-- ============================================================================
-- saas-vitalis — RLS granulaire par rôle (module 1)
--
-- Remplace les politiques permissives `*_authenticated_tout` de la migration
-- initiale par des politiques par rôle (knocker / closer / roofer / admin).
--
-- Principes appliqués :
--   • Le rôle est lu via des fonctions `security definer` qui contournent la
--     RLS de `profiles` — sans quoi une politique de `profiles` qui lit
--     `profiles` provoquerait une récursion infinie.
--   • Un profil `actif = false` n'a AUCUN rôle : toutes les politiques le
--     rejettent. La désactivation coupe l'accès aux données, pas seulement
--     l'accès à l'interface.
--   • Les appels de fonction indépendants de la ligne sont enveloppés dans
--     `(select ...)` : Postgres les évalue une seule fois par requête
--     (initPlan) au lieu d'une fois par ligne.
--   • Plusieurs politiques permissives sur la même table + opération se
--     combinent en OU. Une politique par rôle et par opération : ajouter ou
--     retirer un rôle ne touche pas les autres.
--
-- Migration idempotente : rejouable sans erreur.
-- ============================================================================


-- ============================================================================
-- 1. PRIVILÈGES — resserrage de la migration initiale
-- ----------------------------------------------------------------------------
-- La migration initiale faisait `grant all on all tables ... to authenticated`,
-- ce qui inclut TRUNCATE — et TRUNCATE n'est PAS filtré par la RLS. On ne
-- laisse au rôle `authenticated` que le DML, seul filtré par les politiques.
-- ============================================================================

-- Ne porte que sur les tables EXISTANTES. Les privilèges par défaut de Supabase
-- redonneront `all` (donc TRUNCATE) aux tables créées plus tard : répéter ces
-- deux lignes dans la migration qui ajoute une table.
revoke all on all tables in schema public from authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;


-- ============================================================================
-- 2. FONCTIONS D'AIDE (security definer)
-- ----------------------------------------------------------------------------
-- `security definer` = exécutées avec les droits du propriétaire (postgres),
-- qui n'est pas soumis à la RLS. C'est ce qui casse la récursion.
-- `stable` permet à Postgres de mémoïser l'appel dans une même requête.
-- `set search_path = ''` interdit tout détournement par le search_path de
-- l'appelant — tous les objets sont donc qualifiés.
-- ============================================================================

-- Rôle de l'utilisateur courant, ou NULL s'il n'a pas de profil ou s'il est
-- désactivé. Retourner NULL est volontaire : `NULL = 'knocker'` vaut NULL,
-- donc aucune politique ne s'applique.
create or replace function public.role_actuel()
returns public.role_user
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.actif
$$;

comment on function public.role_actuel() is
  'Rôle de l''utilisateur courant (NULL si sans profil ou désactivé). Contourne la RLS.';

-- Raccourci de lisibilité pour les politiques « admin ».
create or replace function public.est_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.role_actuel() = 'admin', false)
$$;

comment on function public.est_admin() is
  'Vrai si l''utilisateur courant est un admin actif.';

-- Droit de MODIFICATION sur une opportunité donnée.
--
-- Pourquoi une fonction plutôt qu'une sous-requête sur `opportunites` ?
-- Une sous-requête ne teste que le droit de SELECT. Or un closer peut VOIR
-- une opportunité au statut `rdv` sans lui être assigné : il pourrait alors
-- modifier ses notes, photos et montants. Cette fonction encode explicitement
-- les règles d'UPDATE, et les tables enfants s'y adossent.
--
-- Toute évolution des règles d'UPDATE de `opportunites` (section 4) doit être
-- répercutée ICI.
create or replace function public.peut_modifier_opportunite(p_opportunite_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.opportunites o
    where o.id = p_opportunite_id
      and (
        public.est_admin()
        or (public.role_actuel() = 'knocker' and o.knocker_id = auth.uid())
        or (public.role_actuel() = 'closer'  and o.closer_id  = auth.uid())
        or (public.role_actuel() = 'roofer'  and o.roofer_id  = auth.uid())
      )
  )
$$;

comment on function public.peut_modifier_opportunite(uuid) is
  'Vrai si l''utilisateur courant peut modifier cette opportunité. Base des politiques des tables enfants.';

-- Ces fonctions contournent la RLS : ne les exposer qu'aux rôles voulus.
-- `public` inclurait `anon`.
revoke all on function public.role_actuel() from public;
revoke all on function public.est_admin() from public;
revoke all on function public.peut_modifier_opportunite(uuid) from public;

grant execute on function public.role_actuel() to authenticated;
grant execute on function public.est_admin() to authenticated;
grant execute on function public.peut_modifier_opportunite(uuid) to authenticated;


