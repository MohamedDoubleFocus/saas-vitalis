import type { Metadata } from 'next'

import { CadrePage } from '@/components/cadre-page'
import { exigerAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { formaterMontant } from '@/lib/vente'

import { assignerRoofer } from './actions'

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

  const [{ data: aAssigner }, { data: roofers }] = await Promise.all([
    supabase
      .from('opportunites')
      .select(
        'id, adresse, ville, client_nom, montant_contrat, date_cible_debut, date_cible_fin, vendu_le',
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
  ])

  const listeRoofers = roofers ?? []

  return (
    <CadrePage titre="Assignation des chantiers" largeur="gestion">
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

      {(aAssigner ?? []).length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun chantier en attente d’assignation. Ils apparaissent ici dès qu’un
          closer conclut une vente.
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

              {(chantier.date_cible_debut || chantier.date_cible_fin) && (
                <p className="mt-1 text-xs text-grey-text">
                  Fenêtre cible : {chantier.date_cible_debut ?? '?'} →{' '}
                  {chantier.date_cible_fin ?? '?'}
                </p>
              )}

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
