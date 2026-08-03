import { ArrowRight, ChevronRight, Undo2 } from 'lucide-react'
import Link from 'next/link'

import { IconeStatut } from '@/components/icones'
import {
  estRetourChantier,
  LIBELLES_FILTRE_CHANTIER,
  LIBELLES_TRANSITION,
  transitionsAdmin,
  type FiltreChantier,
} from '@/lib/chantiers'
import type { StatutOpp } from '@/lib/doublons'
import { estSourcePorte, LIBELLES_SOURCE, type SourceOpp } from '@/lib/sources'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { formaterMontant } from '@/lib/vente'

import { assignerRoofer } from '../assignation/actions'
import { avancerChantier } from './actions'

/**
 * Tableau de suivi des chantiers, une colonne par étape.
 *
 * ⚠️ PAS de glisser-déposer (CLAUDE.md §6). Ce n'est pas qu'une question de
 * goût : « À assigner → Planifié » EXIGE de choisir un roofer, ce qu'un dépôt ne
 * peut pas exprimer — il faudrait ouvrir un sélecteur au lâcher, soit le même
 * formulaire, en moins prévisible. Chaque carte porte donc son bouton.
 *
 * Réservé au desktop : §6 interdit le kanban sous 1024px, où l'écran retombe sur
 * la liste à onglets. Server Component — aucun JS client n'est nécessaire, les
 * actions sont des `<form>`.
 */

export type CarteChantier = {
  id: string
  adresse: string
  ville: string | null
  clientNom: string | null
  statut: StatutOpp
  source: SourceOpp
  montantContrat: number | null
  solde: number
  roofer: string | null
  date: string | null
}

/** Couleur de tête de colonne : elles se distinguent d'un coup d'œil. */
const TEINTES: Record<string, string> = {
  a_assigner: 'bg-red-50 text-red-800',
  planifies: 'bg-grey-light text-grey-text',
  en_cours: 'bg-brand/15 text-brand-strong',
  termines: 'bg-navy text-white',
}

export function Kanban({
  colonnes,
  chantiers,
  roofers,
  vue,
}: {
  colonnes: readonly FiltreChantier[]
  /** Chantiers déjà répartis par colonne, en amont. */
  chantiers: Record<string, CarteChantier[]>
  roofers: { id: string; nom: string }[]
  vue: string
}) {
  return (
    <div className="hidden gap-4 lg:grid lg:grid-cols-4">
      {colonnes.map((colonne) => {
        const cartes = chantiers[colonne] ?? []

        return (
          <section
            key={colonne}
            aria-label={LIBELLES_FILTRE_CHANTIER[colonne]}
            className="flex min-w-0 flex-col rounded-2xl border border-grey-border bg-grey-light/60"
          >
            <header className="flex items-center justify-between gap-2 border-b border-grey-border px-3 py-2">
              <h2 className="truncate font-display text-base font-semibold text-navy">
                {LIBELLES_FILTRE_CHANTIER[colonne]}
              </h2>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${TEINTES[colonne]}`}
              >
                {cartes.length}
              </span>
            </header>

            {/* Hauteur bornée : quatre colonnes de longueurs très inégales
                feraient scroller toute la page pour lire la plus longue. */}
            <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
              {cartes.length === 0 ? (
                <li className="px-2 py-6 text-center text-sm text-grey-text">
                  Aucun chantier
                </li>
              ) : (
                cartes.map((carte) => (
                  <Carte
                    key={carte.id}
                    carte={carte}
                    colonne={colonne}
                    roofers={roofers}
                    vue={vue}
                  />
                ))
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function Carte({
  carte,
  colonne,
  roofers,
  vue,
}: {
  carte: CarteChantier
  colonne: FiltreChantier
  roofers: { id: string; nom: string }[]
  vue: string
}) {
  const transitions = transitionsAdmin(carte.statut)

  return (
    <li className="rounded-xl border border-grey-border bg-white p-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-display text-base font-semibold text-navy">
          {carte.clientNom || carte.adresse}
        </p>
        <span className="shrink-0 text-sm font-bold text-navy">
          {carte.montantContrat === null
            ? '—'
            : formaterMontant(carte.montantContrat)}
        </span>
      </div>

      <p className="mt-0.5 truncate text-xs text-grey-text">
        {[carte.adresse, carte.ville].filter(Boolean).join(', ')}
      </p>

      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-grey-text">
        <span className="inline-flex items-center gap-1">
          <IconeStatut statut={carte.statut} className="size-4" />
          {LIBELLES_STATUT[carte.statut]}
        </span>
        <span>{carte.date ?? 'Non planifié'}</span>
        {carte.roofer && <span className="truncate">{carte.roofer}</span>}
        {!estSourcePorte(carte.source) && (
          <span className="rounded-full bg-grey-light px-1.5">
            {LIBELLES_SOURCE[carte.source]}
          </span>
        )}
      </p>

      {carte.solde > 0 && (
        <p className="mt-1 text-xs text-grey-text">
          Solde : <span className="font-semibold text-navy">{formaterMontant(carte.solde)}</span>
        </p>
      )}

      <div className="mt-2 flex flex-col gap-1.5 border-t border-grey-border pt-2">
        <Link
          href={`/chantiers/${carte.id}`}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-strong"
        >
          Ouvrir
          <ChevronRight className="size-5" aria-hidden />
        </Link>

        {/* « À assigner » n'avance pas par un bouton de statut : il lui faut un
            roofer. C'est le seul cas où la carte porte un formulaire. */}
        {colonne === 'a_assigner' ? (
          <form action={assignerRoofer} className="flex flex-col gap-1.5">
            <input type="hidden" name="opportunite_id" value={carte.id} />
            <input type="hidden" name="retour" value="chantiers" />
            <label className="sr-only" htmlFor={`roofer-${carte.id}`}>
              Roofer à assigner
            </label>
            <select
              id={`roofer-${carte.id}`}
              name="roofer_id"
              required
              defaultValue=""
              className="h-11 w-full rounded-lg border border-grey-border bg-white px-2 text-sm text-navy outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            >
              <option value="" disabled>
                Choisir un roofer…
              </option>
              {roofers.map((roofer) => (
                <option key={roofer.id} value={roofer.id}>
                  {roofer.nom}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={roofers.length === 0}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              Assigner
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </form>
        ) : (
          transitions.map((cible) => {
            const retourEnArriere = estRetourChantier(carte.statut, cible)

            return (
              <form key={cible} action={avancerChantier}>
                <input type="hidden" name="opportunite_id" value={carte.id} />
                <input type="hidden" name="statut" value={cible} />
                <input type="hidden" name="vue" value={vue} />
                <button
                  type="submit"
                  className={
                    retourEnArriere
                      ? 'flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-grey-border px-3 text-sm font-medium text-grey-text transition-colors hover:bg-grey-light'
                      : 'flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover'
                  }
                >
                  {retourEnArriere ? (
                    <>
                      <Undo2 className="size-4" aria-hidden />
                      {LIBELLES_STATUT[cible]}
                    </>
                  ) : (
                    <>
                      {LIBELLES_TRANSITION[cible] ?? LIBELLES_STATUT[cible]}
                      <ArrowRight className="size-4" aria-hidden />
                    </>
                  )}
                </button>
              </form>
            )
          })
        )}
      </div>
    </li>
  )
}
