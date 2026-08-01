import { cadreDuPolygone, type Point } from './secteurs'

/**
 * Choix d'un secteur à partir d'un QUARTIER, plutôt qu'en traçant un polygone.
 *
 * Le manager cherche une adresse, on lui propose les quartiers qui contiennent
 * ce point, il en tape un. Quand OpenStreetMap ne connaît rien à cet endroit —
 * la couverture est très inégale au Québec — un rayon autour de l'adresse prend
 * le relais.
 *
 * Entièrement pur : ni réseau, ni navigateur, ni base.
 */

/** Type d'objet OSM porteur d'une zone. */
export type TypeOsm = 'relation' | 'way'

export type QuartierOsm = {
  /** Identifiant OSM, à recombiner en « area id » pour interroger les rues. */
  osmId: number
  osmType: TypeOsm
  nom: string
  /**
   * Ce que la zone est, en clair : « Quartier », « Municipalité »…
   * Sert à l'affichage ET au tri : on montre le plus précis en premier.
   */
  categorie: string
  /**
   * Contour reconstruit, pour l'affichage sur la carte.
   *
   * ⚠️ Peut être APPROXIMATIF. Un quartier découpé en plusieurs morceaux dans
   * OSM ne se recolle pas toujours proprement : on retombe alors sur son cadre
   * englobant. L'import des rues, lui, se fait par identifiant de zone et reste
   * exact — c'est le compromis assumé.
   */
  polygone: Point[]
  /** Vrai quand `polygone` est un simple cadre englobant, pas le vrai contour. */
  approximatif: boolean
}

/* -------------------------------------------------------------------------- */
/* Requête                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Niveaux administratifs retenus, du plus fin au plus large.
 *
 * 8 = municipalité, 9 = arrondissement, 10 = quartier (convention OSM au
 * Canada). En dessous de 8 on remonterait à la MRC puis à la province : aucun
 * intérêt pour du porte-à-porte.
 */
const NIVEAUX_ADMIN = '8|9|10'

/** Valeurs de `place` qui désignent un quartier habité. */
const PLACES_QUARTIER = 'neighbourhood|suburb|quarter|borough|city_district'

/**
 * Zones contenant un point.
 *
 * `is_in` renvoie des « areas » ; `rel(pivot)` et `way(pivot)` remontent à
 * l'objet d'origine, seul porteur d'une géométrie. On demande les deux : bien
 * des quartiers québécois sont de simples chemins fermés, pas des relations.
 */
export function requeteQuartiers(lat: number, lng: number): string {
  return `[out:json][timeout:30];
is_in(${lat.toFixed(6)},${lng.toFixed(6)})->.zones;
(
  rel(pivot.zones)["place"~"^(${PLACES_QUARTIER})$"];
  way(pivot.zones)["place"~"^(${PLACES_QUARTIER})$"];
  rel(pivot.zones)["boundary"="administrative"]["admin_level"~"^(${NIVEAUX_ADMIN})$"];
);
out geom;`
}

/**
 * Requête des rues d'une zone OSM, par identifiant.
 *
 * Overpass code les « area id » ainsi : relation → 3600000000 + id,
 * way → 2400000000 + id. C'est une convention de l'API, pas un calcul de notre
 * cru — elle est stable depuis des années.
 *
 * Passer par l'area plutôt que par un polygone évite toute reconstruction
 * géométrique : le découpage est celui d'OSM, au mètre près.
 */
export function idAireOverpass(osmId: number, osmType: TypeOsm): number {
  return osmType === 'relation' ? 3_600_000_000 + osmId : 2_400_000_000 + osmId
}

/* -------------------------------------------------------------------------- */
/* Lecture de la réponse                                                       */
/* -------------------------------------------------------------------------- */

/** Un élément Overpass, réduit à ce qu'on lit. */
export type ElementOsm = {
  type?: string
  id?: number
  tags?: Record<string, string | undefined>
  /** Chemins fermés : géométrie directe. */
  geometry?: { lat?: number; lon?: number }[]
  /** Relations : géométrie portée par les membres. */
  members?: {
    type?: string
    role?: string
    geometry?: { lat?: number; lon?: number }[]
  }[]
}

const LIBELLES_PLACE: Record<string, string> = {
  neighbourhood: 'Quartier',
  suburb: 'Quartier',
  quarter: 'Quartier',
  borough: 'Arrondissement',
  city_district: 'Arrondissement',
}

