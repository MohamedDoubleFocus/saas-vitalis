import { NextResponse, type NextRequest } from 'next/server'

import { sessionCourante } from '@/lib/auth'
import { echangerCodeEtEnregistrer } from '@/lib/google/credentials'

/**
 * Retour du consentement Google : échange le code contre les jetons.
 *
 * Tout se passe côté serveur. Le code d'autorisation et le jeton de
 * rafraîchissement ne traversent jamais le navigateur autrement que dans cette
 * redirection, et rien n'est renvoyé au client hormis un statut.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const versAdmin = (parametres: string) =>
    NextResponse.redirect(new URL(`/admin/google?${parametres}`, request.url))

  const session = await sessionCourante()

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (session.role !== 'admin') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // L'utilisateur a refusé, ou Google a renvoyé une erreur.
  const refus = url.searchParams.get('error')

  if (refus) {
    return versAdmin(`error=refus&detail=${encodeURIComponent(refus)}`)
  }

  const code = url.searchParams.get('code')
  const etatRecu = url.searchParams.get('state')
  const etatAttendu = request.cookies.get('etat_oauth_google')?.value

  if (!code) {
    return versAdmin('error=code_absent')
  }

  // Comparaison CSRF : le `state` doit être exactement celui qu'on a posé.
  if (!etatAttendu || etatRecu !== etatAttendu) {
    return versAdmin('error=etat_invalide')
  }

  try {
    const { courriel } = await echangerCodeEtEnregistrer(code, url.origin)

    const reponse = versAdmin(
      `ok=connecte${courriel ? `&courriel=${encodeURIComponent(courriel)}` : ''}`,
    )

    // Le `state` a servi, il ne doit pas pouvoir être rejoué.
    reponse.cookies.delete('etat_oauth_google')

    return reponse
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : 'Erreur inconnue'

    return versAdmin(`error=echange&detail=${encodeURIComponent(message.slice(0, 200))}`)
  }
}
