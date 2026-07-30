-- ============================================================================
-- saas-vitalis — Secteurs de porte-à-porte (module 5)
--
-- L'admin dessine un polygone sur une carte ; l'application récupère les rues
-- nommées à l'intérieur (via Overpass / OpenStreetMap) et les enregistre. Le
-- secteur entier est ensuite attribué à un knocker.
--
-- DÉCISION DE MODÈLE — on n'invente pas une table « rues ».
-- `territoires` (module 0) EST déjà la table des rues : `nom_rue`, `ville`,
-- `knocker_id`, `complete`. On l'étend au lieu de la doubler, ce qui garde
-- `opportunites.territoire_id` utile (rattacher un lead à sa rue) et évite deux
-- notions de « rue » dans le schéma.
--
-- L'ASSIGNATION REMONTE AU SECTEUR : c'est `secteurs.knocker_id` qui fait foi.
-- `territoires.knocker_id` reste pour les rues créées à la main hors secteur.
--
-- Migration idempotente.
-- ============================================================================


-- ============================================================================
-- 1. TABLE secteurs
-- ============================================================================

create table if not exists public.secteurs (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  notes      text,
  -- Polygone dessiné : [{ "lat": 45.4, "lng": -72.73 }, …].
  -- JSONB plutôt que PostGIS : on ne fait aucun calcul géométrique en base
  -- (c'est Overpass qui découpe), donc l'extension serait un coût sans usage.
  polygone   jsonb not null,
  -- Knocker à qui le secteur est attribué. `set null` : un départ libère le
  -- secteur au lieu de le détruire (invariant soft-delete, §4.2).
  knocker_id uuid references public.profiles (id) on delete set null,
  cree_par   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.secteurs is
  'Zone de porte-à-porte délimitée par un polygone, attribuée à un knocker.';

create index if not exists idx_secteurs_knocker_id on public.secteurs (knocker_id);

drop trigger if exists trg_secteurs_updated_at on public.secteurs;
create trigger trg_secteurs_updated_at
  before update on public.secteurs
  for each row
  execute function public.set_updated_at();


-- ============================================================================
-- 2. EXTENSION DE territoires
-- ----------------------------------------------------------------------------
-- Purement additive : les colonnes existantes ne bougent pas.
-- ============================================================================

alter table public.territoires
  add column if not exists secteur_id    uuid references public.secteurs (id) on delete cascade,
  -- Clé de déduplication : OSM découpe une rue en plusieurs segments portant le
  -- même nom. Voir `normaliserNomRue()` côté application.
  add column if not exists nom_normalise text,
  -- Tracé de la rue : tableau de SEGMENTS, chacun étant une suite de points.
  -- [[{lat,lng},…],[{lat,lng},…]] — une rue coupée par un parc reste deux
  -- polylignes distinctes, qu'un tableau plat relierait par un trait fantôme.
  add column if not exists geometrie     jsonb,
  add column if not exists complete_le   timestamptz,
  add column if not exists complete_par  uuid references public.profiles (id) on delete set null;

comment on column public.territoires.secteur_id is
  'Secteur d''où provient cette rue. NULL pour une rue saisie à la main.';

create index if not exists idx_territoires_secteur_id on public.territoires (secteur_id);

-- Une rue n'apparaît qu'une fois par secteur, quel que soit le nombre de
-- segments renvoyés par OpenStreetMap.
create unique index if not exists idx_territoires_secteur_nom
  on public.territoires (secteur_id, nom_normalise)
  where secteur_id is not null and nom_normalise is not null;


-- ============================================================================
-- 3. RLS — secteurs
-- ----------------------------------------------------------------------------
-- Admin : tout. Knocker : lecture seule de SES secteurs (il a besoin du
-- polygone pour se repérer, pas du droit de le modifier).
-- ============================================================================

alter table public.secteurs enable row level security;

grant select, insert, update, delete on public.secteurs to authenticated;

drop policy if exists secteurs_admin_tout on public.secteurs;
create policy secteurs_admin_tout on public.secteurs
  for all to authenticated
  using ((select public.est_admin()))
  with check ((select public.est_admin()));

drop policy if exists secteurs_select_knocker on public.secteurs;
create policy secteurs_select_knocker on public.secteurs
  for select to authenticated
  using (
    (select public.role_actuel()) = 'knocker'
    and knocker_id = (select auth.uid())
  );


-- ============================================================================
-- 4. RLS — territoires : l'accès suit désormais le secteur
-- ----------------------------------------------------------------------------
-- Un knocker voit une rue si le SECTEUR qui la porte lui est attribué. La règle
-- historique (`territoires.knocker_id`) est conservée en OU, pour les rues
-- saisies à la main sans secteur.
-- ============================================================================

drop policy if exists territoires_select_knocker on public.territoires;
create policy territoires_select_knocker on public.territoires
  for select to authenticated
  using (
    (select public.role_actuel()) = 'knocker'
    and (
      knocker_id = (select auth.uid())
      or exists (
        select 1
        from public.secteurs s
        where s.id = territoires.secteur_id
          and s.knocker_id = (select auth.uid())
      )
    )
  );

drop policy if exists territoires_update_knocker on public.territoires;
create policy territoires_update_knocker on public.territoires
  for update to authenticated
  using (
    (select public.role_actuel()) = 'knocker'
    and (
      knocker_id = (select auth.uid())
      or exists (
        select 1
        from public.secteurs s
        where s.id = territoires.secteur_id
          and s.knocker_id = (select auth.uid())
      )
    )
  )
  with check (
    (select public.role_actuel()) = 'knocker'
    and (
      knocker_id = (select auth.uid())
      or exists (
        select 1
        from public.secteurs s
        where s.id = territoires.secteur_id
          and s.knocker_id = (select auth.uid())
      )
    )
  );


-- ============================================================================
-- 5. TRIGGER — ce qu'un knocker a le droit de changer sur une rue
-- ----------------------------------------------------------------------------
-- Le trigger du module 1 énumérait les colonnes intouchables. Les cinq colonnes
-- ajoutées ci-dessus lui échappaient donc : un knocker aurait pu réécrire le
-- tracé d'une rue ou la déplacer de secteur.
--
-- On passe à la comparaison de ligne entière (même patron que le trigger roofer
-- du module 4) : tout ce qui n'est pas explicitement autorisé est refusé, et une
-- colonne ajoutée plus tard est protégée d'office.
--
-- Autorisé : `complete`, `complete_le`, `complete_par`.
-- ============================================================================

create or replace function public.territoires_restreindre_maj_knocker()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_temoin public.territoires%rowtype;
begin
  if public.role_actuel() is distinct from 'knocker' then
    return new;
  end if;

  v_temoin := new;
  v_temoin.complete := old.complete;
  v_temoin.complete_le := old.complete_le;
  v_temoin.complete_par := old.complete_par;

  if v_temoin is distinct from old then
    raise exception
      'Un knocker ne peut que cocher une rue comme complétée.'
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
  'Trigger : limite un knocker au marquage « complétée », et horodate lui-même.';


-- ============================================================================
-- 6. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- Les politiques `territoires_*_admin` du module 1 restent en place : l'admin
-- crée, modifie et supprime rues et secteurs. `opportunites.territoire_id`
-- continue de pointer vers `territoires`, désormais alimentée par les secteurs.
-- ============================================================================
