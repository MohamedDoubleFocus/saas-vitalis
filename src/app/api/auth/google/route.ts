import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { configGoogleDisponible, urlConsentement } from '@/lib/google/credentials'

/**
 * Lance le consentement Google.
 *
 * Les routes `/api` sont exclues du proxy (voir le `matcher` dans
 * `src/proxy.ts`) : chaque handler s'authentifie donc lui-même. Ici, admin
 * obligatoire — connecter le compte Google de l'entreprise n'est pas un geste
 * anodin.
 */
export async function GET(request: NextRequest) {
  const session = await sessionCourante()

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (session.role !== 'admin') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (!configGoogleDisponible()) {
    return NextResponse.redirect(
      new URL('/admin/google?error=config_absente', request.url),
    )
  }

  const origine = new URL(request.url).origin

  // `state` : protection CSRF. Google nous le rendra tel quel au callback, où on
  // le compare au cookie. Sans ça, un tiers pourrait faire aboutir SON
  // autorisation dans notre application.
  const etat = crypto.randomUUID()

  const reponse = NextResponse.redirect(urlConsentement(origine, etat))

  reponse.cookies.set('etat_oauth_google', etat, {
    httpOnly: true,
    sameSite: 'lax',
    secure: origine.startsWith('https://'),
    path: '/',
    maxAge: 600,
  })

  return reponse
}
