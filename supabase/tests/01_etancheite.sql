-- AC-2 (FR-3) : un compte B ne peut ni lire, ni modifier, ni supprimer les données d'un compte A,
-- ni écrire des données au nom de A, ni rattacher ses lignes à celles de A ; la base le refuse
-- même sans le filtre de l'API. Table par table, plus des contrôles de structure qui protègent
-- aussi les tables à venir.
--
-- SQL simple (pas pgTAP) : chaque bloc lève une exception au premier écart, « OK ... » sinon.
-- Tout se passe dans une transaction annulée à la fin : aucune trace dans la base.
-- Exécution : psql -v ON_ERROR_STOP=1 -f supabase/tests/01_etancheite.sql (en postgres), ou le
-- banc PGlite décrit dans specs/catalog-v2-donnees.md.
-- A est un compte durable ; B est un invité (connexion anonyme, rôle authenticated aussi).

begin;

-- ---------------------------------------------------------------------------------------------
-- Données d'essai, écrites comme le ferait le serveur (rôle postgres, hors règles par ligne).
-- Identifiants de A : 1xx ; de B : 2xx. Personnes : 1001 et 1002 pour A, 1002 et 1003 pour B.
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, is_anonymous) values
  ('00000000-0000-4000-8000-00000000000a', 'a@exemple.test', false),
  ('00000000-0000-4000-8000-00000000000b', null, true);

insert into public.catalog_titles (type, tmdb_id, name, year, genres, overview) values
  ('Movie', 603, 'Matrix', '1999', '["Action", "Science Fiction"]', 'Synopsis.'),
  ('Movie', 550, 'Fight Club', '1999', '["Drama"]', ''),
  ('TV Series', 1399, 'Game of Thrones', '2011 - 2019', '["Drama"]', null);

insert into public.catalog_people (id, name) values (1001, 'Personne 1'), (1002, 'Personne 2'), (1003, 'Personne 3');

insert into public.library_items (user_id, id, title_id, watch_status, rating, elo_score, duels_count) values
  ('00000000-0000-4000-8000-00000000000a', 101, (select id from public.catalog_titles where type = 'Movie' and tmdb_id = 603), 'Watched', 5, 1216, 1),
  ('00000000-0000-4000-8000-00000000000a', 102, (select id from public.catalog_titles where type = 'Movie' and tmdb_id = 550), 'Watched', 3, 1184, 1),
  ('00000000-0000-4000-8000-00000000000b', 201, (select id from public.catalog_titles where type = 'Movie' and tmdb_id = 603), 'Watched', 2, 1200, 0),
  ('00000000-0000-4000-8000-00000000000b', 202, (select id from public.catalog_titles where type = 'TV Series' and tmdb_id = 1399), 'Watched', 4, 1200, 0);
insert into public.library_items (user_id, id, local_name, local_type, local_year, local_genres, watch_status) values
  ('00000000-0000-4000-8000-00000000000a', 103, 'Titre saisi à la main', 'Movie', '2019', '["Documentary"]', 'Unwatched');

insert into public.elo_snapshot (user_id, item_id, elo_score, duels_count) values
  ('00000000-0000-4000-8000-00000000000a', 101, 1231.5, 2),
  ('00000000-0000-4000-8000-00000000000b', 201, 1190, 1);

insert into public.duels (user_id, id, item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after) values
  ('00000000-0000-4000-8000-00000000000a', 11, 101, 102, 101, 1200, 1200, 1216, 1184),
  ('00000000-0000-4000-8000-00000000000b', 21, 201, 202, null, 1200, 1200, 1200, 1200);

insert into public.tier_duels (user_id, id, item_a_id, item_b_id, winner_id, rating, elo_a_before, elo_b_before, elo_a_after, elo_b_after) values
  ('00000000-0000-4000-8000-00000000000a', 12, 101, 102, 102, 4, 1200, 1200, 1184, 1216),
  ('00000000-0000-4000-8000-00000000000b', 22, 201, 202, 201, 3, 1200, 1200, 1216, 1184);

