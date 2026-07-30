-- ============================================================================
-- saas-vitalis — Migration initiale (module 0 : fondations)
--
-- Crée le schéma complet de gestion ventes + opérations de Toitures Vitalis :
-- types énumérés, tables, trigger d'horodatage, index, RLS et bucket photos.
--
-- Cette migration est idempotente : elle peut être rejouée sans erreur.
-- Toutes les politiques RLS de cette phase sont volontairement permissives
-- (accès complet au rôle `authenticated`). Le module 1 les remplacera par des
-- politiques granulaires par rôle — voir la section 9 pour la marche à suivre.
-- ============================================================================


-- ============================================================================
-- 1. TYPES ÉNUMÉRÉS
-- ----------------------------------------------------------------------------
-- `create type` n'accepte pas `if not exists` : on intercepte `duplicate_object`
-- pour rendre chaque création rejouable.
-- Note : pour AJOUTER une valeur à un enum plus tard, utiliser une nouvelle
-- migration avec `alter type ... add value if not exists '...'`.
-- ============================================================================

-- Rôles applicatifs. knocker = porte-à-porte, closer = vente/RDV,
-- roofer = exécution des travaux, admin = accès complet.
do $$ begin
  create type public.role_user as enum ('knocker', 'closer', 'roofer', 'admin');
exception
  when duplicate_object then null;
end $$;

-- Cycle de vie d'une opportunité, du porte-à-porte jusqu'au paiement.
do $$ begin
  create type public.statut_opp as enum (
    'absent',      -- personne à la porte
    'refus',       -- refus du client
    'repasser',    -- à revisiter
    'rdv',         -- rendez-vous fixé avec un closer
    'vendu',       -- contrat signé
    'planifie',    -- travaux planifiés
    'en_cours',    -- travaux en cours
    'complete',    -- travaux terminés
    'facture',     -- facture envoyée
    'paye',        -- payé en totalité
    'perdu'        -- opportunité perdue
  );
exception
  when duplicate_object then null;
end $$;

-- État du paiement d'un contrat.
do $$ begin
  create type public.statut_paiement as enum ('non_paye', 'depot', 'complet');
exception
  when duplicate_object then null;
end $$;

-- Types de travaux vendables.
do $$ begin
  create type public.type_travail as enum (
    'traitement_gonano',   -- traitement nano-silice GoNano
    'refection_bardeaux',  -- réfection de bardeaux d'asphalte
    'refection_metal',     -- réfection de toit métal
    'gouttieres',          -- gouttières
    'autre'
  );
exception
  when duplicate_object then null;
end $$;

-- Gammes de produit GoNano.
do $$ begin
  create type public.produit_gonano as enum ('fortify', 'revive', 'bio_boost');
exception
  when duplicate_object then null;
end $$;


-- ============================================================================
-- 2. TABLE profiles — utilisateurs de l'application
-- ----------------------------------------------------------------------------
-- Miroir applicatif de `auth.users` : un profil par compte authentifié.
-- La suppression d'un compte auth supprime le profil (cascade).
-- ============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nom_complet text,
  role        public.role_user not null,
  actif       boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Profil applicatif d''un utilisateur authentifié (rôle, nom, activation).';


-- ============================================================================
-- 3. TABLE territoires — rues assignées au porte-à-porte
-- ----------------------------------------------------------------------------
-- Un territoire = une rue, assignable à un knocker et marquable comme complétée.
-- ============================================================================

