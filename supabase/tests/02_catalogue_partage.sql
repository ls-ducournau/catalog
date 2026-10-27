-- FR-4 : le catalogue partagé (fiches TMDB, personnes) est lisible par tout compte connecté, invité
-- compris, et n'est écrit que par le serveur. Un compte ne peut ni l'altérer pour les autres, ni
-- y glisser une donnée personnelle.
-- SQL simple, transaction annulée à la fin (voir 01_etancheite.sql pour l'exécution).

begin;

insert into auth.users (id, email, is_anonymous) values
  ('00000000-0000-4000-8000-00000000000a', 'a@exemple.test', false),
  ('00000000-0000-4000-8000-00000000000b', null, true);

-- Écrit par le serveur.
do $$
begin
  set local role service_role;
  insert into public.catalog_titles (type, tmdb_id, name, year, genres, overview, watch_providers, availability_fetched_at)
  values
    ('Movie', 603, 'Matrix', '1999', '["Action", "Science Fiction"]', 'Synopsis.',
     '{"link": null, "flatrate": [{"id": 8, "name": "Netflix", "logoPath": null}], "free": [], "ads": [], "rent": [], "buy": [], "fetchedAt": "2026-10-20T10:00:00.000Z"}',
     '2026-10-20T10:00:00.000Z'),
    -- Même numéro TMDB, autre type : deux fiches distinctes.
    ('TV Series', 603, 'Une série homonyme', '2020 -', '["Drama"]', null, null, null);
  insert into public.catalog_people (id, name, profile_path) values (1001, 'Personne 1', '/p.jpg');
  update public.catalog_titles set overview = 'Synopsis mis à jour.', updated_at = now() where tmdb_id = 603 and type = 'Movie';
  reset role;
  raise notice 'OK serveur : écriture du catalogue';
end $$;

do $$
declare
  qui uuid;
  n bigint;
begin
  foreach qui in array array['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', qui, 'role', 'authenticated')::text, true);
    set local role authenticated;

    select count(*) into n from public.catalog_titles;
    if n <> 2 then raise exception 'ÉCHEC lecture catalogue (%): % fiche(s) au lieu de 2', qui, n; end if;
    select count(*) into n from public.catalog_people;
    if n <> 1 then raise exception 'ÉCHEC lecture personnes (%): % au lieu de 1', qui, n; end if;

    begin
      insert into public.catalog_titles (type, tmdb_id, name) values ('Movie', 999, 'Fiche pirate');
      raise exception 'ÉCHEC : % ajoute une fiche au catalogue', qui;
    exception when insufficient_privilege then null;
    end;
    begin
      update public.catalog_titles set name = 'Titre détourné' where tmdb_id = 603;
      raise exception 'ÉCHEC : % modifie une fiche du catalogue', qui;
    exception when insufficient_privilege then null;
    end;
    begin
      delete from public.catalog_titles where tmdb_id = 603;
      raise exception 'ÉCHEC : % supprime une fiche du catalogue', qui;
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.catalog_people (id, name) values (1002, 'Nom inventé');
      raise exception 'ÉCHEC : % ajoute une personne au catalogue', qui;
    exception when insufficient_privilege then null;
    end;
    begin
      update public.catalog_people set name = 'Nom détourné' where id = 1001;
      raise exception 'ÉCHEC : % renomme une personne du catalogue', qui;
    exception when insufficient_privilege then null;
    end;

    -- Chacun peut rattacher une fiche partagée à sa propre bibliothèque.
    insert into public.library_items (title_id) select id from public.catalog_titles where type = 'Movie' and tmdb_id = 603;

    reset role;
    perform set_config('request.jwt.claims', '', true);
  end loop;

  -- Côté serveur : la fiche n'a pas été altérée, et chacun a sa propre ligne de bibliothèque.
  select count(*) into n from public.catalog_titles where type = 'Movie' and tmdb_id = 603 and name = 'Matrix' and overview = 'Synopsis mis à jour.';
  if n <> 1 then raise exception 'ÉCHEC : la fiche partagée a été altérée'; end if;
  select count(distinct user_id) into n from public.library_items;
  if n <> 2 then raise exception 'ÉCHEC : % compte(s) ont la fiche au lieu de 2', n; end if;
  select count(*) into n from public.library_items where id < 1000000;
  if n <> 0 then raise exception 'ÉCHEC : un nouvel identifiant personnel est sous 1 000 000'; end if;

  raise notice 'OK catalogue : lu par le compte durable et par l''invité, écrit par le serveur seul';
end $$;

-- Un filtre de disponibilité et un filtre de genre, tels que la v2 les écrira (sections
-- « Équivalences » du document de conception), lus par un compte.
do $$
declare
  n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000000a', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.library_view v
  where v.genres @> '["Science Fiction"]'::jsonb
    and exists (
      select 1 from jsonb_array_elements(coalesce(v.watch_providers -> 'flatrate', '[]') || coalesce(v.watch_providers -> 'free', '[]') || coalesce(v.watch_providers -> 'ads', '[]')) p
      where (p ->> 'id')::int = any (array[8, 119])
    );
  if n <> 1 then raise exception 'ÉCHEC équivalence : % titre(s) au lieu de 1', n; end if;
  reset role;
  raise notice 'OK requêtes de la v2 (genre, disponibilité) sur la vue, sous les règles du compte';
end $$;

rollback;
