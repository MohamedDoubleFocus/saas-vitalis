import { formaterDateHeureFuseau, FUSEAU_QUEBEC } from '@/lib/fuseau'

/**
 * Textes des SMS envoyés au client.
 *
 * Fonctions pures : elles ne font que composer une chaîne. L'envoi vit dans
 * `openphone.ts`, côté serveur.
 *
 * ⚙️ Pour changer un message, c'est ICI et nulle part ailleurs.
 */

export type ContexteConfirmation = {
  clientNom: string | null
  closerNom: string | null
  dateRdv: Date
}

export type ContexteRappel = {
  closerNom: string | null
}

/** Repli quand le nom du closer manque : le SMS reste envoyable et poli. */
const CLOSER_PAR_DEFAUT = 'l’équipe'

/**
 * Salutation adaptée.
 *
 * Le nom du client est facultatif au stade lead (CLAUDE.md §4.7) : sans lui, on
 * dit « Bonjour, » plutôt que « Bonjour , » ou « Bonjour null ».
 */
function salutation(clientNom: string | null): string {
  const nom = clientNom?.trim()

  return nom ? `Bonjour ${nom},` : 'Bonjour,'
}

function nomCloser(closerNom: string | null): string {
  return closerNom?.trim() || CLOSER_PAR_DEFAUT
}

/** SMS envoyé immédiatement à la prise de rendez-vous. */
export function messageConfirmation(contexte: ContexteConfirmation): string {
  const quand = formaterDateHeureFuseau(contexte.dateRdv, FUSEAU_QUEBEC)

  return (
    `${salutation(contexte.clientNom)} c’est ${nomCloser(contexte.closerNom)} de ` +
    `Toitures Vitalis. Je vous confirme notre rendez-vous le ${quand}. ` +
    `Je vais vous présenter les différentes options et répondre à vos questions ` +
    `pour vous aider à prendre la meilleure décision pour votre maison. À bientôt!`
  )
}

/** SMS envoyé la veille du rendez-vous, à 9 h. */
export function messageRappel(contexte: ContexteRappel): string {
  return (
    `Bonjour, c’est ${nomCloser(contexte.closerNom)} de Toitures Vitalis. ` +
    `Je vous confirme notre rencontre demain. Je vais vous présenter les ` +
    `meilleures options selon vos besoins et votre budget. Si tout vous convient, ` +
    `on pourra officialiser le projet sur place et réserver votre date ` +
    `d’installation. Au plaisir de vous voir demain!`
  )
}

/**
 * Vrai si le SMS est envoyable : il faut un expéditeur ET un destinataire.
 *
 * Les deux sont facultatifs dans le modèle — un closer peut ne pas avoir de
 * numéro OpenPhone, un lead peut ne pas avoir de téléphone. Ce n'est pas une
 * erreur, simplement un envoi qui n'a pas lieu.
 */
export function peutEnvoyer(
  numeroExpediteur: string | null | undefined,
  numeroDestinataire: string | null | undefined,
): boolean {
  return Boolean(numeroExpediteur?.trim()) && Boolean(numeroDestinataire?.trim())
}