-- ============================================================================
-- 3. RETRAIT DES POLITIQUES PERMISSIVES DU MODULE 0
-- ============================================================================

drop policy if exists profiles_authenticated_tout            on public.profiles;
drop policy if exists territoires_authenticated_tout         on public.territoires;
drop policy if exists opportunites_authenticated_tout        on public.opportunites;
drop policy if exists opportunite_travaux_authenticated_tout on public.opportunite_travaux;
drop policy if exists extras_authenticated_tout              on public.extras;
drop policy if exists notes_authenticated_tout               on public.notes;
drop policy if exists photos_authenticated_tout              on public.photos;


-- ============================================================================
-- 4. profiles
-- ----------------------------------------------------------------------------
-- • Chacun lit SON profil (nécessaire au proxy pour résoudre le rôle).
-- • L'admin lit et modifie tous les profils.
-- • Création et modification réservées à l'admin — un utilisateur ne doit pas
--   pouvoir changer son propre rôle ni se réactiver.
-- • AUCUNE politique DELETE : invariant « soft-delete des utilisateurs »
--   (CLAUDE.md §4.2). Sans politique, `delete` échoue pour tout le monde sauf
--   `service_role`. Ne pas en ajouter.
-- ============================================================================

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.est_admin()));

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check ((select public.est_admin()));

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select public.est_admin()))
  with check ((select public.est_admin()));


-- ============================================================================
-- 5. opportunites
-- ----------------------------------------------------------------------------
-- SELECT
--   admin   : tout
--   knocker : tout — indispensable à la détection de doublons d'adresse à la
--             porte (CLAUDE.md §4.5)
--   closer  : les siennes, OU tout ce qui a atteint le statut `rdv`
--   roofer  : les siennes uniquement
-- INSERT   : admin, knocker (libre)
-- UPDATE   : admin ; sinon uniquement les lignes qui te sont assignées
-- DELETE   : admin, knocker (les siennes)
-- ============================================================================

-- --- SELECT -----------------------------------------------------------------

drop policy if exists opportunites_select_admin on public.opportunites;
create policy opportunites_select_admin on public.opportunites
  for select to authenticated
  using ((select public.est_admin()));

drop policy if exists opportunites_select_knocker on public.opportunites;
create policy opportunites_select_knocker on public.opportunites
  for select to authenticated
  using ((select public.role_actuel()) = 'knocker');

-- ATTENTION : `statut >= 'rdv'` s'appuie sur l'ORDRE DE DÉCLARATION de l'enum
-- `statut_opp` (absent, refus, repasser, rdv, vendu, planifie, en_cours,
-- complete, facture, paye, perdu). « rdv et au-delà » couvre donc rdv → perdu,
-- `perdu` inclus. Toute valeur ajoutée à l'enum doit l'être APRÈS `rdv` pour
-- rester visible du closer, sinon relire cette politique.
drop policy if exists opportunites_select_closer on public.opportunites;
create policy opportunites_select_closer on public.opportunites
  for select to authenticated
  using (
    (select public.role_actuel()) = 'closer'
    and (
      closer_id = (select auth.uid())
      or statut >= 'rdv'::public.statut_opp
    )
  );

drop policy if exists opportunites_select_roofer on public.opportunites;
create policy opportunites_select_roofer on public.opportunites
  for select to authenticated
  using (
    (select public.role_actuel()) = 'roofer'
    and roofer_id = (select auth.uid())
  );

-- --- INSERT -----------------------------------------------------------------

drop policy if exists opportunites_insert_admin on public.opportunites;
create policy opportunites_insert_admin on public.opportunites
  for insert to authenticated
  with check ((select public.est_admin()));

-- INSERT libre pour le knocker : aucune contrainte sur `knocker_id`.
-- Pour forcer la traçabilité (CLAUDE.md §4.3), ajouter
-- `and knocker_id = (select auth.uid())` — non fait ici, conformément au
-- cahier des charges du module 1.
drop policy if exists opportunites_insert_knocker on public.opportunites;
create policy opportunites_insert_knocker on public.opportunites
  for insert to authenticated
  with check ((select public.role_actuel()) = 'knocker');

-- --- UPDATE -----------------------------------------------------------------
-- Le `with check` reprend la condition du `using` : sans lui, un utilisateur
-- pourrait réassigner une ligne à quelqu'un d'autre et la faire sortir de son
-- périmètre.

drop policy if exists opportunites_update_admin on public.opportunites;
create policy opportunites_update_admin on public.opportunites
  for update to authenticated
  using ((select public.est_admin()))
  with check ((select public.est_admin()));

