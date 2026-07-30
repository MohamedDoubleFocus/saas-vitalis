import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { ruesDuPolygone } from '@/lib/overpass'
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

  if (session.role !== 'admin') {
    return NextResponse.json({ erreur: 'Réservé aux administrateurs.' }, { status: 403 })
  }

  const supabase = await createClient()

  const { data: secteur } = await supabase
    .from('secteurs')
    .select('id, polygone')
    .eq('id', id)
    .maybeSingle()

  if (!secteur) {
    return NextResponse.json({ erreur: 'Secteur introuvable.' }, { status: 404 })
  }

  if (!polygoneValide(secteur.polygone)) {
    return NextResponse.json({ erreur: 'Polygone invalide.' }, { status: 400 })
  }

  try {
    const { rues } = await ruesDuPolygone(secteur.polygone)

    if (rues.length === 0) {
      return NextResponse.json({
        ajoutees: 0,
        avertissement: 'Aucune rue nommée trouvée dans ce polygone.',
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
