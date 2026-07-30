import type { StatutOpp } from './doublons'

/** Libellés d'affichage des statuts d'opportunité. */
export const LIBELLES_STATUT: Record<StatutOpp, string> = {
  absent: 'Absent',
  refus: 'Refus',
  repasser: 'À repasser',
  rdv: 'Rendez-vous',
  vendu: 'Vendu',
  planifie: 'Planifié',
  en_cours: 'En cours',
  complete: 'Travaux terminés',
  facture: 'Facturé',
  paye: 'Payé',
  perdu: 'Perdu',
}

/**
 * Statuts qu'un knocker peut poser à la porte, dans l'ordre d'affichage du
 * sélecteur : du plus fréquent au plus rare.
 */
export const STATUTS_CONTACT: readonly StatutOpp[] = [
  'absent',
  'refus',
  'repasser',
  'rdv',
]

/** Ce que le knocker a vraiment vu à la porte — évite « Absent » vs « Refus ». */
export const AIDES_STATUT_CONTACT: Record<string, string> = {
  absent: 'Personne n’a répondu',
  refus: 'On a répondu, non merci',
  repasser: 'On a répondu, revenir plus tard',
  rdv: 'Rendez-vous pris',
}
