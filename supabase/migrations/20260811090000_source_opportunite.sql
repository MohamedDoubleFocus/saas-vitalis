-- ============================================================================
-- saas-vitalis — D'où vient la vente
--
-- LE MANQUE.
--
-- Une opportunité ne pouvait naître que d'une porte cognée : le seul chemin de
-- création était `/terrain/lead`. Une vente par référence, un appel entrant ou
-- un client qui revient n'avaient aucune porte d'entrée dans le système — il
-- fallait passer par du SQL, ou renoncer.
--
-- POURQUOI UNE COLONNE PLUTÔT QU'UNE CONVENTION.
--
-- On aurait pu reconnaître une référence à `knocker_id IS NULL`. Mais
-- `knocker_id` est `on delete set null` : le profil d'un knocker parti laisse
-- ses leads avec un `knocker_id` vide. Une référence deviendrait alors
-- indiscernable d'un lead orphelin, et la part du chiffre venant du
-- porte-à-porte serait irrécupérable. CLAUDE.md §4.3 : on capture la donnée dès
-- le jour 1, même si le calcul vient plus tard.
--
-- Migration idempotente.
-- ============================================================================


-- ============================================================================
-- 1. L'ENUM
-- ----------------------------------------------------------------------------
-- `porte` en PREMIER : l'ordre de déclaration d'un enum sert aux comparaisons,
-- et c'est aussi la valeur par défaut. Ajouter une valeur plus tard se fait par
-- `alter type ... add value`, toujours à la fin.
-- ============================================================================

do $$ begin
  create type public.source_opp as enum ('porte', 'reference', 'entrant', 'autre');
exception
  when duplicate_object then null;
end $$;

comment on type public.source_opp is
  'Origine d''une opportunité : porte-à-porte, référence d''un client, appel entrant, ou autre.';


-- ============================================================================
-- 2. LA COLONNE
-- ----------------------------------------------------------------------------
-- `default 'porte'` et `not null` : toutes les lignes existantes viennent du
-- porte-à-porte, c'est vrai par construction — il n'existait pas d'autre moyen
-- d'en créer. Aucun backfill n'est donc nécessaire, et aucune donnée n'est
-- inventée.
-- ============================================================================

alter table public.opportunites
  add column if not exists source public.source_opp not null default 'porte';

comment on column public.opportunites.source is
  'Origine de l''opportunité. « porte » par défaut : c''était le seul chemin de création jusqu''ici.';

-- Les rapports croiseront « chiffre par source » : l'index sert cette lecture,
-- et reste minuscule (quatre valeurs).
create index if not exists idx_opportunites_source
  on public.opportunites (source);


-- ============================================================================
-- 3. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- • Aucune politique RLS. La création d'une vente hors porte-à-porte passe par
--   `opportunites_insert_admin`, qui existe depuis le module 1 : c'est déjà
--   réservé à l'admin, et c'est le comportement voulu.
-- • `conclure_vente()` : intacte. La vente directe l'appelle telle quelle, ce
--   qui lui fait profiter de TOUTE la validation serveur du module 3 — totaux
--   recalculés, champs client obligatoires, note d'audit. Rien n'est dupliqué.
-- • La file de résilience du terrain insère sans `source` : le défaut `porte`
--   s'applique, le comportement du knocker est inchangé.
-- • Le tableau de bord d'équipe et le classement filtrent par `knocker_id`. Une
--   vente hors porte-à-porte n'en a pas — elle ne peut donc pas fausser
--   l'entonnoir d'un knocker, sans qu'aucun filtre supplémentaire soit requis.
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
