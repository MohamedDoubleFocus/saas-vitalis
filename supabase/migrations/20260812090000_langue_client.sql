-- ============================================================================
-- saas-vitalis — Langue du client
--
-- POURQUOI SUR L'OPPORTUNITÉ, ET POURQUOI MAINTENANT.
--
-- Le closer appelle, envoie un SMS et se présente à la porte. S'il arrive en
-- français chez un client anglophone, la vente est compromise avant d'avoir
-- commencé. La langue est une donnée de vente, pas une préférence d'interface.
--
-- Le seul moment où quelqu'un l'ENTEND, c'est le knocker à la porte. Elle se
-- capture donc là, au même endroit que le nom et le téléphone — pas déduite
-- plus tard d'un code postal ou d'un nom de famille.
--
-- Elle alimentera aussi le champ « Langue » du webhook Make/GHL, pour que les
-- leads de porte-à-porte entrent dans les mêmes séquences que l'inbound.
--
-- ⚠️ L'APPLICATION reste en français partout (CLAUDE.md §1) : c'est un SaaS
-- interne pour une équipe québécoise. Cette colonne décrit la langue du CLIENT,
-- pas celle de l'outil.
--
-- Migration idempotente.
-- ============================================================================


-- ============================================================================
-- 1. L'ENUM
-- ----------------------------------------------------------------------------
-- `fr` en premier : c'est la valeur par défaut et le cas majoritaire au Québec.
-- Toute valeur ajoutée plus tard se met à la fin (`alter type ... add value`).
-- ============================================================================

do $$ begin
  create type public.langue_client as enum ('fr', 'en');
exception
  when duplicate_object then null;
end $$;

comment on type public.langue_client is
  'Langue dans laquelle on s''adresse au client : français ou anglais.';


-- ============================================================================
-- 2. LA COLONNE
-- ----------------------------------------------------------------------------
-- `not null default 'fr'` : au Québec c'est le cas de très loin le plus
-- fréquent, et une valeur nulle obligerait chaque écran à décider quoi faire.
-- Les leads existants deviennent « fr », ce qui est vrai par défaut — aucune
-- donnée n'est inventée, seulement supposée dans le sens le plus probable.
-- ============================================================================

alter table public.opportunites
  add column if not exists langue public.langue_client not null default 'fr';

comment on column public.opportunites.langue is
  'Langue du client. Capturée par le knocker à la porte, utilisée par le closer et les communications automatisées.';


-- ============================================================================
-- 3. CE QUE CETTE MIGRATION NE CHANGE PAS
-- ----------------------------------------------------------------------------
-- • Aucune politique RLS. La colonne suit l'opportunité : qui peut lire ou
--   modifier le lead peut lire ou modifier sa langue.
-- • `conclure_vente()` : intacte. Elle ne touche pas à ce champ, et la langue
--   choisie à la porte survit donc au close.
-- • Le trigger `opportunites_restreindre_maj_roofer` compare la ligne ENTIÈRE :
--   la nouvelle colonne est protégée d'office contre une modification par un
--   roofer, sans qu'on ait à l'énumérer.
-- ============================================================================


-- ============================================================================
-- Fin.
-- ============================================================================
