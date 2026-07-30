import { estRoleUser, type RoleUser } from '@/lib/roles'

/**
 * Ce que le hook `custom_access_token_hook` ajoute au JWT
 * (voir `supabase/migrations/20260731091000_hook_jwt_claims.sql`).
 */
export type ClaimsVitalis = {
  role: RoleUser
  closerId: string | null
  actif: boolean
}

/**
 * Résultat de la lecture des claims. Les trois cas sont distincts et n'appellent
 * pas la même réaction :
 *
 * - `absent`      : le hook n'est pas activé, ou le jeton a été émis avant son
 *                   activation, ou une claim est malformée → **replier** sur la
 *                   lecture de `public.profiles`, qui est la source de vérité.
 * - `sans_profil` : le hook a répondu que ce compte auth n'a pas de ligne
 *                   `profiles` → refuser, sans repli inutile.
 * - `ok`          : claims exploitables.
 */
export type LectureClaims =
  | { statut: 'absent' }
  | { statut: 'sans_profil' }
  | { statut: 'ok'; claims: ClaimsVitalis }

/**
 * Extrait les claims Vitalis d'un payload JWT **déjà vérifié**.
 *
 * Cette fonction ne valide aucune signature : elle doit être alimentée par
 * `supabase.auth.getClaims()`, qui vérifie le jeton (localement via la JWKS si
 * le projet utilise des clés asymétriques, sinon auprès du serveur Auth).
 * Ne jamais l'alimenter avec un JWT simplement décodé.
 */
export function lireClaimsVitalis(
  claims: Record<string, unknown> | null | undefined,
): LectureClaims {
  if (!claims || !('role_vitalis' in claims)) {
    return { statut: 'absent' }
  }

  const roleBrut = claims.role_vitalis

  if (roleBrut === null || roleBrut === undefined) {
    return { statut: 'sans_profil' }
  }

  // Valeur inattendue (rôle retiré de l'enum, hook modifié à la main…) : on
  // préfère le repli sur la base à une décision prise sur une donnée douteuse.
  if (!estRoleUser(roleBrut)) {
    return { statut: 'absent' }
  }

  // Idem : `actif` doit être un booléen franc. En cas d'anomalie, replier plutôt
  // que de deviner — deviner `true` ouvrirait un accès, deviner `false`
  // verrouillerait tout le monde dehors.
  if (typeof claims.actif !== 'boolean') {
    return { statut: 'absent' }
  }

  return {
    statut: 'ok',
    claims: {
      role: roleBrut,
      closerId: typeof claims.closer_id === 'string' ? claims.closer_id : null,
      actif: claims.actif,
    },
  }
}
