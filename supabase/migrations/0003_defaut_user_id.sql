-- Les deux instantanés d'Elo n'avaient pas, comme toutes les autres tables personnelles, le compte
-- courant pour valeur par défaut de user_id : une insertion qui ne le nommait pas était refusée par les
-- règles d'accès (constaté en portant la réinitialisation des duels).
alter table public.elo_snapshot alter column user_id set default auth.uid();
alter table public.person_elo_snapshot alter column user_id set default auth.uid();
