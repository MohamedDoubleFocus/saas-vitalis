import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Jetons Google — **strictement serveur**.
 *
 * `import 'server-only'` fait échouer le build si ce module est atteint depuis
 * un Client Component. Le `client_secret` et le jeton de rafraîchissement ne
 * doivent jamais approcher le navigateur.
 *
 * Architecture : UN SEUL compte Google porte tous les calendriers des closers.
 * Il y a donc un unique jeton de rafraîchissement pour toute l'application,
 * rangé dans `public.google_credentials`, table qu'aucune session ne peut lire
 * (seul `service_role` y accède).
 *
 * Ce module ne présume RIEN du compte ni de son domaine : il autorise celui qui
 * se présente au consentement et enregistre son courriel. Le domaine autorisé se
 * décide dans Google Cloud Console — l'écran de consentement en « Interne » ne
 * laisse passer que l'organisation propriétaire du projet.
 */

const ID_LIGNE = 'compte_principal'

const POINT_JETON = 'https://oauth2.googleapis.com/token'
const POINT_CONSENTEMENT = 'https://accounts.google.com/o/oauth2/v2/auth'

/**
 * Portées demandées.
 *
 * - `calendar.events`   : lire et CRÉER les rendez-vous.
 * - `calendar.readonly` : interroger `freeBusy` et LISTER les calendriers du
 *   compte. `calendar.events` seul ne donne pas accès à `calendarList.list`,
 *   sans quoi l'admin devrait coller les identifiants de calendrier à la main.
 */
export const PORTEES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
] as const

export function configGoogleDisponible(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function identifiants(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET doivent être définis côté serveur.',
    )
  }

  return { clientId, clientSecret }
}

/** URI de redirection, dérivée de l'origine réelle de la requête. */
export function uriRedirection(origine: string): string {
  return `${origine}/api/auth/google/callback`
}

/**
 * URL du consentement Google.
 *
 * `access_type=offline` **et** `prompt=consent` : sans les deux, Google ne
 * renvoie un jeton de rafraîchissement qu'à la toute première autorisation. Une
 * reconnexion ultérieure repartirait sans jeton, et l'intégration cesserait de
 * fonctionner au bout d'une heure.
 */
export function urlConsentement(origine: string, etat: string): string {
  const { clientId } = identifiants()

  const parametres = new URLSearchParams({
    client_id: clientId,
    redirect_uri: uriRedirection(origine),
    response_type: 'code',
    scope: PORTEES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: etat,
  })

  return `${POINT_CONSENTEMENT}?${parametres.toString()}`
}

type ReponseJeton = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function appelerPointJeton(corps: URLSearchParams): Promise<ReponseJeton> {
  const reponse = await fetch(POINT_JETON, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corps,
    cache: 'no-store',
  })

  const donnees = (await reponse.json().catch(() => ({}))) as ReponseJeton

  if (!reponse.ok || donnees.error) {
    throw new Error(
      donnees.error_description ?? donnees.error ?? `Google a répondu ${reponse.status}.`,
    )
  }

  return donnees
}

/** Échange le code d'autorisation contre les jetons, puis les enregistre. */
export async function echangerCodeEtEnregistrer(
  code: string,
  origine: string,
): Promise<{ courriel: string | null }> {
  const { clientId, clientSecret } = identifiants()

  const jetons = await appelerPointJeton(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: uriRedirection(origine),
      grant_type: 'authorization_code',
    }),
  )

  if (!jetons.refresh_token) {
    throw new Error(
      'Google n’a pas renvoyé de jeton de rafraîchissement. Révoque l’accès de l’application dans le compte Google, puis reconnecte.',
    )
  }

  const courriel = jetons.access_token
    ? await courrielDuCompte(jetons.access_token)
    : null

  const admin = createAdminClient()

  const { error } = await admin.from('google_credentials').upsert(
    {
      id: ID_LIGNE,
      refresh_token: jetons.refresh_token,
      courriel,
      portee: jetons.scope ?? PORTEES.join(' '),
      connecte_le: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )

  if (error) throw new Error(error.message)

  // Le compte a changé : l'ancien jeton d'accès en mémoire ne vaut plus rien.
  cacheJeton = null

  return { courriel }
}

async function courrielDuCompte(jetonAcces: string): Promise<string | null> {
  try {
    const reponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${jetonAcces}` },
      cache: 'no-store',
    })

    if (!reponse.ok) return null

    const donnees = (await reponse.json()) as { email?: string }

    return donnees.email ?? null
  } catch {
    // Purement informatif : l'absence de courriel n'empêche pas l'intégration.
    return null
  }
}

export type EtatConnexionGoogle = {
  connecte: boolean
  courriel: string | null
  connecteLe: string | null
  portee: string | null
}

/**
 * État de la connexion, **sans jamais renvoyer le jeton**.
 *
 * C'est ce que l'écran d'administration affiche. Le type ne contient
 * volontairement aucun champ secret : impossible d'en fuiter un par mégarde.
 */
export async function etatConnexion(): Promise<EtatConnexionGoogle> {
  if (!configGoogleDisponible()) {
    return { connecte: false, courriel: null, connecteLe: null, portee: null }
  }

  const admin = createAdminClient()

  const { data } = await admin
    .from('google_credentials')
    .select('courriel, connecte_le, portee')
    .eq('id', ID_LIGNE)
    .maybeSingle()

  if (!data) {
    return { connecte: false, courriel: null, connecteLe: null, portee: null }
  }

  return {
    connecte: true,
    courriel: data.courriel,
    connecteLe: data.connecte_le,
    portee: data.portee,
  }
}

export async function deconnecter(): Promise<void> {
  const admin = createAdminClient()

  const { error } = await admin.from('google_credentials').delete().eq('id', ID_LIGNE)

  if (error) throw new Error(error.message)

  cacheJeton = null
}

/**
 * Jeton d'accès en cache mémoire.
 *
 * Il dure une heure ; le redemander à chaque requête ajouterait un aller-retour
 * inutile devant un client, à la porte. Le cache est par instance de serveur :
 * en environnement sans état, chaque instance froide en redemande un, ce qui est
 * sans conséquence.
 */
let cacheJeton: { valeur: string; expireLe: number } | null = null

/** Marge de sécurité : on renouvelle avant l'expiration réelle. */
const MARGE_MS = 60_000

export async function jetonAcces(): Promise<string> {
  if (cacheJeton && cacheJeton.expireLe - MARGE_MS > Date.now()) {
    return cacheJeton.valeur
  }

  const admin = createAdminClient()

  const { data } = await admin
    .from('google_credentials')
    .select('refresh_token')
    .eq('id', ID_LIGNE)
    .maybeSingle()

  if (!data?.refresh_token) {
    throw new Error('Aucun compte Google connecté.')
  }

  const { clientId, clientSecret } = identifiants()

  const jetons = await appelerPointJeton(
    new URLSearchParams({
      refresh_token: data.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  )

  if (!jetons.access_token) {
    throw new Error('Google n’a pas renvoyé de jeton d’accès.')
  }

  cacheJeton = {
    valeur: jetons.access_token,
    expireLe: Date.now() + (jetons.expires_in ?? 3600) * 1000,
  }

  return cacheJeton.valeur
}
