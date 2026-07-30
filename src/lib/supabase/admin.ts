import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.types'

/**
 * Client Supabase à privilèges `service_role`.
 *
 * ⚠️ Contourne TOUTE la RLS. Réservé aux opérations d'administration qu'un
 * utilisateur ne peut pas faire lui-même : création de comptes via
 * `auth.admin.*`, lecture des courriels dans `auth.users`.
 *
 * `import 'server-only'` fait échouer le build si ce module est atteint depuis
 * un Client Component. Ne jamais l'importer dans un fichier `'use client'`, ni
 * exposer la clé sous un préfixe `NEXT_PUBLIC_`.
 *
 * Toute action qui utilise ce client doit vérifier elle-même que l'appelant est
 * un admin (`exigerAdmin()` dans `@/lib/auth`) : la base ne le fera pas.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const cleService = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !cleService) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies pour les opérations d’administration.',
    )
  }

  return createSupabaseClient<Database>(url, cleService, {
    auth: {
      // Aucun utilisateur derrière ce client : pas de session à conserver ni de
      // jeton à renouveler.
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
