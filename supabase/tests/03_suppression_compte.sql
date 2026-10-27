-- FR-9, AC-7 : supprimer un compte efface toutes ses lignes, dans toutes les tables qui portent
-- user_id (y compris les tables ajoutées plus tard : la liste est lue dans le catalogue système),
-- sans toucher aux autres comptes ni au catalogue partagé.
-- La suppression passe par auth.users (ce que fait la suppression d'un utilisateur Supabase) ;
-- les clés étrangères « on delete cascade » font le reste.
-- SQL simple, transaction annulée à la fin (voir 01_etancheite.sql pour l'exécution).

begin;

insert into auth.users (id, email, is_anonymous) values
  ('00000000-0000-4000-8000-00000000000a', 'a@exemple.test', false),
  ('00000000-0000-4000-8000-00000000000b', null, true);

insert into public.catalog_titles (type, tmdb_id, name) values ('Movie', 603, 'Matrix'), ('Movie', 550, 'Fight Club');
insert into public.catalog_people (id, name) values (1001, 'Personne 1'), (1002, 'Personne 2');

-- Les deux comptes ont une ligne dans chaque table personnelle.
do $$
declare
  u uuid;
  base int;
begin
  foreach u in array array['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b']::uuid[] loop
    base := case when u = '00000000-0000-4000-8000-00000000000a' then 100 else 200 end;
    insert into public.library_items (user_id, id, title_id, watch_status, rating)
      select u, base + 1, id, 'Watched', 4 from public.catalog_titles where tmdb_id = 603;
    insert into public.library_items (user_id, id, title_id, watch_status)
      select u, base + 2, id, 'Watched' from public.catalog_titles where tmdb_id = 550;
    insert into public.elo_snapshot (user_id, item_id, elo_score, duels_count) values (u, base + 1, 1210, 1);
    insert into public.duels (user_id, id, item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
      values (u, base + 11, base + 1, base + 2, base + 1, 1200, 1200, 1216, 1184);
    insert into public.tier_duels (user_id, id, item_a_id, item_b_id, winner_id, rating, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
      values (u, base + 12, base + 1, base + 2, null, 4, 1200, 1200, 1200, 1200);
    insert into public.tier_rounds (user_id, id, rating, kind, payload) values (u, base + 13, 4, 'quad', '{"items": []}');
    insert into public.person_scores (user_id, person_id) values (u, 1001), (u, 1002);
    insert into public.person_duels (user_id, id, person_a_id, person_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
      values (u, base + 14, 1001, 1002, 1002, 1200, 1200, 1184, 1216);
    insert into public.person_elo_snapshot (user_id, person_id, elo_score, duels_count) values (u, 1001, 1240, 2);
    insert into public.person_opinions (user_id, person_id, name, opinion, rating) values (u, 1001, 'Personne 1', 1, 4);
    insert into public.events (user_id, id, kind, subject_type, subject_id) values (u, base + 15, 'opened', 'item', (base + 1)::text);
    insert into public.dismissals (user_id, subject_type, subject_id) values (u, 'tmdb', 'movie:550');
    insert into public.impressions (user_id, subject_type, subject_id, day, surface) values (u, 'tmdb', 'movie:603', '2026-10-20', 'discover');
    insert into public.settings (user_id, key, value) values (u, 'streaming_subscriptions', '[8]');
    insert into public.playlists (user_id, id, name) values (u, base + 16, 'Ma playlist');
    insert into public.playlist_items (user_id, playlist_id, item_id, position) values (u, base + 16, base + 1, 0);
    insert into public.playlist_suggestion_dismissals (user_id, playlist_id, item_id) values (u, base + 16, base + 2);
  end loop;
end $$;

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-00000000000a';
  b constant uuid := '00000000-0000-4000-8000-00000000000b';
  r record;
  n bigint;
  tables text[] := '{}';
  avant_b text[] := '{}';
  empreinte text;
  i int;
  catalogue_avant bigint;
begin
  -- Toutes les tables de public qui portent user_id.
  select array_agg(c.relname::text order by c.relname) into tables
  from pg_class c
  join pg_namespace s on s.oid = c.relnamespace
  join pg_attribute att on att.attrelid = c.oid and att.attname = 'user_id' and not att.attisdropped
  where s.nspname = 'public' and c.relkind = 'r';
  if array_length(tables, 1) <> 16 then
    raise exception 'ÉCHEC : % table(s) personnelle(s) trouvée(s) au lieu de 16', array_length(tables, 1);
  end if;

  for i in 1 .. array_length(tables, 1) loop
    execute format('select count(*) from public.%I where user_id = $1', tables[i]) using a into n;
    if n = 0 then raise exception 'ÉCHEC préparation : aucune ligne de A dans %', tables[i]; end if;
    execute format('select md5(coalesce(string_agg(to_jsonb(x)::text, ''|'' order by to_jsonb(x)::text), '''')) from public.%I x where user_id = $1', tables[i]) using b into empreinte;
    avant_b := avant_b || empreinte;
  end loop;
  select count(*) into catalogue_avant from public.catalog_titles;

  -- Suppression du compte A.
  delete from auth.users where id = a;

  for i in 1 .. array_length(tables, 1) loop
    execute format('select count(*) from public.%I where user_id = $1', tables[i]) using a into n;
    if n <> 0 then raise exception 'ÉCHEC : % ligne(s) de A restent dans %', n, tables[i]; end if;
    execute format('select md5(coalesce(string_agg(to_jsonb(x)::text, ''|'' order by to_jsonb(x)::text), '''')) from public.%I x where user_id = $1', tables[i]) using b into empreinte;
    if empreinte <> avant_b[i] then raise exception 'ÉCHEC : les données de B ont changé dans %', tables[i]; end if;
  end loop;

  select count(*) into n from public.catalog_titles;
  if n <> catalogue_avant then raise exception 'ÉCHEC : le catalogue partagé a perdu des fiches'; end if;

  -- Aucune trace de A ailleurs dans public (colonne uuid égale à son identifiant).
  for r in
    select c.relname, att.attname
    from pg_class c
    join pg_namespace s on s.oid = c.relnamespace
    join pg_attribute att on att.attrelid = c.oid and att.atttypid = 'uuid'::regtype and att.attnum > 0 and not att.attisdropped
    where s.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('select count(*) from public.%I where %I = $1', r.relname, r.attname) using a into n;
    if n <> 0 then raise exception 'ÉCHEC : % trace(s) de A dans %.%', n, r.relname, r.attname; end if;
  end loop;

  raise notice 'OK suppression : plus aucune ligne de A dans les 16 tables personnelles ; B et le catalogue intacts';
end $$;

rollback;
