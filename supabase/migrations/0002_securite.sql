-- Catalog v2 : droits et règles d'accès par ligne (RLS).
-- Conception : specs/catalog-v2-donnees.md (section « Sécurité ») ; spec : FR-3, AC-2.
--
-- Principe :
--   - anon (requête sans session) : aucun accès à aucune table de l'application ;
--   - authenticated (compte durable ou invité : les invités Supabase ont aussi ce rôle) :
--       catalogue partagé en lecture seule ; tables personnelles limitées à ses propres lignes,
--       en lecture comme en écriture (user_id = auth.uid()) ;
--   - service_role (serveur) : seul à écrire le catalogue ; il contourne les règles par ligne
--       (attribut bypassrls chez Supabase), il ne sert donc jamais pour une requête d'utilisateur.
--
-- Le serveur Rust exécute chaque requête d'utilisateur dans une transaction qui pose les
-- revendications vérifiées du jeton (request.jwt.claims) puis « set local role authenticated » :
-- les règles ci-dessous s'appliquent alors, en seconde barrière derrière les filtres de l'API.
--
-- auth.uid() est appelé sous la forme (select auth.uid()) : évalué une fois par requête
-- (recommandation Supabase), et null hors session, ce qui ne laisse rien passer.

-- ---------------------------------------------------------------------------------------------
-- Droits par défaut : les prochaines tables créées par postgres dans public ne seront plus
-- ouvertes d'office à anon et authenticated (chaque migration accordera ses droits).
-- ---------------------------------------------------------------------------------------------

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Catalogue partagé : lecture pour tout compte connecté, écriture pour le serveur seulement.
-- ---------------------------------------------------------------------------------------------

alter table public.catalog_titles enable row level security;
alter table public.catalog_people enable row level security;

revoke all on table public.catalog_titles, public.catalog_people from anon, authenticated;
grant select on table public.catalog_titles, public.catalog_people to authenticated;
grant select, insert, update, delete on table public.catalog_titles, public.catalog_people to service_role;

create policy catalog_titles_lecture on public.catalog_titles
  for select to authenticated using (true);
create policy catalog_people_lecture on public.catalog_people
  for select to authenticated using (true);
-- Aucune règle d'écriture pour authenticated : insertion, modification et suppression refusées.

-- ---------------------------------------------------------------------------------------------
-- Tables personnelles : chacune limitée à son propriétaire, pour les quatre opérations.
-- ---------------------------------------------------------------------------------------------

revoke all on table
  public.library_items, public.elo_snapshot, public.duels, public.tier_duels, public.tier_rounds,
  public.person_scores, public.person_duels, public.person_elo_snapshot, public.person_opinions,
  public.events, public.dismissals, public.impressions, public.settings,
  public.playlists, public.playlist_items, public.playlist_suggestion_dismissals
from anon, authenticated;

grant select, insert, update, delete on table
  public.library_items, public.elo_snapshot, public.duels, public.tier_duels, public.tier_rounds,
  public.person_scores, public.person_duels, public.person_elo_snapshot, public.person_opinions,
  public.events, public.dismissals, public.impressions, public.settings,
  public.playlists, public.playlist_items, public.playlist_suggestion_dismissals
to authenticated, service_role;

-- library_items
alter table public.library_items enable row level security;
create policy library_items_lecture on public.library_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy library_items_ajout on public.library_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy library_items_modification on public.library_items
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy library_items_suppression on public.library_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- elo_snapshot
alter table public.elo_snapshot enable row level security;
create policy elo_snapshot_lecture on public.elo_snapshot
  for select to authenticated using (user_id = (select auth.uid()));
create policy elo_snapshot_ajout on public.elo_snapshot
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy elo_snapshot_modification on public.elo_snapshot
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy elo_snapshot_suppression on public.elo_snapshot
  for delete to authenticated using (user_id = (select auth.uid()));

-- duels
alter table public.duels enable row level security;
create policy duels_lecture on public.duels
  for select to authenticated using (user_id = (select auth.uid()));
create policy duels_ajout on public.duels
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy duels_modification on public.duels
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy duels_suppression on public.duels
  for delete to authenticated using (user_id = (select auth.uid()));

-- tier_duels
alter table public.tier_duels enable row level security;
create policy tier_duels_lecture on public.tier_duels
  for select to authenticated using (user_id = (select auth.uid()));
create policy tier_duels_ajout on public.tier_duels
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy tier_duels_modification on public.tier_duels
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy tier_duels_suppression on public.tier_duels
  for delete to authenticated using (user_id = (select auth.uid()));

