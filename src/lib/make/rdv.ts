import { isoAvecDecalage } from '@/lib/fuseau'
import { codeLangueExterne, type LangueClient } from '@/lib/langues'

/**
 * Charge utile envoyée au webhook Make quand un rendez-vous est booké.
 *
 * ⚠️ LES NOMS DE CHAMPS SONT UN CONTRAT. Ils sont mappés un par un dans le
 * scénario Make (`1.clientName`, `1.clientPhone`, `1.address`, `1.notes`,
 * `1.scheduledAt`). Renommer une clé ici casse le scénario **en silence** :
 * Make continuera de recevoir le webhook et créera une tâche avec un champ vide.
 * Toute modification doit être faite des deux côtés, en même temps.
 *
 * Entièrement pur : aucun réseau, aucune base. L'envoi vit dans `webhook.ts`.
 */

export type ContexteRdvMake = {
  /** Identifiant Vitalis — permet de retrouver l'opportunité depuis Make. */
  opportuniteId: string
  clientNom: string | null
  /** E.164, tel que stocké. */
  clientTel: string | null
  clientCourriel: string | null
  adresse: string
  ville: string | null
  codePostal: string | null
  dateRdv: Date
  dureeMinutes: number
  langue: LangueClient
  closerNom: string | null
  knockerNom: string | null
  /** Notes du knocker, déjà concaténées. */
  notes: string | null
}

export type ChargeRdvMake = {
  opportuniteId: string
  clientName: string
  clientPhone: string
  clientEmail: string
  address: string
  city: string
  postalCode: string
  scheduledAt: string
  durationMinutes: number
  langue: string
  closer: string
  knocker: string
  source: string
  notes: string
}

/**
 * Toutes les valeurs sont des chaînes, jamais `null`.
 *
 * Make traite un `null` et une clé absente différemment selon les modules, et
 * une tâche GHL avec « null » écrit dedans est pire qu'un champ vide. On
 * normalise ici, une fois.
 */
function texte(valeur: string | null | undefined): string {
  return valeur?.trim() || ''
}

/**
 * Construit la charge du webhook.
 *
 * `scheduledAt` porte le décalage explicite (`-04:00` l'été) : le champ « Due
 * Date » de Make est réglé sur America/Toronto, et une chaîne en `Z` l'aurait
 * obligé à reconvertir — un aller-retour de plus où se glisser une erreur de
 * quatre heures.
 */
export function chargeRdvMake(contexte: ContexteRdvMake): ChargeRdvMake {
  const adresseComplete = [
    contexte.adresse,
    contexte.ville,
    contexte.codePostal,
  ]
    .map((partie) => texte(partie))
    .filter(Boolean)
    .join(', ')

  return {
    opportuniteId: contexte.opportuniteId,
    clientName: texte(contexte.clientNom),
    clientPhone: texte(contexte.clientTel),
    clientEmail: texte(contexte.clientCourriel),
    // `address` reçoit la rue seule : le scénario la mappe sur Address → Street,
    // et `city` / `postalCode` ont leurs propres champs.
    address: texte(contexte.adresse),
    city: texte(contexte.ville),
    postalCode: texte(contexte.codePostal),
    scheduledAt: isoAvecDecalage(contexte.dateRdv),
    durationMinutes: contexte.dureeMinutes,
    langue: codeLangueExterne(contexte.langue),
    closer: texte(contexte.closerNom),
    knocker: texte(contexte.knockerNom),
    // Distingue ces leads de l'inbound dans GHL sans changer le scénario.
    source: 'Porte-à-porte',
    // Le corps de la tâche : adresse complète en tête, puis ce que le knocker a
    // noté. Le setter lit ça et rien d'autre.
    notes: [adresseComplete, texte(contexte.notes)].filter(Boolean).join('\n'),
  }
}
