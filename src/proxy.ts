import type { NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/middleware'

/**
 * Proxy Next.js — anciennement `middleware.ts`, renommé en `proxy.ts` depuis
 * Next.js 16 (le nom de la fonction exportée doit être `proxy`).
 * Le runtime est `nodejs` et n'est pas configurable ici.
 *
 * Rôle : rafraîchir la session Supabase et rediriger les visiteurs non
 * authentifiés vers `/login`.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Toutes les routes SAUF :
     * - `_next/static` et `_next/image` (assets générés)
     * - `favicon.ico`
     * - les fichiers image
     * Sans cette exclusion, la logique d'auth bloquerait le chargement du CSS,
     * du JS et des images.
     *
     * Exclusions PWA — ces ressources doivent rester atteignables sans session,
     * sinon le service worker mettrait en cache une redirection vers /login :
     * - `sw.js`      : le service worker lui-même
     * - `manifest.webmanifest` : le manifest PWA
     * - `hors-ligne` : la page de secours, préchargée par le service worker
     *
     * `api` est exclu aussi, mais pour une autre raison : la garde de zone
     * redirigerait un knocker appelant `/api/creneaux` vers son accueil, et le
     * `fetch` recevrait du HTML au lieu de JSON. CHAQUE handler de `/api`
     * s'authentifie donc lui-même et répond 401/403 en JSON.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|hors-ligne|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
