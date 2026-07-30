/*
 * Service worker Vitalis — coquille d'application uniquement.
 *
 * Objectif (CLAUDE.md §5) : que l'app reste OUVRABLE sans réseau, pas qu'elle
 * fonctionne hors ligne. On ne met en cache que ce qui ne contient aucune donnée
 * métier :
 *   • les assets immuables de Next (`/_next/static/**`, empreintés par contenu) ;
 *   • les icônes ;
 *   • une page de secours `/hors-ligne`.
 *
 * Ce qui n'est JAMAIS mis en cache :
 *   • le HTML des pages (elles contiennent les leads, les rues, les montants) ;
 *   • les charges RSC (`?_rsc=`) ;
 *   • quoi que ce soit venant de Supabase ou d'une autre origine ;
 *   • toute requête non-GET — les écritures passent par la file d'attente
 *     applicative (`src/lib/file-attente`), pas par le service worker.
 *
 * Conséquence assumée : recharger la page hors réseau affiche `/hors-ligne`, pas
 * l'écran en cours. Servir un écran métier depuis le cache reviendrait à
 * afficher des données périmées, ce que §5 exclut explicitement.
 *
 * Pour forcer la mise à jour du cache après un changement ici : incrémenter
 * VERSION.
 */

const VERSION = 'v1'
const CACHE = `vitalis-coquille-${VERSION}`
const PAGE_HORS_LIGNE = '/hors-ligne'

const PRECHARGEMENT = [PAGE_HORS_LIGNE, '/icones/icone-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // `catch` : un précaseau qui échoue ne doit pas empêcher l'installation.
      // Sans réseau au premier chargement, on réessaiera à la prochaine visite.
      await cache.addAll(PRECHARGEMENT).catch(() => {})
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const noms = await caches.keys()
      await Promise.all(
        noms
          .filter((nom) => nom.startsWith('vitalis-coquille-') && nom !== CACHE)
          .map((nom) => caches.delete(nom)),
      )
      await self.clients.claim()
    })(),
  )
})

/** Cache d'abord — réservé aux ressources au contenu immuable. */
async function cacheDAbord(request) {
  const cache = await caches.open(CACHE)
  const enCache = await cache.match(request)

  if (enCache) return enCache

  const reponse = await fetch(request)

  // Ne mettre en cache que les succès de même origine.
  if (reponse.ok && reponse.type === 'basic') {
    cache.put(request, reponse.clone())
  }

  return reponse
}

/** Réseau d'abord, page de secours si le réseau est absent. Aucun cache. */
async function reseauPuisSecours(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(CACHE)
    const secours = await cache.match(PAGE_HORS_LIGNE)

    if (secours) return secours

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Hors ligne</title><p>Connexion perdue. Réessaie dans un instant.',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Les écritures ne passent jamais par ici : voir `src/lib/file-attente`.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Supabase, Google Maps, polices… : laisser filer sans intervenir.
  if (url.origin !== self.location.origin) return

  // Charges RSC : ce sont des données, pas la coquille.
  if (url.searchParams.has('_rsc')) return

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icones/')
  ) {
    event.respondWith(cacheDAbord(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(reseauPuisSecours(request))
    return
  }

  // Tout le reste : réseau seul, aucune mise en cache.
})
