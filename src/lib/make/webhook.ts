import 'server-only'

import type { ChargeRdvMake } from './rdv'

/**
 * Envoi vers le webhook Make — **strictement serveur**.
 *
 * `import 'server-only'` fait échouer le build si ce module est atteint depuis
 * un Client Component. L'URL du webhook est un secret d'écriture : qui la
 * possède peut créer des tâches et des contacts dans GHL. Elle ne doit jamais
 * être préfixée `NEXT_PUBLIC_`.
 *
 * ⚠️ CE MODULE NE LÈVE JAMAIS. Le rendez-vous est déjà en base quand on arrive
 * ici. Faire échouer l'appelant ferait rejouer toute la création du lead, alors
 * qu'elle a réussi — et un knocker devant un client verrait une erreur pour une
 * panne qui ne le concerne pas.
 */

const DELAI_MAX_MS = 15_000

export type ResultatMake =
  | { statut: 'envoye' }
  /** Webhook non configuré : cas normal en local, pas une panne. */
  | { statut: 'ignore'; raison: string }
  | { statut: 'echec'; message: string }

export function makeConfigure(): boolean {
  return Boolean(process.env.MAKE_WEBHOOK_RDV_URL)
}

export async function envoyerRdvAMake(
  charge: ChargeRdvMake,
): Promise<ResultatMake> {
  const url = process.env.MAKE_WEBHOOK_RDV_URL

  if (!url) {
    return { statut: 'ignore', raison: 'MAKE_WEBHOOK_RDV_URL absente' }
  }

  try {
    const reponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(charge),
      signal: AbortSignal.timeout(DELAI_MAX_MS),
      cache: 'no-store',
    })

    if (!reponse.ok) {
      // Make répond « Accepted » en texte brut ; en cas d'erreur le corps
      // contient le motif. On le garde court : il finit dans un log, pas devant
      // un utilisateur.
      const detail = await reponse.text().catch(() => '')

      return {
        statut: 'echec',
        message: `Make a répondu ${reponse.status}${detail ? ` : ${detail.slice(0, 200)}` : ''}`,
      }
    }

    return { statut: 'envoye' }
  } catch (erreur) {
    return {
      statut: 'echec',
      message: erreur instanceof Error ? erreur.message : 'Erreur inconnue',
    }
  }
}
