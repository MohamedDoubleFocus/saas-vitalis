-- ============================================================================
-- saas-vitalis — Transmission du rendez-vous à Make/GHL
--
-- CE QUI CHANGE DANS L'ARCHITECTURE.
--
-- Jusqu'ici, Vitalis créait lui-même l'événement Google et envoyait le SMS de
-- confirmation. L'inbound, lui, passait par GHL → Make. Deux chaînes pour le
-- même geste : deux formats de titre à maintenir, deux textes de SMS, deux
-- endroits où changer une durée.
--
-- Désormais, quand un rendez-vous est booké, Vitalis appelle le webhook Make —
-- le MÊME que l'inbound. Google reste branché, mais en LECTURE SEULE : lire les
-- disponibilités du closer exige un aller-retour instantané, à la porte, devant
-- un client. C'est la seule chose que la chaîne de webhooks ne peut pas faire.
--
-- POURQUOI UNE COLONNE.
--
-- `google_event_id` servait de marqueur : NULL voulait dire « pas encore
-- synchronisé », ce qui alimentait le bouton « Renvoyer ». Ce n'est plus Google
-- qui crée l'événement, et réutiliser cette colonne pour un identifiant GHL
-- serait un mensonge par le nom.
--
-- Sans marqueur, un webhook qui tombe fait disparaître un rendez-vous en
-- silence — et on ne le découvre qu'en voyant un closer ne pas se présenter.
--
-- Migration idempotente.
-- ============================================================================


-- ============================================================================
-- 1. LA COLONNE
-- ============================================================================

alter table public.opportunites
  add column if not exists rdv_transmis_le timestamptz;

comment on column public.opportunites.rdv_transmis_le is
  'Instant où le rendez-vous a été transmis au webhook Make. NULL = jamais transmis, donc à renvoyer.';


-- ============================================================================
-- 2. INDEX DE RATTRAPAGE
-- ----------------------------------------------------------------------------
-- Partiel : seules les lignes NON transmises nous intéressent, et elles sont
-- rares. L'index reste minuscule tout en rendant instantanée la question « quels
-- rendez-vous n'ont jamais atteint Make ? ».
-- ============================================================================

create index if not exists idx_opportunites_rdv_non_transmis
  on public.opportunites (date_rdv)
  where date_rdv is not null and rdv_transmis_le is null;


-- ============================================================================
-- 3. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- • `google_event_id` reste en place. Les rendez-vous déjà créés dans Google
--   gardent leur identifiant, et le jour où tu voudras supprimer un événement,
--   l'information est encore là. On ne détruit pas un historique pour faire
--   propre.
-- • Aucune politique RLS : la colonne suit l'opportunité.
-- • Le trigger `opportunites_restreindre_maj_roofer` compare la ligne entière —
--   la nouvelle colonne est protégée d'office contre une écriture par un roofer.
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
