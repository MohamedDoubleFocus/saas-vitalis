import 'server-only'

import { redirect } from 'next/navigation'

import { lireClaimsVitalis } from '@/lib/claims'
import { accueilDuRole, type RoleUser } from '@/lib/roles'
import { createClient } from '@/lib/supabase/server'

export type SessionApp = {
  userId: string
  role: RoleUser
  /** Closer rattaché (knocker uniquement), sinon `null`. */
  closerId: string | null
}

export type ProfilCourant = SessionApp & {
  nomComplet: string | null
}

/**
 * Session courante — **voie économique**.
 *
 * Lit le rôle dans le JWT (claims du custom access token hook) et ne touche à
 * `public.profiles` que si la claim manque : hook pas encore activé, ou jeton
 * émis avant son activation.
 *
 * Un profil absent ou désactivé équivaut à l'absence de session — même règle que
 * dans le proxy et que dans la RLS, où `role_actuel()` renvoie NULL pour un
 * profil inactif.
 *
 * Ne renvoie PAS le nom d'affichage : il n'est pas dans le jeton. Pour l'obtenir,
 * utiliser `profilCourant()`, qui interroge la base.
 */
export async function sessionCourante(): Promise<SessionApp | null> {
  const supabase = await createClient()

  // `getClaims()` VÉRIFIE le jeton (JWKS en local si le projet utilise des clés
  // asymétriques, sinon appel au serveur Auth). Ne jamais remplacer par un
  // décodage brut du JWT.
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims) return null

  const claims = data.claims
  const userId = typeof claims.sub === 'string' ? claims.sub : null

  if (!userId) return null

  const lecture = lireClaimsVitalis(claims)

  if (lecture.statut === 'sans_profil') return null

  if (lecture.statut === 'ok') {
    if (!lecture.claims.actif) return null

    return {
      userId,
      role: lecture.claims.role,
      closerId: lecture.claims.closerId,
    }
  }

  // Repli : le hook n'est pas (encore) actif.
  const { data: profil } = await supabase
    .from('profiles')
    .select('role, actif, closer_id')
    .eq('id', userId)
    .maybeSingle()

  if (!profil || !profil.actif) return null

  return {
    userId,
    role: profil.role,
    closerId: profil.closer_id,
  }
}

/**
 * Profil courant, nom d'affichage compris — **interroge toujours la base**.
 *
 * À réserver aux écrans qui affichent réellement le nom (l'en-tête de
 * `CadrePage`). Partout ailleurs, `sessionCourante()` suffit et coûte moins.
 */
export async function profilCourant(): Promise<ProfilCourant | null> {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims) return null

  const userId = typeof data.claims.sub === 'string' ? data.claims.sub : null

  if (!userId) return null

  const { data: profil } = await supabase
    .from('profiles')
    .select('role, actif, closer_id, nom_complet')
    .eq('id', userId)
    .maybeSingle()

  if (!profil || !profil.actif) return null

  return {
    userId,
    role: profil.role,
    closerId: profil.closer_id,
    nomComplet: profil.nom_complet,
  }
}

/**
 * Exige un admin actif, sinon redirige.
 *
 * À appeler au début de CHAQUE page et action d'administration. Le proxy garde
 * déjà les zones, mais une server action est un point d'entrée HTTP à part
 * entière : elle doit se défendre seule.
 */
export async function exigerAdmin(): Promise<SessionApp> {
  const session = await sessionCourante()

  if (!session) redirect('/login?error=session')
  if (session.role !== 'admin') redirect(accueilDuRole(session.role))

  return session
}

/**
 * Exige une session active et renvoie le rôle, sinon redirige vers la connexion.
 * Utilisé par les écrans terrain.
 */
export async function exigerSession(): Promise<SessionApp> {
  const session = await sessionCourante()

  if (!session) redirect('/login?error=session')

  return session
}
