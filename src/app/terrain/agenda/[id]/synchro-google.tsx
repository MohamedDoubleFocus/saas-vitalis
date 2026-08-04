'use client'

import { CalendarCheck, CalendarPlus, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Envoi manuel du rendez-vous vers la chaîne d'automatisation.
 *
 * Existe parce que la transmission automatique, déclenchée par la file d'attente
 * au moment du booking, est volontairement **non bloquante** : si le réseau ou
 * Make est injoignable, le rendez-vous est enregistré quand même et
 * `rdv_transmis_le` reste vide. Sans ce bouton, il n'y avait aucun moyen de
 * rattraper — ni de savoir que c'était arrivé.
 *
 * La route `/api/rdv/make` décide elle-même du chemin : Make s'il est
 * configuré, sinon l'ancienne chaîne Google + SMS. Ce composant ne présume donc
 * rien de l'un ou de l'autre et parle simplement de « transmission ».
 */
export function SynchroGoogle({
  opportuniteId,
  transmis,
}: {
  opportuniteId: string
  /** `false` tant que le rendez-vous n'a atteint aucun système externe. */
  transmis: boolean
}) {
  const router = useRouter()

  const [envoi, setEnvoi] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  // --- Déjà transmis --------------------------------------------------------
  if (transmis) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
        <CalendarCheck className="size-5 shrink-0" aria-hidden />
        Transmis à l’agenda et au client.
      </p>
    )
  }

  async function envoyer() {
    setEnvoi(true)
    setMessage(null)
    setErreur(null)

    try {
      const reponse = await fetch('/api/rdv/make', {
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

      // La route répond 200 même sur un échec distant : c'est le champ `statut`
      // qui porte le résultat réel, pas le code HTTP.
      switch (donnees.statut) {
        case 'transmis':
          setMessage('Envoyé.')
          router.refresh()
          break

        case 'deja_transmis':
          setMessage('Ce rendez-vous avait déjà été transmis.')
          router.refresh()
          break

        case 'ignore':
          setErreur(
            'Aucune automatisation n’est configurée sur le serveur. Un administrateur doit renseigner MAKE_WEBHOOK_RDV_URL.',
          )
          break

        case 'echec':
          setErreur(`Envoi refusé : ${donnees.message ?? 'raison inconnue'}`)
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
        Pas encore transmis
      </p>

      <p className="text-xs text-grey-text">
        Le rendez-vous est bien enregistré dans Vitalis. Seuls l’événement
        d’agenda et la confirmation au client manquent — l’envoi a pu échouer
        faute de réseau au moment du booking.
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
        {envoi ? 'Envoi…' : 'Transmettre maintenant'}
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
