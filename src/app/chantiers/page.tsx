import { IconeStatut } from '@/components/icones'

import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'
import { dateDeReference, STATUTS_EXECUTION, trierJobs } from '@/lib/chantiers'
import type { StatutOpp } from '@/lib/doublons'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Mes jobs — Vitalis',
}

const FORMAT_DATE = new Intl.DateTimeFormat('fr-CA', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
})

/**
 * Formate une `date` Postgres (AAAA-MM-JJ) sans passer par un fuseau.
 *
 * `new Date('2026-08-03')` est interprété en UTC : à l'heure du Québec, ça
 * afficherait le 2 août. On construit donc la date en local, à la main.
 */
function formaterDateJour(iso: string): string {
  const [annee, mois, jour] = iso.split('-').map(Number)

  return FORMAT_DATE.format(new Date(annee, mois - 1, jour))
}

/**
 * Les chantiers assignés au roofer.
 *
 * Zone gestion : rendu serveur, sans file d'attente ni cache local
 * (CLAUDE.md §3). Le roofer est souvent sur son téléphone au chantier, d'où la
 * largeur `gestion` qui reste propre en 440px avant de s'ouvrir sur portable.
 */
export default async function PageChantiers() {
  const session = await exigerSession()

  const supabase = await createClient()

  const { data } = await supabase
    .from('opportunites')
    .select(
      'id, adresse, ville, client_nom, statut, date_confirmee, date_cible_debut, date_cible_fin',
    )
    .eq('roofer_id', session.userId)
    .in('statut', STATUTS_EXECUTION)

  const jobs = trierJobs(
    (data ?? []).map((ligne) => ({
      ...ligne,
      dateConfirmee: ligne.date_confirmee,
      dateCibleDebut: ligne.date_cible_debut,
    })),
  )

  return (
    <CadrePage titre="Mes jobs" largeur="gestion">
      {jobs.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun chantier ne t’est assigné. Ils apparaîtront ici dès qu’un
          administrateur t’en attribuera un.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-grey-text">
            {jobs.length} {jobs.length === 1 ? 'chantier' : 'chantiers'}
          </p>

          {/* Mobile : une colonne. Desktop : deux, la largeur est là pour ça. */}
          <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <CarteJob
                  id={job.id}
                  adresse={job.adresse}
                  ville={job.ville}
                  clientNom={job.client_nom}
                  statut={job.statut}
                  dateConfirmee={job.date_confirmee}
                  dateCibleDebut={job.date_cible_debut}
                  dateCibleFin={job.date_cible_fin}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </CadrePage>
  )
}

function CarteJob({
  id,
  adresse,
  ville,
  clientNom,
  statut,
  dateConfirmee,
  dateCibleDebut,
  dateCibleFin,
}: {
  id: string
  adresse: string
  ville: string | null
  clientNom: string | null
  statut: StatutOpp
  dateConfirmee: string | null
  dateCibleDebut: string | null
  dateCibleFin: string | null
}) {
  const reference = dateDeReference({ dateConfirmee, dateCibleDebut })

  // Une date confirmée est ferme, une fenêtre cible ne l'est pas : le libellé
  // doit le dire, sinon le roofer se déplace un jour où le client n'attend rien.
  const quand = dateConfirmee
    ? `Confirmé · ${formaterDateJour(dateConfirmee)}`
    : dateCibleDebut
      ? `Cible · ${formaterDateJour(dateCibleDebut)}${
          dateCibleFin ? ` → ${formaterDateJour(dateCibleFin)}` : ''
        }`
      : 'Aucune date planifiée'

  return (
    <Link
      href={`/chantiers/${id}`}
      className="block h-full rounded-2xl bg-white p-4 shadow-card transition-colors hover:bg-grey-light"
    >
      {/* Ligne 1 : qui, et où en est le chantier. */}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-display text-base font-semibold text-navy">
          {clientNom || adresse}
        </p>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            statut === 'complete'
              ? 'bg-navy text-white'
              : statut === 'en_cours'
                ? 'bg-brand/15 text-brand-strong'
                : 'bg-grey-light text-grey-text'
          }`}
        >
          <IconeStatut statut={statut} className="size-4" />
          {LIBELLES_STATUT[statut]}
        </span>
      </div>

      {/* Ligne 2 : quand — et rien de plus (max 2 lignes, CLAUDE.md §6). */}
      <p
        className={`mt-0.5 truncate text-sm ${
          reference ? 'text-grey-text' : 'text-grey-text italic'
        }`}
      >
        {quand}
      </p>

      {clientNom && (
        <p className="mt-1 truncate text-xs text-grey-text">
          {[adresse, ville].filter(Boolean).join(', ')}
        </p>
      )}
    </Link>
  )
}
