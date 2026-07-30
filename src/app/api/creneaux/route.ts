import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { occupations } from '@/lib/google/calendar'
import {
  CONFIG_DISPONIBILITES,
  creneauxLibres,
  fenetreInterrogation,
} from '@/lib/google/disponibilites'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Créneaux disponibles d'un closer.
 *
 * Cette route existe parce que la lecture de l'agenda exige le jeton du compte
 * Google — donc le serveur. Le knocker interroge cette route depuis
 * `obtenirCreneaux()`, dont la signature n'a pas changé.
 *
 * Repli : si Google est injoignable, mal configuré, ou si le closer n'a pas de
 * calendrier associé, on renvoie les créneaux fixes avec `source: 'repli'`.
 * **Jamais d'erreur bloquante** — on ne fait pas rater une vente à la porte
 * parce qu'une API tierce est lente (CLAUDE.md §5).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await sessionCourante()

  if (!session) {
    return NextResponse.json({ erreur: 'Session requise.' }, { status: 401 })
  }

  const closerId = new URL(request.url).searchParams.get('closer')
  const maintenant = new Date()

  // Repli immédiat : sans closer, il n'y a pas d'agenda à consulter.
  if (!closerId) {
    return reponseRepli(maintenant, 'closer_absent')
  }

  try {
    // `service_role` : un knocker ne peut pas lire le profil d'un closer
    // (`profiles_select` ne lui accorde que le sien). La route, elle, n'expose
    // que des heures libres — jamais le contenu de l'agenda.
    const admin = createAdminClient()

    const { data: closer } = await admin
      .from('profiles')
      .select('google_calendar_id')
      .eq('id', closerId)
      .maybeSingle()

    if (!closer?.google_calendar_id) {
      return reponseRepli(maintenant, 'calendrier_non_associe')
    }

    const { debutIso, finIso } = fenetreInterrogation(maintenant)
    const occupees = await occupations(closer.google_calendar_id, debutIso, finIso)

    const libres = creneauxLibres(maintenant, occupees, CONFIG_DISPONIBILITES)

    return NextResponse.json({
      source: 'google',
      creneaux: libres.map((debut) => debut.toISOString()),
    })
  } catch (erreur) {
    // Journalisé côté serveur pour le diagnostic ; l'utilisateur, lui, voit
    // simplement des créneaux de secours.
    console.error('Créneaux Google indisponibles :', erreur)

    return reponseRepli(maintenant, 'google_indisponible')
  }
}

/**
 * Créneaux de secours — mêmes heures ouvrables, sans soustraire d'occupation.
 *
 * Assumé : ils peuvent proposer une heure déjà prise. C'est le compromis choisi,
 * un double-booking se rattrape, une vente perdue non.
 */
function reponseRepli(maintenant: Date, raison: string) {
  const libres = creneauxLibres(maintenant, [], CONFIG_DISPONIBILITES)

  return NextResponse.json({
    source: 'repli',
    raison,
    creneaux: libres.map((debut) => debut.toISOString()),
  })
}
