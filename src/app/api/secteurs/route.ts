import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { ruesDuPolygone } from '@/lib/overpass'
import { polygoneValide } from '@/lib/secteurs'
import { createClient } from '@/lib/supabase/server'

/**
 * Crée un secteur et y importe les rues trouvées dans le polygone.
 *
 * Route handler et non server action : l'appel à Overpass peut prendre jusqu'à
 * une minute, et `maxDuration` n'est réglable que sur une route.
 *
 * L'écriture passe par la session de l'admin, donc par `secteurs_admin_tout` et
 * `territoires_insert_admin` — la RLS reste la barrière.
 */
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await sessionCourante()

  if (!session) {
    return NextResponse.json({ erreur: 'Session requise.' }, { status: 401 })
  }

  if (session.role !== 'admin') {
    return NextResponse.json({ erreur: 'Réservé aux administrateurs.' }, { status: 403 })
  }

  let corps: { nom?: unknown; notes?: unknown; polygone?: unknown }

  try {
    corps = await request.json()
  } catch {
    return NextResponse.json({ erreur: 'Corps illisible.' }, { status: 400 })
  }

  const nom = typeof corps.nom === 'string' ? corps.nom.trim() : ''
  const notes = typeof corps.notes === 'string' ? corps.notes.trim() : ''

  if (!nom) {
    return NextResponse.json({ erreur: 'Donne un nom au secteur.' }, { status: 400 })
  }

  if (!polygoneValide(corps.polygone)) {
    return NextResponse.json(
      { erreur: 'Trace un polygone d’au moins trois coins.' },
      { status: 400 },
    )
  }

  const polygone = corps.polygone
  const supabase = await createClient()

  // Le secteur d'abord : s'il échoue, rien n'a été demandé à Overpass.
  const { data: secteur, error: erreurSecteur } = await supabase
    .from('secteurs')
    .insert({
      nom,
      notes: notes || null,
      polygone,
      cree_par: session.userId,
    })
    .select('id')
    .single()

  if (erreurSecteur || !secteur) {
    return NextResponse.json(
      { erreur: erreurSecteur?.message ?? 'Création du secteur impossible.' },
      { status: 500 },
    )
  }

  // Overpass ensuite. Un échec ici ne détruit PAS le secteur : l'admin pourra
  // relancer l'import depuis la fiche, sans redessiner le polygone.
  try {
    const { rues, miroir } = await ruesDuPolygone(polygone)

    if (rues.length === 0) {
      return NextResponse.json({
        secteurId: secteur.id,
        rues: 0,
        avertissement:
          'Aucune rue nommée trouvée dans ce polygone. Zone trop petite, rurale, ou absente d’OpenStreetMap.',
      })
    }

    const { error: erreurRues } = await supabase.from('territoires').insert(
      rues.map((rue) => ({
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

    return NextResponse.json({ secteurId: secteur.id, rues: rues.length, miroir })
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
