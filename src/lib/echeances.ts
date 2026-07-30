/**
 * Dates et échéances, en heure locale de l'appareil.
 *
 * Tout est calculé en LOCAL, pas en UTC : un rendez-vous à 19 h le lundi doit
 * s'afficher « lundi 19 h » pour le knocker qui est au Québec, quelle que soit
 * la région où tourne le serveur.
 */

/** Minuit local du jour de `date`. */
export function minuitLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Jour local au format AAAA-MM-JJ (et non `toISOString`, qui passe en UTC). */
export function jourLocalIso(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, '0')
  const jour = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${mois}-${jour}`
}

/**
 * Écart en jours **calendaires**, pas en tranches de 24 h.
 *
 * Un rendez-vous ce soir à 19 h vu à 23 h hier soir est « demain », pas
 * « dans 0 jour ». C'est la comparaison de minuit à minuit qui donne ça.
 */
export function joursDEcart(date: Date, maintenant: Date): number {
  const millisecondesParJour = 24 * 60 * 60 * 1000
  const ecart =
    minuitLocal(date).getTime() - minuitLocal(maintenant).getTime()

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

const FORMAT_JOUR_COURT = new Intl.DateTimeFormat('fr-CA', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-CA', {
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
