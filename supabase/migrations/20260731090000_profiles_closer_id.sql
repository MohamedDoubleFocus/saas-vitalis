-- ============================================================================
-- saas-vitalis — Relation knocker → closer (module 2, socle terrain)
--
-- Un knocker est rattaché à un closer : c'est à lui qu'il envoie ses rendez-vous.
-- Un closer a 0..N knockers. Migration purement additive.
-- ============================================================================


-- ============================================================================
-- 1. COLONNE closer_id
-- ----------------------------------------------------------------------------
-- Auto-référence sur `profiles`. `on delete set null` : le départ d'un closer
-- délie ses knockers au lieu de les supprimer (invariant soft-delete, §4.2).
--
-- Cette colonne n'a de sens que pour un profil de rôle `knocker`. La contrainte
-- « closer_id doit pointer vers un profil de rôle closer » n'est PAS exprimable
-- en `check` (elle porte sur une autre ligne) : elle est appliquée côté
-- application, dans l'écran admin qui ne propose que des closers. Un trigger
-- pourrait la verrouiller en base — hors périmètre pour l'instant.
-- ============================================================================

alter table public.profiles
  add column if not exists closer_id uuid references public.profiles (id) on delete set null;

comment on column public.profiles.closer_id is
  'Closer auquel ce knocker est rattaché (NULL pour les autres rôles).';

-- Un profil ne peut pas être son propre closer. Contrainte intra-ligne, donc
-- exprimable en `check`.
do $$ begin
  alter table public.profiles
    add constraint profiles_closer_id_pas_soi_meme
    check (closer_id is null or closer_id <> id);
exception
  when duplicate_object then null;
end $$;


-- ============================================================================
-- 2. INDEX
-- ----------------------------------------------------------------------------
-- Sert la requête « les knockers de ce closer ».
-- ============================================================================

create index if not exists idx_profiles_closer_id on public.profiles (closer_id);


-- ============================================================================
-- 3. RLS — rien à changer
-- ----------------------------------------------------------------------------
-- `profiles_select` (chacun son profil, l'admin tous) et `profiles_update_admin`
-- couvrent déjà cette colonne : les politiques portent sur la ligne, pas sur la
-- liste des colonnes.
--
-- Conséquence voulue : un knocker lit `closer_id` sur SON profil (il a besoin de
-- savoir à quel closer envoyer ses rendez-vous), et seul un admin peut le
-- modifier.
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
