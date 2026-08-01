-- ============================================================================
-- saas-vitalis — Cogner des portes devient une casquette
--
-- LE PROBLÈME.
--
-- Billal est closer et manager. Il cogne aussi des portes. Jusqu'ici c'était
-- impossible : `opportunites_insert_knocker` exige `role_actuel() = 'knocker'`,
-- donc sa saisie serait refusée EN BASE, pas seulement à l'écran.
--
-- La solution évidente — lui créer un second compte « Billal knocker » — casse
-- l'invariant CLAUDE.md §4.3 : ses portes seraient sous un `knocker_id` et ses
-- closes sous un `closer_id` différent. Son classement et ses commissions se
-- retrouveraient coupés en deux, et recoller les leads a posteriori est pénible.
--
-- On applique donc exactement le geste de la migration manager : le terrain
-- devient une CASQUETTE cumulable, pas un rôle.
--
--   role             = ce qu'il fait principalement
--   est_manager      = il supervise une équipe          (migration précédente)
--   fait_du_terrain  = il cogne des portes lui aussi    (ici)
--
-- ⚠️ LIMITE ASSUMÉE. Deux drapeaux, ça va. Un TROISIÈME serait le signal que
-- `role` ne veut plus rien dire et qu'il faut passer à un vrai modèle
-- multi-rôles (table de liaison profil × rôle). Ne pas en ajouter un de plus
-- sans faire cette refonte.
--
-- Migration idempotente : rejouable sans erreur.
-- ============================================================================


-- ============================================================================
-- 1. LA COLONNE
-- ============================================================================

alter table public.profiles
  add column if not exists fait_du_terrain boolean not null default false;

comment on column public.profiles.fait_du_terrain is
  'Cogne des portes en plus de son rôle. Sans effet sur un knocker, qui cogne déjà.';


-- ============================================================================
-- 2. peut_cogner() — LA NOUVELLE SOURCE DE VÉRITÉ
-- ----------------------------------------------------------------------------
-- Remplace partout le test `role_actuel() = 'knocker'`. Un knocker cogne par
-- définition ; les autres cognent s'ils portent la casquette.
--
-- Même patron que le module 1 : `security definer` pour casser la récursion,
-- `stable` pour la mémoïsation, `set search_path = ''` contre le détournement.
-- ============================================================================

create or replace function public.peut_cogner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'knocker' or p.fait_du_terrain
     from public.profiles p
     where p.id = auth.uid() and p.actif),
    false
  )
$$;

comment on function public.peut_cogner() is
  'Vrai si l''utilisateur courant peut créer et travailler des leads terrain (knocker, ou casquette fait_du_terrain).';

revoke all on function public.peut_cogner() from public;
grant execute on function public.peut_cogner() to authenticated;


-- ============================================================================
-- 3. peut_modifier_opportunite() — LA BRANCHE QUI MANQUAIT
-- ----------------------------------------------------------------------------
-- ⚠️ Sans cette réécriture, un closer qui cogne créerait son lead… puis
-- échouerait à y attacher sa note : `notes_insert` s'appuie sur cette fonction,
-- qui ne connaissait que `role_actuel() = 'knocker'`.
--
-- La branche knocker devient donc « quiconque cogne, sur SES propres lignes ».
-- Les branches closer et roofer sont inchangées.
-- ============================================================================

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
        or (public.peut_cogner()                 and o.knocker_id = auth.uid())
        or (public.role_actuel() = 'closer'      and o.closer_id  = auth.uid())
        or (public.role_actuel() = 'roofer'      and o.roofer_id  = auth.uid())
      )
  )
$$;

comment on function public.peut_modifier_opportunite(uuid) is
  'Vrai si l''utilisateur courant peut modifier cette opportunité. Base des politiques des tables enfants.';


-- ============================================================================
-- 4. opportunites — LES POLITIQUES « KNOCKER » DEVIENNENT « TERRAIN »
-- ----------------------------------------------------------------------------
-- Les anciennes politiques sont SUPPRIMÉES et remplacées sous un nouveau nom :
-- laisser `*_knocker` en place les ferait cohabiter en OU avec les nouvelles,
-- et le nom mentirait sur ce qu'elles font.
-- ============================================================================