drop policy if exists opportunites_update_knocker on public.opportunites;
create policy opportunites_update_knocker on public.opportunites
  for update to authenticated
  using (
    (select public.role_actuel()) = 'knocker'
    and knocker_id = (select auth.uid())
  )
  with check (
    (select public.role_actuel()) = 'knocker'
    and knocker_id = (select auth.uid())
  );

drop policy if exists opportunites_update_closer on public.opportunites;
create policy opportunites_update_closer on public.opportunites
  for update to authenticated
  using (
    (select public.role_actuel()) = 'closer'
    and closer_id = (select auth.uid())
  )
  with check (
    (select public.role_actuel()) = 'closer'
    and closer_id = (select auth.uid())
  );

drop policy if exists opportunites_update_roofer on public.opportunites;
create policy opportunites_update_roofer on public.opportunites
  for update to authenticated
  using (
    (select public.role_actuel()) = 'roofer'
    and roofer_id = (select auth.uid())
  )
  with check (
    (select public.role_actuel()) = 'roofer'
    and roofer_id = (select auth.uid())
  );

-- --- DELETE -----------------------------------------------------------------
-- Ni closer ni roofer ne suppriment d'opportunité : leur retirer une ligne du
-- pipeline se fait par un changement de statut, journalisé.

drop policy if exists opportunites_delete_admin on public.opportunites;
create policy opportunites_delete_admin on public.opportunites
  for delete to authenticated
  using ((select public.est_admin()));

drop policy if exists opportunites_delete_knocker on public.opportunites;
create policy opportunites_delete_knocker on public.opportunites
  for delete to authenticated
  using (
    (select public.role_actuel()) = 'knocker'
    and knocker_id = (select auth.uid())
  );


-- ============================================================================
-- 6. TABLES ENFANTS — héritage de l'accès à l'opportunité parente
-- ----------------------------------------------------------------------------
-- SELECT : `exists (select 1 from opportunites o where o.id = ...)`. La
--   sous-requête est elle-même soumise à la RLS de `opportunites` : elle ne
--   renvoie une ligne que si l'utilisateur peut voir le parent. L'héritage est
--   donc automatique — aucune règle dupliquée.
--
-- INSERT / UPDATE / DELETE : `peut_modifier_opportunite()` (section 2), car un
--   droit de lecture sur le parent ne vaut pas droit d'écriture.
--
-- Ces prédicats dépendent de la ligne : pas d'enveloppe `(select ...)`, qui
-- n'apporterait aucune mise en cache ici.
-- ============================================================================

-- --- 6.1 opportunite_travaux ------------------------------------------------

drop policy if exists opportunite_travaux_select on public.opportunite_travaux;
create policy opportunite_travaux_select on public.opportunite_travaux
  for select to authenticated
  using (exists (
    select 1 from public.opportunites o
    where o.id = opportunite_travaux.opportunite_id
  ));

drop policy if exists opportunite_travaux_insert on public.opportunite_travaux;
create policy opportunite_travaux_insert on public.opportunite_travaux
  for insert to authenticated
  with check (public.peut_modifier_opportunite(opportunite_id));

drop policy if exists opportunite_travaux_update on public.opportunite_travaux;
create policy opportunite_travaux_update on public.opportunite_travaux
  for update to authenticated
  using (public.peut_modifier_opportunite(opportunite_id))
  with check (public.peut_modifier_opportunite(opportunite_id));

drop policy if exists opportunite_travaux_delete on public.opportunite_travaux;
create policy opportunite_travaux_delete on public.opportunite_travaux
  for delete to authenticated
  using (public.peut_modifier_opportunite(opportunite_id));

-- --- 6.2 extras -------------------------------------------------------------

drop policy if exists extras_select on public.extras;
create policy extras_select on public.extras
  for select to authenticated
  using (exists (
    select 1 from public.opportunites o
    where o.id = extras.opportunite_id
  ));

drop policy if exists extras_insert on public.extras;
create policy extras_insert on public.extras
  for insert to authenticated
  with check (public.peut_modifier_opportunite(opportunite_id));

drop policy if exists extras_update on public.extras;
create policy extras_update on public.extras
  for update to authenticated
  using (public.peut_modifier_opportunite(opportunite_id))
  with check (public.peut_modifier_opportunite(opportunite_id));

drop policy if exists extras_delete on public.extras;
create policy extras_delete on public.extras
  for delete to authenticated
  using (public.peut_modifier_opportunite(opportunite_id));

