import type { Database } from '@/lib/supabase/database.types'

/**
 * Langue du CLIENT — pas celle de l'application.
 *
 * L'interface reste en français partout (CLAUDE.md §1) : c'est un outil interne
 * pour une équipe québécoise. Ce module décrit dans quelle langue on s'adresse
 * au client : appel du closer, SMS, visite à la porte.
 *
 * Entièrement pur.
 */

export type LangueClient = Database['public']['Enums']['langue_client']

/** Le cas de très loin le plus fréquent au Québec. */
export const LANGUE_DEFAUT: LangueClient = 'fr'

export const LANGUES: readonly LangueClient[] = ['fr', 'en']

/**
 * Libellés affichés au knocker.
 *
 * « FR » / « ENG » plutôt que « Français » / « Anglais » : ce sont les mêmes
 * codes que dans GHL, et deux boutons courts se visent mieux au pouce, dehors,
 * qu'une liste déroulante.
 */
export const LIBELLES_LANGUE: Record<LangueClient, string> = {
  fr: 'FR',
  en: 'ENG',
}

/** Libellé long, pour les écrans de gestion où la place ne manque pas. */
export const LIBELLES_LANGUE_LONG: Record<LangueClient, string> = {
  fr: 'Français',
  en: 'Anglais',
}

/**
 * Langue reçue d'un formulaire ou d'une charge de file d'attente.
 *
 * Retombe sur le français plutôt que d'échouer : une valeur inattendue ne doit
 * jamais empêcher l'enregistrement d'un lead à la porte (CLAUDE.md §5).
 */
export function lireLangue(valeur: unknown): LangueClient {
  return LANGUES.includes(valeur as LangueClient)
    ? (valeur as LangueClient)
    : LANGUE_DEFAUT
}

/**
 * Code de langue tel que l'attendent GHL et Make.
 *
 * Isolé ici : le jour où le champ distant change de format, c'est cette
 * fonction qu'on modifie, pas le corps du webhook.
 */
export function codeLangueExterne(langue: LangueClient): string {
  return LIBELLES_LANGUE[langue]
}
