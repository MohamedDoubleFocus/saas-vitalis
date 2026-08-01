import type { StatutOpp } from './doublons'

/**
 * « Mes portes » — les adresses déjà cognées par le knocker, celles qu'il peut
 * encore travailler.
 *
 * Périmètre volontairement complémentaire de « Mes meetings » : dès qu'une porte
 * a décroché un rendez-vous, elle sort d'ici et vit là-bas. Les deux écrans ne
 * montrent jamais la même chose.
 *
 * Entièrement pur.
 */

/** Statuts d'une porte encore travaillable. */
export const STATUTS_PORTE: readonly StatutOpp[] = ['repasser', 'absent', 'refus']

export type FiltrePortes = 'repasser' | 'absent' | 'refus' | 'toutes'

/**
 * Ordre des onglets : « à repasser » d'abord, parce que c'est la vraie file de
 * travail — quelqu'un a répondu et attend qu'on revienne.
 */
export const FILTRES_PORTES: readonly FiltrePortes[] = [
  'repasser',
  'absent',
  'refus',
  'toutes',
]

export const LIBELLES_FILTRES: Record<FiltrePortes, string> = {
  repasser: 'À repasser',
  absent: 'Absents',
  refus: 'Refusés',
  toutes: 'Toutes',
}

export function lireFiltre(valeur: string | undefined): FiltrePortes {
  return FILTRES_PORTES.includes(valeur as FiltrePortes)
    ? (valeur as FiltrePortes)
    : 'repasser'
}

export function correspondAuFiltre(statut: StatutOpp, filtre: FiltrePortes): boolean {
  if (filtre === 'toutes') return STATUTS_PORTE.includes(statut)

  return statut === filtre
}

export type PorteTriable = {
  derniereVisite: string
}

/**
 * Trie de la visite la plus ANCIENNE à la plus récente.
 *
 * L'inverse du réflexe habituel, et c'est voulu : une porte cognée il y a trois
 * semaines est plus urgente à retravailler qu'une cognée ce matin. Le haut de la
 * liste est la prochaine chose à faire.
 */
export function trierPortes<T extends PorteTriable>(portes: readonly T[]): T[] {
  return [...portes].sort((a, b) => {
    const da = new Date(a.derniereVisite).getTime()
    const db = new Date(b.derniereVisite).getTime()

    // Une date illisible ne doit pas faire disparaître la porte : on la renvoie
    // en fin de liste plutôt que de la perdre dans un tri incohérent.
    if (Number.isNaN(da)) return 1
    if (Number.isNaN(db)) return -1

    return da - db
  })
}

/** Nombre de portes par onglet, pour afficher les compteurs. */
export function compterParFiltre(
  portes: readonly { statut: StatutOpp }[],
): Record<FiltrePortes, number> {
  const comptes: Record<FiltrePortes, number> = {
    repasser: 0,
    absent: 0,
    refus: 0,
    toutes: 0,
  }

  for (const porte of portes) {
    if (!STATUTS_PORTE.includes(porte.statut)) continue

    comptes.toutes += 1

    if (porte.statut === 'repasser') comptes.repasser += 1
    else if (porte.statut === 'absent') comptes.absent += 1
    else if (porte.statut === 'refus') comptes.refus += 1
  }

  return comptes
}