insert into public.tier_rounds (user_id, id, rating, kind, payload) values
  ('00000000-0000-4000-8000-00000000000a', 13, 5, 'band', '{"items": [{"id": 101, "before": {"elo": 1200, "count": 0, "band": null, "rating": null}, "after": {"elo": 1200, "count": 0, "band": 2, "rating": 5}}]}'),
  ('00000000-0000-4000-8000-00000000000b', 23, 4, 'band', '{"items": [{"id": 202, "before": {"elo": 1200, "count": 0, "band": null, "rating": null}, "after": {"elo": 1200, "count": 0, "band": 1, "rating": 4}}]}');

insert into public.person_scores (user_id, person_id, elo_score, duels_count) values
  ('00000000-0000-4000-8000-00000000000a', 1001, 1216, 1),
  ('00000000-0000-4000-8000-00000000000a', 1002, 1184, 1),
  ('00000000-0000-4000-8000-00000000000b', 1002, 1200, 1),
  ('00000000-0000-4000-8000-00000000000b', 1003, 1200, 1);

insert into public.person_duels (user_id, id, person_a_id, person_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after) values
  ('00000000-0000-4000-8000-00000000000a', 14, 1001, 1002, 1001, 1200, 1200, 1216, 1184),
  ('00000000-0000-4000-8000-00000000000b', 24, 1002, 1003, null, 1200, 1200, 1200, 1200);

insert into public.person_elo_snapshot (user_id, person_id, elo_score, duels_count) values
  ('00000000-0000-4000-8000-00000000000a', 1001, 1250, 3),
  ('00000000-0000-4000-8000-00000000000b', 1003, 1150, 2);

insert into public.person_opinions (user_id, person_id, name, opinion, rating) values
  ('00000000-0000-4000-8000-00000000000a', 1001, 'Personne 1', 1, 5),
  ('00000000-0000-4000-8000-00000000000b', 1003, 'Personne 3', -1, null);

insert into public.events (user_id, id, kind, subject_type, subject_id, context) values
  ('00000000-0000-4000-8000-00000000000a', 15, 'rated', 'item', '101', '{"rating": 5}'),
  ('00000000-0000-4000-8000-00000000000b', 25, 'triage', 'tmdb', 'movie:550', '{"family": "unseen", "answer": "skip"}');

insert into public.dismissals (user_id, subject_type, subject_id) values
  ('00000000-0000-4000-8000-00000000000a', 'tmdb', 'movie:550'),
  ('00000000-0000-4000-8000-00000000000b', 'tmdb', 'tv:1399');

insert into public.impressions (user_id, subject_type, subject_id, day, surface) values
  ('00000000-0000-4000-8000-00000000000a', 'item', '101', '2026-10-20', 'pile'),
  ('00000000-0000-4000-8000-00000000000b', 'item', '201', '2026-10-20', 'home');

-- Clés différentes : la copie d'une ligne de B au nom de A ne heurte aucune clé existante, seule
-- la règle d'accès peut la refuser.
insert into public.settings (user_id, key, value) values
  ('00000000-0000-4000-8000-00000000000a', 'streaming_subscriptions', '[8, 119]'),
  ('00000000-0000-4000-8000-00000000000b', 'reglage_essai_b', '"b"');

insert into public.playlists (user_id, id, name) values
  ('00000000-0000-4000-8000-00000000000a', 16, 'Playlist de A'),
  ('00000000-0000-4000-8000-00000000000b', 26, 'Playlist de B');

insert into public.playlist_items (user_id, playlist_id, item_id, position) values
  ('00000000-0000-4000-8000-00000000000a', 16, 101, 0),
  ('00000000-0000-4000-8000-00000000000b', 26, 201, 0);

