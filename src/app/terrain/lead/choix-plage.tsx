'use client'

import { useEffect, useState } from 'react'

import {
  grouperParJournee,
  libelleCreneau,
  obtenirCreneaux,
  type Creneau,
  type JourneeCreneaux,
} from '@/lib/creneaux'

type Props = {
  closerId: string | null
  /** Adresse rappelée en tête, pour que le knocker sache ce qu'il confirme. */
  resumeAdresse: string
  onConfirmer: (creneau: Creneau) => void
  onRetour: () => void
  enregistrement: boolean
}

/**
 * Choix du créneau de rendez-vous, devant le client, à la porte.
 *
 * Les créneaux viennent de `obtenirCreneaux()` — aujourd'hui générés, demain
 * lus dans le Google Agenda du closer. Cet écran ne changera pas.
 */
export function ChoixPlage({
  closerId,
  resumeAdresse,
  onConfirmer,
  onRetour,
  enregistrement,
}: Props) {
  const [journees, setJournees] = useState<JourneeCreneaux[] | null>(null)
  const [choisi, setChoisi] = useState<Creneau | null>(null)

  useEffect(() => {
    let annule = false

    void (async () => {
      const maintenant = new Date()
      const creneaux = await obtenirCreneaux(closerId, maintenant)

      if (!annule) setJournees(grouperParJournee(creneaux, maintenant))
    })()

    return () => {
      annule = true
    }
  }, [closerId])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-navy">
          Choisir une plage
        </h2>
        <p className="mt-0.5 text-sm text-grey-text">{resumeAdresse}</p>
      </div>

      {!closerId && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          Aucun closer ne t’est rattaché. Le rendez-vous sera enregistré sans
          closer — demande à un administrateur de te rattacher.
        </p>
      )}

      {/* Skeleton, pas de spinner (CLAUDE.md §6). */}
      {journees === null ? (
        <div className="flex flex-col gap-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl bg-white p-4 shadow-card">
              <div className="h-4 w-32 rounded bg-grey-light" />
              <div className="mt-3 flex gap-2">
                <div className="h-11 flex-1 rounded-lg bg-grey-light" />
                <div className="h-11 flex-1 rounded-lg bg-grey-light" />
                <div className="h-11 flex-1 rounded-lg bg-grey-light" />
              </div>
            </div>
          ))}
        </div>
      ) : journees.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun créneau disponible dans les prochains jours.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {journees.map((journee) => (
            <li
              key={journee.jour}
              className="rounded-2xl bg-white p-4 shadow-card"
            >
              <p className="font-display text-base font-semibold text-navy">
                {journee.libelleEcheance}
              </p>
              <p className="text-xs text-grey-text">{journee.libelleJour}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                {journee.creneaux.map((creneau) => {
                  const actif = choisi?.id === creneau.id

                  return (
                    <button
                      key={creneau.id}
                      type="button"
                      onClick={() => setChoisi(creneau)}
                      aria-pressed={actif}
                      className={`min-h-11 min-w-24 flex-1 rounded-lg border px-3 text-base font-semibold transition-colors ${
                        actif
                          ? 'border-brand bg-brand text-white'
                          : 'border-grey-border bg-white text-navy hover:bg-grey-light'
                      }`}
                    >
                      {libelleCreneau(creneau)}
                    </button>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Barre d'action collée au-dessus de la navigation basse : le bouton de
          confirmation reste sous le pouce sans avoir à remonter la liste. */}
      <div className="sticky bottom-24 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => choisi && onConfirmer(choisi)}
          disabled={!choisi || enregistrement}
          className="h-12 rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong disabled:opacity-50"
        >
          {enregistrement
            ? 'Enregistrement…'
            : choisi
              ? `Confirmer ${libelleCreneau(choisi)}`
              : 'Choisis une plage'}
        </button>

        <button
          type="button"
          onClick={onRetour}
          disabled={enregistrement}
          className="min-h-11 text-sm text-grey-text underline disabled:opacity-50"
        >
          Revenir au lead
        </button>
      </div>
    </div>
  )
}
