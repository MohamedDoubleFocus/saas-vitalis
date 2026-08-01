-- ============================================================================
-- saas-vitalis — La fonction manager
--
-- CONTEXTE DE SCALE.
--
-- Aujourd'hui Billal est closer ET manager d'Abderrahmane. Demain il y aura
-- plusieurs closers et plusieurs managers, et les deux fonctions ne coïncideront
-- plus. Le modèle sépare donc dès maintenant :
--
--   • `role`        — ce que la personne FAIT (knocker / closer / roofer / admin) ;
--   • `est_manager` — une casquette EN PLUS, cumulable avec n'importe quel rôle ;
--   • `closer_id`   — POUR QUI le knocker booke ses rendez-vous ;
--   • `manager_id`  — QUI supervise le knocker.
--
-- `closer_id` et `manager_id` pointent tous deux vers Billal aujourd'hui. Rien
-- dans le schéma ne l'impose : un knocker pourra booker pour un closer et être
-- supervisé par quelqu'un d'autre.
--
-- Le manager est en LECTURE SEULE sur les données de son équipe. Il supervise ;
-- il ne réécrit pas les leads de ses knockers. Aucune politique d'écriture n'est
-- ajoutée, et `peut_modifier_opportunite()` n'est pas touchée.
--
-- Migration idempotente : rejouable sans erreur.
-- ============================================================================


-- ============================================================================
-- 1. COLONNES
-- ============================================================================

alter table public.profiles
  add column if not exists est_manager boolean not null default false;

comment on column public.profiles.est_manager is
  'Casquette de manager, cumulable avec le rôle. Un closer peut être manager ; un manager n''est pas un rôle à part.';

-- `on delete set null` et non `cascade` : le départ d'un manager ne doit jamais
-- effacer le profil de ses knockers. L'équipe se retrouve sans superviseur, ce
-- que l'écran admin rend visible — c'est le comportement voulu.
alter table public.profiles
  add column if not exists manager_id uuid references public.profiles(id) on delete set null;

comment on column public.profiles.manager_id is
  'Manager qui supervise ce knocker. Distinct de closer_id (pour qui il booke) : les deux peuvent diverger.';

-- Se superviser soi-même rendrait `est_manager_de()` vrai pour sa propre ligne
-- et brouillerait le périmètre de lecture.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_manager_id_pas_soi_meme'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_manager_id_pas_soi_meme
      check (manager_id is null or manager_id <> id);
  end if;
end
$$;

-- Index : la politique RLS et le tableau de bord lisent tous deux « les profils
-- dont manager_id = moi ».
create index if not exists idx_profiles_manager_id
  on public.profiles (manager_id)
  where manager_id is not null;


-- ============================================================================
-- 2. FONCTIONS D'AIDE (security definer, même patron que le module 1)
-- ----------------------------------------------------------------------------
-- `security definer` pour casser la récursion : une politique de `profiles` qui
-- lirait `profiles` en direct bouclerait à l'infini.
-- `set search_path = ''` : tous les objets sont qualifiés, aucun détournement
-- possible par le search_path de l'appelant.
-- ============================================================================

-- L'utilisateur courant est-il un manager ACTIF ?
-- Un profil désactivé n'a plus de casquette : même règle que `role_actuel()`,
-- qui renvoie NULL pour un compte inactif.
create or replace function public.est_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.est_manager from public.profiles p where p.id = auth.uid() and p.actif),
    false
  )
$$;

comment on function public.est_manager() is
  'Vrai si l''utilisateur courant est un manager actif.';

-- Les knockers supervisés par l'utilisateur courant.
--
-- POURQUOI une fonction ENSEMBLISTE plutôt qu'un simple booléen par ligne :
-- utilisée sous la forme `knocker_id in (select public.knockers_geres())`, elle
-- est évaluée UNE SEULE FOIS par requête (initPlan) au lieu d'une fois par ligne
-- d'`opportunites`. Sur un tableau de bord qui balaie une saison de portes,
-- l'écart n'est pas cosmétique.
create or replace function public.knockers_geres()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.manager_id = auth.uid()
    and public.est_manager()
$$;

comment on function public.knockers_geres() is
  'Identifiants des knockers supervisés par l''utilisateur courant (vide s''il n''est pas manager actif).';