-- --- 6.3 notes — EN AJOUT SEUL ----------------------------------------------
-- Écart assumé par rapport à « les enfants héritent de l'accès au parent » :
-- l'invariant CLAUDE.md §4.10 impose un fil chronologique « jamais écrasé »,
-- et les notes portent la piste d'audit (transitions de statut, reports de
-- date). Aucune politique UPDATE ni DELETE n'est donc créée : les notes ne
-- peuvent qu'être lues et ajoutées. Seul `service_role` peut y toucher.

drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes
  for select to authenticated
  using (exists (
    select 1 from public.opportunites o
    where o.id = notes.opportunite_id
  ));

drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes
  for insert to authenticated
  with check (public.peut_modifier_opportunite(opportunite_id));

-- --- 6.4 photos -------------------------------------------------------------
-- Pas de politique UPDATE : une photo se remplace par un DELETE + INSERT, ce
-- qui garde l'objet du bucket et la ligne alignés.

drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos
  for select to authenticated
  using (exists (
    select 1 from public.opportunites o
    where o.id = photos.opportunite_id
  ));

drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos
  for insert to authenticated
  with check (public.peut_modifier_opportunite(opportunite_id));

drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos
  for delete to authenticated
  using (public.peut_modifier_opportunite(opportunite_id));


-- ============================================================================
-- 7. territoires
-- ----------------------------------------------------------------------------
-- admin   : accès total.
-- knocker : SELECT sur les siens + UPDATE du seul champ `complete`.
--
-- La RLS ne sait pas restreindre une mise à jour à une colonne précise, et les
-- privilèges par colonne ne conviennent pas ici : admin et knocker partagent le
-- même rôle Postgres (`authenticated`). La restriction passe donc par un
-- trigger BEFORE UPDATE (section 7.1), seul endroit où OLD et NEW sont
-- comparables.
-- ============================================================================

drop policy if exists territoires_select_admin on public.territoires;
create policy territoires_select_admin on public.territoires
  for select to authenticated
  using ((select public.est_admin()));

drop policy if exists territoires_insert_admin on public.territoires;
create policy territoires_insert_admin on public.territoires
  for insert to authenticated
  with check ((select public.est_admin()));

drop policy if exists territoires_update_admin on public.territoires;
create policy territoires_update_admin on public.territoires
  for update to authenticated
  using ((select public.est_admin()))
  with check ((select public.est_admin()));

drop policy if exists territoires_delete_admin on public.territoires;
create policy territoires_delete_admin on public.territoires
  for delete to authenticated
  using ((select public.est_admin()));

drop policy if exists territoires_select_knocker on public.territoires;
create policy territoires_select_knocker on public.territoires
  for select to authenticated
  using (
    (select public.role_actuel()) = 'knocker'
    and knocker_id = (select auth.uid())
  );

drop policy if exists territoires_update_knocker on public.territoires;
create policy territoires_update_knocker on public.territoires
  for update to authenticated
  using (
    (select public.role_actuel()) = 'knocker'
    and knocker_id = (select auth.uid())
  )
  with check (
    (select public.role_actuel()) = 'knocker'
    and knocker_id = (select auth.uid())
  );

-- --- 7.1 Trigger : le knocker ne modifie que `complete` ---------------------
-- Ne s'applique qu'au rôle knocker. `service_role` et les migrations ont
-- `auth.uid()` à NULL, donc `role_actuel()` à NULL : ils passent librement.

create or replace function public.territoires_restreindre_maj_knocker()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.role_actuel() = 'knocker' then
    if new.id         is distinct from old.id
    or new.nom_rue    is distinct from old.nom_rue
    or new.ville      is distinct from old.ville
    or new.knocker_id is distinct from old.knocker_id
    or new.created_at is distinct from old.created_at then
      raise exception
        'Un knocker ne peut modifier que le champ « complete » de ses territoires.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.territoires_restreindre_maj_knocker() is
  'Trigger : limite les UPDATE d''un knocker sur territoires au seul champ `complete`.';

drop trigger if exists trg_territoires_restreindre_maj_knocker on public.territoires;
create trigger trg_territoires_restreindre_maj_knocker
  before update on public.territoires
  for each row
  execute function public.territoires_restreindre_maj_knocker();


-- ============================================================================
-- 8. STORAGE — inchangé pour l'instant
-- ----------------------------------------------------------------------------
-- Les politiques du bucket `photos` restent celles du module 0 : tout
-- utilisateur authentifié peut lire, déposer et supprimer dans ce bucket.
-- Les restreindre à l'opportunité concernée suppose de dériver l'ID depuis le
-- chemin de l'objet (`<opportunite_id>/...`) — à faire avec le module photos,
-- quand la convention de nommage sera figée.
-- ============================================================================


-- ============================================================================
-- Fin de la migration RLS granulaire.
-- ============================================================================
