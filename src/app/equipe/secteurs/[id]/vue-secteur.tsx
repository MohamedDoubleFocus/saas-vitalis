'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { progressionSecteur, type Point } from '@/lib/secteurs'
import { createClient } from '@/lib/supabase/client'

import { CarteSecteur, type RueTracee } from './carte-secteur'

/**
 * Carte + checklist des rues, avec bascule optimiste.
 *
 * Client Component pour deux raisons : la carte est un SDK navigateur, et le
 * cochage doit être instantané au pouce sur un chantier — un aller-retour
 * serveur par case rendrait la liste poussive.
 */
export function VueSecteur({
  polygone,
  ruesInitiales,
}: {
  polygone: Point[]
  ruesInitiales: RueTracee[]
}) {
  const router = useRouter()

  const [rues, setRues] = useState<RueTracee[]>(ruesInitiales)
  const [erreur, setErreur] = useState<string | null>(null)

  const progression = progressionSecteur(rues)

  async function basculer(rue: RueTracee) {
    const suivant = !rue.complete

    // Optimiste : l'interface bouge tout de suite.
    setRues((precedent) =>
      precedent.map((r) => (r.id === rue.id ? { ...r, complete: suivant } : r)),
    )
    setErreur(null)

    const supabase = createClient()

    const { error } = await supabase
      .from('territoires')
      .update({ complete: suivant })
      .eq('id', rue.id)

    if (error) {
      // Retour arrière : l'affichage ne doit jamais mentir sur l'état réel.
      setRues((precedent) =>
        precedent.map((r) => (r.id === rue.id ? { ...r, complete: !suivant } : r)),
      )
      setErreur(`« ${rue.nom} » n’a pas pu être mise à jour : ${error.message}`)
      return
    }

    // Rafraîchit les données serveur (progression affichée ailleurs) sans
    // remonter la page.
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <CarteSecteur polygone={polygone} rues={rues} />

      {erreur && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {erreur}
        </p>
      )}

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-navy">
            Rues ({progression.total})
          </h2>
          <span className="text-sm text-grey-text">
            {progression.faites} / {progression.total} faites ·{' '}
            {progression.pourcentage} %
          </span>
        </div>

        {/* Barre de progression : `brand` est ici un indicateur d'avancement,
            pas un statut passif. */}
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-grey-light">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${progression.pourcentage}%` }}
          />
        </div>

        {rues.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
            Aucune rue importée pour ce secteur.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
            {rues.map((rue) => (
              <li key={rue.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl bg-white p-3 shadow-card">
                  <input
                    type="checkbox"
                    checked={rue.complete}
                    onChange={() => void basculer(rue)}
                    className="size-6 shrink-0 accent-brand"
                  />
                  <span
                    className={`min-w-0 flex-1 truncate font-medium ${
                      rue.complete ? 'text-grey-text line-through' : 'text-navy'
                    }`}
                  >
                    {rue.nom}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
