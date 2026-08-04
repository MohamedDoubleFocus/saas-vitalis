/**
 * Mise en forme du rendez-vous tel qu'il apparaît dans Google Agenda.
 *
 * Isolé et pur : le titre est ce que le closer lit dans son agenda, souvent en
 * coup d'œil sur un téléphone entre deux visites. Il ne doit jamais dépendre
 * d'un champ vide.
 */

export type PartiesTitre = {
  clientNom: string | null
  closerNom: string | null
  /** Repli quand le client n'a pas encore de nom (lead au stade porte). */
  adresse: string | null
}

/**
 * « VITALIS- Jean Tremblay- Billal - »
 *
 * Format demandé par l'entreprise : préfixe de marque, client, closer.
 *
 * Les segments vides sont RETIRÉS, pas remplacés par du blanc : « VITALIS-  -
 * Billal » se lirait comme une donnée manquante alors que c'est simplement un
 * lead sans nom. On retombe alors sur l'adresse, puis sur « Client ».
 */
export function titreEvenementRdv(parties: PartiesTitre): string {
  const client =
    parties.clientNom?.trim() || parties.adresse?.trim() || 'Client'

  const closer = parties.closerNom?.trim()

  // Le tiret final fait partie du format demandé.
  return closer
    ? `VITALIS- ${client}- ${closer} -`
    : `VITALIS- ${client} -`
}
