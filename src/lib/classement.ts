import { lireDate } from './echeances'

import type { StatutOpp } from './doublons'

/**
 * Classement des knockers (gamification, CLAUDE.md §1 : roulement constant chez
 * les knockers — le tableau de scores fait partie du produit).
 *
 * Tout est agrégé ici, en pur, à partir des lignes brutes lues en ligne.
 */

export type Periode = 'aujourdhui' | 'semaine' | 'mois'

export const PERIODES: readonly Periode[] = ['aujourdhui', 'semaine', 'mois']

export const LIBELLES_PERIODES: Record<Periode, string> = {
  aujourdhui: 'Aujourd’hui',
  semaine: 'Cette semaine',
  mois: 'Ce mois',
}

/**
 * Statuts qui signifient « le rendez-vous a mené à une vente ».
 *
 * `perdu` en est exclu même s'il vient après `vendu` dans l'ordre de l'enum :
 * l'ordre de l'enum sert aux comparaisons de progression, pas au sens métier.
 */
const STATUTS_CLOSES: readonly StatutOpp[] = [
  'vendu',
  'planifie',
  'en_cours',
  'complete',
  'facture',
  'paye',
]

export function estClose(statut: StatutOpp): boolean {
  return STATUTS_CLOSES.includes(statut)
}

/** Une opportunité, réduite à ce dont le classement a besoin. */
export type LigneClassement = {
  knockerId: string | null
  dateRdv: string | null
  statut: StatutOpp
}

export type RangeeClassement = {
  knockerId: string
  nom: string
  rdv: number
  closes: number
  /** Rang à partir de 1. Les ex æquo partagent le même rang. */
  rang: number
}

/**
 * Bornes locales d'une période : `[debut, fin[`.
 *
 * - `aujourdhui` : de minuit à minuit.
 * - `semaine`    : du **lundi** (convention fr-CA) au lundi suivant.
 * - `mois`       : du 1er au 1er du mois suivant.
 */
export function bornesPeriode(
  periode: Periode,
  maintenant: Date,
): { debut: Date; fin: Date } {
  const annee = maintenant.getFullYear()
  const mois = maintenant.getMonth()
  const jour = maintenant.getDate()

  if (periode === 'aujourdhui') {
    return {
      debut: new Date(annee, mois, jour),
      fin: new Date(annee, mois, jour + 1),
    }
  }

  if (periode === 'semaine') {
    // getDay() : 0 = dimanche. On veut lundi comme premier jour, donc dimanche
    // compte pour 6 jours après le lundi.
    const jourSemaine = maintenant.getDay()
    const reculJusquAuLundi = jourSemaine === 0 ? 6 : jourSemaine - 1

    return {
      debut: new Date(annee, mois, jour - reculJusquAuLundi),
      fin: new Date(annee, mois, jour - reculJusquAuLundi + 7),
    }
  }

  return {
    debut: new Date(annee, mois, 1),
    fin: new Date(annee, mois + 1, 1),
  }
}

export function dansPeriode(
  date: Date,
  periode: Periode,
  maintenant: Date,
): boolean {
  const { debut, fin } = bornesPeriode(periode, maintenant)
  const t = date.getTime()

  return t >= debut.getTime() && t < fin.getTime()
}

/**
 * Agrège le classement.
 *
 * ⚠️ La période porte sur **`date_rdv`**, c'est-à-dire la date du rendez-vous, et
 * non le moment où il a été booké. Le schéma ne conserve pas d'horodatage de
 * booking (`created_at` vaudrait la première visite, pas la prise de rendez-vous).
 * « Cette semaine » signifie donc « les rendez-vous qui tombent cette semaine ».
 * Pour compter les bookings du jour, il faudra une colonne `rdv_booke_le`.
 *
 * Les knockers sans aucun rendez-vous dans la période apparaissent quand même,
 * à 0 : un classement où l'on disparaît en faisant zéro n'incite à rien.
 */
/** Métrique de classement : rendez-vous bookés, ou rendez-vous qui ont vendu. */
export type Critere = 'rdv' | 'closes'

export const LIBELLES_CRITERES: Record<Critere, string> = {
  rdv: 'Rendez-vous',
  closes: 'Ventes',
}

export function agregerClassement(
  lignes: readonly LigneClassement[],
  nomsParId: ReadonlyMap<string, string | null>,
  periode: Periode,
  maintenant: Date,
  critere: Critere = 'rdv',
): RangeeClassement[] {
  const comptes = new Map<string, { rdv: number; closes: number }>()

  for (const [id] of nomsParId) {
    comptes.set(id, { rdv: 0, closes: 0 })
  }

  for (const ligne of lignes) {
    if (!ligne.knockerId) continue

    const dateRdv = lireDate(ligne.dateRdv)

    if (!dateRdv || !dansPeriode(dateRdv, periode, maintenant)) continue

    const compte = comptes.get(ligne.knockerId) ?? { rdv: 0, closes: 0 }

    compte.rdv += 1
    if (estClose(ligne.statut)) compte.closes += 1

    comptes.set(ligne.knockerId, compte)
  }

  const rangees = [...comptes.entries()]
    .map(([knockerId, compte]) => ({
      knockerId,
      nom: nomsParId.get(knockerId) || 'Sans nom',
      rdv: compte.rdv,
      closes: compte.closes,
      rang: 0,
    }))
    .sort((a, b) => {
      // Le critère choisi mène ; l'autre départage.
      const principal = critere === 'rdv' ? b.rdv - a.rdv : b.closes - a.closes
      const secondaire = critere === 'rdv' ? b.closes - a.closes : b.rdv - a.rdv

      return principal || secondaire || a.nom.localeCompare(b.nom, 'fr-CA')
    })

  // Rangs ex æquo : deux knockers à égalité partagent le rang, et le suivant
  // saute (1, 2, 2, 4) — comme dans un classement sportif.
  let rangCourant = 0
  let precedent: { rdv: number; closes: number } | null = null

  return rangees.map((rangee, index) => {
    if (
      !precedent ||
      precedent.rdv !== rangee.rdv ||
      precedent.closes !== rangee.closes
    ) {
      rangCourant = index + 1
    }

    precedent = { rdv: rangee.rdv, closes: rangee.closes }

    return { ...rangee, rang: rangCourant }
  })
}
