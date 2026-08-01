/**
 * Calculs de dates dans un fuseau **explicite**, indépendants du fuseau du
 * processus.
 *
 * Pourquoi ce module existe : le cron des rappels tourne sur Vercel, en UTC.
 * `new Date(a, m, j)` y construirait minuit UTC, soit 20 h la veille au Québec —
 * les rappels partiraient pour le mauvais jour. Tout passe donc par `Intl`, à
 * qui on impose le fuseau, plutôt que par les accesseurs locaux de `Date`.
 *
 * Entièrement pur : les tests donnent le même résultat quel que soit le `TZ` de
 * la machine qui les exécute.
 */

/** Fuseau de l'entreprise. Le Québec suit America/Toronto (mêmes règles). */
export const FUSEAU_QUEBEC = 'America/Toronto'

export type PartiesDate = {
  annee: number
  mois: number
  jour: number
  heure: number
  minute: number
}

const FORMATS = new Map<string, Intl.DateTimeFormat>()

function formateur(fuseau: string): Intl.DateTimeFormat {
  let format = FORMATS.get(fuseau)

  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    FORMATS.set(fuseau, format)
  }

  return format
}

/** Décompose un instant dans le fuseau demandé. */
export function partiesDansFuseau(instant: Date, fuseau: string): PartiesDate {
  const parties = formateur(fuseau).formatToParts(instant)
  const lire = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parties.find((partie) => partie.type === type)?.value ?? '0')

  // `hour12: false` peut rendre « 24 » pour minuit selon l'implémentation.
  const heure = lire('hour') % 24

  return {
    annee: lire('year'),
    mois: lire('month'),
    jour: lire('day'),
    heure,
    minute: lire('minute'),
  }
}

/** Décalage du fuseau par rapport à UTC, en minutes, À CET INSTANT précis. */
function decalageMinutes(instant: Date, fuseau: string): number {
  const p = partiesDansFuseau(instant, fuseau)

  const commeSiUtc = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute)

  // Les secondes sont ignorées de part et d'autre : on compare des minutes.
  const reference = Math.floor(instant.getTime() / 60000) * 60000

  return (commeSiUtc - reference) / 60000
}

/**
 * Instant UTC correspondant à une heure locale donnée dans ce fuseau.
 *
 * Deux passes : la première estime le décalage, la seconde le corrige. C'est
 * nécessaire aux bascules d'heure — le 8 mars, le décalage change à 2 h du
 * matin, et une estimation faite avec le décalage de la veille tomberait à côté.
 */
export function instantDepuisLocal(
  annee: number,
  mois: number,
  jour: number,
  heure: number,
  minute: number,
  fuseau: string,
): Date {
  const naif = Date.UTC(annee, mois - 1, jour, heure, minute)

  const premiereEstimation = new Date(naif - decalageMinutes(new Date(naif), fuseau) * 60000)

  return new Date(
    naif - decalageMinutes(premiereEstimation, fuseau) * 60000,
  )
}

/** Jour local (AAAA-MM-JJ) d'un instant, dans ce fuseau. */
export function jourDansFuseau(instant: Date, fuseau: string): string {
  const p = partiesDansFuseau(instant, fuseau)
  const deuxChiffres = (n: number) => String(n).padStart(2, '0')

  return `${p.annee}-${deuxChiffres(p.mois)}-${deuxChiffres(p.jour)}`
}

/**
 * Bornes UTC d'une journée locale : `[minuit, minuit du lendemain[`.
 *
 * `decalageJours` permet de viser un autre jour que celui de `instant` — c'est
 * `1` pour « demain », ce dont le cron a besoin.
 */
export function bornesJourneeLocale(
  instant: Date,
  fuseau: string,
  decalageJours = 0,
): { debut: Date; fin: Date } {
  const p = partiesDansFuseau(instant, fuseau)

  // `Date.UTC` normalise les débordements : le 31 + 1 devient bien le 1er du
  // mois suivant, changement d'année compris.
  const cible = new Date(Date.UTC(p.annee, p.mois - 1, p.jour + decalageJours))
  const c = {
    annee: cible.getUTCFullYear(),
    mois: cible.getUTCMonth() + 1,
    jour: cible.getUTCDate(),
  }

  return {
    debut: instantDepuisLocal(c.annee, c.mois, c.jour, 0, 0, fuseau),
    fin: instantDepuisLocal(c.annee, c.mois, c.jour + 1, 0, 0, fuseau),
  }
}

const FORMAT_LISIBLE = new Map<string, Intl.DateTimeFormat>()

/**
 * « lundi 3 août à 17 h 00 » — dans le fuseau de l'entreprise, pas celui du
 * serveur.
 *
 * Utilisé dans les SMS : le client lit l'heure de SON rendez-vous.
 */
export function formaterDateHeureFuseau(
  instant: Date,
  fuseau: string = FUSEAU_QUEBEC,
): string {
  let format = FORMAT_LISIBLE.get(fuseau)

  if (!format) {
    format = new Intl.DateTimeFormat('fr-CA', {
      timeZone: fuseau,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
    })
    FORMAT_LISIBLE.set(fuseau, format)
  }

  // fr-CA rend « lundi 3 août à 17 h 00 » ou « lundi 3 août, 17 h 00 » selon la
  // version d'ICU : on normalise pour que le SMS soit toujours identique.
  return format.format(instant).replace(/,\s*/, ' à ')
}
