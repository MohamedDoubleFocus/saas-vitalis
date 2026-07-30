import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerAdmin } from '@/lib/auth'
import { progressionSecteur } from '@/lib/secteurs'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Secteurs — Vitalis',
}

type Props = {
  searchParams: Promise<{ error?: string; ok?: string }>
}

const MESSAGES_SUCCES: Record<string, string> = {
  supprime: 'Secteur supprimé.',
}

export default async function PageSecteurs({ searchParams }: Props) {
  const { error, ok } = await searchParams
  await exigerAdmin()

  const supabase = await createClient()

  // Une seule requête par table, jointes en mémoire : le volume est de l'ordre
  // de la dizaine de secteurs et de quelques centaines de rues.
  const [{ data: secteurs }, { data: rues }, { data: knockers }] = await Promise.all([
    supabase
      .from('secteurs')
      .select('id, nom, notes, knocker_id, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('territoires').select('secteur_id, complete').not('secteur_id', 'is', null),
    supabase.from('profiles').select('id, nom_complet').eq('role', 'knocker'),
  ])

  const nomParKnocker = new Map(
    (knockers ?? []).map((k) => [k.id, k.nom_complet || 'Sans nom']),
  )

  const ruesParSecteur = new Map<string, { complete: boolean }[]>()

  for (const rue of rues ?? []) {
    if (!rue.secteur_id) continue

    const liste = ruesParSecteur.get(rue.secteur_id) ?? []
    liste.push({ complete: rue.complete })
    ruesParSecteur.set(rue.secteur_id, liste)
  }

  return (
    <CadrePage titre="Secteurs" largeur="gestion">
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          Une erreur est survenue.
        </p>
      )}

      {ok && MESSAGES_SUCCES[ok] && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-grey-border bg-white px-3 py-2 text-sm text-grey-text"
        >
          {MESSAGES_SUCCES[ok]}
        </p>
      )}

      <Link
        href="/admin/secteurs/nouveau"
        className="mb-4 flex h-12 items-center justify-center rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong"
      >
        + Nouveau secteur
      </Link>

      {(secteurs ?? []).length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun secteur. Trace-en un sur la carte : les rues seront récupérées
          automatiquement depuis OpenStreetMap.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
          {(secteurs ?? []).map((secteur) => {
            const progression = progressionSecteur(
              ruesParSecteur.get(secteur.id) ?? [],
            )

            const knocker = secteur.knocker_id
              ? nomParKnocker.get(secteur.knocker_id)
              : null

            return (
              <li key={secteur.id}>
                <Link
                  href={`/admin/secteurs/${secteur.id}`}
                  className="block h-full rounded-2xl bg-white p-4 shadow-card transition-colors hover:bg-grey-light"
                >
                  {/* Ligne 1 : le secteur et son knocker. */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-display text-base font-semibold text-navy">
                      {secteur.nom}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        knocker
                          ? 'bg-grey-light text-grey-text'
                          : 'bg-red-50 text-red-800'
                      }`}
                    >
                      {knocker ?? 'Non attribué'}
                    </span>
                  </div>

                  {/* Ligne 2 : l'avancement. */}
                  <p className="mt-0.5 text-sm text-grey-text">
                    {progression.total === 0
                      ? 'Aucune rue importée'
                      : `${progression.faites} / ${progression.total} rues faites · ${progression.pourcentage} %`}
                  </p>

                  {progression.total > 0 && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-grey-light">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${progression.pourcentage}%` }}
                      />
                    </div>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </CadrePage>
  )
}
