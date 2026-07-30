import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'
import {
  agregerClassement,
  LIBELLES_CRITERES,
  LIBELLES_PERIODES,
  PERIODES,
  bornesPeriode,
  type Critere,
  type LigneClassement,
  type Periode,
} from '@/lib/classement'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Classement — Vitalis',
}

type Props = {
  searchParams: Promise<{ periode?: string; vue?: string }>
}

function lirePeriode(valeur: string | undefined): Periode {
  return PERIODES.includes(valeur as Periode) ? (valeur as Periode) : 'semaine'
}

function lireCritere(valeur: string | undefined): Critere {
  return valeur === 'closes' ? 'closes' : 'rdv'
}

/**
 * Classement des knockers (gamification, CLAUDE.md §1).
 *
 * Onglets en liens `?periode=` / `?vue=` : zéro JS client (§6), et l'état est
 * partageable et rechargeable. Lecture en direct.
 */
export default async function PageClassement({ searchParams }: Props) {
  const { periode: periodeBrute, vue } = await searchParams
  const session = await exigerSession()

  const periode = lirePeriode(periodeBrute)
  const critere = lireCritere(vue)
  const maintenant = new Date()

  const supabase = await createClient()

  // Annuaire : `profiles` reste fermé aux knockers, la vue expose seulement
  // id / nom / rôle (migration `annuaire_profils`).
  const { data: annuaire } = await supabase
    .from('annuaire_profils')
    .select('id, nom_complet, role')
    .eq('role', 'knocker')

  const nomsParId = new Map<string, string | null>(
    (annuaire ?? [])
      .filter((profil): profil is typeof profil & { id: string } => Boolean(profil.id))
      .map((profil) => [profil.id, profil.nom_complet]),
  )

  // On ne rapatrie que la fenêtre utile : la période bornée, pas toute la table.
  const { debut, fin } = bornesPeriode(periode, maintenant)

  const { data: opportunites } = await supabase
    .from('opportunites')
    .select('knocker_id, date_rdv, statut')
    .not('date_rdv', 'is', null)
    .gte('date_rdv', debut.toISOString())
    .lt('date_rdv', fin.toISOString())

  const lignes: LigneClassement[] = (opportunites ?? []).map((ligne) => ({
    knockerId: ligne.knocker_id,
    dateRdv: ligne.date_rdv,
    statut: ligne.statut,
  }))

  const classement = agregerClassement(
    lignes,
    nomsParId,
    periode,
    maintenant,
    critere,
  )

  return (
    <CadrePage titre="Classement" largeur="terrain">
      {/* Rail d'onglets : la seule exception au scroll horizontal (§6). */}
      <nav aria-label="Période" className="-mx-4 mb-3 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {PERIODES.map((valeur) => {
            const actif = valeur === periode

            return (
              <li key={valeur}>
                <Link
                  href={`/terrain/classement?periode=${valeur}&vue=${critere}`}
                  aria-current={actif ? 'page' : undefined}
                  className={`flex h-11 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
                    actif
                      ? 'border-navy bg-navy text-white'
                      : 'border-grey-border bg-white text-grey-text'
                  }`}
                >
                  {LIBELLES_PERIODES[valeur]}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <nav aria-label="Métrique" className="mb-4 flex gap-2">
        {(['rdv', 'closes'] as const).map((valeur) => {
          const actif = valeur === critere

          return (
            <Link
              key={valeur}
              href={`/terrain/classement?periode=${periode}&vue=${valeur}`}
              aria-current={actif ? 'page' : undefined}
              className={`flex h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${
                actif
                  ? 'border-grey-border bg-grey-light text-navy'
                  : 'border-transparent bg-transparent text-grey-text'
              }`}
            >
              {LIBELLES_CRITERES[valeur]}
            </Link>
          )
        })}
      </nav>

      {classement.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun knocker à classer pour l’instant.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {classement.map((rangee) => {
            const moi = rangee.knockerId === session.userId
            const principal = critere === 'rdv' ? rangee.rdv : rangee.closes
            const secondaire = critere === 'rdv' ? rangee.closes : rangee.rdv

            return (
              <li
                key={rangee.knockerId}
                className={`flex items-center gap-3 rounded-2xl p-3 shadow-card ${
                  moi ? 'bg-navy text-white' : 'bg-white'
                }`}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    moi ? 'bg-white/15 text-white' : 'bg-grey-light text-grey-text'
                  }`}
                >
                  {rangee.rang}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate font-medium ${moi ? 'text-white' : 'text-navy'}`}
                  >
                    {rangee.nom}
                    {moi && (
                      <span className="ml-2 text-xs font-normal opacity-80">
                        (toi)
                      </span>
                    )}
                  </span>
                  <span
                    className={`block text-xs ${moi ? 'text-white/70' : 'text-grey-text'}`}
                  >
                    {critere === 'rdv'
                      ? `${secondaire} ${secondaire === 1 ? 'vente' : 'ventes'}`
                      : `${secondaire} ${secondaire === 1 ? 'rendez-vous' : 'rendez-vous'}`}
                  </span>
                </span>

                <span
                  className={`shrink-0 font-display text-2xl font-bold ${
                    moi ? 'text-white' : 'text-navy'
                  }`}
                >
                  {principal}
                </span>
              </li>
            )
          })}
        </ol>
      )}

      <p className="mt-4 text-xs text-grey-text">
        Les rendez-vous sont comptés selon la date du rendez-vous, dans la période
        choisie.
      </p>
    </CadrePage>
  )
}
