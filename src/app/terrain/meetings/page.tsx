import { IconeStatut } from '@/components/icones'

import { Phone } from 'lucide-react'
import type { Metadata } from 'next'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'
import { estClose } from '@/lib/classement'
import {
  estPasse,
  formaterDateHeure,
  libelleEcheance,
  lireDate,
} from '@/lib/echeances'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'
import { formaterTelephone, lienTelephone } from '@/lib/telephone'

export const metadata: Metadata = {
  title: 'Mes meetings — Vitalis',
}

/**
 * Les rendez-vous décrochés par le knocker.
 *
 * Lecture en direct, sans cache (CLAUDE.md §5) : le résultat d'un meeting est mis
 * à jour par le closer, le knocker doit voir l'état courant.
 */
export default async function PageMeetings() {
  const session = await exigerSession()
  const maintenant = new Date()

  const supabase = await createClient()

  // Le tri se fait en base : le plus proche en haut, les passés en dessous par
  // ordre chronologique inverse une fois filtrés côté rendu.
  const { data } = await supabase
    .from('opportunites')
    .select('id, adresse, ville, client_nom, client_tel, statut, date_rdv')
    .eq('knocker_id', session.userId)
    .not('date_rdv', 'is', null)
    .order('date_rdv', { ascending: true })

  const meetings = (data ?? []).map((ligne) => ({
    ...ligne,
    dateRdv: lireDate(ligne.date_rdv),
  }))

  const aVenir = meetings.filter((m) => m.dateRdv && !estPasse(m.dateRdv, maintenant))
  const passes = meetings
    .filter((m) => m.dateRdv && estPasse(m.dateRdv, maintenant))
    .reverse()

  return (
    <CadrePage titre="Mes meetings" largeur="terrain">
      {meetings.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun rendez-vous pour l’instant. Ils apparaîtront ici dès qu’un lead
          passera au statut « Rendez-vous ».
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {aVenir.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-grey-text">
                À venir ({aVenir.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {aVenir.map((meeting) => (
                  <CarteMeeting
                    key={meeting.id}
                    adresse={meeting.adresse}
                    ville={meeting.ville}
                    clientNom={meeting.client_nom}
                    clientTel={meeting.client_tel}
                    statut={meeting.statut}
                    dateRdv={meeting.dateRdv!}
                    maintenant={maintenant}
                  />
                ))}
              </ul>
            </section>
          )}

          {passes.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-grey-text">
                Passés ({passes.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {passes.map((meeting) => (
                  <CarteMeeting
                    key={meeting.id}
                    adresse={meeting.adresse}
                    ville={meeting.ville}
                    clientNom={meeting.client_nom}
                    clientTel={meeting.client_tel}
                    statut={meeting.statut}
                    dateRdv={meeting.dateRdv!}
                    maintenant={maintenant}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </CadrePage>
  )
}

function CarteMeeting({
  adresse,
  ville,
  clientNom,
  clientTel,
  statut,
  dateRdv,
  maintenant,
}: {
  adresse: string
  ville: string | null
  clientNom: string | null
  clientTel: string | null
  statut: Parameters<typeof estClose>[0]
  dateRdv: Date
  maintenant: Date
}) {
  const tel = lienTelephone(clientTel)
  const passe = estPasse(dateRdv, maintenant)
  const close = estClose(statut)

  return (
    <li className="rounded-2xl bg-white p-4 shadow-card">
      {/* Ligne 1 : qui / où. */}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-display text-base font-semibold text-navy">
          {clientNom || adresse}
        </p>
        {/* `brand` est réservé aux actions et au statut « Confirmée » : un
            résultat de meeting se marque en gris ou en rouge, pas en brand. */}
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            close
              ? 'bg-navy text-white'
              : statut === 'perdu'
                ? 'bg-red-50 text-red-800'
                : 'bg-grey-light text-grey-text'
          }`}
        >
          <IconeStatut statut={statut} className="size-4" />
          {LIBELLES_STATUT[statut]}
        </span>
      </div>

      {/* Ligne 2 : quand. */}
      <p className="mt-0.5 truncate text-sm text-grey-text">
        {formaterDateHeure(dateRdv)}
        {' · '}
        <span className={passe ? '' : 'font-medium text-navy'}>
          {libelleEcheance(dateRdv, maintenant)}
        </span>
      </p>

      {clientNom && (
        <p className="mt-1 truncate text-xs text-grey-text">
          {[adresse, ville].filter(Boolean).join(', ')}
        </p>
      )}

      {/* Le numéro sert à quelque chose : un tap l'appelle. Cible 44px. */}
      {tel && (
        <a
          href={tel}
          className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-strong"
        >
          <Phone className="size-5" aria-hidden />
          {formaterTelephone(clientTel)}
        </a>
      )}

      {passe && !close && statut === 'rdv' && (
        <p className="mt-2 text-xs text-grey-text">
          Résultat en attente — le closer mettra le statut à jour.
        </p>
      )}
    </li>
  )
}
