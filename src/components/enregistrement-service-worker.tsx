'use client'

import { useEffect } from 'react'

/**
 * Enregistre le service worker de la coquille PWA (`public/sw.js`).
 *
 * Uniquement en production : en développement, les chunks de Next ne sont pas
 * empreintés de la même façon et un cache périmé casse le rechargement à chaud.
 * Pour tester la PWA en local : `npm run build && npm start`.
 */
export function EnregistrementServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    const enregistrer = () => {
      // Échec silencieux : un service worker indisponible (mode privé, réglages
      // du navigateur) ne doit jamais empêcher l'app de fonctionner.
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
    }

    // Attendre `load` pour ne pas concurrencer le premier rendu.
    if (document.readyState === 'complete') {
      enregistrer()
    } else {
      window.addEventListener('load', enregistrer, { once: true })
      return () => window.removeEventListener('load', enregistrer)
    }
  }, [])

  return null
}
