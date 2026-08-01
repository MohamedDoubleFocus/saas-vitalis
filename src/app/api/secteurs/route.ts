import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { ruesDeLaZone, ruesDuPolygone, type ResultatRues } from '@/lib/overpass'
import {
  cercleVersPolygone,
  lirePoint,
  lireRayon,
  type TypeOsm,
} from '@/lib/quartiers'
import { polygoneValide, type Point } from '@/lib/secteurs'
import { createClient } from '@/lib/supabase/server'

/**
 * Crée un secteur et y importe les rues.
 *
 * Deux façons de définir le secteur, dans cet ordre de préférence :
 *   1. un QUARTIER OpenStreetMap (`osmId` + `osmType`) — les rues sont demandées
 *      par identifiant de zone, donc exactes ;
 *   2. un RAYON autour d'une adresse (`centre` + `rayon`) — repli quand OSM ne
 *      connaît aucun quartier à cet endroit.
 *
 * Route handler et non server action : l'appel à Overpass peut prendre jusqu'à
 * une minute, et `maxDuration` n'est réglable que sur une route.
 *
 * L'écriture passe par la session de l'appelant : c'est la RLS
 * (`secteurs_insert_manager` / `secteurs_admin_tout`) qui décide, pas ce code.
 */
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

type CorpsSecteur = {
  nom?: unknown
  notes?: unknown
  knockerId?: unknown
  /** Quartier OSM. */
  osmId?: unknown
  osmType?: unknown
  polygone?: unknown
  /** Repli par rayon. */
  centre?: unknown
  rayon?: unknown
}

function texteOuNull(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null

  const texte = valeur.trim()

  return texte === '' ? null : texte
}

export async function POST(request: NextRequest) {
  const session = await sessionCourante()

  if (!session) {
    return NextResponse.json({ erreur: 'Session requise.' }, { status: 401 })
  }

  if (!session.estManager && session.role !== 'admin') {
    return NextResponse.json(
      { erreur: 'Réservé aux managers et aux administrateurs.' },
      { status: 403 },
    )
  }

  let corps: CorpsSecteur

  try {
    corps = (await request.json()) as CorpsSecteur
  } catch {
    return NextResponse.json({ erreur: 'Corps illisible.' }, { status: 400 })
  }

  const nom = texteOuNull(corps.nom)
  const notes = texteOuNull(corps.notes)
  const knockerId = texteOuNull(corps.knockerId)

  if (!nom) {
    return NextResponse.json({ erreur: 'Donne un nom au secteur.' }, { status: 400 })
  }

  // --- Quelle définition de zone ? -----------------------------------------
  const osmId =
    typeof corps.osmId === 'number' && Number.isInteger(corps.osmId)
      ? corps.osmId
      : null
  const osmType: TypeOsm | null =
    corps.osmType === 'relation' || corps.osmType === 'way' ? corps.osmType : null

  const centrePoint =
    typeof corps.centre === 'object' && corps.centre !== null
      ? lirePoint(
          (corps.centre as { lat?: unknown }).lat,
          (corps.centre as { lng?: unknown }).lng,
        )
      : null

  const parQuartier = osmId !== null && osmType !== null
  const parRayon = centrePoint !== null

  if (!parQuartier && !parRayon) {
    return NextResponse.json(
      { erreur: 'Choisis un quartier, ou une adresse et un rayon.' },
      { status: 400 },
    )
  }

  const rayon = parRayon ? lireRayon(corps.rayon) : null

  /**
   * Contour stocké pour l'affichage.
   *
   * Par quartier : le contour reconstruit côté client, qui peut être approximatif
   * (relation OSM en plusieurs morceaux). Par rayon : le cercle, exact.
   *
   * Dans les deux cas, ce polygone ne sert QU'À AFFICHER — les rues viennent de
   * la zone OSM ou du cercle, jamais de ce tableau relu depuis la base.
   */
  const polygone: Point[] | null = parRayon
    ? cercleVersPolygone(centrePoint, rayon as number)
    : polygoneValide(corps.polygone)
      ? corps.polygone
      : null

  if (!polygone) {
    return NextResponse.json(
      { erreur: 'Contour du quartier manquant ou invalide.' },
      { status: 400 },
    )
  }

  const supabase = await createClient()

  // Le secteur d'abord : s'il échoue, rien n'a été demandé à Overpass.
  const { data: secteur, error: erreurSecteur } = await supabase
    .from('secteurs')
    .insert({
      nom,
      notes,
      polygone,
      knocker_id: knockerId,
      cree_par: session.userId,
      osm_zone_id: parQuartier ? osmId : null,
      osm_type: parQuartier ? osmType : null,
      centre: centrePoint,
      rayon_metres: rayon,
    })
    .select('id')
    .single()

  if (erreurSecteur || !secteur) {
    return NextResponse.json(
      { erreur: erreurSecteur?.message ?? 'Création du secteur impossible.' },
      { status: 500 },
    )
  }

  // Overpass ensuite. Un échec ici ne détruit PAS le secteur : l'import se
  // relance depuis la fiche, sans avoir à re-choisir le quartier.
  try {
    const resultat: ResultatRues = parQuartier
      ? await ruesDeLaZone(osmId as number, osmType as TypeOsm)
      : await ruesDuPolygone(polygone)

    if (resultat.rues.length === 0) {
      return NextResponse.json({
        secteurId: secteur.id,
        rues: 0,
        avertissement:
          'Aucune rue nommée trouvée dans cette zone. Elle est peut-être trop petite, rurale, ou absente d’OpenStreetMap.',
      })
    }

    const { error: erreurRues } = await supabase.from('territoires').insert(
      resultat.rues.map((rue) => ({
        secteur_id: secteur.id,
        nom_rue: rue.nom,
        nom_normalise: rue.nomNormalise,
        geometrie: rue.geometrie,
      })),
    )

    if (erreurRues) {
      return NextResponse.json({
        secteurId: secteur.id,
        rues: 0,
        avertissement: `Secteur créé, mais l’enregistrement des rues a échoué : ${erreurRues.message}`,
      })
    }

    return NextResponse.json({
      secteurId: secteur.id,
      rues: resultat.rues.length,
      miroir: resultat.miroir,
    })
  } catch (erreur) {
    console.error('Overpass indisponible :', erreur)

    return NextResponse.json({
      secteurId: secteur.id,
      rues: 0,
      avertissement:
        'Secteur créé, mais OpenStreetMap n’a pas répondu. Relance l’import depuis la fiche du secteur.',
    })
  }
}
