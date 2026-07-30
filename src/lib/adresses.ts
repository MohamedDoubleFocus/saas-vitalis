/**
 * Extraction d'une adresse structurée depuis les composantes de Google Places.
 *
 * Partie pure et testée : c'est de la manipulation de listes de composantes, et
 * c'est exactement là que les bugs se cachent (Places ne renvoie pas les mêmes
 * types selon les municipalités québécoises).
 */

/** Une composante telle que la renvoie `Place.addressComponents`. */
export type ComposanteAdresse = {
  longText: string | null
  shortText: string | null
  types: string[]
}

export type AdresseStructuree = {
  /** Numéro civique + voie. C'est ce qui part dans `opportunites.adresse`. */
  adresse: string
  ville: string | null
  codePostal: string | null
}

function premiere(
  composantes: readonly ComposanteAdresse[],
  types: readonly string[],
): ComposanteAdresse | undefined {
  for (const type of types) {
    const trouvee = composantes.find((c) => c.types.includes(type))

    if (trouvee) return trouvee
  }

  return undefined
}

/**
 * Types candidats pour la ville, du plus précis au plus large.
 *
 * `locality` couvre la majorité des cas, mais Places renvoie parfois seulement
 * `administrative_area_level_3` (municipalités fusionnées) ou une `sublocality`
 * (arrondissements de Montréal). On dégrade dans cet ordre plutôt que de rendre
 * `null` et de perdre l'information.
 */
const TYPES_VILLE = [
  'locality',
  'postal_town',
  'administrative_area_level_3',
  'sublocality',
  'sublocality_level_1',
] as const

/**
 * @param composantes Composantes renvoyées par Places.
 * @param adresseFormatee Repli si le numéro civique ou la voie manquent
 *   (`Place.formattedAddress`).
 */
export function extraireAdresse(
  composantes: readonly ComposanteAdresse[],
  adresseFormatee?: string | null,
): AdresseStructuree {
  const numero = premiere(composantes, ['street_number'])
  const voie = premiere(composantes, ['route'])
  const ville = premiere(composantes, TYPES_VILLE)
  const codePostal = premiere(composantes, ['postal_code'])

  const rue = [numero?.longText, voie?.longText].filter(Boolean).join(' ').trim()

  return {
    // Sans numéro ni voie (adresse rurale, lieu-dit), on garde le premier
    // segment de l'adresse formatée : mieux vaut « Rang 4 » que rien du tout.
    adresse: rue || premierSegment(adresseFormatee) || '',
    ville: ville?.longText ?? null,
    codePostal: codePostal?.longText ?? null,
  }
}

function premierSegment(adresseFormatee?: string | null): string {
  if (!adresseFormatee) return ''

  return adresseFormatee.split(',')[0]?.trim() ?? ''
}

/** Libellé d'une adresse sur une ligne : « 12 Rue Principale, Granby ». */
export function libelleAdresse(adresse: AdresseStructuree): string {
  return [adresse.adresse, adresse.ville].filter(Boolean).join(', ')
}
