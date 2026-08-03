import { ChevronRight, PlusCircle } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerAdmin } from '@/lib/auth'
import { estSourcePorte, LIBELLES_SOURCE } from '@/lib/sources'
import { createClient } from '@/lib/supabase/server'
import { formaterMontant } from '@/lib/vente'

import { assignerRoofer } from './actions'
import { FormulaireVenteDirecte } from './formulaire-vente-directe'

export const metadata: Metadata = {
  title: 'Assignation des chantiers — Vitalis',
}

type Props = {
  searchParams: Promise<{ error?: string; ok?: string }>
}

const MESSAGES_ERREUR: Record<string, string> = {
  champs_manquants: 'Choisis un roofer avant d’assigner.',
  roofer_invalide: 'Ce profil n’est pas un roofer actif.',
  maj_impossible: 'L’assignation a échoué. Réessaie.',
}

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

/**
 * Mini-assignation : brancher un chantier vendu sur un roofer.
 *
 * Volontairement minimal — l'écran d'administration complet (territoires,
 * rapports, paiements) viendra plus tard. Le but ici est de pouvoir alimenter le
 * roofer sans passer par du SQL.
 */
export default async function PageAssignation({ searchParams }: Props) {
  const { error, ok } = await searchParams
  await exigerAdmin()

  const supabase = await createClient()

  const [{ data: aAssigner }, { data: roofers }, { data: closers }] =
    await Promise.all([
      supabase
        .from('opportunites')
        .select(
          'id, adresse, ville, client_nom, montant_contrat, date_cible_debut, date_cible_fin, vendu_le, source',
        )
        .eq('statut', 'vendu')
        .is('roofer_id', null)
        .order('vendu_le', { ascending: true }),
      supabase
        .from('profiles')
        .select('id, nom_complet')
        .eq('role', 'roofer')
        .eq('actif', true)
        .order('nom_complet', { ascending: true }),
      supabase
        .from('profiles')
        .select('id, nom_complet')
        .eq('role', 'closer')
        .eq('actif', true)
        .order('nom_complet', { ascending: true }),
    ])

  const listeRoofers = roofers ?? []
  const listeClosers = (closers ?? []).map((closer) => ({
    id: closer.id,
    nom: closer.nom_complet || 'Sans nom',
  }))

  return (
    <CadrePage titre="Assignation des chantiers" largeur="gestion">
      {/* Cet écran ne montre QUE la file d'attente. Une fois assigné, un
          chantier en sort — d'où ce lien vers la vue complète. */}
      <Link
        href="/admin/chantiers"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-strong"
      >
        Voir tous les chantiers
        <ChevronRight className="size-5" aria-hidden />
      </Link>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {MESSAGES_ERREUR[error] ?? 'Une erreur est survenue.'}
        </p>
      )}

      {ok === 'assigne' && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-grey-border bg-white px-3 py-2 text-sm text-grey-text"
        >
          Chantier assigné et planifié.
        </p>
      )}

      {listeRoofers.length === 0 && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          Aucun roofer actif. Crée-en un dans « Utilisateurs » avant d’assigner.
        </p>
      )}

      {/* --- Vente hors porte-à-porte --------------------------------------
          Repliée par défaut : c'est le cas minoritaire, la liste d'assignation
          reste ce qu'on vient voir en premier. Dépliant `<details>` plutôt que
          modale (CLAUDE.md §6). */}
      <details className="mb-5 rounded-2xl bg-white shadow-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 font-display text-base font-semibold text-navy">
          <PlusCircle className="size-6 text-grey-text" aria-hidden />
          Enregistrer une vente hors porte-à-porte
        </summary>

        <div className="border-t border-grey-border p-4">
          <p className="mb-4 text-sm text-grey-text">
            Référence d’un client, appel entrant, salon : une vente qui n’est
            jamais passée par une porte cognée. Elle rejoint la liste
            d’assignation ci-dessous une fois enregistrée.
          </p>

          <FormulaireVenteDirecte closers={listeClosers} />
        </div>
      </details>

      {(aAssigner ?? []).length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun chantier en attente d’assignation. Ils apparaissent ici dès qu’un
          closer conclut une vente, ou dès que tu en enregistres une ci-dessus.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
          {(aAssigner ?? []).map((chantier) => (
            <li key={chantier.id} className="rounded-2xl bg-white p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-display text-base font-semibold text-navy">
                  {chantier.client_nom || chantier.adresse}
                </p>
                {chantier.montant_contrat !== null && (
                  <span className="shrink-0 text-sm font-medium text-navy">
                    {formaterMontant(chantier.montant_contrat)}
                  </span>
                )}
              </div>

              <p className="mt-0.5 truncate text-sm text-grey-text">
                {[chantier.adresse, chantier.ville].filter(Boolean).join(', ')}
              </p>

              {/* Le porte-à-porte est le cas normal : on ne le signale pas. On
                  signale ce qui sort de l'ordinaire, sinon le badge devient du
                  bruit sur toutes les cartes. */}
              {!estSourcePorte(chantier.source) && (
                <span className="mt-1 inline-block rounded-full bg-grey-light px-2 py-0.5 text-xs font-medium text-grey-text">
                  {LIBELLES_SOURCE[chantier.source]}
                </span>
              )}

              {(chantier.date_cible_debut || chantier.date_cible_fin) && (
                <p className="mt-1 text-xs text-grey-text">
                  Fenêtre cible : {chantier.date_cible_debut ?? '?'} →{' '}
                  {chantier.date_cible_fin ?? '?'}
                </p>
              )}

              {/* La carte ne montre que ce qu'il faut pour décider d'un roofer.
                  Le détail complet — volets, extras, argent, fil de notes — est
                  sur la fiche du chantier. */}
              <Link
                href={`/chantiers/${chantier.id}`}
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-strong"
              >
                Voir le détail
                <ChevronRight className="size-5" aria-hidden />
              </Link>

              <form
                action={assignerRoofer}
                className="mt-3 flex flex-col gap-3 border-t border-grey-border pt-3"
              >
                <input type="hidden" name="opportunite_id" value={chantier.id} />

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor={`roofer-${chantier.id}`}
                    className="text-sm font-medium text-navy"
                  >
                    Roofer
                  </label>
                  <select
                    id={`roofer-${chantier.id}`}
                    name="roofer_id"
                    required
                    defaultValue=""
                    className={CLASSE_CHAMP}
                  >
                    <option value="" disabled>
                      Choisir…
                    </option>
                    {listeRoofers.map((roofer) => (
                      <option key={roofer.id} value={roofer.id}>
                        {roofer.nom_complet || 'Sans nom'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor={`date-${chantier.id}`}
                    className="text-sm font-medium text-navy"
                  >
                    Date confirmée (facultatif)
                  </label>
                  <input
                    id={`date-${chantier.id}`}
                    name="date_confirmee"
                    type="date"
                    defaultValue={chantier.date_cible_debut ?? ''}
                    className={CLASSE_CHAMP}
                  />
                  <p className="text-xs text-grey-text">
                    Laisse vide pour garder la fenêtre cible du closer.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={listeRoofers.length === 0}
                  className="h-11 rounded-lg bg-brand px-4 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong disabled:opacity-50"
                >
                  Assigner et planifier
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </CadrePage>
  )
}
