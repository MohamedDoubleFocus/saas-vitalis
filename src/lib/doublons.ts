import type { Database } from '@/lib/supabase/database.types'

export type StatutOpp = Database['public']['Enums']['statut_opp']

export type Coordonnees = {
  latitude: number
  longitude: number
}

/** L'adresse que le knocker vient de sélectionner. */
export type AdresseCandidate = {
  adresse: string
  ville: string | null
  latitude: number | null
  longitude: number | null
}

/** Une opportunité déjà en base, candidate au doublon. */
export type OpportuniteProche = AdresseCandidate & {
  id: string
  statut: StatutOpp
  derniereVisite: string
  nbVisites: number
  knockerId: string | null
}

export type OptionsDoublon = {
  /** En deçà de cette distance, deux points sont la même porte. */
  seuilMetres: number
}

/**
 * 25 m : assez large pour absorber l'imprécision du GPS d'un téléphone et le
 * fait que Places renvoie le centroïde de la parcelle, assez serré pour ne pas
 * confondre deux maisons voisines (front bâti typique : 12–20 m en banlieue).
 */
export const OPTIONS_DOUBLON_DEFAUT: OptionsDoublon = { seuilMetres: 25 }

const ACCENTS = /[̀-ͯ]/g
const PONCTUATION = /[.,;:'’"()\-–—/\\]+/g
const ESPACES = /\s+/g

/**
 * Abréviations fr-CA des types de voie, ramenées à une forme unique.
 * « 12 Boul. St-Joseph » et « 12 boulevard Saint-Joseph » sont la même porte.
 */
const SYNONYMES: ReadonlyArray<[RegExp, string]> = [
  [/\bboul\b|\bboulv\b|\bbld\b/g, 'boulevard'],
  [/\bav\b|\bave\b/g, 'avenue'],
  [/\bch\b|\bchem\b/g, 'chemin'],
  [/\bmtee\b|\bmontee\b/g, 'montee'],
  [/\brg\b|\brang\b/g, 'rang'],
  [/\bst\b|\bste\b|\bsaint\b|\bsainte\b/g, 'saint'],
  [/\bnord\b|\bn\b/g, 'nord'],
  [/\bsud\b|\bs\b/g, 'sud'],
  [/\best\b|\be\b/g, 'est'],
  [/\bouest\b|\bo\b|\bw\b/g, 'ouest'],
  [/\bapp\b|\bapt\b|\bunite\b|\blocal\b/g, 'app'],
]

/**
 * Forme comparable d'une adresse : minuscules, sans accents, sans ponctuation,
 * abréviations normalisées, espaces réduits.
 *
 * Ce n'est pas de la normalisation postale — juste assez pour reconnaître la
 * même porte saisie deux fois. Le GPS fait le reste.
 */
export function normaliserAdresse(valeur: string): string {
  let sortie = valeur
    .normalize('NFD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(PONCTUATION, ' ')
    .replace(ESPACES, ' ')
    .trim()

  for (const [motif, remplacement] of SYNONYMES) {
    sortie = sortie.replace(motif, remplacement)
  }

  return sortie.replace(ESPACES, ' ').trim()
}

const RAYON_TERRE_METRES = 6_371_000

/** Distance orthodromique (haversine) entre deux points, en mètres. */
export function distanceMetres(a: Coordonnees, b: Coordonnees): number {
  const enRadians = (degres: number) => (degres * Math.PI) / 180

  const dLat = enRadians(b.latitude - a.latitude)
  const dLon = enRadians(b.longitude - a.longitude)
  const lat1 = enRadians(a.latitude)
  const lat2 = enRadians(b.latitude)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2

  return 2 * RAYON_TERRE_METRES * Math.asin(Math.min(1, Math.sqrt(h)))
}

function coordonneesDe(valeur: AdresseCandidate): Coordonnees | null {
  if (typeof valeur.latitude !== 'number' || typeof valeur.longitude !== 'number') {
    return null
  }

  return { latitude: valeur.latitude, longitude: valeur.longitude }
}

/** Deux adresses désignent-elles la même porte ? */
export function memeAdresse(
  candidat: AdresseCandidate,
  existant: AdresseCandidate,
  options: OptionsDoublon = OPTIONS_DOUBLON_DEFAUT,
): boolean {
  // 1. Texte identique après normalisation. Si les deux villes sont connues,
  //    elles doivent concorder — « 12 rue Principale » existe dans chaque village.
  const memeTexte =
    normaliserAdresse(candidat.adresse) === normaliserAdresse(existant.adresse) &&
    normaliserAdresse(candidat.adresse) !== ''

  if (memeTexte) {
    const villeCandidat = candidat.ville ? normaliserAdresse(candidat.ville) : null
    const villeExistant = existant.ville ? normaliserAdresse(existant.ville) : null

    if (!villeCandidat || !villeExistant || villeCandidat === villeExistant) {
      return true
    }
  }

  // 2. Sinon, la géographie tranche : Places peut formater la même porte de deux
  //    façons (« 12 Rue Principale » / « 12 Principale St »).
  const coordCandidat = coordonneesDe(candidat)
  const coordExistant = coordonneesDe(existant)

  if (coordCandidat && coordExistant) {
    return distanceMetres(coordCandidat, coordExistant) <= options.seuilMetres
  }

  return false
}

/**
 * Doublon le plus pertinent parmi les opportunités existantes, ou `null`.
 *
 * En cas de plusieurs correspondances, on renvoie **la plus récemment visitée** :
 * c'est celle dont l'information intéresse le knocker à la porte.
 */
export function trouverDoublon(
  candidat: AdresseCandidate,
  existants: readonly OpportuniteProche[],
  options: OptionsDoublon = OPTIONS_DOUBLON_DEFAUT,
): OpportuniteProche | null {
  const correspondances = existants.filter((existant) =>
    memeAdresse(candidat, existant, options),
  )

  if (correspondances.length === 0) return null

  return correspondances.reduce((meilleur, courant) =>
    new Date(courant.derniereVisite).getTime() >
    new Date(meilleur.derniereVisite).getTime()
      ? courant
      : meilleur,
  )
}

/**
 * Cadre de recherche pour interroger la base : une boîte englobante autour du
 * point, en degrés. Filtrer côté serveur sur un rectangle puis affiner avec
 * `trouverDoublon` évite de rapatrier toute la table.
 *
 * La longitude est resserrée par `cos(latitude)` — un degré de longitude vaut
 * ~78 km à la latitude de Montréal, contre 111 km pour un degré de latitude.
 */
export function boiteEnglobante(
  centre: Coordonnees,
  rayonMetres: number,
): { latMin: number; latMax: number; lonMin: number; lonMax: number } {
  const degresParMetreLat = 1 / 111_320
  const cos = Math.cos((centre.latitude * Math.PI) / 180)
  const degresParMetreLon = 1 / (111_320 * Math.max(0.01, Math.abs(cos)))

  const dLat = rayonMetres * degresParMetreLat
  const dLon = rayonMetres * degresParMetreLon

  return {
    latMin: centre.latitude - dLat,
    latMax: centre.latitude + dLat,
    lonMin: centre.longitude - dLon,
    lonMax: centre.longitude + dLon,
  }
}
