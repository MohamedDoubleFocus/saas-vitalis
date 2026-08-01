import { NextResponse, type NextRequest } from 'next/server'

import { createServerClient } from '@supabase/ssr'

import { lireClaimsVitalis } from '@/lib/claims'
import { accueilDuRole, cheminAutorise, type RoleUser } from '@/lib/roles'

import type { Database } from './database.types'

/**
 * Préfixes atteignables sans session.
 * `/auth` est réservé aux futurs retours de flux Supabase (réinitialisation de
 * mot de passe, lien magique) : il reste accessible même une fois connecté,
 * contrairement à `/login`.
 */
const ROUTES_PUBLIQUES = ['/login', '/auth'] as const

function souscheminDe(prefixe: string, chemin: string): boolean {
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`)
}

function estRoutePublique(chemin: string): boolean {
  return ROUTES_PUBLIQUES.some((prefixe) => souscheminDe(prefixe, chemin))
}

function estPageConnexion(chemin: string): boolean {
  return souscheminDe('/login', chemin)
}

/**
 * Redirige en reportant les cookies déjà posés sur `reponse`.
 *
 * Indispensable : `NextResponse.redirect()` part d'une réponse vierge. Sans
 * cette recopie, une requête où Supabase vient de renouveler les jetons puis
 * qui redirige perdrait les nouveaux cookies — l'utilisateur serait déconnecté
 * au hasard. Même chose en sens inverse pour les cookies effacés par
 * `signOut()`.
 */
function redirigerVers(
  destination: string,
  request: NextRequest,
  reponse: NextResponse,
): NextResponse {
  const redirection = NextResponse.redirect(new URL(destination, request.url))

  for (const cookie of reponse.cookies.getAll()) {
    redirection.cookies.set(cookie)
  }

  return redirection
}

/**
 * Rafraîchit la session Supabase, résout le rôle et garde les zones.
 *
 * Branché depuis `src/proxy.ts` (convention Next.js 16, ex-`middleware.ts`).
 *
 * Le rôle vient du JWT (claims du custom access token hook), ce qui supprime la
 * lecture de `public.profiles` à chaque requête. Le repli sur la base subsiste
 * pour la transition : tant que le hook n'est pas activé côté dashboard, ou pour
 * les jetons émis avant, le comportement est celui du module 1.
 */
export async function updateSession(request: NextRequest) {
  // Réponse par défaut : la requête passe telle quelle. Elle est recréée dans
  // `setAll` lorsque Supabase renouvelle les jetons.
  let reponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesAEcrire, entetes) {
          // 1. Sur la requête, pour que le rendu en aval voie les nouveaux jetons.
          for (const { name, value } of cookiesAEcrire) {
            request.cookies.set(name, value)
          }
          // 2. Sur une réponse reconstruite, pour que le navigateur les reçoive.
          reponse = NextResponse.next({ request })
          for (const { name, value, options } of cookiesAEcrire) {
            reponse.cookies.set(name, value, options)
          }
          // 3. En-têtes anti-cache : une réponse qui pose des cookies d'auth ne
          //    doit jamais être mise en cache par un CDN (fuite de session).
          for (const [cle, valeur] of Object.entries(entetes)) {
            reponse.headers.set(cle, valeur)
          }
        },
      },
    },
  )

  // IMPORTANT : ne rien insérer entre `createServerClient` et l'appel ci-dessous.
  // `getClaims()` VÉRIFIE la signature du jeton — localement via la JWKS si le
  // projet signe en asymétrique, sinon auprès du serveur Auth. Les claims sont
  // donc authentifiées, jamais un simple décodage base64.
  const { data: donneesJeton } = await supabase.auth.getClaims()

  const claims = donneesJeton?.claims ?? null
  const userId = typeof claims?.sub === 'string' ? claims.sub : null

  const chemin = request.nextUrl.pathname

  // --- Aucune session -------------------------------------------------------
  if (!claims || !userId) {
    if (estRoutePublique(chemin)) return reponse

    // Inutile de mémoriser la racine : elle n'a pas de contenu propre.
    if (chemin === '/') return redirigerVers('/login', request, reponse)

    const suivant = `${chemin}${request.nextUrl.search}`
    return redirigerVers(
      `/login?suivant=${encodeURIComponent(suivant)}`,
      request,
      reponse,
    )
  }

  // --- Résolution du rôle ---------------------------------------------------
  const lecture = lireClaimsVitalis(claims)

  let role: RoleUser
  let actif: boolean
  let estManager: boolean

  if (lecture.statut === 'ok') {
    role = lecture.claims.role
    actif = lecture.claims.actif

    if (lecture.claims.estManager === null) {
      // Jeton émis avant la migration manager : le reste des claims est bon, on
      // ne va chercher QUE cette colonne. Ce repli disparaît de lui-même au
      // premier renouvellement du jeton (une heure au plus).
      const { data: casquette } = await supabase
        .from('profiles')
        .select('est_manager')
        .eq('id', userId)
        .maybeSingle()

      estManager = casquette?.est_manager ?? false
    } else {
      estManager = lecture.claims.estManager
    }
  } else if (lecture.statut === 'sans_profil') {
    role = 'knocker' // valeur inutilisée : `actif = false` court-circuite plus bas
    actif = false
    estManager = false
  } else {
    // Repli module 1 : le hook n'est pas actif, ou le jeton précède son
    // activation. Une lecture de `profiles` par requête, le temps de la
    // transition.
    const { data: profil, error: erreurProfil } = await supabase
      .from('profiles')
      .select('role, actif, est_manager')
      .eq('id', userId)
      .maybeSingle()

    // Échec de lecture (réseau, base indisponible) : ne pas détruire la session
    // pour une panne passagère. On refuse l'accès à cette requête, sans plus.
    if (erreurProfil) {
      if (estRoutePublique(chemin)) return reponse
      return redirigerVers('/login?error=inattendu', request, reponse)
    }

    if (!profil) {
      await supabase.auth.signOut()
      if (estRoutePublique(chemin)) return reponse
      return redirigerVers('/login?error=profil_absent', request, reponse)
    }

    role = profil.role
    actif = profil.actif
    estManager = profil.est_manager
  }

  // Compte sans profil, ou désactivé (CLAUDE.md §4.2 : un utilisateur est
  // désactivé, jamais supprimé) → déconnexion et message.
  //
  // La claim `actif` peut avoir jusqu'à une heure de retard (durée de vie du
  // jeton). C'est pourquoi `basculerActif` révoque aussi les sessions du profil
  // désactivé, et pourquoi la RLS reste la barrière de fond : `role_actuel()`
  // lit la base, pas le jeton.
  if (!actif) {
    await supabase.auth.signOut()

    // `reponse` porte maintenant les cookies effacés par `signOut()`.
    if (estRoutePublique(chemin)) return reponse

    const code = lecture.statut === 'sans_profil' ? 'profil_absent' : 'compte_desactive'
    return redirigerVers(`/login?error=${code}`, request, reponse)
  }

  // --- Routage par rôle -----------------------------------------------------

  // Déjà connecté : la page de connexion n'a plus rien à offrir.
  if (estPageConnexion(chemin)) {
    return redirigerVers(accueilDuRole(role, estManager), request, reponse)
  }

  if (estRoutePublique(chemin)) return reponse

  // La racine n'a pas de contenu propre : chaque rôle a sa zone.
  if (chemin === '/') {
    return redirigerVers(accueilDuRole(role, estManager), request, reponse)
  }

  // Garde de zone : hors de son périmètre, on renvoie l'utilisateur chez lui
  // plutôt que d'afficher un 403 — il n'a rien à corriger.
  if (!cheminAutorise(role, chemin, estManager)) {
    return redirigerVers(accueilDuRole(role, estManager), request, reponse)
  }

  // Retourner CETTE réponse (et pas une nouvelle) : elle porte les cookies de
  // session rafraîchis.
  return reponse
}