insert into public.playlist_suggestion_dismissals (user_id, playlist_id, item_id) values
  ('00000000-0000-4000-8000-00000000000a', 16, 102),
  ('00000000-0000-4000-8000-00000000000b', 26, 202);

-- ---------------------------------------------------------------------------------------------
-- 1. Structure : toute table de public a la RLS ; toute table portant user_id a ses quatre règles,
--    n'est pas ouverte à anon ; toute clé étrangère entre deux tables personnelles inclut user_id.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  r record;
  n int;
begin
  for r in
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r'
  loop
    if not r.relrowsecurity then
      raise exception 'ÉCHEC structure : RLS désactivée sur %', r.relname;
    end if;
    if has_table_privilege('anon', 'public.' || quote_ident(r.relname), 'select')
       or has_table_privilege('anon', 'public.' || quote_ident(r.relname), 'insert')
       or has_table_privilege('anon', 'public.' || quote_ident(r.relname), 'update')
       or has_table_privilege('anon', 'public.' || quote_ident(r.relname), 'delete') then
      raise exception 'ÉCHEC structure : anon a un droit sur %', r.relname;
    end if;
  end loop;

  for r in
    select c.relname
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where s.nspname = 'public' and c.relkind = 'r'
  loop
    -- Exactement quatre règles (lecture, ajout, modification, suppression), permissives, pour
    -- authenticated seul, et chacune limitée au propriétaire là où PostgreSQL l'évalue :
    -- using pour lecture, modification, suppression ; with check pour ajout et modification.
    select count(*) into n
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = r.relname;
    if n <> 4 then
      raise exception 'ÉCHEC structure : % a % règle(s) au lieu de 4', r.relname, n;
    end if;
    select count(distinct p.cmd) into n
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = r.relname
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['authenticated']::name[]
      and p.cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      and (case when p.cmd = 'INSERT' then p.qual is null
                else regexp_replace(lower(coalesce(p.qual, '')), '\s', '', 'g') = '(user_id=(selectauth.uid()asuid))' end)
      and (case when p.cmd in ('INSERT', 'UPDATE')
                then regexp_replace(lower(coalesce(p.with_check, '')), '\s', '', 'g') = '(user_id=(selectauth.uid()asuid))'
                else p.with_check is null end);
    if n <> 4 then
      raise exception 'ÉCHEC structure : % n''a que % règle(s) conforme(s) sur 4 (propriétaire = auth.uid())', r.relname, n;
    end if;
  end loop;

  -- Clés étrangères entre deux tables qui ont chacune user_id : user_id doit être apparié à user_id.
  for r in
    select con.conname, src.relname as source, dst.relname as cible
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class dst on dst.oid = con.confrelid
    join pg_namespace s on s.oid = src.relnamespace
    where con.contype = 'f' and s.nspname = 'public'
      and exists (select 1 from pg_attribute a where a.attrelid = con.conrelid and a.attname = 'user_id')
      and exists (select 1 from pg_attribute a where a.attrelid = con.confrelid and a.attname = 'user_id')
      and not exists (
        select 1
        from unnest(con.conkey, con.confkey) as k(src_att, dst_att)
        join pg_attribute sa on sa.attrelid = con.conrelid and sa.attnum = k.src_att
        join pg_attribute da on da.attrelid = con.confrelid and da.attnum = k.dst_att
        where sa.attname = 'user_id' and da.attname = 'user_id'
      )
  loop
    raise exception 'ÉCHEC structure : la clé étrangère % (% vers %) n''inclut pas user_id', r.conname, r.source, r.cible;
  end loop;

  -- La vue de lecture applique les règles de qui l'interroge.
  if not exists (
    select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relname = 'library_view'
      and c.reloptions @> array['security_invoker=true']
  ) then
    raise exception 'ÉCHEC structure : library_view sans security_invoker';
  end if;

  raise notice 'OK structure : RLS partout, anon sans droit, 4 règles par table personnelle, clés étrangères appariées par user_id';
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. B contre A, table par table : lire, modifier, supprimer, écrire au nom de A, s'approprier
--    ou céder des lignes. Les empreintes des lignes de A et de B sont comparées avant et après.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-00000000000a';
  b constant uuid := '00000000-0000-4000-8000-00000000000b';
  tables constant text[] := array[
    'library_items', 'elo_snapshot', 'duels', 'tier_duels', 'tier_rounds',
    'person_scores', 'person_duels', 'person_elo_snapshot', 'person_opinions',
    'events', 'dismissals', 'impressions', 'settings',
    'playlists', 'playlist_items', 'playlist_suggestion_dismissals'];
  t text;
  n bigint;
  i int;
  avant_a text[] := '{}';
  avant_b text[] := '{}';
  compte_b bigint[] := '{}';
  empreinte text;
