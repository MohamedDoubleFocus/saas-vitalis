/**
 * Numéros de téléphone nord-américains (indicatif +1).
 *
 * Stockage en **E.164** (`+14505551234`) plutôt qu'en texte libre : c'est le
 * format sans ambiguïté, celui qu'attendent les liens `tel:` et n'importe quel
 * futur envoi de SMS de rappel. L'affichage est reformaté à la lecture.
 */

/** Ne garde que les chiffres. */
export function chiffres(valeur: string): string {
  return valeur.replace(/\D/g, '')
}

/**
 * Les dix chiffres significatifs, ou `null` si le numéro n'est pas exploitable.
 *
 * Accepte le « 1 » d'indicatif de pays en tête (11 chiffres), que les gens
 * composent naturellement.
 */
function dixChiffres(valeur: string): string | null {
  const bruts = chiffres(valeur)

  if (bruts.length === 10) return bruts
  if (bruts.length === 11 && bruts.startsWith('1')) return bruts.slice(1)

  return null
}

export function estTelephoneValide(valeur: string): boolean {
  const dix = dixChiffres(valeur)

  if (!dix) return false

  // Un indicatif régional et un préfixe nord-américains ne commencent jamais
  // par 0 ni 1 : ça élimine les saisies bâclées sans prétendre valider la ligne.
  return dix[0] >= '2' && dix[3] >= '2'
}

/** Forme stockée : `+14505551234`, ou `null` si le numéro est inexploitable. */
export function versE164(valeur: string): string | null {
  if (!estTelephoneValide(valeur)) return null

  return `+1${dixChiffres(valeur)}`
}

/** Forme affichée : `(450) 555-1234`. Renvoie l'entrée telle quelle si illisible. */
export function formaterTelephone(valeur: string | null | undefined): string {
  if (!valeur) return ''

  const dix = dixChiffres(valeur)

  if (!dix) return valeur

  return `(${dix.slice(0, 3)}) ${dix.slice(3, 6)}-${dix.slice(6)}`
}

/** Cible d'un lien `tel:` — jamais la forme affichée, qui contient des espaces. */
export function lienTelephone(valeur: string | null | undefined): string | null {
  if (!valeur) return null

  const dix = dixChiffres(valeur)

  return dix ? `tel:+1${dix}` : null
}
