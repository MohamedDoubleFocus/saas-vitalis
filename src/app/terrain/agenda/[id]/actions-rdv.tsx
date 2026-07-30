'use client'

import { useState } from 'react'

import { IndicateurFileAttente } from '@/components/indicateur-file-attente'
import type { StatutOpp } from '@/lib/doublons'
import type { ChargeMajStatutRdv } from '@/lib/file-attente/executeurs'
import { cleStatutRdv } from '@/lib/file-attente/file'
import { useFileAttente } from '@/lib/file-attente/fournisseur'

const CLASSE_SECONDAIRE =
  'min-h-11 w-full rounded-lg border border-grey-border bg-white px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-grey-light'

/**
 * Marquer un rendez-vous comme non conclu.
 *
 * Deux issues distinctes, et pas une seule « annuler » : une porte à repasser
 * reste dans le pipeline, une perdue en sort. La confusion des deux fausserait
 * le haut de funnel.
 */
export function ActionsRdv({ opportuniteId }: { opportuniteId: string }) {
  const { envoyer, contientCle } = useFileAttente()

  const [motif, setMotif] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [fait, setFait] = useState<StatutOpp | null>(null)

  const enAttente = contientCle(cleStatutRdv(opportuniteId))

  async function marquer(statut: StatutOpp) {
    setEnvoi(true)

    const charge: ChargeMajStatutRdv = {
      opportuniteId,
      statut,
      motif: motif.trim() || null,
    }

    try {
      await envoyer('maj_statut_rdv', charge)
      setFait(statut)
    } finally {
      setEnvoi(false)
    }
  }

  if (fait) {
    return (
      <div className="flex flex-col gap-3">
        <IndicateurFileAttente />
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          {fait === 'perdu'
            ? 'Rendez-vous marqué perdu.'
            : 'Rendez-vous renvoyé à « à repasser ».'}
          {enAttente && ' Il partira au retour du réseau.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <IndicateurFileAttente />

      {/* Confirmation en deux temps, sans modale (CLAUDE.md §6). */}
      <details className="rounded-2xl bg-white shadow-card">
        <summary className="flex h-11 cursor-pointer list-none items-center px-4 text-sm font-medium text-grey-text transition-colors hover:text-navy">
          Le rendez-vous n’a pas conclu
        </summary>

        <div className="flex flex-col gap-3 border-t border-grey-border p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="motif" className="text-sm font-medium text-navy">
              Motif (facultatif)
            </label>
            <textarea
              id="motif"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={2}
              placeholder="Budget, reporte à l’an prochain, conjoint absent…"
              className="w-full rounded-lg border border-grey-border bg-white px-3 py-2 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <p className="text-xs text-grey-text">
              Journalisé dans le fil de notes, jamais écrasé.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void marquer('repasser')}
            disabled={envoi}
            className={`${CLASSE_SECONDAIRE} disabled:opacity-50`}
          >
            À repasser — garder dans le pipeline
          </button>

          <button
            type="button"
            onClick={() => void marquer('perdu')}
            disabled={envoi}
            className="min-h-11 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 transition-colors hover:bg-red-100 disabled:opacity-50"
          >
            Perdu — sortir du pipeline
          </button>
        </div>
      </details>
    </div>
  )
}
