import { NextResponse, type NextRequest } from 'next/server'

import { bornesJourneeLocale, FUSEAU_QUEBEC, jourDansFuseau } from '@/lib/fuseau'
import { messageRappel, peutEnvoyer } from '@/lib/sms/messages'
import { envoyerSms, journaliserEnvoi } from '@/lib/sms/openphone'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Rappel SMS de la veille — déclenché par un Vercel Cron à 9 h, heure du Québec.
 *
 * Envoie un message à chaque client dont le rendez-vous est **demain**, puis
 * marque `rappel_sms_envoye_le` pour ne jamais dédoubler : le cron peut être
 * rejoué, relancé à la main, ou se déclencher deux fois — chaque rendez-vous ne
 * reçoit qu'un rappel.
 *
 * ⚠️ « Demain » est calculé en heure du QUÉBEC, pas en UTC. Vercel exécute en
 * UTC : à 9 h heure locale un soir d'été, on est déjà le lendemain à 13 h UTC.
 * Un calcul naïf viserait le mauvais jour. Voir `src/lib/fuseau.ts`.
 */
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // --- Authentification du cron -------------------------------------------
  // Vercel envoie `Authorization: Bearer <CRON_SECRET>`. Sans ce contrôle,
  // n'importe qui pourrait déclencher une salve de SMS facturés.
  const secret = process.env.CRON_SECRET

  if (!secret) {
    console.error('[cron] CRON_SECRET absent : route désactivée.')
    return NextResponse.json({ erreur: 'Cron non configuré.' }, { status: 503 })
  }

  const entete = request.headers.get('authorization')

  if (entete !== `Bearer ${secret}`) {
    return NextResponse.json({ erreur: 'Non autorisé.' }, { status: 401 })
  }

  const maintenant = new Date()
  const { debut, fin } = bornesJourneeLocale(maintenant, FUSEAU_QUEBEC, 1)

  const admin = createAdminClient()

  const { data: rdv, error } = await admin
    .from('opportunites')
    .select('id, client_nom, client_tel, date_rdv, closer_id')
    .eq('statut', 'rdv')
    .is('rappel_sms_envoye_le', null)
    .gte('date_rdv', debut.toISOString())
    .lt('date_rdv', fin.toISOString())

  if (error) {
    console.error('[cron] Lecture des rendez-vous impossible :', error.message)
    return NextResponse.json({ erreur: error.message }, { status: 500 })
  }

  const cible = jourDansFuseau(debut, FUSEAU_QUEBEC)

  if ((rdv ?? []).length === 0) {
    console.info(`[cron] Aucun rappel à envoyer pour le ${cible}.`)
    return NextResponse.json({ jour: cible, candidats: 0, envoyes: 0, ignores: 0, echecs: 0 })
  }

  // Les closers sont lus en une fois : un secteur peut avoir des dizaines de
  // rendez-vous pour le même closer.
  const closerIds = [...new Set((rdv ?? []).map((r) => r.closer_id).filter(Boolean))]

  const { data: closers } = await admin
    .from('profiles')
    .select('id, nom_complet, openphone_number')
    .in('id', closerIds as string[])

  const closerParId = new Map((closers ?? []).map((c) => [c.id, c]))

  let envoyes = 0
  let ignores = 0
  let echecs = 0

  for (const opportunite of rdv ?? []) {
    const closer = opportunite.closer_id
      ? closerParId.get(opportunite.closer_id)
      : undefined

    if (!peutEnvoyer(closer?.openphone_number, opportunite.client_tel)) {
      ignores += 1
      journaliserEnvoi(`rappel ${opportunite.id}`, {
        statut: 'ignore',
        raison: !closer?.openphone_number
          ? 'closer_sans_numero_openphone'
          : 'client_sans_telephone',
      })
      continue
    }

    const resultat = await envoyerSms(
      closer!.openphone_number!,
      opportunite.client_tel!,
      messageRappel({ closerNom: closer?.nom_complet ?? null }),
    )

    journaliserEnvoi(`rappel ${opportunite.id}`, resultat)

    if (resultat.statut !== 'envoye') {
      echecs += 1
      // On NE marque PAS : le rappel reste candidat pour une relance manuelle.
      // Mieux vaut un rappel en retard qu'un rappel jamais envoyé.
      continue
    }

    envoyes += 1

    const { error: erreurMarquage } = await admin
      .from('opportunites')
      .update({ rappel_sms_envoye_le: new Date().toISOString() })
      .eq('id', opportunite.id)

    if (erreurMarquage) {
      // Le SMS est parti mais le marqueur n'est pas posé : un rejeu enverrait un
      // doublon. Sérieux, donc journalisé comme tel.
      console.error(
        `[cron] SMS envoyé pour ${opportunite.id} mais marquage échoué : ${erreurMarquage.message}`,
      )
    }
  }

  console.info(
    `[cron] Rappels du ${cible} — ${envoyes} envoyé(s), ${ignores} ignoré(s), ${echecs} échec(s).`,
  )

  return NextResponse.json({
    jour: cible,
    candidats: (rdv ?? []).length,
    envoyes,
    ignores,
    echecs,
  })
}
