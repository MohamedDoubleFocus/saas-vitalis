/**
 * Messages d'erreur d'authentification.
 *
 * Les écrans ne reçoivent qu'un code via `?error=` : aucun message d'erreur
 * Supabase (en anglais, parfois bavard sur l'existence d'un compte) n'atteint
 * l'utilisateur.
 */
const MESSAGES: Record<string, string> = {
  identifiants: 'Courriel ou mot de passe invalide.',
  champs_manquants: 'Saisis ton courriel et ton mot de passe.',
  compte_desactive:
    'Ton compte a été désactivé. Contacte un administrateur pour le réactiver.',
  profil_absent:
    'Aucun profil n’est rattaché à ce compte. Contacte un administrateur.',
  session: 'Ta session a expiré. Reconnecte-toi.',
  inattendu: 'Une erreur est survenue. Réessaie dans un instant.',
}

/** Message correspondant au code, ou `null` si le code est absent ou inconnu. */
export function messageErreurAuth(code: string | null | undefined): string | null {
  if (!code) return null
  return MESSAGES[code] ?? MESSAGES.inattendu
}
