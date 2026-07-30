import { createBrowserClient } from '@supabase/ssr'

import type { Database } from './database.types'

/**
 * Client Supabase pour le navigateur (Client Components).
 *
 * La gestion des cookies est automatique : ne pas passer d'option `cookies`,
 * sinon la session se désynchronise du client serveur.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
