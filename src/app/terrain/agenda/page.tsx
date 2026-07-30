import { IconeStatut } from '@/components/icones'

import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'
import { estPasse, formaterDateHeure, libelleEcheance, lireDate } from '@/lib/echeances'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'
import type { StatutOpp } from '@/lib/doublons'

export const metadata: Metadata = {
  title: 'Mon agenda — Vitalis',
}

/**
 * Les rendez-vous assignés au closer.
 *
 * Lecture en direct (CLAUDE.md §5) : l'agenda change quand un knocker book un
 * nouveau rendez-vous, il ne doit jamais venir d'un cache.
 */
export default async function PageAgenda() {
  const session = await exigerSession()
  const maintenant = new Date()

  const supabase = await createClient()

  const { data } = await supabase
    .from('opportunites')
    .select('id, adresse, ville, client_nom, statut, date_rdv, montant_contrat')
    .eq('closer_id', session.userId)
    .not('date_rdv', 'is', null)
    .order('date_rdv', { ascending: true })

  const rdv = (data ?? [])
    .map((ligne) => ({ ...ligne, dateRdv: lireDate(ligne.date_rdv) }))
    .filter((ligne) => ligne.dateRdv !== null)

  const aVenir = rdv.filter((r) => !estPasse(r.dateRdv!, maintenant))

  /**
   * Un rendez-vous passé encore au statut `rdv` n'a pas été traité : ni conclu,
   * ni marqué perdu. C'est la pile de travail du closer, on la met en premier.
   */
  const aTraiter = rdv
    .filter((r) => estPasse(r.dateRdv!, maintenant) && r.statut === 'rdv')
    .reverse()

  const traites = rdv
    .filter((r) => estPasse(r.dateRdv!, maintenant) && r.statut !== 'rdv')
    .reverse()

  return (
    <CadrePage titre="Mon agenda" largeur="terrain">
      {rdv.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun rendez-vous ne t’est assigné. Ils apparaîtront ici dès qu’un
          knocker en bookera un à ton nom.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {aTraiter.length > 0 && (
            <Section titre={`À traiter (${aTraiter.length})`} accent>
              {aTraiter.map((r) => (
                <CarteRdv
                  key={r.id}
                  id={r.id}
                  adresse={r.adresse}
                  ville={r.ville}
                  clientNom={r.client_nom}
                  statut={r.statut}
                  dateRdv={r.dateRdv!}
                  montantContrat={r.montant_contrat}
                  maintenant={maintenant}
                  aTraiter
                />
              ))}
            </Section>
          )}

          {aVenir.length > 0 && (
            <Section titre={`À venir (${aVenir.length})`}>
              {aVenir.map((r) => (
                <CarteRdv
                  key={r.id}
                  id={r.id}
                  adresse={r.adresse}
                  ville={r.ville}
                  clientNom={r.client_nom}
                  statut={r.statut}
                  dateRdv={r.dateRdv!}
                  montantContrat={r.montant_contrat}
                  maintenant={maintenant}
                />
              ))}
            </Section>
          )}

          {traites.length > 0 && (
            <Section titre={`Traités (${traites.length})`}>
              {traites.map((r) => (
                <CarteRdv
                  key={r.id}
                  id={r.id}
                  adresse={r.adresse}
                  ville={r.ville}
                  clientNom={r.client_nom}
                  statut={r.statut}
                  dateRdv={r.dateRdv!}
                  montantContrat={r.montant_contrat}
                  maintenant={maintenant}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </CadrePage>
  )
}

function Section({
  titre,
  accent,
  children,
}: {
  titre: string
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <section>
      <h2
        className={`mb-2 text-sm font-semibold ${accent ? 'text-navy' : 'text-grey-text'}`}
      >
        {titre}
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  )
}

function CarteRdv({
  id,
  adresse,
  ville,
  clientNom,
  statut,
  dateRdv,
  montantContrat,
  maintenant,
  aTraiter,
}: {
  id: string
  adresse: string
  ville: string | null
  clientNom: string | null
  statut: StatutOpp
  dateRdv: Date
  montantContrat: number | null
  maintenant: Date
  aTraiter?: boolean
}) {
  const vendu = statut === 'vendu'

  return (
    <li>
      <Link
        href={`/terrain/agenda/${id}`}
        className={`block rounded-2xl bg-white p-4 shadow-card transition-colors hover:bg-grey-light ${
          // Un rendez-vous en retard de traitement se signale par un liseré, pas
          // par la couleur `brand` — réservée aux actions (CLAUDE.md §6).
          aTraiter ? 'border-l-4 border-navy' : ''
        }`}
      >
        {/* Ligne 1 : qui, et où en est-on. */}
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate font-display text-base font-semibold text-navy">
            {clientNom || adresse}
          </p>
          <span
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              vendu
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
          <span className={aTraiter ? 'font-medium text-navy' : ''}>
            {libelleEcheance(dateRdv, maintenant)}
          </span>
        </p>

        {clientNom && (
          <p className="mt-1 truncate text-xs text-grey-text">
            {[adresse, ville].filter(Boolean).join(', ')}
          </p>
        )}

        {vendu && montantContrat !== null && (
          <p className="mt-1 text-xs text-grey-text">
            Contrat signé — voir le détail
          </p>
        )}
      </Link>
    </li>
  )
}