-- tier_rounds
alter table public.tier_rounds enable row level security;
create policy tier_rounds_lecture on public.tier_rounds
  for select to authenticated using (user_id = (select auth.uid()));
create policy tier_rounds_ajout on public.tier_rounds
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy tier_rounds_modification on public.tier_rounds
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy tier_rounds_suppression on public.tier_rounds
  for delete to authenticated using (user_id = (select auth.uid()));

-- person_scores
alter table public.person_scores enable row level security;
create policy person_scores_lecture on public.person_scores
  for select to authenticated using (user_id = (select auth.uid()));
create policy person_scores_ajout on public.person_scores
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy person_scores_modification on public.person_scores
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy person_scores_suppression on public.person_scores
  for delete to authenticated using (user_id = (select auth.uid()));

-- person_duels
alter table public.person_duels enable row level security;
create policy person_duels_lecture on public.person_duels
  for select to authenticated using (user_id = (select auth.uid()));
create policy person_duels_ajout on public.person_duels
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy person_duels_modification on public.person_duels
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy person_duels_suppression on public.person_duels
  for delete to authenticated using (user_id = (select auth.uid()));

-- person_elo_snapshot
alter table public.person_elo_snapshot enable row level security;
create policy person_elo_snapshot_lecture on public.person_elo_snapshot
  for select to authenticated using (user_id = (select auth.uid()));
create policy person_elo_snapshot_ajout on public.person_elo_snapshot
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy person_elo_snapshot_modification on public.person_elo_snapshot
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy person_elo_snapshot_suppression on public.person_elo_snapshot
  for delete to authenticated using (user_id = (select auth.uid()));

-- person_opinions
alter table public.person_opinions enable row level security;
create policy person_opinions_lecture on public.person_opinions
  for select to authenticated using (user_id = (select auth.uid()));
create policy person_opinions_ajout on public.person_opinions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy person_opinions_modification on public.person_opinions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy person_opinions_suppression on public.person_opinions
  for delete to authenticated using (user_id = (select auth.uid()));

-- events
alter table public.events enable row level security;
create policy events_lecture on public.events
  for select to authenticated using (user_id = (select auth.uid()));
create policy events_ajout on public.events
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy events_modification on public.events
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy events_suppression on public.events
  for delete to authenticated using (user_id = (select auth.uid()));

-- dismissals
alter table public.dismissals enable row level security;
create policy dismissals_lecture on public.dismissals
  for select to authenticated using (user_id = (select auth.uid()));
create policy dismissals_ajout on public.dismissals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy dismissals_modification on public.dismissals
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy dismissals_suppression on public.dismissals
  for delete to authenticated using (user_id = (select auth.uid()));

-- impressions
alter table public.impressions enable row level security;
create policy impressions_lecture on public.impressions
  for select to authenticated using (user_id = (select auth.uid()));
create policy impressions_ajout on public.impressions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy impressions_modification on public.impressions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy impressions_suppression on public.impressions
  for delete to authenticated using (user_id = (select auth.uid()));

-- settings
alter table public.settings enable row level security;
create policy settings_lecture on public.settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy settings_ajout on public.settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy settings_modification on public.settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy settings_suppression on public.settings
  for delete to authenticated using (user_id = (select auth.uid()));

-- playlists
alter table public.playlists enable row level security;
create policy playlists_lecture on public.playlists
  for select to authenticated using (user_id = (select auth.uid()));
create policy playlists_ajout on public.playlists
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy playlists_modification on public.playlists
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy playlists_suppression on public.playlists
  for delete to authenticated using (user_id = (select auth.uid()));

-- playlist_items
alter table public.playlist_items enable row level security;
create policy playlist_items_lecture on public.playlist_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy playlist_items_ajout on public.playlist_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy playlist_items_modification on public.playlist_items
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy playlist_items_suppression on public.playlist_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- playlist_suggestion_dismissals
alter table public.playlist_suggestion_dismissals enable row level security;
create policy playlist_suggestion_dismissals_lecture on public.playlist_suggestion_dismissals
  for select to authenticated using (user_id = (select auth.uid()));
create policy playlist_suggestion_dismissals_ajout on public.playlist_suggestion_dismissals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy playlist_suggestion_dismissals_modification on public.playlist_suggestion_dismissals
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy playlist_suggestion_dismissals_suppression on public.playlist_suggestion_dismissals
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Vue de lecture : jamais pour anon ; pour authenticated, elle applique les règles ci-dessus
-- (security_invoker, posé dans 0001).
-- ---------------------------------------------------------------------------------------------

revoke all on table public.library_view from anon, authenticated;
grant select on table public.library_view to authenticated, service_role;