const LIBELLES_NIVEAU: Record<string, string> = {
  '8': 'Municipalité',
  '9': 'Arrondissement',
  '10': 'Quartier',
}

/**
 * Rang de précision : plus c'est petit, plus la zone est fine.
 *
 * C'est ce qui met « Quartier des Érables » avant « Granby » dans la liste — le
 * manager cherche un secteur de porte-à-porte, pas une ville entière.
 */
function rangPrecision(tags: Record<string, string | undefined>): number {
  const place = tags.place

  if (place && place in LIBELLES_PLACE) {
    return place === 'borough' || place === 'city_district' ? 2 : 1
  }

  const niveau = tags.admin_level

  if (niveau === '10') return 1
  if (niveau === '9') return 2
  if (niveau === '8') return 3

  return 4
}

function categorieDe(tags: Record<string, string | undefined>): string {
  const place = tags.place

  if (place && LIBELLES_PLACE[place]) return LIBELLES_PLACE[place]

  const niveau = tags.admin_level

  if (niveau && LIBELLES_NIVEAU[niveau]) return LIBELLES_NIVEAU[niveau]

  return 'Zone'
}

function pointsValides(
  geometrie: { lat?: number; lon?: number }[] | undefined,
): Point[] {
  return (geometrie ?? [])
    .filter(
      (point): point is { lat: number; lon: number } =>
        typeof point.lat === 'number' && typeof point.lon === 'number',
    )
    // ⚠️ Overpass dit `lon`, Google Maps dit `lng`. Conversion ici, une fois.
    .map((point) => ({ lat: point.lat, lng: point.lon }))
}

/**
 * Recolle les membres extérieurs d'une relation en un seul contour.
 *
 * OSM livre une frontière en tronçons, dans un ordre quelconque et parfois
 * retournés. On part du premier et on cherche à chaque tour le tronçon dont une
 * extrémité rejoint la nôtre.
 *
 * Renvoie `null` dès que ça ne se recolle pas — trous, plusieurs anneaux,
 * tronçons manquants. L'appelant retombe alors sur le cadre englobant plutôt que
 * d'afficher une forme fausse.
 */
export function recollerAnneau(segments: readonly Point[][]): Point[] | null {
  const utilisables = segments.filter((segment) => segment.length >= 2)

  if (utilisables.length === 0) return null
  if (utilisables.length === 1) return utilisables[0]

  const restants = utilisables.slice(1)
  const anneau = [...utilisables[0]]

  while (restants.length > 0) {
    const fin = anneau[anneau.length - 1]

    const index = restants.findIndex(
      (segment) =>
        memePoint(segment[0], fin) ||
        memePoint(segment[segment.length - 1], fin),
    )

    if (index === -1) return null

    const [segment] = restants.splice(index, 1)
    const suite = memePoint(segment[0], fin) ? segment.slice(1) : segment.slice(0, -1).reverse()

    anneau.push(...suite)
  }

  return anneau.length >= 3 ? anneau : null
}

/** Tolérance de raccord : ~1 cm. Les coordonnées OSM sont à 7 décimales. */
const EPSILON = 1e-7

function memePoint(a: Point | undefined, b: Point | undefined): boolean {
  if (!a || !b) return false

  return Math.abs(a.lat - b.lat) < EPSILON && Math.abs(a.lng - b.lng) < EPSILON
}

/** Contour rectangulaire d'un ensemble de points. */
export function cadreVersPolygone(points: readonly Point[]): Point[] | null {
  const cadre = cadreDuPolygone(points)

  if (!cadre) return null

  return [
    { lat: cadre.sud, lng: cadre.ouest },
    { lat: cadre.nord, lng: cadre.ouest },
    { lat: cadre.nord, lng: cadre.est },
    { lat: cadre.sud, lng: cadre.est },
  ]
}

/**
 * Transforme la réponse Overpass en quartiers proposables.
 *
 * Les zones sans nom sont écartées : on ne peut pas demander à quelqu'un de
 * choisir entre deux entrées vides.
 */
