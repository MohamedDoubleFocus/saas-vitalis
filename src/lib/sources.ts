import type { Database } from '@/lib/supabase/database.types'

/**
 * D'où vient une opportunité.
 *
 * `porte` est le cas de très loin le plus fréquent — c'était même le seul
 * possible jusqu'à l'écran de vente directe. Les trois autres décrivent une
 * vente qui n'a jamais eu de porte cognée.
 *
 * Entièrement pur.
 */

export type SourceOpp = Database['public']['Enums']['source_opp']

export const LIBELLES_SOURCE: Record<SourceOpp, string> = {
  porte: 'Porte-à-porte',
  reference: 'Référence',
  entrant: 'Appel entrant',
  autre: 'Autre',
}

/** Ce que chaque source veut dire, pour lever l'hésitation à la saisie. */
export const AIDES_SOURCE: Record<SourceOpp, string> = {
  porte: 'Un knocker a cogné à cette porte.',
  reference: 'Un client existant nous a recommandés.',
  entrant: 'Le client nous a appelés ou écrits de lui-même.',
  autre: 'Salon, publicité, partenaire…',
}

/**
 * Sources créables depuis l'écran d'administration.
 *
 * `porte` en est volontairement ABSENTE : une opportunité de porte-à-porte se
 * crée sur le terrain, par le knocker, avec son GPS et son compteur de visites.
 * L'autoriser ici ouvrirait une seconde façon de faire la même chose — et la
 * traçabilité du knocker (§4.3) serait perdue au premier usage.
 */
export const SOURCES_DIRECTES: readonly SourceOpp[] = [
  'reference',
  'entrant',
  'autre',
]

export function estSourcePorte(source: SourceOpp): boolean {
  return source === 'porte'
}

/**
 * Source reçue d'un formulaire, ou `null`.
 *
 * N'accepte QUE les sources directes : c'est ce qui empêche de forger une vente
 * « porte-à-porte » sans knocker depuis l'écran d'administration.
 */
export function lireSourceDirecte(valeur: unknown): SourceOpp | null {
  return SOURCES_DIRECTES.includes(valeur as SourceOpp)
    ? (valeur as SourceOpp)
    : null
}
