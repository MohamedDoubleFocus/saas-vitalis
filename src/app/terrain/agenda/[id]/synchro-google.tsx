'use client'

import { CalendarCheck, CalendarPlus, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Envoi manuel du rendez-vous vers le Google Agenda du closer.
 *
 * Existe parce que la synchronisation automatique, déclenchée par la file
 * d'attente au moment du booking, est volontairement **non bloquante** : si
 * Google est injoignable ou si l'appel n'aboutit pas, le rendez-vous est
 * enregistré quand même et `google_event_id` reste vide. Sans ce bouton, il n'y
 * avait aucun moyen de rattraper — ni de savoir que c'était arrivé.
 */
export function SynchroGoogle({
  opportuniteId,
  evenementId,
}: {
  opportuniteId: string
  /** `null` tant que le rendez-vous n'est pas dans Google. */
  evenementId: string | null
}) {
  const router = useRouter()

  const [envoi, setEnvoi] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  // --- Déjà dans Google ----------------------------------------------------
  if (evenementId) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
        <CalendarCheck className="size-5 shrink-0" aria-hidden />
        Dans l’agenda Google du closer.
      </p>
    )
  }

  async function envoyer() {
    setEnvoi(true)
    setMessage(null)
    setErreur(null)

    try {
      const reponse = await fetch('/api/rdv/evenement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportuniteId }),
      })

      const donnees = (await reponse.json()) as {
        statut?: string
        message?: string
        erreur?: string
      }

      if (!reponse.ok) {
        setErreur(donnees.erreur ?? `Le serveur a répondu ${reponse.status}.`)
        return
      }

      // La route répond 200 même sur un échec Google : c'est le champ `statut`
      // qui porte le résultat réel, pas le code HTTP.
      switch (donnees.statut) {
        case 'cree':
          setMessage('Envoyé dans l’agenda Google.')
          router.refresh()
          break

        case 'deja_synchronise':
          setMessage('Ce rendez-vous y était déjà.')
          router.refresh()
          break

        case 'calendrier_non_associe':
          setErreur(
            'Aucun calendrier Google n’est associé à ce closer. Un administrateur doit le faire dans Réglages → Google Calendar.',
          )
          break

        case 'echec_google':
          setErreur(`Google a refusé : ${donnees.message ?? 'raison inconnue'}`)
          break

        default:
          setErreur('Réponse inattendue du serveur.')
      }
    } catch {
      setErreur('Réseau indisponible. Réessaie quand tu auras du signal.')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-card">
      <p className="flex items-center gap-2 text-sm font-semibold text-navy">
        <CalendarPlus className="size-5 shrink-0" aria-hidden />
        Pas encore dans l’agenda Google
      </p>

      <p className="text-xs text-grey-text">
        Le rendez-vous est bien enregistré dans Vitalis. Seul l’événement Google
        manque — l’envoi a pu échouer faute de réseau au moment du booking.
      </p>

      <button
        type="button"
        onClick={() => void envoyer()}
        disabled={envoi}
        className="mt-1 flex h-12 items-center justify-center gap-2 rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong disabled:opacity-50"
      >
        <RefreshCw
          className={`size-5 shrink-0 ${envoi ? 'animate-spin' : ''}`}
          aria-hidden
        />
        {envoi ? 'Envoi…' : 'Envoyer vers Google'}
      </button>

      {message && (
        <p role="status" className="text-sm font-semibold text-brand-strong">
          {message}
        </p>
      )}

      {erreur && (
        <p role="alert" className="text-sm font-semibold text-red-800">
          {erreur}
        </p>
      )}
    </div>
  )
}