-- Version par ligne, pour les vérifications ponctuelles côté application et pour
-- lire une politique d'un coup d'œil. S'appuie sur la même source de vérité.
create or replace function public.est_manager_de(p_knocker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_knocker_id in (select public.knockers_geres())
$$;

comment on function public.est_manager_de(uuid) is
  'Vrai si l''utilisateur courant supervise ce knocker. Base des politiques de lecture du manager.';

-- Ces fonctions contournent la RLS : `public` inclurait `anon`.
revoke all on function public.est_manager()            from public;
revoke all on function public.knockers_geres()         from public;
revoke all on function public.est_manager_de(uuid)     from public;

grant execute on function public.est_manager()        to authenticated;
grant execute on function public.knockers_geres()     to authenticated;
grant execute on function public.est_manager_de(uuid) to authenticated;


-- ============================================================================
-- 3. RLS — LE MANAGER VOIT SON ÉQUIPE, EN LECTURE SEULE
-- ----------------------------------------------------------------------------
-- Plusieurs politiques permissives sur la même table + opération se combinent en
-- OU : ces politiques s'AJOUTENT à celles du module 1 sans en modifier aucune.
-- Un manager qui est aussi closer garde donc exactement ses droits de closer.
--
-- Aucune politique INSERT / UPDATE / DELETE n'est créée ici. C'est délibéré :
-- superviser, ce n'est pas écrire.
-- ============================================================================

-- --- 3.1 profiles : les fiches de son équipe --------------------------------
-- Sans ça, le manager ne saurait même pas QUI il supervise : `profiles_select`
-- (module 1) ne lui montre que sa propre ligne.
--
-- Pas de récursion : le prédicat ne lit que la colonne `manager_id` de la ligne
-- examinée, et `est_manager()` contourne la RLS.
drop policy if exists profiles_select_manager on public.profiles;
create policy profiles_select_manager on public.profiles
  for select to authenticated
  using (
    (select public.est_manager())
    and manager_id = (select auth.uid())
  );

-- --- 3.2 opportunites : les leads de ses knockers ---------------------------
-- `in (select ...)` plutôt que `est_manager_de(knocker_id)` : voir la note de
-- performance en section 2.
drop policy if exists opportunites_select_manager on public.opportunites;
create policy opportunites_select_manager on public.opportunites
  for select to authenticated
  using (knocker_id in (select public.knockers_geres()));

-- --- 3.3 territoires : les rues en cours de ses knockers --------------------
-- Nécessaire à la fiche « détail d'un knocker » du tableau de bord d'équipe.
-- Lecture seule : le manager ne coche pas les rues à la place de son knocker.
drop policy if exists territoires_select_manager on public.territoires;
create policy territoires_select_manager on public.territoires
  for select to authenticated
  using (knocker_id in (select public.knockers_geres()));

-- Les tables enfants (notes, photos, opportunite_travaux, extras) héritent
-- automatiquement : leurs politiques SELECT du module 1 sont de la forme
-- `exists (select 1 from opportunites o where o.id = ...)`, sous-requête
-- elle-même soumise à la RLS d'`opportunites`. Rien à ajouter.
--
-- Leurs politiques d'écriture s'appuient sur `peut_modifier_opportunite()`, qui
-- ne connaît pas les managers : le manager reste en lecture seule jusqu'au bout
-- de l'arbre.


-- ============================================================================
-- 4. LE JWT PORTE LA CASQUETTE
-- ----------------------------------------------------------------------------
-- Le routage doit savoir, à chaque requête, si l'utilisateur est manager — sans
-- lire `profiles`. On ajoute donc `est_manager` aux claims, à côté de
-- `role_vitalis`, `closer_id` et `actif`.
--
-- ⚠️ Les jetons DÉJÀ ÉMIS ne portent pas la claim : l'application replie alors
-- sur une lecture de `profiles` (voir `src/lib/claims.ts`). Le repli disparaît
-- de lui-même au premier rafraîchissement du jeton (une heure au plus) ; une
-- déconnexion/reconnexion l'obtient tout de suite.
--
-- La fonction est RECRÉÉE intégralement (pas d'ALTER possible) : ce corps
-- remplace celui de `20260731091000_hook_jwt_claims.sql`.
-- ============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role        public.role_user;
  v_closer_id   uuid;
  v_actif       boolean;
  v_est_manager boolean;
  claims        jsonb;
begin
  select p.role, p.closer_id, p.actif, p.est_manager
    into v_role, v_closer_id, v_actif, v_est_manager
  from public.profiles p
  where p.id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if v_role is null then
    -- Compte auth sans ligne `profiles` : claims écrites explicitement, pour que
    -- l'application distingue « profil absent » de « hook non activé ».
    claims := jsonb_set(claims, '{role_vitalis}', 'null'::jsonb);
    claims := jsonb_set(claims, '{closer_id}',    'null'::jsonb);
    claims := jsonb_set(claims, '{actif}',        'false'::jsonb);
    claims := jsonb_set(claims, '{est_manager}',  'false'::jsonb);
  else
    claims := jsonb_set(claims, '{role_vitalis}', to_jsonb(v_role::text));
    -- `to_jsonb(NULL)` renvoie un NULL SQL, et `jsonb_set` avec un NULL SQL
    -- annule TOUT le document. Le `coalesce` est indispensable.
    claims := jsonb_set(
      claims,
      '{closer_id}',
      coalesce(to_jsonb(v_closer_id::text), 'null'::jsonb)
    );
    claims := jsonb_set(claims, '{actif}',       to_jsonb(coalesce(v_actif, false)));
    claims := jsonb_set(claims, '{est_manager}', to_jsonb(coalesce(v_est_manager, false)));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Custom access token hook Supabase : injecte role_vitalis, closer_id, actif et est_manager dans le JWT.';

-- Les droits de la migration du module 2 restent valables (la fonction garde son
-- nom et sa signature), mais `create or replace` peut réinitialiser le
-- propriétaire selon le contexte d'exécution. On les réaffirme : c'est idempotent
-- et ça évite un hook qui échoue silencieusement.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

revoke execute on function public.custom_access_token_hook(jsonb) from public;
revoke execute on function public.custom_access_token_hook(jsonb) from anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;


-- ============================================================================
-- 5. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- • `peut_modifier_opportunite()` : intacte. Un manager n'y gagne aucun droit
--   d'écriture. S'il est aussi closer, il garde ses droits de closer sur SES
--   rendez-vous — par sa casquette de closer, pas par celle de manager.
-- • `role_actuel()`, `est_admin()` : intactes. L'admin voit tout, comme avant.
-- • L'annuaire `annuaire_profils` : intact.
-- • Aucune donnée existante n'est modifiée : `est_manager` vaut `false` partout
--   et `manager_id` vaut NULL partout après cette migration. C'est l'admin qui
--   désigne les managers depuis `/admin/utilisateurs`.
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
