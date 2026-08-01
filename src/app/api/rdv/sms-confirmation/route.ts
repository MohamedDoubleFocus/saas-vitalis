import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { messageConfirmation, peutEnvoyer } from '@/lib/sms/messages'
import { envoyerSms, journaliserEnvoi } from '@/lib/sms/openphone'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * SMS de confirmation, envoyé juste après la prise de rendez-vous.
 *
 * Appelée par la file de résilience une fois l'opportunité écrite. Le rendez-vous
 * existe donc déjà : **quoi qu'il arrive ici, il n'est jamais perdu**. La route
 * répond 200 même quand le SMS ne part pas, pour que le client n'ait aucune
 * raison de réessayer en boucle.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await sessionCourante()

  if (!session) {
    return NextResponse.json({ erreur: 'Session requise.' }, { status: 401 })
  }

  let opportuniteId: string | null = null

  try {
    const corps = (await request.json()) as { opportuniteId?: unknown }
    opportuniteId = typeof corps.opportuniteId === 'string' ? corps.opportuniteId : null
  } catch {
    opportuniteId = null
  }

  if (!opportuniteId) {
    return NextResponse.json({ erreur: 'Opportunité manquante.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: opportunite } = await admin
    .from('opportunites')
    .select('id, client_nom, client_tel, date_rdv, closer_id, knocker_id')
    .eq('id', opportuniteId)
    .maybeSingle()

  if (!opportunite) {
    return NextResponse.json({ erreur: 'Opportunité introuvable.' }, { status: 404 })
  }

  // `service_role` contourne la RLS : le contrôle d'accès se fait donc ici.
  const autorise =
    session.role === 'admin' ||
    opportunite.knocker_id === session.userId ||
    opportunite.closer_id === session.userId

  if (!autorise) {
    return NextResponse.json({ erreur: 'Non autorisé.' }, { status: 403 })
  }

  if (!opportunite.date_rdv) {
    return NextResponse.json({ statut: 'ignore', raison: 'pas_de_rdv' })
  }

  const { data: closer } = opportunite.closer_id
    ? await admin
        .from('profiles')
        .select('nom_complet, openphone_number')
        .eq('id', opportunite.closer_id)
        .maybeSingle()
    : { data: null }

  // Configuration incomplète : ce n'est pas une panne, simplement un envoi qui
  // n'a pas lieu. Le rendez-vous reste valide.
  if (!peutEnvoyer(closer?.openphone_number, opportunite.client_tel)) {
    const raison = !closer?.openphone_number
      ? 'closer_sans_numero_openphone'
      : 'client_sans_telephone'

    journaliserEnvoi(`confirmation ${opportunite.id}`, {
      statut: 'ignore',
      raison,
    })

    return NextResponse.json({ statut: 'ignore', raison })
  }

  const resultat = await envoyerSms(
    closer!.openphone_number!,
    opportunite.client_tel!,
    messageConfirmation({
      clientNom: opportunite.client_nom,
      closerNom: closer?.nom_complet ?? null,
      dateRdv: new Date(opportunite.date_rdv),
    }),
  )

  journaliserEnvoi(`confirmation ${opportunite.id}`, resultat)

  // 200 même sur échec : le champ `statut` porte le résultat réel.
  return NextResponse.json(resultat)
}
