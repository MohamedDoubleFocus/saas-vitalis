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

/**
 * Deux adresses désignent-elles la même porte ?
 *
 * UNE SEULE RÈGLE : le même texte, après normalisation, dans la même ville.
 *
 * Il y avait auparavant un second critère — « à moins de 25 m selon le GPS ».
 * Il partait d'une bonne intention (rattraper deux formatages d'une même porte)
 * mais ne rattrapait rien : Places renvoie toujours le même libellé pour un même
 * lieu, donc le texte suffisait déjà. En revanche il attrapait les VOISINS, à
 * une quinzaine de mètres sur une rue normale. Le knocker recevait « porte déjà
 * cognée » pour des portes jamais faites, et l'alerte perdait toute crédibilité.
 *
 * Compromis assumé : une porte saisie à la main sous une forme très différente
 * (« 1024 De La Rochelle » sans « rue ») passera au travers. C'est un doublon
 * manqué, pas une fausse alerte — et re-cogner une porte coûte moins cher que
 * de ne pas oser y aller. Chaque visite compte de toute façon (CLAUDE.md §4.6).
 */
export function memeAdresse(
  candidat: AdresseCandidate,
  existant: AdresseCandidate,
): boolean {
  const texteCandidat = normaliserAdresse(candidat.adresse)

  if (texteCandidat === '' || texteCandidat !== normaliserAdresse(existant.adresse)) {
    return false
  }

  // Si les deux villes sont connues, elles doivent concorder — « 12 rue
  // Principale » existe dans chaque village du Québec.
  const villeCandidat = candidat.ville ? normaliserAdresse(candidat.ville) : null
  const villeExistant = existant.ville ? normaliserAdresse(existant.ville) : null

  return !villeCandidat || !villeExistant || villeCandidat === villeExistant
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
): OpportuniteProche | null {
  const correspondances = existants.filter((existant) =>
    memeAdresse(candidat, existant),
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
