import 'server-only'

import {
  idAireOverpass,
  lireQuartiers,
  requeteQuartiers,
  type ElementOsm,
  type QuartierOsm,
  type TypeOsm,
} from './quartiers'
import {
  fusionnerRues,
  polygoneVersOverpass,
  type Point,
  type RueSecteur,
  type VoieOverpass,
} from './secteurs'

/**
 * Récupération des rues d'un polygone via Overpass (OpenStreetMap).
 *
 * Service public gratuit, sans clé d'API — mais partagé par toute la planète :
 * il est régulièrement lent ou saturé. D'où les miroirs et le repli en cascade.
 *
 * Côté serveur uniquement : c'est un appel long (jusqu'à 60 s) qui n'a rien à
 * faire dans un navigateur, et l'entête `User-Agent` ci-dessous serait ignorée
 * par le navigateur de toute façon.
 */

/**
 * Miroirs, essayés dans l'ordre.
 *
 * `overpass-api.de` est l'instance de référence, la plus souvent saturée.
 * `kumi.systems` est généralement plus rapide.
 */
const MIROIRS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
] as const

/**
 * Overpass renvoie `406 Not Acceptable` sans `User-Agent` identifiable — c'est
 * leur façon de bloquer les scripts anonymes. L'entête doit désigner
 * l'application et permettre de nous joindre.
 */
const USER_AGENT = 'Vitalis/1.0 (SaaS interne Toitures Vitalis; info@toituresvitalis.ca)'

/** Budget par miroir. Overpass lui-même est plafonné à 60 s dans la requête. */
const DELAI_MAX_MS = 60_000

/**
 * Types de voies retenus : celles qu'on peut cogner.
 *
 * Exclut volontairement `motorway`, `trunk` et leurs bretelles (autoroutes,
 * personne n'y habite), ainsi que les chemins piétons et pistes cyclables.
 */
const TYPES_VOIE =
  'residential|primary|secondary|tertiary|unclassified|living_street|service|road'

function requeteOverpass(polygone: readonly Point[]): string {
  const contour = polygoneVersOverpass(polygone)

  // `way[…](poly:"…")` : tous les segments dont au moins un point tombe dans le
  // polygone. `out geom;` joint la géométrie complète, ce qui évite un second
  // aller-retour pour résoudre les nœuds.
  return `[out:json][timeout:60];
way["highway"~"^(${TYPES_VOIE})$"]["name"](poly:"${contour}");
out geom;`
}

/**
 * Requête des rues d'une ZONE OSM, par identifiant.
 *
 * Préférée au polygone quand le secteur vient d'un quartier : le découpage est
 * celui d'OpenStreetMap lui-même, au mètre près, sans reconstruction géométrique
 * de notre part. C'est ce qui permet d'afficher un contour approximatif sans que
 * les rues importées le soient.
 */
function requeteZone(osmId: number, osmType: TypeOsm): string {
  return `[out:json][timeout:60];
area(${idAireOverpass(osmId, osmType)})->.zone;
way["highway"~"^(${TYPES_VOIE})$"]["name"](area.zone);
out geom;`
}

type ReponseOverpass = {
  elements?: {
    type?: string
    id?: number
    tags?: Record<string, string | undefined>
    geometry?: { lat?: number; lon?: number }[]
    /** Relations : la géométrie est portée par les membres. */
    members?: {
      type?: string
      role?: string
      geometry?: { lat?: number; lon?: number }[]
    }[]
  }[]
}

export type ResultatRues = {
  rues: RueSecteur[]
  /** Miroir qui a répondu — utile au diagnostic quand c'est lent. */
  miroir: string
}

async function interroger(
  miroir: string,
  requete: string,
): Promise<ReponseOverpass> {
  const abandon = AbortSignal.timeout(DELAI_MAX_MS)

  const reponse = await fetch(miroir, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: `data=${encodeURIComponent(requete)}`,
    signal: abandon,
    cache: 'no-store',
  })

  if (!reponse.ok) {
    throw new Error(`${miroir} a répondu ${reponse.status}`)
  }

  return (await reponse.json()) as ReponseOverpass
}

