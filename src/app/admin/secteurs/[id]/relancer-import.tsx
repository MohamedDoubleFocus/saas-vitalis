'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Relance la récupération des rues depuis OpenStreetMap.
 *
 * Client Component parce que l'appel peut durer une minute : il faut un état
 * « en cours » visible, qu'un formulaire natif ne donnerait pas.
 */
export function RelancerImport({ secteurId }: { secteurId: string }) {
  const router = useRouter()

  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  async function relancer() {
    setEnCours(true)
    setMessage(null)
    setErreur(null)

    try {
      const reponse = await fetch(`/api/secteurs/${secteurId}/rues`, {
        method: 'POST',
      })

      const donnees = (await reponse.json()) as {
        ajoutees?: number
        message?: string
        avertissement?: string
        erreur?: string
      }

      if (!reponse.ok) {
        setErreur(donnees.erreur ?? 'Import impossible.')
        return
      }

      setMessage(
        donnees.avertissement ??
          donnees.message ??
          `${donnees.ajoutees ?? 0} nouvelle(s) rue(s) importée(s).`,
      )

      if (donnees.ajoutees) router.refresh()
    } catch {
      setErreur('Réseau indisponible.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void relancer()}
        disabled={enCours}
        className="min-h-11 rounded-lg border border-grey-border px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-grey-light disabled:opacity-50"
      >
        {enCours ? 'Interrogation d’OpenStreetMap…' : 'Réimporter les rues'}
      </button>

      <p className="text-xs text-grey-text">
        Ajoute les rues manquantes sans toucher à celles déjà cochées.
      </p>

      {message && <p className="text-sm text-grey-text">{message}</p>}
      {erreur && (
        <p role="alert" className="text-sm text-red-800">
          {erreur}
        </p>
      )}
    </div>
  )
}