-- --- SELECT -----------------------------------------------------------------
-- « Tout voir » reste indispensable à la détection de doublons à la porte
-- (CLAUDE.md §4.5) — et c'est aussi ce qui permet à un closer qui cogne de
-- relire ses propres leads au statut `absent`, que `opportunites_select_closer`
-- ne lui montrerait pas (elle exige `closer_id = moi` ou `statut >= rdv`).
drop policy if exists opportunites_select_knocker on public.opportunites;
drop policy if exists opportunites_select_terrain on public.opportunites;
create policy opportunites_select_terrain on public.opportunites
  for select to authenticated
  using ((select public.peut_cogner()));

-- --- INSERT -----------------------------------------------------------------
drop policy if exists opportunites_insert_knocker on public.opportunites;
drop policy if exists opportunites_insert_terrain on public.opportunites;
create policy opportunites_insert_terrain on public.opportunites
  for insert to authenticated
  with check ((select public.peut_cogner()));

-- --- UPDATE -----------------------------------------------------------------
-- Le `with check` reprend la condition du `using` : sans lui, on pourrait
-- réassigner une ligne à quelqu'un d'autre et la faire sortir de son périmètre.
drop policy if exists opportunites_update_knocker on public.opportunites;
drop policy if exists opportunites_update_terrain on public.opportunites;
create policy opportunites_update_terrain on public.opportunites
  for update to authenticated
  using (
    (select public.peut_cogner())
    and knocker_id = (select auth.uid())
  )
  with check (
    (select public.peut_cogner())
    and knocker_id = (select auth.uid())
  );

-- --- DELETE -----------------------------------------------------------------
drop policy if exists opportunites_delete_knocker on public.opportunites;
drop policy if exists opportunites_delete_terrain on public.opportunites;
create policy opportunites_delete_terrain on public.opportunites
  for delete to authenticated
  using (
    (select public.peut_cogner())
    and knocker_id = (select auth.uid())
  );


-- ============================================================================
-- 5. territoires — MÊME TRAITEMENT
-- ----------------------------------------------------------------------------
-- Un closer qui cogne a besoin de ses rues assignées et de pouvoir les cocher.
-- ============================================================================

drop policy if exists territoires_select_knocker on public.territoires;
drop policy if exists territoires_select_terrain on public.territoires;
create policy territoires_select_terrain on public.territoires
  for select to authenticated
  using (
    (select public.peut_cogner())
    and knocker_id = (select auth.uid())
  );

drop policy if exists territoires_update_knocker on public.territoires;
drop policy if exists territoires_update_terrain on public.territoires;
create policy territoires_update_terrain on public.territoires
  for update to authenticated
  using (
    (select public.peut_cogner())
    and knocker_id = (select auth.uid())
  )
  with check (
    (select public.peut_cogner())
    and knocker_id = (select auth.uid())
  );

-- --- Le trigger suit ---------------------------------------------------------
-- Il limitait « un knocker » au marquage « complétée ». Désormais : quiconque
-- cogne, sauf l'admin.
--
-- `est_admin()` est testé explicitement parce qu'un admin pourrait très bien
-- porter la casquette terrain — et il doit garder le droit de tout modifier.
-- `service_role` et les migrations ont `auth.uid()` à NULL, donc `peut_cogner()`
-- à faux : ils passent librement.
create or replace function public.territoires_restreindre_maj_knocker()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_temoin public.territoires%rowtype;
begin
  if public.est_admin() or not public.peut_cogner() then
    return new;
  end if;

  -- Comparaison de la ligne ENTIÈRE : toute colonne ajoutée plus tard est
  -- protégée par défaut, sans qu'on ait à penser à ce trigger.
  v_temoin := new;
  v_temoin.complete := old.complete;
  v_temoin.complete_le := old.complete_le;
  v_temoin.complete_par := old.complete_par;

  if v_temoin is distinct from old then
    raise exception
      'Sur le terrain, on ne peut que cocher une rue comme complétée.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Traçabilité : on sait qui a coché et quand, sans faire confiance au client.
  if new.complete is distinct from old.complete then
    if new.complete then
      new.complete_le := now();
      new.complete_par := auth.uid();
    else
      new.complete_le := null;
      new.complete_par := null;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.territoires_restreindre_maj_knocker() is
  'Trigger : limite quiconque cogne au marquage « complétée », et horodate lui-même.';


