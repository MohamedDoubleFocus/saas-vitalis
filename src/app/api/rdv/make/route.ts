import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { CONFIG_DISPONIBILITES } from '@/lib/google/disponibilites'
import { chargeRdvMake } from '@/lib/make/rdv'
import { envoyerRdvAMake } from '@/lib/make/webhook'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Transmet un rendez-vous déjà enregistré au webhook Make/GHL.
 *
 * Appelée par la file de résilience APRÈS l'écriture de l'opportunité. Le
 * rendez-vous existe donc déjà : si Make échoue ici, **rien n'est perdu** —
 * `rdv_transmis_le` reste NULL et sert de marqueur pour un renvoi.
 *
 * Remplace `/api/rdv/evenement` (création Google) et `/api/rdv/sms-confirmation`
 * dans le chemin de booking : c'est désormais Make qui crée l'événement et
 * notifie le client, exactement comme pour les leads inbound.
 */
export const runtime = 'nodejs'
export const maxDuration = 30
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
    .select(
      'id, adresse, ville, code_postal, client_nom, client_tel, client_courriel, langue, date_rdv, closer_id, knocker_id, rdv_transmis_le',
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

  if (!opportunite.date_rdv) {
    return NextResponse.json({ erreur: 'Rendez-vous incomplet.' }, { status: 400 })
  }

  // Déjà transmis : ne pas créer une seconde tâche si la file rejoue l'appel.
  if (opportunite.rdv_transmis_le) {
    return NextResponse.json({ statut: 'deja_transmis' })
  }

  // Noms d'affichage via l'annuaire : il liste aussi les profils désactivés, un
  // knocker parti reste donc nommé sur ses anciens rendez-vous (§4.2).
  const ids = [opportunite.closer_id, opportunite.knocker_id].filter(
    (identifiant): identifiant is string => Boolean(identifiant),
  )

  const { data: annuaire } = ids.length
    ? await admin.from('annuaire_profils').select('id, nom_complet').in('id', ids)
    : { data: null }

  const nomParId = new Map(
    (annuaire ?? [])
      .filter((profil): profil is typeof profil & { id: string } => Boolean(profil.id))
      .map((profil) => [profil.id, profil.nom_complet]),
  )

  const { data: notes } = await admin
    .from('notes')
    .select('texte')
    .eq('opportunite_id', opportunite.id)
    .order('created_at', { ascending: true })
    .limit(5)

  const resultat = await envoyerRdvAMake(
    chargeRdvMake({
      opportuniteId: opportunite.id,
      clientNom: opportunite.client_nom,
      clientTel: opportunite.client_tel,
      clientCourriel: opportunite.client_courriel,
      adresse: opportunite.adresse,
      ville: opportunite.ville,
      codePostal: opportunite.code_postal,
      dateRdv: new Date(opportunite.date_rdv),
      dureeMinutes: CONFIG_DISPONIBILITES.dureeMinutes,
      langue: opportunite.langue,
      closerNom: opportunite.closer_id
        ? (nomParId.get(opportunite.closer_id) ?? null)
        : null,
      knockerNom: opportunite.knocker_id
        ? (nomParId.get(opportunite.knocker_id) ?? null)
        : null,
      notes: (notes ?? []).map((note) => note.texte).join('\n') || null,
    }),
  )

  if (resultat.statut === 'envoye') {
    await admin
      .from('opportunites')
      .update({ rdv_transmis_le: new Date().toISOString() })
      .eq('id', opportunite.id)

    return NextResponse.json({ statut: 'transmis' })
  }

  // Échec ou webhook non configuré : le rendez-vous reste valide en base et
  // `rdv_transmis_le` reste NULL. On répond 200 — la file ne doit pas réessayer
  // indéfiniment pour une panne côté Make.
  if (resultat.statut === 'echec') {
    console.error('Transmission Make impossible :', resultat.message)
  }

  return NextResponse.json({
    statut: resultat.statut,
    message: resultat.statut === 'echec' ? resultat.message : resultat.raison,
  })
}
