import type { MetadataRoute } from 'next'

/**
 * Manifest PWA — servi sur `/manifest.webmanifest`.
 *
 * Permet l'installation sur l'écran d'accueil (iOS Safari via « Sur l'écran
 * d'accueil », Android Chrome via l'invite d'installation) et le lancement en
 * plein écran.
 *
 * Couleurs : `navy` des tokens (CLAUDE.md §6). `theme_color` colore la barre
 * d'état en mode standalone ; `background_color` l'écran de démarrage.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vitalis',
    short_name: 'Vitalis',
    description: 'Gestion des ventes et des opérations — Toitures Vitalis',
    lang: 'fr-CA',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#111418',
    theme_color: '#111418',
    icons: [
      {
        src: '/icones/icone-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icones/icone-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // Android rogne les icônes adaptatives : celle-ci a la marge de sécurité.
        src: '/icones/icone-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
