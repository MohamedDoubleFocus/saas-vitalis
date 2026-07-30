import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CadrePage } from '@/components/cadre-page'
import { exigerAdmin } from '@/lib/auth'
import { formaterDateHeure, lireDate } from '@/lib/echeances'
import { polygoneValide, trierRuesSecteur, type Point } from '@/lib/secteurs'
import { createClient } from '@/lib/supabase/server'

import { assignerSecteur, supprimerSecteur } from './actions'
import type { RueTracee } from './carte-secteur'
import { RelancerImport } from './relancer-import'
import { VueSecteur } from './vue-secteur'

export const metadata: Metadata = {
  title: 'Secteur — Vitalis',
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string; avertissement?: string }>
}

const MESSAGES_ERREUR: Record<string, string> = {
  champs_manquants: 'Secteur manquant.',
  knocker_invalide: 'Ce profil n’est pas un knocker actif.',
  maj_impossible: 'La mise à jour a échoué.',
  suppression: 'La suppression a échoué.',
}

const MESSAGES_SUCCES: Record<string, string> = {
  cree: 'Secteur créé et rues importées.',
  assigne: 'Secteur attribué.',
  libere: 'Secteur libéré.',
}

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

/** Géométrie stockée en JSONB : on la relit défensivement. */
function lireGeometrie(valeur: unknown): Point[][] {
  if (!Array.isArray(valeur)) return []

  return valeur.filter(
    (segment): segment is Point[] =>
      Array.isArray(segment) &&
      segment.every(
        (point) =>
          typeof point === 'object' &&
          point !== null &&
          Number.isFinite((point as Point).lat) &&
          Number.isFinite((point as Point).lng),
      ),
  )
}

export default async function PageSecteur({ params, searchParams }: Props) {
  const { id } = await params
  const { error, ok, avertissement } = await searchParams
  await exigerAdmin()

  const supabase = await createClient()

  const { data: secteur } = await supabase
    .from('secteurs')
    .select('id, nom, notes, polygone, knocker_id, created_at')
    .eq('id', id)
    .maybeSingle()

  if (!secteur) notFound()

  const [{ data: ruesBrutes }, { data: knockers }] = await Promise.all([
    supabase
      .from('territoires')
      .select('id, nom_rue, complete, geometrie')
      .eq('secteur_id', id),
    supabase
      .from('profiles')
      .select('id, nom_complet')
      .eq('role', 'knocker')
      .eq('actif', true)
      .order('nom_complet', { ascending: true }),
  ])

  const rues: RueTracee[] = trierRuesSecteur(
    (ruesBrutes ?? []).map((rue) => ({
      id: rue.id,
      nom: rue.nom_rue,
      complete: rue.complete,
      geometrie: lireGeometrie(rue.geometrie),
    })),
  )

  const polygone = polygoneValide(secteur.polygone) ? secteur.polygone : []
  const cree = lireDate(secteur.created_at)

  return (
    <CadrePage titre={secteur.nom} largeur="gestion">
      <div className="flex flex-col gap-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {MESSAGES_ERREUR[error] ?? 'Une erreur est survenue.'}
          </p>
        )}

        {ok && MESSAGES_SUCCES[ok] && (
          <p
            role="status"
            className="rounded-lg border border-grey-border bg-white px-3 py-2 text-sm text-grey-text"
          >
            {MESSAGES_SUCCES[ok]}
          </p>
        )}

        {avertissement && (
          <p
            role="status"
            className="rounded-lg border border-grey-border bg-grey-light px-3 py-2 text-sm text-grey-text"
          >
            {avertissement}
          </p>
        )}

        <Link href="/admin/secteurs" className="text-sm text-grey-text underline">
          ← Tous les secteurs
        </Link>

        {/* --- Attribution ------------------------------------------------ */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-navy">
            Knocker attribué
          </h2>

          {secteur.notes && (
            <p className="mt-1 text-sm text-grey-text">{secteur.notes}</p>
          )}

          <form action={assignerSecteur} className="mt-3 flex flex-col gap-2 lg:flex-row">
            <input type="hidden" name="secteur_id" value={secteur.id} />

            <label className="sr-only" htmlFor="knocker">
              Knocker
            </label>
            <select
              id="knocker"
              name="knocker_id"
              defaultValue={secteur.knocker_id ?? ''}
              className={`${CLASSE_CHAMP} lg:flex-1`}
            >
              <option value="">— Aucun —</option>
              {(knockers ?? []).map((knocker) => (
                <option key={knocker.id} value={knocker.id}>
                  {knocker.nom_complet || 'Sans nom'}
                </option>
              ))}
            </select>

            <button
              type="submit"
              className="h-11 rounded-lg bg-brand px-6 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong"
            >
              Enregistrer
            </button>
          </form>

          {cree && (
            <p className="mt-2 text-xs text-grey-text">
              Créé le {formaterDateHeure(cree)}
            </p>
          )}
        </section>

        {/* --- Carte et checklist ----------------------------------------- */}
        {polygone.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-red-800 shadow-card">
            Le polygone de ce secteur est illisible. Recrée-le.
          </p>
        ) : (
          <VueSecteur polygone={polygone} ruesInitiales={rues} />
        )}

        {/* --- Maintenance ------------------------------------------------- */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-navy">
            Maintenance
          </h2>

          <div className="mt-3 flex flex-col gap-3">
            <RelancerImport secteurId={secteur.id} />

            <details>
              <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm text-grey-text transition-colors hover:text-navy">
                Supprimer ce secteur
              </summary>
              <form action={supprimerSecteur} className="mt-1">
                <input type="hidden" name="secteur_id" value={secteur.id} />
                <p className="text-sm text-grey-text">
                  Les {rues.length} rues de ce secteur seront supprimées avec lui.
                  Les leads déjà créés ne sont pas touchés.
                </p>
                <button
                  type="submit"
                  className="mt-2 min-h-11 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 transition-colors hover:bg-red-100"
                >
                  Confirmer la suppression
                </button>
              </form>
            </details>
          </div>
        </section>
      </div>
    </CadrePage>
  )
}
