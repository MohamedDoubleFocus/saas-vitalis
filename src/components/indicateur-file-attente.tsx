'use client'

import { useFileAttente } from '@/lib/file-attente/fournisseur'

/**
 * État de la file d'écritures — discret par défaut (CLAUDE.md §5).
 *
 * Silencieux quand tout est parti et que le réseau est là : rien à dire, on
 * n'occupe pas l'écran. Parle uniquement quand il se passe quelque chose que le
 * knocker doit savoir.
 */
export function IndicateurFileAttente() {
  const { pret, enLigne, enAttente, echouees, reessayer } = useFileAttente()

  if (!pret) return null

  const nbAttente = enAttente.length
  const nbEchecs = echouees.length

  if (nbAttente === 0 && nbEchecs === 0 && enLigne) return null

  return (
    <div className="mb-3 flex flex-col gap-2">
      {nbEchecs > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p>
            {nbEchecs === 1
              ? '1 enregistrement n’a pas pu être envoyé.'
              : `${nbEchecs} enregistrements n’ont pas pu être envoyés.`}
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {echouees.map((mutation) => (
              <button
                key={mutation.id}
                type="button"
                onClick={() => void reessayer(mutation.id)}
                className="min-h-11 rounded-lg border border-red-300 bg-white px-3 text-sm font-semibold text-red-800 transition-colors hover:bg-red-100"
              >
                Réessayer
                {mutation.derniereErreur ? ` — ${mutation.derniereErreur}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {(nbAttente > 0 || !enLigne) && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-grey-border bg-white px-3 py-2 text-sm text-grey-text"
        >
          <span
            aria-hidden
            className={`inline-block size-2 shrink-0 rounded-full ${
              enLigne ? 'bg-brand' : 'bg-grey-text'
            }`}
          />
          {nbAttente > 0
            ? nbAttente === 1
              ? '1 modification en attente d’envoi.'
              : `${nbAttente} modifications en attente d’envoi.`
            : 'Hors ligne. Tes saisies seront envoyées au retour du réseau.'}
        </p>
      )}
    </div>
  )
}
