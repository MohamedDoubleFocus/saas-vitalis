import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { quartiersAutourDe } from '@/lib/overpass'
import { lirePoint } from '@/lib/quartiers'

/**
 * Quartiers d'OpenStreetMap contenant une adresse.
 *
 * Route handler et non server action : l'appel à Overpass peut être lent, et
 * `maxDuration` n'est réglable que sur une route.
 *
 * Overpass est appelé **côté serveur** : c'est un service public partagé qui
 * exige un `User-Agent` identifiable, lequel serait ignoré depuis un navigateur.
 * Cette route est aussi ce qui évite d'exposer nos requêtes OSM au client.
 */
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await sessionCourante()

  if (!session) {
    return NextResponse.json({ erreur: 'Session requise.' }, { status: 401 })
  }

  // Découper un territoire est un geste de manager ou d'admin. La route ne lit
  // aucune donnée Vitalis, mais c'est un appel coûteux vers un service public
  // gratuit : on ne l'ouvre pas à toute l'équipe.
  if (!session.estManager && session.role !== 'admin') {
    return NextResponse.json({ erreur: 'Non autorisé.' }, { status: 403 })
  }

  const parametres = request.nextUrl.searchParams
  const point = lirePoint(parametres.get('lat'), parametres.get('lng'))

  if (!point) {
    return NextResponse.json(
      { erreur: 'Coordonnées manquantes ou invalides.' },
      { status: 400 },
    )
  }

  try {
    const { quartiers, miroir } = await quartiersAutourDe(point.lat, point.lng)

    // Liste vide = OSM ne connaît pas ce coin. Ce n'est PAS une erreur : le
    // client bascule sur le rayon. Répondre 200 avec un tableau vide plutôt
    // qu'un 404 évite de faire passer un cas normal pour une panne.
    return NextResponse.json({ quartiers, miroir })
  } catch (erreur) {
    console.error('Overpass indisponible :', erreur)

    return NextResponse.json(
      {
        erreur:
          'OpenStreetMap n’a pas répondu. Tu peux définir le secteur par un rayon autour de l’adresse.',
      },
      { status: 502 },
    )
  }
}
