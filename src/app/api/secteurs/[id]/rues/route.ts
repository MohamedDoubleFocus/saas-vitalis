import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { ruesDeLaZone, ruesDuPolygone } from '@/lib/overpass'
import { polygoneValide } from '@/lib/secteurs'
import { createClient } from '@/lib/supabase/server'

/**
 * Relance l'import des rues d'un secteur existant.
 *
 * Sert quand Overpass était indisponible à la création, ou quand OpenStreetMap
 * s'est enrichi depuis. Les rues déjà présentes sont conservées **avec leur état
 * « faite »** : seules les nouvelles sont ajoutées.
 */
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
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

  const supabase = await createClient()

  // La RLS décide de la visibilité : un manager ne lit ici que SES secteurs
  // (`secteurs_select_manager`). Un secteur qu'il ne gère pas donne un 404, pas
  // un import silencieux sur la zone de quelqu'un d'autre.
  const { data: secteur } = await supabase
    .from('secteurs')
    .select('id, polygone, osm_zone_id, osm_type')
    .eq('id', id)
    .maybeSingle()

  if (!secteur) {
    return NextResponse.json({ erreur: 'Secteur introuvable.' }, { status: 404 })
  }

  // On rejoue la zone OSM d'origine quand on la connaît : c'est elle qui a servi
  // à l'import initial, et elle est plus fidèle que le contour reconstruit —
  // lequel peut n'être qu'un cadre englobant.
  const parZone =
    typeof secteur.osm_zone_id === 'number' &&
    (secteur.osm_type === 'relation' || secteur.osm_type === 'way')

  if (!parZone && !polygoneValide(secteur.polygone)) {
    return NextResponse.json({ erreur: 'Polygone invalide.' }, { status: 400 })
  }

  try {
    const { rues } = parZone
      ? await ruesDeLaZone(
          secteur.osm_zone_id as number,
          secteur.osm_type as 'relation' | 'way',
        )
      : await ruesDuPolygone(secteur.polygone as { lat: number; lng: number }[])

    if (rues.length === 0) {
      return NextResponse.json({
        ajoutees: 0,
        avertissement: 'Aucune rue nommée trouvée dans cette zone.',
      })
    }

    // Ce qui est déjà là ne doit pas être réécrit : une rue cochée « faite »
    // resterait faite, mais un `upsert` écraserait sa géométrie et, surtout,
    // ferait perdre le sens du geste si le nom d'affichage avait changé.
    const { data: existantes } = await supabase
      .from('territoires')
      .select('nom_normalise')
      .eq('secteur_id', id)

    const dejaLa = new Set(
      (existantes ?? []).map((rue) => rue.nom_normalise).filter(Boolean),
    )

    const nouvelles = rues.filter((rue) => !dejaLa.has(rue.nomNormalise))

    if (nouvelles.length === 0) {
      return NextResponse.json({ ajoutees: 0, message: 'Aucune nouvelle rue.' })
    }

    const { error } = await supabase.from('territoires').insert(
      nouvelles.map((rue) => ({
        secteur_id: id,
        nom_rue: rue.nom,
        nom_normalise: rue.nomNormalise,
        geometrie: rue.geometrie,
      })),
    )

    if (error) {
      return NextResponse.json({ erreur: error.message }, { status: 500 })
    }

    return NextResponse.json({ ajoutees: nouvelles.length })
  } catch (erreur) {
    console.error('Overpass indisponible :', erreur)

    return NextResponse.json(
      { erreur: 'OpenStreetMap n’a pas répondu. Réessaie dans un moment.' },
      { status: 503 },
    )
  }
}
