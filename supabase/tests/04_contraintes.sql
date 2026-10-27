-- Contraintes du schéma qui portent les invariants de la v1 (specs/catalog-v2-donnees.md) :
-- identifiants par compte, un titre une fois par compte (doublons hérités exceptés), titre sans
-- fiche TMDB, bornes des notes, duels cohérents, sujets du journal, playlists, cascades.
-- SQL simple, transaction annulée à la fin (voir 01_etancheite.sql pour l'exécution).

begin;

insert into auth.users (id, email, is_anonymous) values
  ('00000000-0000-4000-8000-00000000000a', 'a@exemple.test', false),
  ('00000000-0000-4000-8000-00000000000b', null, true);
insert into public.catalog_titles (type, tmdb_id, name) values ('Movie', 603, 'Matrix'), ('Movie', 550, 'Fight Club');

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-00000000000a';
  b constant uuid := '00000000-0000-4000-8000-00000000000b';
  matrix bigint;
  fight bigint;
  n bigint;
begin
  select id into matrix from public.catalog_titles where tmdb_id = 603;
  select id into fight from public.catalog_titles where tmdb_id = 550;

  -- Espaces d'identifiants par compte : A et B peuvent tous deux avoir le titre n° 1 (copie de démo).
  insert into public.library_items (user_id, id, title_id) values (a, 1, matrix), (b, 1, matrix);
  raise notice 'OK identifiants par compte : le titre 1 existe chez A et chez B';

  -- Un titre une fois par compte.
  begin
    insert into public.library_items (user_id, id, title_id) values (a, 2, matrix);
    raise exception 'ÉCHEC : même fiche deux fois chez A';
  exception when unique_violation then null;
  end;
  -- Sauf doublon hérité de la v1, marqué comme tel.
  insert into public.library_items (user_id, id, title_id, import_duplicate) values (a, 2, matrix, true);
  raise notice 'OK doublons : refusés, sauf doublon hérité marqué';

  -- Titre sans fiche : informations locales obligatoires, et jamais les deux à la fois.
  insert into public.library_items (user_id, id, local_name, local_type) values (a, 3, 'Saisi à la main', 'Movie');
  begin
    insert into public.library_items (user_id, id) values (a, 4);
    raise exception 'ÉCHEC : titre sans fiche ni nom accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.library_items (user_id, id, title_id, local_name, local_type) values (a, 5, fight, 'Nom', 'Movie');
    raise exception 'ÉCHEC : fiche partagée et informations locales mêlées acceptées';
  exception when check_violation then null;
  end;
  begin
    insert into public.library_items (user_id, id, local_name, local_type, import_duplicate) values (a, 6, 'X', 'Movie', true);
    raise exception 'ÉCHEC : doublon hérité sans fiche accepté';
  exception when check_violation then null;
  end;

  -- Notes et paliers bornés.
  begin
    update public.library_items set rating = 6 where user_id = a and id = 1;
    raise exception 'ÉCHEC : note 6 acceptée';
  exception when check_violation then null;
  end;
  begin
    update public.library_items set tier_band = 3 where user_id = a and id = 1;
    raise exception 'ÉCHEC : groupe de palier 3 accepté';
  exception when check_violation then null;
  end;
  begin
    update public.library_items set watch_status = 'Seen' where user_id = a and id = 1;
    raise exception 'ÉCHEC : statut inconnu accepté';
  exception when check_violation then null;
  end;
  raise notice 'OK bornes : note 0 à 5, groupe 0 à 2, statut Watched ou Unwatched';

  -- Duels cohérents.
  insert into public.library_items (user_id, id, title_id) values (a, 7, fight);
  begin
    insert into public.duels (user_id, item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
    values (a, 1, 7, 3, 1200, 1200, 1216, 1184);
    raise exception 'ÉCHEC : vainqueur hors de la paire accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.duels (user_id, item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
    values (a, 1, 1, null, 1200, 1200, 1200, 1200);
    raise exception 'ÉCHEC : duel d''un titre contre lui-même accepté';
  exception when check_violation then null;
  end;
  insert into public.duels (user_id, item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
  values (a, 1, 7, 7, 1200, 1200, 1184, 1216);
  select max(id) into n from public.duels where user_id = a;
  if n < 1000000 then raise exception 'ÉCHEC : nouveau duel numéroté % (attendu 1 000 000 ou plus)', n; end if;
  raise notice 'OK duels : paire distincte, vainqueur dans la paire, numérotation à partir de 1 000 000';

  -- Sujets du journal et des titres écartés.
  begin
    insert into public.events (user_id, kind, subject_type, subject_id) values (a, 'opened', 'tmdb', '603');
    raise exception 'ÉCHEC : sujet TMDB sans type accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.events (user_id, kind, subject_type, subject_id) values (a, 'synced', 'item', '1');
    raise exception 'ÉCHEC : geste inconnu accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.dismissals (user_id, subject_type, subject_id) values (a, 'item', 'movie:603');
    raise exception 'ÉCHEC : titre écarté mal formé accepté';
  exception when check_violation then null;
  end;
  -- INSERT OR IGNORE de la v1 : on conflict do nothing, et le nombre de lignes créées.
  insert into public.impressions (user_id, subject_type, subject_id, day, surface) values (a, 'item', '1', '2026-10-20', 'pile');
  insert into public.impressions (user_id, subject_type, subject_id, day, surface) values (a, 'item', '1', '2026-10-20', 'home')
  on conflict do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : impression en double créée'; end if;
  select count(*) into n from public.impressions where user_id = a and surface = 'pile';
  if n <> 1 then raise exception 'ÉCHEC : la première surface n''a pas été gardée'; end if;
  raise notice 'OK journal : sujets bien formés, gestes connus, une impression par titre et par jour';

  -- Avis : une note seulement pour une personne aimée.
  begin
    insert into public.person_opinions (user_id, person_id, name, opinion, rating) values (a, 1001, 'P', -1, 3);
    raise exception 'ÉCHEC : note sur une personne pas aimée acceptée';
  exception when check_violation then null;
  end;

  -- Playlists : nom de 1 à 60 caractères, sans espace en bord.
  begin
    insert into public.playlists (user_id, name) values (a, ' Espace ');
    raise exception 'ÉCHEC : nom avec espaces en bord accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.playlists (user_id, name) values (a, repeat('x', 61));
    raise exception 'ÉCHEC : nom de 61 caractères accepté';
  exception when check_violation then null;
  end;
  insert into public.playlists (user_id, id, name) values (a, 1, 'Ma liste');
  insert into public.playlist_items (user_id, playlist_id, item_id, position) values (a, 1, 1, 0), (a, 1, 7, 1);
  insert into public.elo_snapshot (user_id, item_id, elo_score, duels_count) values (a, 7, 1220, 2);

  -- Retirer un titre : ses duels, instantanés et places en playlist partent avec lui (v1 FR-9).
  delete from public.library_items where user_id = a and id = 7;
  select (select count(*) from public.duels where user_id = a and 7 in (item_a_id, item_b_id))
       + (select count(*) from public.playlist_items where user_id = a and item_id = 7)
       + (select count(*) from public.elo_snapshot where user_id = a and item_id = 7) into n;
  if n <> 0 then raise exception 'ÉCHEC : % ligne(s) orphelines après le retrait du titre', n; end if;
  -- Supprimer une playlist emporte ses titres (pas les titres de la bibliothèque).
  delete from public.playlists where user_id = a and id = 1;
  select count(*) into n from public.playlist_items where user_id = a;
  if n <> 0 then raise exception 'ÉCHEC : places de playlist orphelines'; end if;
  select count(*) into n from public.library_items where user_id = a and id = 1;
  if n <> 1 then raise exception 'ÉCHEC : le titre a disparu avec la playlist'; end if;
  raise notice 'OK cascades : titre retiré, playlist supprimée';

  -- Une fiche partagée utilisée par un compte ne peut pas être supprimée.
  begin
    delete from public.catalog_titles where id = matrix;
    raise exception 'ÉCHEC : fiche utilisée supprimée';
  exception when restrict_violation then null;
  end;
  raise notice 'OK catalogue : une fiche utilisée est protégée';
end $$;

rollback;
