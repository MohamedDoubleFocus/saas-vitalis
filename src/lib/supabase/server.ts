import { cookies } from 'next/headers'

import { createServerClient } from '@supabase/ssr'

import type { Database } from './database.types'

/**
 * Client Supabase côté serveur (Server Components, Server Actions,
 * Route Handlers).
 *
 * Toujours créer un nouveau client par requête — ne jamais le mettre en cache
 * dans une variable de module, sous peine de fuiter une session d'un
 * utilisateur vers un autre.
 *
 * `cookies()` est asynchrone depuis Next.js 15 : cette fonction doit être
 * attendue (`const supabase = await createClient()`).
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesAEcrire) {
          try {
            for (const { name, value, options } of cookiesAEcrire) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Un Server Component ne peut pas écrire de cookies. On ignore :
            // le rafraîchissement de session est assuré par le proxy
            // (`src/proxy.ts` → `updateSession`).
          }
        },
      },
    },
  )
}
