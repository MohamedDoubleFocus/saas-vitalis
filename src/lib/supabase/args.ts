/**
 * Rétablit la nullabilité d'un argument de fonction Postgres.
 *
 * `supabase gen types` ne modélise pas la nullabilité des ARGUMENTS : il déclare
 * `p_superficie_pi2: number` et `p_date_cible_debut: string` alors que la
 * fonction accepte `NULL` pour les deux (seuls les paramètres munis d'un
 * `default` deviennent optionnels côté TypeScript).
 *
 * Envoyer `0` pi² ou une date bidon pour contourner le typage écrirait une
 * FAUSSE DONNÉE en base — une superficie de zéro, un chantier daté du 1er
 * janvier 1970. On garde donc `null` et on corrige le type ici.
 *
 * Isolé dans son propre module depuis qu'il sert à deux appelants
 * (`conclure_vente` depuis la file d'attente ET depuis la vente directe de
 * l'administration) : recopier un contournement de typage, c'est se garantir
 * d'en corriger un seul le jour où le générateur s'améliore.
 */
export function argNullable<T>(valeur: T | null): T {
  return valeur as T
}
