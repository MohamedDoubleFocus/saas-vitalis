import 'server-only'

/**
 * Client d'envoi OpenPhone (aussi appelé Quo) — **strictement serveur**.
 *
 * `import 'server-only'` fait échouer le build si ce module est atteint depuis
 * un Client Component : la clé d'API ne doit jamais approcher le navigateur.
 *
 * Principe de conception : **aucune fonction d'ici ne lève**. Un SMS qui ne part
 * pas ne doit jamais faire échouer un booking ni une vente — c'est un service
 * d'accompagnement, pas le cœur du métier. Les échecs remontent en valeur de
 * retour, pas en exception.
 */

const POINT_ENVOI = 'https://api.openphone.com/v1/messages'

/** Au-delà, on considère l'API injoignable plutôt que d'attendre indéfiniment. */
const DELAI_MAX_MS = 15_000

export type ResultatEnvoi =
  | { statut: 'envoye'; id: string | null }
  /** Rien n'a été tenté : configuration incomplète. Ce n'est pas une panne. */
  | { statut: 'ignore'; raison: string }
  | { statut: 'echec'; message: string }

export function openphoneConfigure(): boolean {
  return Boolean(process.env.OPENPHONE_API_KEY)
}

/**
 * Envoie un SMS.
 *
 * @param expediteur Numéro OpenPhone du closer, en E.164.
 * @param destinataire Numéro du client, en E.164.
 */
export async function envoyerSms(
  expediteur: string,
  destinataire: string,
  texte: string,
): Promise<ResultatEnvoi> {
  const cle = process.env.OPENPHONE_API_KEY

  if (!cle) {
    return { statut: 'ignore', raison: 'OPENPHONE_API_KEY absente côté serveur.' }
  }

  try {
    const reponse = await fetch(POINT_ENVOI, {
      method: 'POST',
      headers: {
        // OpenPhone attend la clé NUE, sans préfixe « Bearer ».
        Authorization: cle,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: expediteur,
        to: [destinataire],
        content: texte,
      }),
      signal: AbortSignal.timeout(DELAI_MAX_MS),
      cache: 'no-store',
    })

    const donnees = (await reponse.json().catch(() => null)) as {
      data?: { id?: string }
      message?: string
      errors?: unknown
    } | null

    if (!reponse.ok) {
      // Cas le plus fréquent en pratique : plus de crédits prépayés sur le
      // compte OpenPhone. Le message de l'API est repris tel quel pour que
      // l'admin sache quoi faire.
      return {
        statut: 'echec',
        message:
          donnees?.message ??
          (donnees?.errors ? JSON.stringify(donnees.errors).slice(0, 200) : '') ??
          `OpenPhone a répondu ${reponse.status}.`,
      }
    }

    return { statut: 'envoye', id: donnees?.data?.id ?? null }
  } catch (erreur) {
    return {
      statut: 'echec',
      message:
        erreur instanceof Error ? erreur.message : 'Erreur réseau vers OpenPhone.',
    }
  }
}

/**
 * Journalise le résultat d'un envoi, de façon uniforme.
 *
 * Les échecs restent visibles dans les logs Vercel — c'est aujourd'hui le seul
 * endroit où ils apparaissent, faute de table d'audit des SMS.
 */
export function journaliserEnvoi(
  contexte: string,
  resultat: ResultatEnvoi,
): void {
  if (resultat.statut === 'envoye') {
    console.info(`[SMS] ${contexte} — envoyé (${resultat.id ?? 'sans id'})`)
    return
  }

  if (resultat.statut === 'ignore') {
    console.info(`[SMS] ${contexte} — ignoré : ${resultat.raison}`)
    return
  }

  console.error(`[SMS] ${contexte} — ÉCHEC : ${resultat.message}`)
}
