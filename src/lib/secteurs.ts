/**
 * Secteurs de porte-à-porte : normalisation des noms de rue, fusion des
 * segments OpenStreetMap, géométrie du polygone.
 *
 * Entièrement pur — ni réseau, ni navigateur, ni base.
 */

export type Point = {
  lat: number
  lng: number
}

/** Une rue prête à être enregistrée. */
export type RueSecteur = {
  /** Nom d'affichage, tel qu'OpenStreetMap le donne. */
  nom: string
  /** Clé de déduplication. */
  nomNormalise: string
  /** Segments distincts : une rue coupée reste plusieurs polylignes. */
  geometrie: Point[][]
}

const ACCENTS = /[̀-ͯ]/g
const PONCTUATION = /[.,;:'’"()\-–—/\\]+/g
const ESPACES = /\s+/g

/**
 * Types de voie ramenés à une forme unique.
 *
 * ⚠️ On NORMALISE le type, on ne le supprime pas. Retirer « rue » et
 * « boulevard » ferait de « Rue Principale » et « Boulevard Principale » la même
 * rue — ce sont deux voies différentes, et elles coexistent dans beaucoup de
 * municipalités québécoises. Le but est de rapprocher les abréviations, pas
 * d'effacer l'information.
 */
const TYPES_VOIE: ReadonlyArray<[RegExp, string]> = [
  [/\bboul\b|\bboulv\b|\bbld\b|\bblvd\b/g, 'boulevard'],
  [/\bav\b|\bave\b/g, 'avenue'],
  [/\bch\b|\bchem\b/g, 'chemin'],
  [/\bmtee\b/g, 'montee'],
  [/\brg\b/g, 'rang'],
  [/\bcroiss\b/g, 'croissant'],
  [/\bimp\b/g, 'impasse'],
]

/** Saint / Sainte et leurs abréviations, très fréquents dans les noms d'ici. */
const SAINTS: ReadonlyArray<[RegExp, string]> = [
  [/\bste\b|\bsainte\b/g, 'sainte'],
  [/\bst\b|\bsaint\b/g, 'saint'],
]

/**
 * Forme comparable d'un nom de rue.
 *
 * « Boul. St-Denis », « boulevard Saint-Denis » et « BOULEVARD SAINT DENIS »
 * donnent tous `boulevard saint denis`.
 */
export function normaliserNomRue(nom: string): string {
  let sortie = nom
    .normalize('NFD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(PONCTUATION, ' ')
    .replace(ESPACES, ' ')
    .trim()

  // `sainte` avant `saint` : sinon « ste » deviendrait « saint e ».
  for (const [motif, remplacement] of [...SAINTS, ...TYPES_VOIE]) {
    sortie = sortie.replace(motif, remplacement)
  }

  return sortie.replace(ESPACES, ' ').trim()
}

/** Un « way » Overpass, réduit à ce qui nous intéresse. */
export type VoieOverpass = {
  nom: string
  /** Overpass renvoie `lon`, Google Maps attend `lng` — déjà converti ici. */
  points: Point[]
}

/**
 * Fusionne les segments portant le même nom.
 *
 * OpenStreetMap découpe une rue à chaque changement de limite, de vitesse ou
 * d'intersection : une même rue arrive en cinq ou dix « ways ». Sans fusion,
 * la checklist afficherait cinq fois « Rue Principale ».
 *
 * Les segments sont CONSERVÉS séparément dans `geometrie` : les concaténer
 * tracerait un trait fantôme entre deux tronçons disjoints.
 *
 * Le nom d'affichage retenu est celui du premier segment rencontré, l'ordre
 * d'entrée étant préservé.
 */
export function fusionnerRues(voies: readonly VoieOverpass[]): RueSecteur[] {
  const parCle = new Map<string, RueSecteur>()

  for (const voie of voies) {
    const nom = voie.nom.trim()

    if (!nom) continue

    const points = voie.points.filter(
      (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
    )

    if (points.length < 2) continue

    const cle = normaliserNomRue(nom)

    if (!cle) continue

    const existante = parCle.get(cle)

    if (existante) {
      existante.geometrie.push(points)
    } else {
      parCle.set(cle, { nom, nomNormalise: cle, geometrie: [points] })
    }
  }

  return [...parCle.values()]
}

/** Tri d'affichage : fr-CA, chiffres compris (« 2e Avenue » avant « 10e Avenue »). */
const COMPARATEUR = new Intl.Collator('fr-CA', { numeric: true, sensitivity: 'base' })

export function trierRuesSecteur<T extends { nom: string }>(rues: readonly T[]): T[] {
  return [...rues].sort((a, b) => COMPARATEUR.compare(a.nom, b.nom))
}

/**
 * Un polygone exploitable : au moins trois sommets, coordonnées valides.
 *
 * Google renvoie le contour sans répéter le premier point à la fin ; on ne
 * l'exige donc pas.
 */
export function polygoneValide(points: unknown): points is Point[] {
  if (!Array.isArray(points) || points.length < 3) return false

  return points.every(
    (point) =>
      typeof point === 'object' &&
      point !== null &&
      Number.isFinite((point as Point).lat) &&
      Number.isFinite((point as Point).lng) &&
      Math.abs((point as Point).lat) <= 90 &&
      Math.abs((point as Point).lng) <= 180,
  )
}

/** Cadre englobant, pour recentrer la carte sur le secteur. */
export function cadreDuPolygone(points: readonly Point[]): {
  sud: number
  nord: number
  ouest: number
  est: number
} | null {
  if (points.length === 0) return null

  return points.reduce(
    (cadre, point) => ({
      sud: Math.min(cadre.sud, point.lat),
      nord: Math.max(cadre.nord, point.lat),
      ouest: Math.min(cadre.ouest, point.lng),
      est: Math.max(cadre.est, point.lng),
    }),
    {
      sud: points[0].lat,
      nord: points[0].lat,
      ouest: points[0].lng,
      est: points[0].lng,
    },
  )
}

/**
 * Polygone au format attendu par Overpass : « lat lon lat lon … ».
 *
 * Overpass parle `lat lon` séparés par des espaces, dans un seul littéral. Les
 * coordonnées sont arrondies à six décimales — ~11 cm, largement assez, et ça
 * raccourcit une requête qui peut compter des dizaines de sommets.
 */
export function polygoneVersOverpass(points: readonly Point[]): string {
  return points
    .map((point) => `${point.lat.toFixed(6)} ${point.lng.toFixed(6)}`)
    .join(' ')
}

/** Progression d'un secteur, pour l'affichage. */
export function progressionSecteur(
  rues: readonly { complete: boolean }[],
): { faites: number; total: number; pourcentage: number } {
  const total = rues.length
  const faites = rues.filter((rue) => rue.complete).length

  return {
    faites,
    total,
    pourcentage: total === 0 ? 0 : Math.round((faites / total) * 100),
  }
}