-- ============================================================================
-- 6. L'ANNUAIRE EXPOSE LA CASQUETTE
-- ----------------------------------------------------------------------------
-- Décision produit : quiconque cogne concourt au classement. L'écran doit donc
-- pouvoir distinguer « celui-là cogne » d'un simple rôle, sans avoir accès à
-- `profiles`.
--
-- `fait_du_terrain` n'est pas une donnée sensible : elle est de toute façon
-- déductible de la présence de la personne au podium des knockers.
--
-- ⚠️ `create or replace view` refuse de RETIRER une colonne. Comme on en ajoute
-- une, ça passe — mais si tu dois un jour en enlever, il faudra un DROP.
-- ============================================================================

create or replace view public.annuaire_profils as
  select
    p.id,
    p.nom_complet,
    p.role,
    p.fait_du_terrain
  from public.profiles p;

comment on view public.annuaire_profils is
  'Annuaire minimal (id, nom, rôle, casquette terrain) lisible par tout utilisateur authentifié. Contourne volontairement la RLS de profiles, en n''exposant que des colonnes non sensibles.';

revoke all on public.annuaire_profils from public;
revoke all on public.annuaire_profils from anon;

grant select on public.annuaire_profils to authenticated;
grant select on public.annuaire_profils to service_role;


-- ============================================================================
-- 7. LE JWT PORTE LA DEUXIÈME CASQUETTE
-- ----------------------------------------------------------------------------
-- Même remarque que pour `est_manager` : les jetons DÉJÀ ÉMIS ne portent pas la
-- claim, l'application replie alors sur une lecture de `profiles`, et le repli
-- disparaît au premier renouvellement du jeton (une heure au plus).
--
-- La fonction est recréée intégralement : ce corps remplace celui de
-- `20260807090000_manager.sql`.
-- ============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role      public.role_user;
  v_closer_id uuid;
  v_actif     boolean;
  v_manager   boolean;
  v_terrain   boolean;
  claims      jsonb;
begin
  select p.role, p.closer_id, p.actif, p.est_manager, p.fait_du_terrain
    into v_role, v_closer_id, v_actif, v_manager, v_terrain
  from public.profiles p
  where p.id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if v_role is null then
    -- Compte auth sans ligne `profiles` : claims écrites explicitement, pour que
    -- l'application distingue « profil absent » de « hook non activé ».
    claims := jsonb_set(claims, '{role_vitalis}',    'null'::jsonb);
    claims := jsonb_set(claims, '{closer_id}',       'null'::jsonb);
    claims := jsonb_set(claims, '{actif}',           'false'::jsonb);
    claims := jsonb_set(claims, '{est_manager}',     'false'::jsonb);
    claims := jsonb_set(claims, '{fait_du_terrain}', 'false'::jsonb);
  else
    claims := jsonb_set(claims, '{role_vitalis}', to_jsonb(v_role::text));
    -- `to_jsonb(NULL)` renvoie un NULL SQL, et `jsonb_set` avec un NULL SQL
    -- annule TOUT le document. Le `coalesce` est indispensable.
    claims := jsonb_set(
      claims,
      '{closer_id}',
      coalesce(to_jsonb(v_closer_id::text), 'null'::jsonb)
    );
    claims := jsonb_set(claims, '{actif}',           to_jsonb(coalesce(v_actif, false)));
    claims := jsonb_set(claims, '{est_manager}',     to_jsonb(coalesce(v_manager, false)));
    -- Un knocker cogne par définition : la claim porte la CAPACITÉ, pas le
    -- drapeau brut. L'application n'a ainsi qu'une seule valeur à consulter.
    claims := jsonb_set(
      claims,
      '{fait_du_terrain}',
      to_jsonb(coalesce(v_terrain, false) or v_role = 'knocker')
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Custom access token hook Supabase : injecte role_vitalis, closer_id, actif, est_manager et fait_du_terrain dans le JWT.';

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

revoke execute on function public.custom_access_token_hook(jsonb) from public;
revoke execute on function public.custom_access_token_hook(jsonb) from anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;


-- ============================================================================
-- 8. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- • Un knocker : aucun changement. `peut_cogner()` est vrai pour lui comme
--   `role_actuel() = 'knocker'` l'était.
-- • Les politiques closer, roofer et admin d'`opportunites` : intactes.
-- • `manager_id`, `est_manager`, `est_manager_de()` : intacts. Un manager reste
--   en lecture seule sur son équipe, qu'il cogne ou non.
-- • Aucune donnée existante n'est modifiée : `fait_du_terrain` vaut `false`
--   partout après cette migration.
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