begin
  -- Empreintes et comptes, vus par le serveur.
  foreach t in array tables loop
    execute format('select count(*) from public.%I where user_id = $1', t) using a into n;
    if n = 0 then raise exception 'ÉCHEC préparation : aucune ligne de A dans %', t; end if;
    execute format('select count(*) from public.%I where user_id = $1', t) using b into n;
    if n = 0 then raise exception 'ÉCHEC préparation : aucune ligne de B dans %', t; end if;
    compte_b := compte_b || n;
    execute format('select md5(coalesce(string_agg(to_jsonb(x)::text, ''|'' order by to_jsonb(x)::text), '''')) from public.%I x where user_id = $1', t) using a into empreinte;
    avant_a := avant_a || empreinte;
    execute format('select md5(coalesce(string_agg(to_jsonb(x)::text, ''|'' order by to_jsonb(x)::text), '''')) from public.%I x where user_id = $1', t) using b into empreinte;
    avant_b := avant_b || empreinte;
  end loop;

  -- B se connecte (jeton d'invité).
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  set local role authenticated;

  for i in 1 .. array_length(tables, 1) loop
    t := tables[i];

    -- Lire : rien de A, ni par filtre, ni sans filtre.
    execute format('select count(*) from public.%I where user_id = $1', t) using a into n;
    if n <> 0 then raise exception 'ÉCHEC % : B lit % ligne(s) de A', t, n; end if;
    execute format('select count(*) from public.%I', t) into n;
    if n <> compte_b[i] then raise exception 'ÉCHEC % : B voit % ligne(s) au lieu de ses %', t, n, compte_b[i]; end if;

    -- Modifier ou supprimer les lignes de A : aucune ligne touchée.
    execute format('update public.%I set user_id = $2 where user_id = $1', t) using a, b;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'ÉCHEC % : B s''approprie % ligne(s) de A', t, n; end if;
    execute format('delete from public.%I where user_id = $1', t) using a;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'ÉCHEC % : B supprime % ligne(s) de A', t, n; end if;

    -- Une modification sans filtre ne touche que les lignes de B.
    execute format('update public.%I set user_id = user_id', t);
    get diagnostics n = row_count;
    if n <> compte_b[i] then raise exception 'ÉCHEC % : une modification sans filtre touche % ligne(s)', t, n; end if;

    -- Écrire au nom de A (copie d'une ligne de B réécrite pour A) : refusé par la règle (42501).
    begin
      execute format(
        'insert into public.%I select (jsonb_populate_record(null::public.%I, to_jsonb(x) || jsonb_build_object(''user_id'', $1))).* from public.%I x where user_id = $2 limit 1',
        t, t, t) using a, b;
      raise exception 'ÉCHEC % : B a écrit une ligne au nom de A', t;
    exception when insufficient_privilege then
      null;
    end;

    -- Céder ses lignes à A : refusé (42501). Deux formes : avec un filtre (la règle de lecture
    -- s'applique alors aussi à la nouvelle ligne) et sans filtre (seul le with check protège).
    begin
      execute format('update public.%I set user_id = $1 where user_id = $2', t) using a, b;
      raise exception 'ÉCHEC % : B a transféré ses lignes à A', t;
    exception when insufficient_privilege then
      null;
    end;
    begin
      execute format('update public.%I set user_id = $1', t) using a;
      raise exception 'ÉCHEC % : B a transféré ses lignes à A (sans filtre)', t;
    exception when insufficient_privilege then
      null;
    end;
  end loop;

  -- La vue de lecture : seulement les titres de B.
  select count(*) into n from public.library_view where user_id = a;
  if n <> 0 then raise exception 'ÉCHEC library_view : B lit % titre(s) de A', n; end if;
  select count(*) into n from public.library_view;
  if n <> 2 then raise exception 'ÉCHEC library_view : B voit % titre(s) au lieu de 2', n; end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- Rien n'a bougé, ni chez A ni chez B.
  for i in 1 .. array_length(tables, 1) loop
    t := tables[i];
    execute format('select md5(coalesce(string_agg(to_jsonb(x)::text, ''|'' order by to_jsonb(x)::text), '''')) from public.%I x where user_id = $1', t) using a into empreinte;
    if empreinte <> avant_a[i] then raise exception 'ÉCHEC % : les données de A ont changé', t; end if;
    execute format('select md5(coalesce(string_agg(to_jsonb(x)::text, ''|'' order by to_jsonb(x)::text), '''')) from public.%I x where user_id = $1', t) using b into empreinte;
    if empreinte <> avant_b[i] then raise exception 'ÉCHEC % : les données de B ont changé', t; end if;
  end loop;

  raise notice 'OK étanchéité : 16 tables personnelles, B ne lit, ne modifie, ne supprime, ni n''écrit pour A ; vue comprise';
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. B vise des identifiants de A (comme une API qui oublierait son filtre) : rien n'est lu ni
--    touché ; et B ne peut pas rattacher ses lignes à celles de A (clés étrangères avec user_id).
-- ---------------------------------------------------------------------------------------------

do $$
declare
  b constant uuid := '00000000-0000-4000-8000-00000000000b';
  n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Par identifiant, sans filtre de compte.
  select count(*) into n from public.library_items where id in (101, 102, 103);
  if n <> 0 then raise exception 'ÉCHEC : B lit un titre de A par son identifiant'; end if;
  update public.library_items set rating = 0, watch_status = 'Unwatched' where id = 101;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : B modifie la note d''un titre de A'; end if;
  delete from public.playlists where id = 16;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : B supprime une playlist de A'; end if;
  delete from public.duels where id = 11;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : B supprime un duel de A'; end if;
  update public.tier_rounds set payload = '{"items": []}' where id = 13;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : B modifie un départage de A'; end if;
  update public.person_opinions set opinion = -1, rating = null where person_id = 1001;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : B modifie un avis de A'; end if;
  select count(*) into n from public.settings where key = 'streaming_subscriptions' and value = '[8, 119]';
  if n <> 0 then raise exception 'ÉCHEC : B lit les abonnements de A'; end if;

  -- Rattacher ses lignes à celles de A : la clé étrangère (user_id, ...) le refuse (23503).
  begin
    insert into public.duels (user_id, item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
    values (b, 101, 102, 101, 1200, 1200, 1216, 1184);
    raise exception 'ÉCHEC : duel de B sur des titres de A accepté';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.duels (user_id, item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
    values (b, 201, 101, 201, 1200, 1200, 1216, 1184);
    raise exception 'ÉCHEC : duel mêlant un titre de B et un titre de A accepté';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.tier_duels (user_id, item_a_id, item_b_id, winner_id, rating, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
    values (b, 101, 202, null, 4, 1200, 1200, 1200, 1200);
    raise exception 'ÉCHEC : départage de B sur un titre de A accepté';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.elo_snapshot (user_id, item_id, elo_score, duels_count) values (b, 101, 1300, 9);
    raise exception 'ÉCHEC : instantané de B sur un titre de A accepté';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.playlist_items (user_id, playlist_id, item_id, position) values (b, 16, 201, 1);
    raise exception 'ÉCHEC : B ajoute un titre dans la playlist de A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.playlist_items (user_id, playlist_id, item_id, position) values (b, 26, 101, 1);
    raise exception 'ÉCHEC : B met un titre de A dans sa playlist';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.playlist_suggestion_dismissals (user_id, playlist_id, item_id) values (b, 16, 201);
    raise exception 'ÉCHEC : B écarte une suggestion dans la playlist de A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.person_duels (user_id, person_a_id, person_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
    values (b, 1001, 1003, 1001, 1200, 1200, 1216, 1184);
    raise exception 'ÉCHEC : duel de B sur une personne qu''il n''a pas dans ses scores';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.person_elo_snapshot (user_id, person_id, elo_score, duels_count) values (b, 1001, 1300, 9);
    raise exception 'ÉCHEC : instantané de B sur un score de A accepté';
  exception when foreign_key_violation then null;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- Côté serveur : les lignes de A visées sont intactes.
  select count(*) into n from public.library_items
  where user_id = '00000000-0000-4000-8000-00000000000a' and id = 101 and rating = 5 and watch_status = 'Watched';
  if n <> 1 then raise exception 'ÉCHEC : le titre 101 de A a changé'; end if;
  select count(*) into n from public.playlists where user_id = '00000000-0000-4000-8000-00000000000a' and id = 16;
  if n <> 1 then raise exception 'ÉCHEC : la playlist 16 de A a disparu'; end if;

  raise notice 'OK identifiants : B ne lit ni ne touche les lignes de A par leur identifiant, et ne peut pas s''y rattacher';
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Sans session : anon n'a aucun droit ; authenticated sans identifiant ne voit rien.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  t text;
  n bigint;
  toutes constant text[] := array[
    'catalog_titles', 'catalog_people', 'library_view',
    'library_items', 'elo_snapshot', 'duels', 'tier_duels', 'tier_rounds',
    'person_scores', 'person_duels', 'person_elo_snapshot', 'person_opinions',
    'events', 'dismissals', 'impressions', 'settings',
    'playlists', 'playlist_items', 'playlist_suggestion_dismissals'];
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  foreach t in array toutes loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      raise exception 'ÉCHEC anon : lecture de % permise', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  reset role;

  set local role authenticated;
  foreach t in array toutes loop
    continue when t in ('catalog_titles', 'catalog_people');
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then raise exception 'ÉCHEC sans identifiant : % ligne(s) visibles dans %', n, t; end if;
  end loop;
  begin
    insert into public.settings (user_id, key, value) values ('00000000-0000-4000-8000-00000000000a', 'intrus', '1');
    raise exception 'ÉCHEC sans identifiant : écriture au nom de A permise';
  exception when insufficient_privilege then null;
  end;
  begin
    -- user_id par défaut : auth.uid(), null ici, donc refusé par la contrainte not null.
    insert into public.settings (key, value) values ('intrus', '1');
    raise exception 'ÉCHEC sans identifiant : écriture sans propriétaire permise';
  exception when not_null_violation or insufficient_privilege then null;
  end;
  reset role;

  raise notice 'OK sans session : anon refusé partout, authenticated sans identifiant ne voit ni n''écrit rien';
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Le serveur (service_role) voit et écrit tout : c'est le chemin de l'import et du catalogue,
--    jamais celui d'une requête d'utilisateur.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  n bigint;
begin
  set local role service_role;
  select count(distinct user_id) into n from public.library_items;
  if n <> 2 then raise exception 'ÉCHEC service_role : % compte(s) visibles au lieu de 2', n; end if;
  insert into public.settings (user_id, key, value) values ('00000000-0000-4000-8000-00000000000a', 'essai_serveur', 'true');
  reset role;
  raise notice 'OK service_role : lecture et écriture de toutes les lignes (contournement attendu)';
end $$;

rollback;
