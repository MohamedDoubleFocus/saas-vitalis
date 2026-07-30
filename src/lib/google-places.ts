import { extraireAdresse, type AdresseStructuree } from './adresses'

/**
 * Enveloppe du SDK Google Maps / Places (API « nouvelle génération »).
 *
 * Uniquement côté navigateur. Toutes les fonctions peuvent échouer — clé absente,
 * réseau coupé, quota dépassé — et l'appelant DOIT prévoir la saisie manuelle :
 * un knocker hors réseau doit pouvoir enregistrer son lead quand même
 * (CLAUDE.md §5, « ne jamais perdre une saisie »).
 */

const NOM_CALLBACK = '__vitalisMapsPret'

let promesseChargement: Promise<void> | null = null

/** Vrai si la clé publique est configurée. */
export function placesConfigure(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
}

/**
 * Charge le SDK une seule fois.
 *
 * En cas d'échec, la promesse mémoïsée est effacée : un knocker qui repasse en
 * ligne doit pouvoir retenter, pas rester bloqué sur le premier échec.
 */
export function chargerPlaces(): Promise<void> {
  if (promesseChargement) return promesseChargement

  promesseChargement = new Promise<void>((resoudre, rejeter) => {
    if (typeof window === 'undefined') {
      rejeter(new Error('Google Places n’est disponible que dans le navigateur.'))
      return
    }

    const cle = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

    if (!cle) {
      rejeter(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY n’est pas configurée.'))
      return
    }

    // `typeof … === 'function'` et non `if (…)` : les types Google déclarent
    // `importLibrary` comme toujours définie, donc un test de vérité déclenche
    // TS2774 alors qu'au runtime le SDK peut ne pas être chargé du tout.
    const sdkDejaCharge =
      typeof window.google !== 'undefined' &&
      typeof window.google.maps !== 'undefined' &&
      typeof window.google.maps.importLibrary === 'function'

    if (sdkDejaCharge) {
      resoudre()
      return
    }

    const global = window as unknown as Record<string, unknown>

    global[NOM_CALLBACK] = () => {
      delete global[NOM_CALLBACK]
      resoudre()
    }

    const script = document.createElement('script')
    const parametres = new URLSearchParams({
      key: cle,
      libraries: 'places',
      language: 'fr-CA',
      region: 'CA',
      loading: 'async',
      v: 'weekly',
      callback: NOM_CALLBACK,
    })

    script.src = `https://maps.googleapis.com/maps/api/js?${parametres.toString()}`
    script.async = true
    script.onerror = () =>
      rejeter(new Error('Chargement de Google Places impossible (réseau ?).'))

    document.head.append(script)
  })

  return promesseChargement.catch((erreur) => {
    promesseChargement = null
    throw erreur
  })
}

export type SuggestionAdresse = {
  placeId: string
  /** Ligne principale : « 12 Rue Principale ». */
  texte: string
  /** Ligne secondaire : « Granby, QC, Canada ». */
  texteSecondaire: string | null
  /**
   * Conservée pour que `detaillerSuggestion()` réutilise le jeton de session
   * — Google facture la session entière au lieu de chaque requête.
   */
  prediction: google.maps.places.PlacePrediction
}

/**
 * Jeton de session Places.
 *
 * Un jeton = une saisie (plusieurs frappes) + un `fetchFields`. Créer un jeton
 * frais pour chaque nouveau lead ; réutiliser le même ferait facturer chaque
 * frappe séparément.
 */
export async function creerJetonSession(): Promise<google.maps.places.AutocompleteSessionToken> {
  await chargerPlaces()

  const { AutocompleteSessionToken } = (await google.maps.importLibrary(
    'places',
  )) as google.maps.PlacesLibrary

  return new AutocompleteSessionToken()
}

/**
 * Suggestions d'adresses pour une saisie partielle.
 *
 * Restreint au Canada et aux types « adresse civique » : le knocker cherche une
 * porte, pas un restaurant.
 */
export async function chercherAdresses(
  saisie: string,
  jeton?: google.maps.places.AutocompleteSessionToken,
): Promise<SuggestionAdresse[]> {
  const texte = saisie.trim()

  if (texte.length < 3) return []

  await chargerPlaces()

  const { AutocompleteSuggestion } = (await google.maps.importLibrary(
    'places',
  )) as google.maps.PlacesLibrary

  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: texte,
    sessionToken: jeton,
    includedRegionCodes: ['ca'],
    includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
    language: 'fr-CA',
    region: 'ca',
  })

  return suggestions
    .map((suggestion) => suggestion.placePrediction)
    .filter((prediction): prediction is google.maps.places.PlacePrediction =>
      Boolean(prediction),
    )
    .map((prediction) => ({
      placeId: prediction.placeId,
      texte: prediction.mainText?.text ?? prediction.text.text,
      texteSecondaire: prediction.secondaryText?.text ?? null,
      prediction,
    }))
}

export type AdresseSelectionnee = AdresseStructuree & {
  latitude: number | null
  longitude: number | null
  /** Adresse complète telle que formatée par Google, pour affichage. */
  adresseComplete: string | null
}

/**
 * Complète une suggestion : adresse structurée + coordonnées GPS.
 *
 * Le GPS est indispensable dès le stade lead (CLAUDE.md §4.5) : il débloque les
 * territoires, le tri géographique et la détection de doublons.
 */
export async function detaillerSuggestion(
  suggestion: SuggestionAdresse,
): Promise<AdresseSelectionnee> {
  await chargerPlaces()

  const lieu = suggestion.prediction.toPlace()

  await lieu.fetchFields({
    fields: ['addressComponents', 'location', 'formattedAddress'],
  })

  const composantes = (lieu.addressComponents ?? []).map((composante) => ({
    longText: composante.longText,
    shortText: composante.shortText,
    types: composante.types,
  }))

  const structuree = extraireAdresse(composantes, lieu.formattedAddress)

  return {
    ...structuree,
    // Repli sur le texte de la suggestion si Places ne renvoie pas de voie.
    adresse: structuree.adresse || suggestion.texte,
    latitude: lieu.location?.lat() ?? null,
    longitude: lieu.location?.lng() ?? null,
    adresseComplete: lieu.formattedAddress ?? null,
  }
}
