import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { creerEvenement } from '@/lib/google/calendar'
import { FUSEAU_QUEBEC } from '@/lib/fuseau'
import { CONFIG_DISPONIBILITES } from '@/lib/google/disponibilites'
import { createAdminClient } from '@/lib/supabase/admin'
import { formaterTelephone } from '@/lib/telephone'

/**
 * Crée l'événement Google d'un rendez-vous déjà enregistré en base.
 *
 * Appelée par la file de résilience APRÈS l'écriture de l'opportunité. Le
 * rendez-vous existe donc déjà : si Google échoue ici, **rien n'est perdu** —
 * l'événement pourra être resynchronisé plus tard, `google_event_id` restant à
 * NULL sert de marqueur.
 *
 * Le fuseau envoyé à Google est celui de l'entreprise (`FUSEAU_QUEBEC`), pas
 * celui du serveur : l'heure affichée au closer est donc juste partout.
 */
export const dynamic = 'force-dynamic'

/**
 * Fuseau de l'entreprise — une décision métier, PAS un réglage serveur.
 *
 * On lisait `process.env.TZ` : si le serveur exposait un nom Windows
 * (« Eastern Standard Time »), Google rejetait l'événement avec « Invalid time
 * zone definition ». L'heure d'un rendez-vous de Toitures Vitalis est celle du
 * Québec, quel que soit l'endroit où tourne le code.
 */
const FUSEAU = FUSEAU_QUEBEC

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
    .select(
      'id, adresse, ville, code_postal, client_nom, client_tel, date_rdv, closer_id, knocker_id, google_event_id',
    )
    .eq('id', opportuniteId)
    .maybeSingle()

  if (!opportunite) {
    return NextResponse.json({ erreur: 'Opportunité introuvable.' }, { status: 404 })
  }

  // Le demandeur doit être impliqué : le knocker qui a booké, le closer
  // concerné, ou un admin. `service_role` contourne la RLS, donc c'est ici que
  // le contrôle se fait.
  const autorise =
    session.role === 'admin' ||
    opportunite.knocker_id === session.userId ||
    opportunite.closer_id === session.userId

  if (!autorise) {
    return NextResponse.json({ erreur: 'Non autorisé.' }, { status: 403 })
  }

  if (!opportunite.date_rdv || !opportunite.closer_id) {
    return NextResponse.json({ erreur: 'Rendez-vous incomplet.' }, { status: 400 })
  }

  // Déjà synchronisé : ne pas créer un doublon si la file rejoue l'appel.
  if (opportunite.google_event_id) {
    return NextResponse.json({ statut: 'deja_synchronise' })
  }

  const { data: closer } = await admin
    .from('profiles')
    .select('google_calendar_id')
    .eq('id', opportunite.closer_id)
    .maybeSingle()

  if (!closer?.google_calendar_id) {
    return NextResponse.json({ statut: 'calendrier_non_associe' })
  }

  const adresse = [opportunite.adresse, opportunite.ville, opportunite.code_postal]
    .filter(Boolean)
    .join(', ')

  const { data: notes } = await admin
    .from('notes')
    .select('texte')
    .eq('opportunite_id', opportunite.id)
    .order('created_at', { ascending: true })
    .limit(5)

  const description = [
    opportunite.client_tel
      ? `Téléphone : ${formaterTelephone(opportunite.client_tel)}`
      : null,
    adresse
      ? `Itinéraire : https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(adresse)}`
      : null,
    (notes ?? []).length > 0 ? '\nNotes du knocker :' : null,
    ...(notes ?? []).map((note) => `• ${note.texte}`),
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const evenementId = await creerEvenement(closer.google_calendar_id, {
      titre: `RDV — ${opportunite.client_nom || adresse || 'Client'}`,
      debut: new Date(opportunite.date_rdv),
      dureeMinutes: CONFIG_DISPONIBILITES.dureeMinutes,
      adresse: adresse || null,
      description: description || null,
      fuseau: FUSEAU,
    })

    await admin
      .from('opportunites')
      .update({ google_event_id: evenementId })
      .eq('id', opportunite.id)

    return NextResponse.json({ statut: 'cree', evenementId })
  } catch (erreur) {
    // Le rendez-vous reste valide en base. On journalise et on répond 200 : la
    // file ne doit pas réessayer indéfiniment pour un échec côté Google.
    console.error('Création de l’événement Google impossible :', erreur)

    return NextResponse.json({
      statut: 'echec_google',
      message: erreur instanceof Error ? erreur.message : 'Erreur inconnue',
    })
  }
}