export function lireQuartiers(elements: readonly ElementOsm[]): QuartierOsm[] {
  const quartiers: QuartierOsm[] = []
  const vus = new Set<string>()

  for (const element of elements) {
    const type = element.type === 'relation' ? 'relation' : element.type === 'way' ? 'way' : null

    if (!type || typeof element.id !== 'number') continue

    const tags = element.tags ?? {}
    const nom = tags.name?.trim()

    if (!nom) continue

    const cle = `${type}/${element.id}`

    if (vus.has(cle)) continue

    // Chemin fermé : géométrie directe. Relation : membres « outer ».
    const segments =
      type === 'way'
        ? [pointsValides(element.geometry)]
        : (element.members ?? [])
            .filter((membre) => membre.type === 'way' && membre.role !== 'inner')
            .map((membre) => pointsValides(membre.geometry))

    const tous = segments.flat()

    if (tous.length < 3) continue

    const recolle = recollerAnneau(segments.filter((s) => s.length >= 2))
    const polygone = recolle ?? cadreVersPolygone(tous)

    if (!polygone) continue

    vus.add(cle)

    quartiers.push({
      osmId: element.id,
      osmType: type,
      nom,
      categorie: categorieDe(tags),
      polygone,
      approximatif: recolle === null,
    })
  }

  return quartiers.sort(
    (a, b) =>
      rangPrecisionDe(a) - rangPrecisionDe(b) || a.nom.localeCompare(b.nom, 'fr-CA'),
  )
}

/** Rang de précision d'un quartier déjà lu, dérivé de sa catégorie. */
function rangPrecisionDe(quartier: QuartierOsm): number {
  if (quartier.categorie === 'Quartier') return 1
  if (quartier.categorie === 'Arrondissement') return 2
  if (quartier.categorie === 'Municipalité') return 3

  return 4
}

/** Exporté pour les tests : le rang tel qu'il se lit sur les tags bruts. */
export const rangPrecisionTags = rangPrecision

/* -------------------------------------------------------------------------- */
/* Repli : un rayon autour de l'adresse                                        */
/* -------------------------------------------------------------------------- */

/** Rayons proposés, en mètres. Trois choix, pas un champ libre. */
export const RAYONS_PROPOSES: readonly number[] = [300, 500, 1000]

export const RAYON_DEFAUT = 500

/** « 300 m » / « 1 km ». */
export function libelleRayon(metres: number): string {
  return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`
}

const RAYON_TERRE_METRES = 6_371_000

/**
 * Approxime un cercle par un polygone régulier.
 *
 * Overpass ne connaît pas les cercles : il faut lui donner un contour. 32 côtés
 * suffisent — à 1 km de rayon, l'écart entre le polygone et le vrai cercle est
 * de l'ordre du mètre, très en dessous de la précision d'une adresse.
 *
 * La longitude est resserrée par `cos(latitude)` : un degré de longitude vaut
 * ~78 km à la latitude de Montréal, contre 111 km pour un degré de latitude.
 * Sans cette correction, le « cercle » serait un ovale étiré d'est en ouest.
 */
export function cercleVersPolygone(
  centre: Point,
  rayonMetres: number,
  cotes = 32,
): Point[] {
  const points: Point[] = []
  const latRad = (centre.lat * Math.PI) / 180
  const cos = Math.max(0.01, Math.abs(Math.cos(latRad)))

  const dLat = (rayonMetres / RAYON_TERRE_METRES) * (180 / Math.PI)
  const dLng = dLat / cos

  for (let i = 0; i < cotes; i++) {
    const angle = (2 * Math.PI * i) / cotes

    points.push({
      lat: centre.lat + dLat * Math.cos(angle),
      lng: centre.lng + dLng * Math.sin(angle),
    })
  }

  return points
}

/** Rayon accepté : une des valeurs proposées, sinon le défaut. */
export function lireRayon(valeur: unknown): number {
  const nombre = typeof valeur === 'number' ? valeur : Number(valeur)

  return RAYONS_PROPOSES.includes(nombre) ? nombre : RAYON_DEFAUT
}

/**
 * Une coordonnée venue d'une requête HTTP, ou `null`.
 *
 * ⚠️ `Number(null)`, `Number('')` et `Number([])` valent tous **0** en
 * JavaScript. Sans ce filtre, un paramètre manquant donnerait le point (0, 0) —
 * au large de l'Afrique — et on chercherait des quartiers dans l'océan.
 */
function coordonnee(valeur: unknown): number | null {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null

  if (typeof valeur !== 'string' || valeur.trim() === '') return null

  const nombre = Number(valeur)

  return Number.isFinite(nombre) ? nombre : null
}

/** Un point exploitable, tel qu'il arrive d'une requête HTTP. */
export function lirePoint(lat: unknown, lng: unknown): Point | null {
  const latitude = coordonnee(lat)
  const longitude = coordonnee(lng)

  if (latitude === null || longitude === null) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null

  return { lat: latitude, lng: longitude }
}
