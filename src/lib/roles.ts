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
 * Les CASQUETTES : ce qu'on fait EN PLUS de son rôle.
 *
 * `role` répond à « c'est quoi ton métier », les casquettes à « qu'est-ce que tu
 * fais aussi ». Elles se cumulent, dans n'importe quelle combinaison. Billal est
 * closer, manager, et il cogne.
 *
 * ⚠️ Deux casquettes, ça va. Une TROISIÈME serait le signal que `role` ne veut
 * plus rien dire et qu'il faut passer à un vrai modèle multi-rôles.
 */
export type Casquettes = {
  /** Supervise une équipe de knockers (lecture seule). */
  estManager?: boolean
  /** Cogne des portes. Toujours vrai pour un knocker. */
  faitDuTerrain?: boolean
}

export const ROUTES_MANAGER: readonly string[] = ['/accueil', '/equipe']

/**
 * Routes du travail de porte, ouvertes par la casquette terrain.
 *
 * `/terrain/meetings` en est volontairement absent : les rendez-vous décrochés
 * par un closer qui cogne sont déjà dans son propre agenda, puisqu'il en est le
 * closer. Deux écrans pour la même liste n'apprendraient rien.
 */
export const ROUTES_TERRAIN: readonly string[] = [
  '/terrain/rues',
  '/terrain/lead',
  '/terrain/portes',
  '/terrain/classement',
  '/accueil',
]

/** Hub d'accueil des utilisateurs à plusieurs casquettes. */
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
 * Les « chez-soi » de cet utilisateur, un par casquette, par ordre d'usage.
 *
 * Une seule entrée = il n'y a rien à choisir, on l'y envoie directement.
 * Plusieurs = le hub pose la question.
 *
 * Sert à la fois au routage, au hub et à la barre de navigation : une seule
 * source de vérité, sinon les trois finiraient par diverger.
 */
export function destinationsDe(
  role: RoleUser,
  casquettes: Casquettes = {},
): string[] {
  const destinations: string[] = []

  // Le terrain d'abord : c'est le travail du matin.
  if (role === 'knocker' || casquettes.faitDuTerrain) {
    destinations.push('/terrain/rues')
  }

  const metier = ACCUEIL_PAR_ROLE[role]

  if (!destinations.includes(metier)) destinations.push(metier)

  if (casquettes.estManager) destinations.push(ACCUEIL_MANAGER)

  return destinations
}

/**
 * Où envoyer cet utilisateur après connexion, ou depuis `/`.
 *
 * Trois règles, dans cet ordre :
 *   1. Admin — il supervise déjà tout, sa console reste son point d'entrée ;
 *   2. Manager sans être closer — décision produit explicite : il va droit à son
 *      équipe, même s'il a d'autres écrans ;
 *   3. Sinon : une seule destination → on y va ; plusieurs → le hub.
 *
 * Un utilisateur sans casquette retrouve exactement son accueil d'avant.
 */
export function accueilDuRole(
  role: RoleUser,
  casquettes: Casquettes = {},
): string {
  if (role === 'admin') return ACCUEIL_PAR_ROLE.admin

  if (casquettes.estManager && role !== 'closer') return ACCUEIL_MANAGER

  const destinations = destinationsDe(role, casquettes)

  return destinations.length > 1 ? HUB : destinations[0]
}

/**
 * Vrai si cet utilisateur a le droit d'atteindre ce chemin.
 *
 * Les casquettes AJOUTENT des routes, elles n'en retirent aucune : un closer qui
 * cogne et supervise garde l'accès complet à son agenda.
 */
export function cheminAutorise(
  role: RoleUser,
  chemin: string,
  casquettes: Casquettes = {},
): boolean {
  const prefixes = [
    ...ROUTES_PAR_ROLE[role],
    ...(casquettes.estManager ? ROUTES_MANAGER : []),
    ...(casquettes.faitDuTerrain ? ROUTES_TERRAIN : []),
  ]

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
  casquettes: Casquettes = {},
): string {
  if (
    suivant &&
    suivant.startsWith('/') &&
    !suivant.startsWith('//') &&
    cheminAutorise(role, suivant.split('?')[0], casquettes)
  ) {
    return suivant
  }

  return accueilDuRole(role, casquettes)
}
