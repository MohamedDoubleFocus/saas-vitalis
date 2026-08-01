import 'server-only'

import { jetonAcces } from './credentials'
import { lireOccupations, type Intervalle } from './disponibilites'

/**
 * Appels à l'API Google Calendar — **strictement serveur**.
 *
 * Chaque fonction récupère un jeton d'accès frais via `jetonAcces()`, qui gère
 * lui-même le rafraîchissement. Aucun secret ne remonte jamais à l'appelant.
 */

const BASE = 'https://www.googleapis.com/calendar/v3'

async function appeler<T>(
  chemin: string,
  options: { methode?: string; corps?: unknown } = {},
): Promise<T> {
  const jeton = await jetonAcces()

  const reponse = await fetch(`${BASE}${chemin}`, {
    method: options.methode ?? 'GET',
    headers: {
      Authorization: `Bearer ${jeton}`,
      ...(options.corps ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.corps ? JSON.stringify(options.corps) : undefined,
    cache: 'no-store',
  })

  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => '')

    throw new Error(
      `Google Calendar a répondu ${reponse.status}${detail ? ` : ${detail.slice(0, 200)}` : ''}`,
    )
  }

  return (await reponse.json()) as T
}

export type CalendrierGoogle = {
  id: string
  nom: string
  principal: boolean
}

/**
 * Calendriers du compte connecté.
 *
 * Sert à l'écran d'administration : l'admin choisit dans une liste au lieu de
 * coller un identifiant à la main. Nécessite la portée `calendar.readonly`.
 */
export async function listerCalendriers(): Promise<CalendrierGoogle[]> {
  const donnees = await appeler<{
    items?: {
      id?: string
      summary?: string
      summaryOverride?: string
      primary?: boolean
      accessRole?: string
    }[]
  }>('/users/me/calendarList?maxResults=250&showHidden=false')

  return (donnees.items ?? [])
    .filter((item) => Boolean(item.id))
    // Un calendrier en lecture seule ne peut pas recevoir de rendez-vous : le
    // proposer mènerait à un échec au moment du booking, devant le client.
    .filter((item) => item.accessRole === 'owner' || item.accessRole === 'writer')
    .map((item) => ({
      id: item.id as string,
      nom: item.summaryOverride ?? item.summary ?? (item.id as string),
      principal: item.primary === true,
    }))
    .sort((a, b) => Number(b.principal) - Number(a.principal) || a.nom.localeCompare(b.nom, 'fr-CA'))
}

/** Plages occupées d'un calendrier sur une fenêtre donnée. */
export async function occupations(
  calendarId: string,
  debutIso: string,
  finIso: string,
): Promise<Intervalle[]> {
  const donnees = await appeler<{
    calendars?: Record<string, { busy?: { start?: string; end?: string }[]; errors?: unknown[] }>
  }>('/freeBusy', {
    methode: 'POST',
    corps: {
      timeMin: debutIso,
      timeMax: finIso,
      items: [{ id: calendarId }],
    },
  })

  const entree = donnees.calendars?.[calendarId]

  if (entree?.errors?.length) {
    throw new Error(
      `Calendrier « ${calendarId} » inaccessible : ${JSON.stringify(entree.errors).slice(0, 200)}`,
    )
  }

  return lireOccupations(entree?.busy)
}

export type EvenementARDV = {
  titre: string
  debut: Date
  dureeMinutes: number
  adresse: string | null
  description: string | null
  /** Fuseau IANA transmis à Google (ex. « America/Toronto »). */
  fuseau: string
}

/**
 * Google rejette tout ce qui n'est pas un identifiant IANA — un nom Windows
 * comme « Eastern Standard Time » provoque un 400 « Invalid time zone
 * definition ». On vérifie donc avant d'envoyer plutôt que d'échouer chez eux.
 */
function fuseauValide(fuseau: string): boolean {
  if (!fuseau) return false

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuseau })
    return true
  } catch {
    return false
  }
}

/**
 * Crée le rendez-vous dans le calendrier du closer.
 *
 * Les heures sont envoyées en ISO **avec décalage** (`toISOString`, donc en UTC) :
 * Google les convertit vers `timeZone` pour l'affichage. Envoyer une heure
 * locale sans décalage ferait dépendre le résultat du fuseau du serveur.
 */
export async function creerEvenement(
  calendarId: string,
  evenement: EvenementARDV,
): Promise<string> {
  const fin = new Date(
    evenement.debut.getTime() + evenement.dureeMinutes * 60 * 1000,
  )

  // `toISOString()` porte déjà le décalage (`…Z`) : l'INSTANT est donc exact
  // même sans `timeZone`. Ce champ ne sert qu'à l'affichage côté Google, on ne
  // l'envoie donc que s'il est sûr — jamais au prix d'un rejet de l'événement.
  const fuseau = fuseauValide(evenement.fuseau) ? { timeZone: evenement.fuseau } : {}

  if (!fuseauValide(evenement.fuseau)) {
    console.warn(
      `[Google Calendar] Fuseau « ${evenement.fuseau} » invalide, ignoré. ` +
        `L'heure reste juste (le décalage est dans dateTime).`,
    )
  }

  const debutIso = evenement.debut.toISOString()

  let donnees: { id?: string }

  try {
    donnees = await appeler<{ id?: string }>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        methode: 'POST',
        corps: {
          summary: evenement.titre,
          location: evenement.adresse ?? undefined,
          description: evenement.description ?? undefined,
          start: { dateTime: debutIso, ...fuseau },
          end: { dateTime: fin.toISOString(), ...fuseau },
          source: { title: 'Vitalis', url: 'https://vitalis.app' },
        },
      },
    )
  } catch (erreur) {
    // Le message de Google seul ne dit pas CE QU'ON a envoyé. Sans ces valeurs,
    // un « Invalid time zone definition » oblige à deviner.
    throw new Error(
      `${erreur instanceof Error ? erreur.message : 'Erreur inconnue'} ` +
        `[envoyé : début=${debutIso}, fuseau=${JSON.stringify(evenement.fuseau)}]`,
    )
  }

  if (!donnees.id) {
    throw new Error('Google n’a pas renvoyé d’identifiant d’événement.')
  }

  return donnees.id
}

/** Supprime un événement. Silencieux si déjà absent. */
export async function supprimerEvenement(
  calendarId: string,
  evenementId: string,
): Promise<void> {
  const jeton = await jetonAcces()

  const reponse = await fetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(evenementId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jeton}` },
      cache: 'no-store',
    },
  )

  // 404/410 : l'événement a déjà disparu, l'objectif est atteint.
  if (!reponse.ok && reponse.status !== 404 && reponse.status !== 410) {
    throw new Error(`Suppression refusée par Google (${reponse.status}).`)
  }
}
