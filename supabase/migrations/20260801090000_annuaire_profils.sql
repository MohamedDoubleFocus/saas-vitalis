-- ============================================================================
-- saas-vitalis — Annuaire des profils (module 2, partie 2)
--
-- POURQUOI cette migration est nécessaire.
--
-- La politique `profiles_select` du module 1 dit : « chacun voit SON profil,
-- l'admin voit tout ». Deux écrans du knocker ont pourtant besoin du nom de ses
-- collègues :
--   • la détection de doublons — « déjà cognée le 12 juillet par Marc Dubé » ;
--   • le classement — un tableau de scores sans les noms n'a aucun intérêt.
--
-- Élargir `profiles_select` à tous les authentifiés exposerait aussi `actif` et
-- `closer_id` de tout le monde. On expose donc une VUE qui ne montre que les
-- trois colonnes nécessaires.
--
-- ⚠️ Cette vue est en `security_invoker = false` (le défaut) : elle s'exécute
-- avec les droits de son propriétaire et CONTOURNE donc la RLS de `profiles`.
-- C'est l'effet recherché, et c'est sûr parce que la vue ne peut rien montrer
-- d'autre que `id`, `nom_complet` et `role`. Le linter Supabase la signalera
-- comme « security definer view » : c'est un faux positif ici.
--
-- Migration idempotente.
-- ============================================================================


-- ============================================================================
-- 1. LA VUE
-- ----------------------------------------------------------------------------
-- Volontairement PAS de `closer_id`, PAS de `actif` : un knocker n'a aucune
-- raison de connaître l'organigramme ni les comptes désactivés.
--
-- Les profils inactifs restent listés : leurs anciens leads doivent continuer
-- d'afficher un nom (invariant soft-delete, CLAUDE.md §4.2) — sinon la détection
-- de doublons dirait « cognée par quelqu'un » après le départ d'un knocker.
-- ============================================================================

create or replace view public.annuaire_profils as
  select
    p.id,
    p.nom_complet,
    p.role
  from public.profiles p;

comment on view public.annuaire_profils is
  'Annuaire minimal (id, nom, rôle) lisible par tout utilisateur authentifié. Contourne volontairement la RLS de profiles, en n''exposant que des colonnes non sensibles.';


-- ============================================================================
-- 2. DROITS
-- ----------------------------------------------------------------------------
-- Lecture seule, et rien pour `anon` : l'annuaire reste derrière la session.
-- ============================================================================

revoke all on public.annuaire_profils from public;
revoke all on public.annuaire_profils from anon;

grant select on public.annuaire_profils to authenticated;
grant select on public.annuaire_profils to service_role;


-- ============================================================================
-- 3. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- `public.profiles` et ses politiques sont intacts. `role_actuel()`,
-- `est_admin()` et `peut_modifier_opportunite()` continuent de lire la table,
-- pas la vue. Aucune écriture n'est possible via l'annuaire.
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
