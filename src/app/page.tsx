import { redirect } from 'next/navigation'

import { casquettesDe, sessionCourante } from '@/lib/auth'
import { accueilDuRole } from '@/lib/roles'

/**
 * La racine n'a pas de contenu propre : chaque rôle a sa zone.
 *
 * Le proxy redirige déjà `/`. Cette page fait la même chose côté rendu, au cas
 * où la requête n'aurait pas traversé le proxy.
 */
export default async function Racine() {
  const session = await sessionCourante()
  redirect(session ? accueilDuRole(session.role, casquettesDe(session)) : '/login')
}
