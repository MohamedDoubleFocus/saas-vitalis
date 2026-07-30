'use client'

import { useCallback, useEffect, useState } from 'react'

import { IndicateurFileAttente } from '@/components/indicateur-file-attente'
import { cleTerritoire } from '@/lib/file-attente/file'
import { useFileAttente } from '@/lib/file-attente/fournisseur'
import type { RuePourListe } from '@/lib/territoires'

/** Durée d'affichage du « Envoyé » avant de rendre la ligne silencieuse. */
const DUREE_CONFIRMATION_MS = 2500

export function ListeRues({ rues }: { rues: RuePourListe[] }) {
  const { envoyer, contientCle } = useFileAttente()

  // État optimiste : la case suit le doigt immédiatement, sans attendre le
  // réseau. La file se charge du reste.
  const [coches, setCoches] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rues.map((rue) => [rue.id, rue.complete])),
  )

  // Rues touchées durant cette session, pour n'afficher un état d'envoi que là
  // où l'utilisateur a effectivement agi.
  const [touchees, setTouchees] = useState<Record<string, true>>({})

  const basculer = useCallback(
    (rue: RuePourListe) => {
      const suivant = !coches[rue.id]

      setCoches((precedent) => ({ ...precedent, [rue.id]: suivant }))
      setTouchees((precedent) => ({ ...precedent, [rue.id]: true }))

      void envoyer('maj_territoire_complete', {
        territoire_id: rue.id,
        complete: suivant,
      })
    },
    [coches, envoyer],
  )

  // Une fois la mutation partie, on laisse « Envoyé » quelques secondes puis on
  // se taise : un badge permanent deviendrait du bruit.
  useEffect(() => {
    const parties = Object.keys(touchees).filter(
      (id) => !contientCle(cleTerritoire(id)),
    )

    if (parties.length === 0) return

    const minuteur = setTimeout(() => {
      setTouchees((precedent) => {
        const suivant = { ...precedent }
        for (const id of parties) delete suivant[id]
        return suivant
      })
    }, DUREE_CONFIRMATION_MS)

    return () => clearTimeout(minuteur)
  }, [touchees, contientCle])

  const nbCompletees = rues.filter((rue) => coches[rue.id]).length

  if (rues.length === 0) {
    return (
      <>
        <IndicateurFileAttente />
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucune rue ne t’est assignée pour l’instant. Un administrateur doit
          t’attribuer des territoires.
        </p>
      </>
    )
  }

  return (
    <>
      <IndicateurFileAttente />

      <p className="mb-3 text-sm text-grey-text">
        {nbCompletees} / {rues.length} complétées
      </p>

      <ul className="flex flex-col gap-2">
        {rues.map((rue) => {
          const coche = coches[rue.id] ?? false
          const enAttente = contientCle(cleTerritoire(rue.id))
          const touchee = touchees[rue.id] === true

          return (
            <li key={rue.id}>
              {/* Toute l'étiquette est cliquable : cible bien au-delà de 44px,
                  utilisable au pouce avec des gants. */}
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl bg-white p-3 shadow-card">
                <input
                  type="checkbox"
                  checked={coche}
                  onChange={() => basculer(rue)}
                  className="size-6 shrink-0 accent-brand"
                />

                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate font-medium ${
                      coche ? 'text-grey-text line-through' : 'text-navy'
                    }`}
                  >
                    {rue.nom_rue}
                  </span>

                  {/* Ligne 2 : ville, et l'état d'envoi seulement si utile. */}
                  <span className="block truncate text-sm text-grey-text">
                    {rue.ville ?? 'Ville non précisée'}
                    {touchee && enAttente && (
                      <span className="ml-2 text-grey-text">
                        · En attente d’envoi
                      </span>
                    )}
                    {touchee && !enAttente && (
                      <span className="ml-2 text-brand-strong">· Envoyé</span>
                    )}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </>
  )
}
