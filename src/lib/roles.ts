import type { Database } from '@/lib/supabase/database.types'

export type RoleUser = Database['public']['Enums']['role_user']

/** Libellés affichés dans l'interface. */
export const LIBELLES_ROLES: Record<RoleUser, string> = {
  knocker: 'Knocker',
  closer: 'Closer',
  roofer: 'Couvreur',
  admin: 'Administrateur',
}

/** Tous les rôles, dans l'ordre d'affichage des formulaires. */
export const ROLES: readonly RoleUser[] = ['knocker', 'closer', 'roofer', 'admin']

/**
 * Page d'accueil de chaque rôle. La racine `/` y redirige, et c'est là
 * qu'aboutit un utilisateur qui tente d'accéder à une zone qui n'est pas la
 * sienne.
 */
export const ACCUEIL_PAR_ROLE: Record<RoleUser, string> = {
  knocker: '/terrain/rues',
  closer: '/terrain/agenda',
  roofer: '/chantiers',
  admin: '/admin',
}

/**
 * Manager : une CASQUETTE, pas un rôle.
 *
 * `est_manager` se cumule avec `role`. Aujourd'hui Billal est closer ET manager ;
 * demain quelqu'un pourra être l'un sans l'autre. Le routage doit donc composer
 * les deux au lieu de choisir.
 */
export const ROUTES_MANAGER: readonly string[] = ['/accueil', '/equipe']

/** Hub d'accueil des utilisateurs à deux casquettes. */
export const HUB = '/accueil'

/** Tableau de bord d'équipe. */
export const ACCUEIL_MANAGER = '/equipe'

/**
 * Préfixes de routes accessibles par rôle.
 *
 * `knocker` et `closer` partagent le préfixe `/terrain` (zone offline-first,
 * CLAUDE.md §3) mais pas les mêmes écrans : la garde est donc définie au
 * niveau de la route, pas de la zone.
 *
 * L'admin fait de la « supervision totale » (CLAUDE.md §1) : il atteint tout.
 */
const ROUTES_PAR_ROLE: Record<RoleUser, readonly string[]> = {
  knocker: [
    '/terrain/rues',
    '/terrain/lead',
    '/terrain/portes',
    '/terrain/meetings',
    '/terrain/classement',
  ],
  closer: ['/terrain/agenda', '/terrain/classement'],
  roofer: ['/chantiers'],
  admin: ['/admin', '/terrain', '/chantiers', '/accueil', '/equipe'],
}

/** Vrai si `chemin` est `prefixe` ou l'un de ses descendants. */
function souscheminDe(prefixe: string, chemin: string): boolean {
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`)
}

export function estRoleUser(valeur: unknown): valeur is RoleUser {
  return typeof valeur === 'string' && (ROLES as readonly string[]).includes(valeur)
}

/**
 * Où envoyer cet utilisateur après connexion, ou depuis `/`.
 *
 * Trois cas, dans cet ordre :
 *   1. Admin — il supervise déjà tout, sa console reste son point d'entrée ;
 *   2. Closer ET manager — deux métiers distincts dans la même journée, aucun
 *      des deux n'est « le vrai » : le hub laisse choisir ;
 *   3. Manager sans être closer — une seule casquette, on y va directement.
 *
 * Un utilisateur sans casquette de manager retrouve exactement son accueil
 * d'avant : rien ne change pour lui.
 */
export function accueilDuRole(role: RoleUser, estManager = false): string {
  if (role === 'admin') return ACCUEIL_PAR_ROLE.admin
  if (!estManager) return ACCUEIL_PAR_ROLE[role]

  return role === 'closer' ? HUB : ACCUEIL_MANAGER
}

/**
 * Vrai si cet utilisateur a le droit d'atteindre ce chemin.
 *
 * La casquette de manager AJOUTE des routes, elle n'en retire aucune : un closer
 * manager garde l'accès complet à son agenda.
 */
export function cheminAutorise(
  role: RoleUser,
  chemin: string,
  estManager = false,
): boolean {
  const prefixes = estManager
    ? [...ROUTES_PAR_ROLE[role], ...ROUTES_MANAGER]
    : ROUTES_PAR_ROLE[role]

  return prefixes.some((prefixe) => souscheminDe(prefixe, chemin))
}

/**
 * Destination après connexion : `suivant` s'il s'agit d'un chemin interne que
 * ce rôle peut atteindre, sinon son accueil.
 *
 * Le filtrage protège contre une redirection ouverte : `//evil.com` et
 * `https://evil.com` sont des URL absolues aux yeux du navigateur.
 */
export function destinationApresConnexion(
  role: RoleUser,
  suivant: string | null | undefined,
  estManager = false,
): string {
  if (
    suivant &&
    suivant.startsWith('/') &&
    !suivant.startsWith('//') &&
    cheminAutorise(role, suivant.split('?')[0], estManager)
  ) {
    return suivant
  }

  return accueilDuRole(role, estManager)
}
