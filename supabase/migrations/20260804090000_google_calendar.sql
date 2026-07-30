-- ============================================================================
-- saas-vitalis — Intégration Google Calendar (module 2.5)
--
-- Architecture : UN SEUL compte Google (info@toituresvitalis.ca) porte tous les
-- agendas. Chaque closer a un calendrier dans ce compte, désigné par
-- `profiles.google_calendar_id`. On ne connecte donc pas chaque closer
-- individuellement : un unique jeton de rafraîchissement suffit pour toute
-- l'application.
--
-- Migration idempotente. Aucune donnée existante n'est touchée.
-- ============================================================================


-- ============================================================================
-- 1. profiles.google_calendar_id
-- ----------------------------------------------------------------------------
-- Identifiant du calendrier Google associé à ce closer, tel que renvoyé par
-- l'API (souvent une adresse : `abcdef@group.calendar.google.com`).
--
-- NULL pour les autres rôles, et pour un closer pas encore associé — auquel cas
-- l'application retombe sur les créneaux fixes.
-- ============================================================================

alter table public.profiles
  add column if not exists google_calendar_id text;

comment on column public.profiles.google_calendar_id is
  'Calendrier Google du closer, dans le compte central. NULL si non associé.';


-- ============================================================================
-- 2. google_credentials — le jeton de rafraîchissement
-- ----------------------------------------------------------------------------
-- Une seule ligne, puisqu'un seul compte Google. La clé primaire est un texte
-- fixe (`compte_principal`) : c'est un verrou, pas un identifiant. Impossible
-- d'accumuler des jetons par inadvertance.
-- ============================================================================

create table if not exists public.google_credentials (
  id             text primary key default 'compte_principal',
  -- Le jeton de rafraîchissement. Il ne périme pas : c'est LUI le secret à
  -- protéger, pas le jeton d'accès (qui dure une heure et vit en mémoire).
  refresh_token  text not null,
  -- Courriel du compte connecté, affiché à l'admin pour qu'il vérifie que c'est
  -- bien info@toituresvitalis.ca et non son compte personnel.
  courriel       text,
  portee         text,
  connecte_le    timestamptz not null default now(),
  maj_le         timestamptz not null default now(),
  -- Empêche une deuxième ligne : un seul compte, par construction.
  constraint google_credentials_ligne_unique check (id = 'compte_principal')
);

comment on table public.google_credentials is
  'Jeton de rafraîchissement du compte Google central. Accessible au seul service_role.';


-- ============================================================================
-- 3. VERROUILLAGE — plus strict que « admin uniquement »
-- ----------------------------------------------------------------------------
-- Aucune politique, aucun privilège pour `anon` ni `authenticated` : même un
-- admin connecté ne peut PAS lire cette table depuis sa session. Seul
-- `service_role` y accède, c'est-à-dire uniquement du code serveur.
--
-- Pourquoi plus strict que demandé : si un admin pouvait lire la table via
-- PostgREST, il suffirait d'un `select('*')` distrait dans un Server Component
-- passant ses données à un Client Component pour que le jeton se retrouve dans
-- le bundle envoyé au navigateur. En le rendant illisible à toute session, cette
-- fuite devient structurellement impossible.
--
-- L'écran d'administration lit l'ÉTAT de la connexion (connecté, courriel, date)
-- côté serveur via le client `service_role`, et n'expose jamais le jeton.
-- ============================================================================

alter table public.google_credentials enable row level security;

revoke all on table public.google_credentials from anon;
revoke all on table public.google_credentials from authenticated;

-- Explicite pour la relecture : `service_role` contourne la RLS de toute façon.
grant all on table public.google_credentials to service_role;

-- Le trigger d'horodatage du module 0 est réutilisé tel quel : il positionne
-- `updated_at`. Cette table utilise `maj_le`, donc on lui en donne un à elle.
create or replace function public.google_credentials_maj_le()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le = now();
  return new;
end;
$$;

drop trigger if exists trg_google_credentials_maj_le on public.google_credentials;
create trigger trg_google_credentials_maj_le
  before update on public.google_credentials
  for each row
  execute function public.google_credentials_maj_le();


-- ============================================================================
-- 4. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- `opportunites.google_event_id` existe depuis le module 0 : rien à ajouter pour
-- stocker l'identifiant de l'événement créé.
--
-- Les politiques de `profiles` couvrent déjà la nouvelle colonne : elles portent
-- sur la ligne, pas sur la liste des colonnes. Un closer lit donc son propre
-- `google_calendar_id`, et seul un admin peut le modifier.
-- ============================================================================