/**
 * Interroge les miroirs dans l'ordre, jusqu'à ce que l'un réponde.
 *
 * Pas de nouvelle tentative sur un même miroir : s'il est saturé, insister ne
 * fait qu'aggraver la limitation de débit.
 *
 * Lève seulement si TOUS ont échoué, avec le détail de chaque échec — sans ça,
 * un « Overpass indisponible » ne dit pas s'il s'agit d'un 429, d'un timeout ou
 * d'une requête malformée.
 */
async function essayerMiroirs(
  requete: string,
): Promise<{ donnees: ReponseOverpass; miroir: string }> {
  const echecs: string[] = []

  for (const miroir of MIROIRS) {
    try {
      return { donnees: await interroger(miroir, requete), miroir }
    } catch (erreur) {
      echecs.push(
        `${miroir} : ${erreur instanceof Error ? erreur.message : 'erreur inconnue'}`,
      )
    }
  }

  throw new Error(`Aucun miroir Overpass n’a répondu.\n${echecs.join('\n')}`)
}

/** Traduit les « ways » d'une réponse en rues fusionnées. */
function ruesDeLaReponse(donnees: ReponseOverpass): RueSecteur[] {
  const voies: VoieOverpass[] = (donnees.elements ?? [])
    .filter((element) => element.type === 'way' && element.tags?.name)
    .map((element) => ({
      nom: element.tags!.name!,
      // ⚠️ Overpass dit `lon`, Google Maps dit `lng`. La conversion se fait
      // ICI, une seule fois — plus loin, tout le code parle `lng`.
      points: (element.geometry ?? [])
        .filter(
          (point): point is { lat: number; lon: number } =>
            typeof point.lat === 'number' && typeof point.lon === 'number',
        )
        .map((point) => ({ lat: point.lat, lng: point.lon })),
    }))

  return fusionnerRues(voies)
}

/**
 * Rues nommées à l'intérieur du polygone.
 *
 * Renvoie une liste **vide** — pas une erreur — quand la zone n'a aucune rue :
 * polygone minuscule, secteur rural, données OSM absentes. C'est un cas normal
 * que l'interface signale, pas une panne.
 */
export async function ruesDuPolygone(
  polygone: readonly Point[],
): Promise<ResultatRues> {
  const { donnees, miroir } = await essayerMiroirs(requeteOverpass(polygone))

  return { rues: ruesDeLaReponse(donnees), miroir }
}

/**
 * Rues nommées d'une zone OSM, par identifiant.
 *
 * À préférer à `ruesDuPolygone` quand le secteur vient d'un quartier : le
 * découpage est celui d'OSM, pas notre reconstruction du contour.
 */
export async function ruesDeLaZone(
  osmId: number,
  osmType: TypeOsm,
): Promise<ResultatRues> {
  const { donnees, miroir } = await essayerMiroirs(requeteZone(osmId, osmType))

  return { rues: ruesDeLaReponse(donnees), miroir }
}

export type ResultatQuartiers = {
  quartiers: QuartierOsm[]
  miroir: string
}

/**
 * Quartiers et zones administratives contenant un point.
 *
 * Liste **vide** = OpenStreetMap ne connaît aucun découpage à cet endroit. C'est
 * fréquent au Québec hors des grands centres : l'interface bascule alors sur le
 * rayon autour de l'adresse. Ce n'est pas une panne.
 */
export async function quartiersAutourDe(
  lat: number,
  lng: number,
): Promise<ResultatQuartiers> {
  const { donnees, miroir } = await essayerMiroirs(requeteQuartiers(lat, lng))

  return {
    quartiers: lireQuartiers((donnees.elements ?? []) as ElementOsm[]),
    miroir,
  }
}
