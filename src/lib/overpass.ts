import 'server-only'

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

type ReponseOverpass = {
  elements?: {
    type?: string
    tags?: { name?: string }
    geometry?: { lat?: number; lon?: number }[]
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
 * Rues nommées à l'intérieur du polygone.
 *
 * Renvoie une liste **vide** — pas une erreur — quand la zone n'a aucune rue :
 * polygone minuscule, secteur rural, données OSM absentes. C'est un cas normal
 * que l'interface signale, pas une panne.
 *
 * Lève seulement si TOUS les miroirs ont échoué.
 */
export async function ruesDuPolygone(
  polygone: readonly Point[],
): Promise<ResultatRues> {
  const requete = requeteOverpass(polygone)
  const echecs: string[] = []

  for (const miroir of MIROIRS) {
    try {
      const donnees = await interroger(miroir, requete)

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

      return { rues: fusionnerRues(voies), miroir }
    } catch (erreur) {
      echecs.push(
        `${miroir} : ${erreur instanceof Error ? erreur.message : 'erreur inconnue'}`,
      )
      // Miroir suivant. Pas de nouvelle tentative sur le même : s'il est saturé,
      // insister ne fait qu'aggraver la limitation de débit.
    }
  }

  throw new Error(`Aucun miroir Overpass n’a répondu.\n${echecs.join('\n')}`)
}
