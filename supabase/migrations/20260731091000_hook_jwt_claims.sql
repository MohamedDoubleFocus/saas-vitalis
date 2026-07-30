-- ============================================================================
-- saas-vitalis — Custom access token hook (module 2, socle terrain)
--
-- Ajoute le rôle Vitalis dans le JWT, pour que le proxy n'ait plus à lire
-- `profiles` à chaque requête. Au module 1, chaque requête coûtait deux
-- allers-retours réseau (validation du jeton + lecture du profil) ; avec ce
-- hook, le rôle voyage dans le jeton.
--
-- ⚠️ ACTIVATION MANUELLE REQUISE — cette migration crée seulement la fonction.
-- Dashboard Supabase → Authentication → Hooks → « Customize Access Token (JWT)
-- Claims » → activer, schéma `public`, fonction `custom_access_token_hook`.
--
-- Tant que le hook n'est pas activé, l'application reste fonctionnelle : elle
-- retombe sur la lecture de `profiles` quand le claim est absent.
--
-- ⚠️ Le gain de performance suppose aussi que le projet signe ses JWT avec des
-- clés ASYMÉTRIQUES (Dashboard → Authentication → JWT Keys). Avec un secret
-- symétrique, `getClaims()` interroge quand même le serveur Auth, comme
-- `getUser()` : le hook évite la lecture de `profiles`, pas l'aller-retour de
-- validation.
--
-- Claims ajoutées : `role_vitalis`, `closer_id`, `actif`.
-- On ne touche PAS au claim réservé `role` (qui vaut `authenticated` et sert au
-- rôle Postgres) : l'écraser casserait PostgREST et toute la RLS.
-- ============================================================================


-- ============================================================================
-- 1. LA FONCTION HOOK
-- ----------------------------------------------------------------------------
-- Signature imposée par Supabase : `(event jsonb) returns jsonb`.
-- `event` contient `user_id` et `claims` ; on retourne l'événement avec les
-- claims enrichies.
--
-- Volontairement PAS `security definer` : la fonction s'exécute avec les droits
-- de `supabase_auth_admin`, à qui la section 2 accorde explicitement la lecture
-- de `profiles`. Les droits sont donc lisibles dans le catalogue plutôt que
-- masqués derrière un contournement de RLS.
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
  claims      jsonb;
begin
  select p.role, p.closer_id, p.actif
    into v_role, v_closer_id, v_actif
  from public.profiles p
  where p.id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if v_role is null then
    -- Compte auth sans ligne `profiles` : on écrit les claims explicitement
    -- plutôt que de les omettre. L'application distingue ainsi « profil
    -- absent » (claim présente et nulle) de « hook non activé » (claim
    -- absente), et n'applique le repli sur `profiles` que dans le second cas.
    claims := jsonb_set(claims, '{role_vitalis}', 'null'::jsonb);
    claims := jsonb_set(claims, '{closer_id}',    'null'::jsonb);
    claims := jsonb_set(claims, '{actif}',        'false'::jsonb);
  else
    claims := jsonb_set(claims, '{role_vitalis}', to_jsonb(v_role::text));
    -- `to_jsonb(NULL)` renvoie un NULL SQL, et `jsonb_set` avec un NULL SQL
    -- annule TOUT le document. Le `coalesce` est indispensable.
    claims := jsonb_set(
      claims,
      '{closer_id}',
      coalesce(to_jsonb(v_closer_id::text), 'null'::jsonb)
    );
    claims := jsonb_set(claims, '{actif}', to_jsonb(coalesce(v_actif, false)));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Custom access token hook Supabase : injecte role_vitalis, closer_id et actif dans le JWT.';


-- ============================================================================
-- 2. DROITS
-- ----------------------------------------------------------------------------
-- Seul `supabase_auth_admin` (le rôle du service Auth) doit pouvoir exécuter ce
-- hook. Le laisser exécutable par `authenticated` ou `anon` permettrait à un
-- client d'appeler la fonction en RPC avec un `user_id` arbitraire et de lire le
-- rôle de n'importe qui.
-- ============================================================================

grant usage on schema public to supabase_auth_admin;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

revoke execute on function public.custom_access_token_hook(jsonb) from public;
revoke execute on function public.custom_access_token_hook(jsonb) from anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;

-- `supabase_auth_admin` n'est pas propriétaire de `profiles` : la RLS
-- s'applique à lui. Sans la politique ci-dessous, la fonction ne verrait aucune
-- ligne et tous les jetons sortiraient avec `role_vitalis: null`.
grant select on table public.profiles to supabase_auth_admin;

drop policy if exists profiles_select_auth_admin on public.profiles;
create policy profiles_select_auth_admin on public.profiles
  as permissive
  for select
  to supabase_auth_admin
  using (true);


-- ============================================================================
-- 3. LA RLS RESTE LA SOURCE DE VÉRITÉ
-- ----------------------------------------------------------------------------
-- `role_actuel()`, `est_admin()` et `peut_modifier_opportunite()` continuent de
-- lire `public.profiles` — elles ne consultent PAS le JWT. Une claim est un
-- instantané qui peut avoir jusqu'à une heure de retard (durée de vie du jeton
-- d'accès) ; les politiques, elles, voient l'état courant.
--
-- Corollaire côté application : désactiver un profil doit aussi révoquer ses
-- sessions (`auth.admin.signOut(userId, 'global')`), sinon son jeton continue
-- de porter `actif: true` jusqu'à expiration. C'est fait dans
-- `src/app/admin/utilisateurs/actions.ts`.
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