create table if not exists public.territoires (
  id         uuid primary key default gen_random_uuid(),
  nom_rue    text not null,
  ville      text,
  -- Knocker assigné. `set null` : le retrait d'un profil libère le territoire
  -- au lieu de le détruire.
  knocker_id uuid references public.profiles (id) on delete set null,
  complete   boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.territoires is
  'Rue assignée au porte-à-porte, avec son knocker et son état d''avancement.';


-- ============================================================================
-- 4. TABLE opportunites — table centrale (une porte cognée → un contrat payé)
-- ----------------------------------------------------------------------------
-- Une opportunité suit une adresse tout au long du cycle de vente et
-- d'exécution. Les FK vers `profiles` utilisent `set null` afin qu'un départ
-- d'employé n'efface aucun historique commercial.
-- ============================================================================

create table if not exists public.opportunites (
  id uuid primary key default gen_random_uuid(),

  -- --- Assignations -------------------------------------------------------
  knocker_id    uuid references public.profiles (id) on delete set null,
  closer_id     uuid references public.profiles (id) on delete set null,
  roofer_id     uuid references public.profiles (id) on delete set null,
  territoire_id uuid references public.territoires (id) on delete set null,

  -- --- Cycle de vie et suivi des visites ----------------------------------
  statut          public.statut_opp not null default 'absent',
  nb_visites      integer not null default 1,
  derniere_visite timestamptz not null default now(),

  -- --- Localisation -------------------------------------------------------
  adresse     text not null,
  ville       text,
  code_postal text,
  latitude    numeric(9, 6),
  longitude   numeric(9, 6),

  -- --- Coordonnées du client ----------------------------------------------
  client_nom      text,
  client_tel      text,
  client_courriel text,

  -- --- Montants et paiement -----------------------------------------------
  -- `montant_contrat` est le total vendu ; le détail par type de travail vit
  -- dans `opportunite_travaux`, les suppléments dans `extras`.
  montant_contrat numeric(12, 2),
  depot_recu      numeric(12, 2) not null default 0,
  statut_paiement public.statut_paiement not null default 'non_paye',

  -- --- Mesures ------------------------------------------------------------
  superficie_pi2 integer,

  -- --- Rendez-vous de vente (synchronisé avec Google Calendar) ------------
  date_rdv        timestamptz,
  google_event_id text,

  -- --- Planification des travaux ------------------------------------------
  -- Fenêtre cible (date_cible_debut → date_cible_fin) puis date confirmée.
  date_cible_debut date,
  date_cible_fin   date,
  date_confirmee   date,
  nb_reports       integer not null default 0,

  -- --- Horodatage ---------------------------------------------------------
  -- `updated_at` est maintenu automatiquement (voir section 6).
  vendu_le   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.opportunites is
  'Opportunité de vente : une adresse suivie du porte-à-porte jusqu''au paiement.';


-- ============================================================================
-- 5. TABLES ENFANTS de opportunites
-- ----------------------------------------------------------------------------
-- Toutes en `on delete cascade` : supprimer une opportunité efface son détail.
-- ============================================================================

-- 5.1 Lignes de travaux vendus (une opportunité peut cumuler plusieurs types).
create table if not exists public.opportunite_travaux (
  id             uuid primary key default gen_random_uuid(),
  opportunite_id uuid not null references public.opportunites (id) on delete cascade,
  type           public.type_travail not null,
  -- Renseigné uniquement pour `type = 'traitement_gonano'`.
  produit_gonano public.produit_gonano,
  -- Deuxième couche de Fortify (option facturable du traitement GoNano).
  deuxieme_couche_fortify boolean not null default false,
  montant        numeric(12, 2) not null,
  created_at     timestamptz not null default now()
);

comment on table public.opportunite_travaux is
  'Ligne de travaux vendue sur une opportunité (type, produit, montant).';

-- 5.2 Suppléments et imprévus de chantier.
create table if not exists public.extras (
  id             uuid primary key default gen_random_uuid(),
  opportunite_id uuid not null references public.opportunites (id) on delete cascade,
  description    text not null,
  montant        numeric(12, 2) not null,
  -- `false` = supplément absorbé par l'entreprise, non facturé au client.
  facturable     boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on table public.extras is
  'Supplément ou imprévu rattaché à une opportunité (facturable ou non).';

-- 5.3 Notes libres (fil de suivi).
create table if not exists public.notes (
  id             uuid primary key default gen_random_uuid(),
  opportunite_id uuid not null references public.opportunites (id) on delete cascade,
  texte          text not null,
  auteur         text,
  created_at     timestamptz not null default now()
);

comment on table public.notes is
  'Note de suivi libre rattachée à une opportunité.';

-- 5.4 Photos de chantier.
create table if not exists public.photos (
  id             uuid primary key default gen_random_uuid(),
  opportunite_id uuid not null references public.opportunites (id) on delete cascade,
  -- Chemin de l'objet DANS le bucket privé `photos`
  -- (ex. `<opportunite_id>/avant-01.jpg`), jamais une URL publique :
  -- l'accès se fait par URL signée.
  photo_url      text not null,
  created_at     timestamptz not null default now()
);

comment on table public.photos is
  'Photo de chantier : chemin de l''objet dans le bucket privé `photos`.';

comment on column public.photos.photo_url is
  'Chemin dans le bucket `photos` (pas une URL publique).';


-- ============================================================================
-- 6. TRIGGER — maintien automatique de opportunites.updated_at
-- ----------------------------------------------------------------------------
-- `set search_path = ''` évite toute résolution de nom dépendante de l'appelant.
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger : positionne updated_at à now() à chaque UPDATE.';

drop trigger if exists trg_opportunites_updated_at on public.opportunites;
create trigger trg_opportunites_updated_at
  before update on public.opportunites
  for each row
  execute function public.set_updated_at();


-- ============================================================================
-- 7. INDEX — clés étrangères et colonnes de filtrage fréquentes
-- ----------------------------------------------------------------------------
-- Postgres n'indexe pas automatiquement les clés étrangères.
-- ============================================================================

-- Filtrage du pipeline par statut et par personne assignée.
create index if not exists idx_opportunites_statut     on public.opportunites (statut);
create index if not exists idx_opportunites_knocker_id on public.opportunites (knocker_id);
create index if not exists idx_opportunites_closer_id  on public.opportunites (closer_id);
create index if not exists idx_opportunites_roofer_id  on public.opportunites (roofer_id);

-- Chargement du détail d'une opportunité.
create index if not exists idx_opportunite_travaux_opportunite_id on public.opportunite_travaux (opportunite_id);
create index if not exists idx_extras_opportunite_id              on public.extras (opportunite_id);
create index if not exists idx_notes_opportunite_id               on public.notes (opportunite_id);
create index if not exists idx_photos_opportunite_id              on public.photos (opportunite_id);

-- Territoires d'un knocker.
create index if not exists idx_territoires_knocker_id on public.territoires (knocker_id);


-- ============================================================================
-- 8. PERMISSIONS DE BASE
-- ----------------------------------------------------------------------------
-- Les privilèges SQL sont la première barrière, la RLS (section 9) la seconde.
-- `anon` ne reçoit rien : aucun accès sans authentification.
-- ============================================================================

grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;


-- ============================================================================
-- 9. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- PHASE 0 : une seule politique permissive par table, pour `authenticated`.
-- Tout utilisateur connecté voit et modifie tout. Aucun accès anonyme.
--
-- MODULE 1 (politiques par rôle) — marche à suivre, dans une NOUVELLE migration :
--   1. `drop policy "<table>_authenticated_tout" on public.<table>;`
--   2. créer des politiques séparées par opération (select / insert / update /
--      delete) et par rôle, en lisant le rôle depuis `public.profiles` ;
--   3. prévoir une fonction `security definer` (ex. `public.role_actuel()`) qui
--      retourne le rôle de `auth.uid()`, afin d'éviter une récursion RLS quand
--      une politique de `profiles` doit elle-même lire `profiles`.
-- La RLS activée ici n'a pas à être retouchée : seules les politiques changeront.
-- ============================================================================

alter table public.profiles            enable row level security;
alter table public.territoires         enable row level security;
alter table public.opportunites        enable row level security;
alter table public.opportunite_travaux enable row level security;
alter table public.extras              enable row level security;
alter table public.notes               enable row level security;
alter table public.photos              enable row level security;

drop policy if exists profiles_authenticated_tout on public.profiles;
create policy profiles_authenticated_tout on public.profiles
  for all to authenticated using (true) with check (true);

drop policy if exists territoires_authenticated_tout on public.territoires;
create policy territoires_authenticated_tout on public.territoires
  for all to authenticated using (true) with check (true);

drop policy if exists opportunites_authenticated_tout on public.opportunites;
create policy opportunites_authenticated_tout on public.opportunites
  for all to authenticated using (true) with check (true);

drop policy if exists opportunite_travaux_authenticated_tout on public.opportunite_travaux;
create policy opportunite_travaux_authenticated_tout on public.opportunite_travaux
  for all to authenticated using (true) with check (true);

drop policy if exists extras_authenticated_tout on public.extras;
create policy extras_authenticated_tout on public.extras
  for all to authenticated using (true) with check (true);

drop policy if exists notes_authenticated_tout on public.notes;
create policy notes_authenticated_tout on public.notes
  for all to authenticated using (true) with check (true);

drop policy if exists photos_authenticated_tout on public.photos;
create policy photos_authenticated_tout on public.photos
  for all to authenticated using (true) with check (true);


-- ============================================================================
-- 10. STORAGE — bucket privé `photos`
-- ----------------------------------------------------------------------------
-- Bucket non public : la lecture passe par une URL signée
-- (`supabase.storage.from('photos').createSignedUrl(...)`).
-- Les politiques portent sur `storage.objects` et sont filtrées sur ce seul
-- bucket, pour ne pas ouvrir les autres buckets du projet.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists photos_bucket_authenticated_select on storage.objects;
create policy photos_bucket_authenticated_select on storage.objects
  for select to authenticated using (bucket_id = 'photos');

drop policy if exists photos_bucket_authenticated_insert on storage.objects;
create policy photos_bucket_authenticated_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');

drop policy if exists photos_bucket_authenticated_delete on storage.objects;
create policy photos_bucket_authenticated_delete on storage.objects
  for delete to authenticated using (bucket_id = 'photos');


-- ============================================================================
-- Fin de la migration initiale.
-- ============================================================================
