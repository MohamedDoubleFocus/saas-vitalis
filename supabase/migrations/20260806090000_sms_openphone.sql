-- ============================================================================
-- saas-vitalis — SMS automatiques via OpenPhone (module 2.6)
--
-- Deux envois :
--   • confirmation immédiate quand un knocker book un rendez-vous ;
--   • rappel la veille à 9 h, déclenché par un Vercel Cron.
--
-- Chaque closer envoie depuis SON numéro OpenPhone, pour que le client reçoive
-- le message de la personne qu'il va rencontrer et puisse lui répondre.
--
-- Migration idempotente, purement additive.
-- ============================================================================


-- ============================================================================
-- 1. profiles.openphone_number
-- ----------------------------------------------------------------------------
-- Numéro OpenPhone du closer, au format E.164 (`+15145551234`) — le seul que
-- l'API accepte. Même convention que `opportunites.client_tel`, déjà stocké en
-- E.164 depuis le module 2.
--
-- NULL pour les autres rôles et pour un closer non configuré : dans ce cas
-- aucun SMS ne part, sans que ce soit une erreur.
--
-- Les politiques de `profiles` couvrent déjà cette colonne : elles portent sur
-- la ligne, pas sur la liste des colonnes. Seul un admin peut donc la modifier
-- (`profiles_update_admin`), et un closer lit la sienne.
-- ============================================================================

alter table public.profiles
  add column if not exists openphone_number text;

comment on column public.profiles.openphone_number is
  'Numéro OpenPhone du closer en E.164, expéditeur de ses SMS. NULL si non configuré.';

-- Garde-fou minimal : E.164 nord-américain, ou NULL. Empêche qu'un numéro
-- collé depuis un courriel (« (514) 555-1234 ») parte tel quel vers l'API.
do $$ begin
  alter table public.profiles
    add constraint profiles_openphone_number_e164
    check (openphone_number is null or openphone_number ~ '^\+1[2-9][0-9]{9}$');
exception
  when duplicate_object then null;
end $$;


-- ============================================================================
-- 2. opportunites.rappel_sms_envoye_le
-- ----------------------------------------------------------------------------
-- Marqueur d'idempotence du cron. Une colonne plutôt qu'une table `sms_journal` :
-- il n'y a qu'UN rappel possible par rendez-vous, donc une table ne stockerait
-- jamais plus d'une ligne par opportunité. Une colonne dit la même chose sans
-- jointure.
--
-- Conséquence assumée : on ne garde pas l'historique des SMS de confirmation.
-- Si un jour il faut auditer chaque envoi, ce sera une table dédiée.
-- ============================================================================

alter table public.opportunites
  add column if not exists rappel_sms_envoye_le timestamptz;

comment on column public.opportunites.rappel_sms_envoye_le is
  'Horodatage du SMS de rappel de la veille. NON NULL = déjà envoyé, le cron passe son tour.';


-- ============================================================================
-- 3. INDEX POUR LE CRON
-- ----------------------------------------------------------------------------
-- Le cron cherche chaque matin : statut `rdv`, `date_rdv` demain, rappel non
-- envoyé. Index partiel : il ne couvre que les lignes réellement candidates,
-- donc il reste minuscule même quand la table grossit.
-- ============================================================================

create index if not exists idx_opportunites_rappel_a_envoyer
  on public.opportunites (date_rdv)
  where statut = 'rdv' and rappel_sms_envoye_le is null;


-- ============================================================================
-- 4. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- Aucune politique RLS. Le cron s'exécute avec `service_role` (il n'a pas de
-- session utilisateur), et l'écran d'administration écrit via la session de
-- l'admin, déjà autorisée par `profiles_update_admin`.
-- ============================================================================
