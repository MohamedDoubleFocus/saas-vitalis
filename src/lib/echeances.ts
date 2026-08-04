import {
  FUSEAU_QUEBEC,
  instantDepuisLocal,
  jourDansFuseau,
  partiesDansFuseau,
} from './fuseau'

/**
 * Dates et échéances, dans le fuseau de l'ENTREPRISE.
 *
 * ⚠️ « Local » ici veut dire America/Toronto, pas le fuseau de la machine.
 *
 * Ce module lisait autrefois `date.getHours()` et formatait sans `timeZone`,
 * donc dans le fuseau du processus. Sur le téléphone d'un knocker au Québec,
 * c'était juste par coïncidence. Sur Vercel, où `TZ` vaut UTC, un rendez-vous
 * de 10 h s'affichait **14 h** sur tous les écrans rendus côté serveur —
 * agenda, meetings, fiche de chantier, détail knocker.
 *
 * Le fuseau d'un rendez-vous de Toitures Vitalis est un fait métier, pas un
 * réglage de déploiement. Tout passe donc par `fuseau.ts`.
 */

/**
 * L'instant de minuit, au Québec, du jour de `date`.
 *
 * Un vrai instant — pas un repère : `formaterHeure()` sur ce résultat rend bien
 * « 0 h 00 ».
 */
export function minuitLocal(date: Date): Date {
  const p = partiesDansFuseau(date, FUSEAU_QUEBEC)

  return instantDepuisLocal(p.annee, p.mois, p.jour, 0, 0, FUSEAU_QUEBEC)
}

/** Jour au format AAAA-MM-JJ, dans le fuseau de l'entreprise. */
export function jourLocalIso(date: Date): string {
  return jourDansFuseau(date, FUSEAU_QUEBEC)
}

/**
 * Écart en jours **calendaires**, pas en tranches de 24 h.
 *
 * Un rendez-vous ce soir à 19 h vu à 23 h hier soir est « demain », pas
 * « dans 0 jour ». C'est la comparaison de minuit à minuit qui donne ça.
 *
 * Les deux minuits sont pris dans le fuseau de l'entreprise : sans quoi, passé
 * 20 h au Québec, un serveur en UTC serait déjà au lendemain et afficherait
 * « Hier » pour un rendez-vous du jour même.
 */
export function joursDEcart(date: Date, maintenant: Date): number {
  const millisecondesParJour = 24 * 60 * 60 * 1000
  const ecart = minuitLocal(date).getTime() - minuitLocal(maintenant).getTime()

  // `Math.round` et non une division exacte : entre deux minuits québécois il y
  // a 23 h ou 25 h les jours de changement d'heure.
  return Math.round(ecart / millisecondesParJour)
}

export function estPasse(date: Date, maintenant: Date): boolean {
  return date.getTime() < maintenant.getTime()
}

/** « Aujourd'hui », « Demain », « Dans 3 jours », « Il y a 2 jours »… */
export function libelleEcheance(date: Date, maintenant: Date): string {
  const jours = joursDEcart(date, maintenant)

  if (jours === 0) return 'Aujourd’hui'
  if (jours === 1) return 'Demain'
  if (jours === -1) return 'Hier'
  if (jours > 1) return `Dans ${jours} jours`

  return `Il y a ${Math.abs(jours)} jours`
}

/**
 * ⚠️ `timeZone` EXPLICITE sur les deux formats.
 *
 * Sans lui, `Intl` prend le fuseau du processus : le même rendez-vous
 * s'affichait 10 h sur le téléphone du knocker et 14 h sur l'écran du closer,
 * rendu côté serveur.
 */
const FORMAT_JOUR_COURT = new Intl.DateTimeFormat('fr-CA', {
  timeZone: FUSEAU_QUEBEC,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-CA', {
  timeZone: FUSEAU_QUEBEC,
  hour: 'numeric',
  minute: '2-digit',
})

/** « lundi 3 août ». */
export function formaterJour(date: Date): string {
  return FORMAT_JOUR_COURT.format(date)
}

/** « 17 h 00 » (convention fr-CA). */
export function formaterHeure(date: Date): string {
  return FORMAT_HEURE.format(date)
}

/** « lundi 3 août, 17 h 00 ». */
export function formaterDateHeure(date: Date): string {
  return `${formaterJour(date)}, ${formaterHeure(date)}`
}

/**
 * Analyse une valeur `timestamptz` venue de Supabase.
 * Renvoie `null` plutôt que `Invalid Date`, pour que l'appelant décide.
 */
export function lireDate(valeur: string | null | undefined): Date | null {
  if (!valeur) return null

  const date = new Date(valeur)

  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Heure locale (0-23) d'un instant, dans le fuseau de l'entreprise.
 *
 * `date.getHours()` donnerait l'heure du processus — 14 au lieu de 10 sur un
 * serveur en UTC.
 */
export function heureLocale(date: Date): number {
  return partiesDansFuseau(date, FUSEAU_QUEBEC).heure
}
