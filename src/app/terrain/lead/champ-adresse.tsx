'use client'

import { useEffect, useRef, useState } from 'react'

import {
  chercherAdresses,
  creerJetonSession,
  detaillerSuggestion,
  placesConfigure,
  type AdresseSelectionnee,
  type SuggestionAdresse,
} from '@/lib/google-places'

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

/** Délai avant d'interroger Places : évite une requête par frappe. */
const DELAI_FRAPPE_MS = 300

type Props = {
  /** Appelé quand une adresse est arrêtée (Places ou saisie manuelle). */
  onChoisie: (adresse: AdresseSelectionnee | null) => void
  adresseChoisie: AdresseSelectionnee | null
}

export function ChampAdresse({ onChoisie, adresseChoisie }: Props) {
  const [saisie, setSaisie] = useState('')
  const [suggestions, setSuggestions] = useState<SuggestionAdresse[]>([])
  const [recherche, setRecherche] = useState(false)
  const [manuel, setManuel] = useState(!placesConfigure())
  const [erreurPlaces, setErreurPlaces] = useState<string | null>(null)

  // Champs de la saisie manuelle.
  const [manuelAdresse, setManuelAdresse] = useState('')
  const [manuelVille, setManuelVille] = useState('')
  const [manuelCodePostal, setManuelCodePostal] = useState('')

  // Un jeton par lead : Google facture la session, pas la frappe.
  const refJeton = useRef<google.maps.places.AutocompleteSessionToken | null>(null)

  const texte = saisie.trim()
  /**
   * Sous trois caractères, on n'affiche rien — dérivé plutôt que stocké : vider
   * l'état depuis l'effet provoquerait un rendu en cascade.
   */
  const suggestionsAffichees = texte.length < 3 ? [] : suggestions

  useEffect(() => {
    if (manuel || adresseChoisie) return
    if (texte.length < 3) return

    let annule = false

    const minuteur = setTimeout(async () => {
      setRecherche(true)

      try {
        refJeton.current ??= await creerJetonSession()

        const resultats = await chercherAdresses(texte, refJeton.current)

        if (!annule) {
          setSuggestions(resultats)
          setErreurPlaces(null)
        }
      } catch {
        if (!annule) {
          // Hors ligne, quota, clé absente… On ne bloque pas : la saisie
          // manuelle prend le relais (CLAUDE.md §5).
          setSuggestions([])
          setErreurPlaces(
            'Recherche d’adresse indisponible. Saisis l’adresse à la main.',
          )
        }
      } finally {
        if (!annule) setRecherche(false)
      }
    }, DELAI_FRAPPE_MS)

    return () => {
      annule = true
      clearTimeout(minuteur)
    }
  }, [texte, manuel, adresseChoisie])

  async function selectionner(suggestion: SuggestionAdresse) {
    setSuggestions([])
    setRecherche(true)

    try {
      const adresse = await detaillerSuggestion(suggestion)

      // Le jeton est consommé par `fetchFields` : la prochaine adresse en aura
      // un neuf.
      refJeton.current = null
      onChoisie(adresse)
    } catch {
      setErreurPlaces(
        'Impossible de récupérer les détails de l’adresse. Saisis-la à la main.',
      )
      setManuel(true)
      setManuelAdresse(suggestion.texte)
    } finally {
      setRecherche(false)
    }
  }

  function validerManuel() {
    const adresse = manuelAdresse.trim()

    if (!adresse) return

    onChoisie({
      adresse,
      ville: manuelVille.trim() || null,
      codePostal: manuelCodePostal.trim() || null,
      // Pas de GPS en saisie manuelle : la détection de doublons se rabat sur la
      // comparaison textuelle, et les territoires géographiques ignoreront ce
      // lead jusqu'à ce qu'on le géocode.
      latitude: null,
      longitude: null,
      adresseComplete: null,
    })
  }

  function reinitialiser() {
    onChoisie(null)
    setSaisie('')
    setSuggestions([])
    setManuelAdresse('')
    setManuelVille('')
    setManuelCodePostal('')
    setManuel(!placesConfigure())
  }

  // --- Adresse arrêtée -----------------------------------------------------
  if (adresseChoisie) {
    return (
      <div className="rounded-lg border border-grey-border bg-grey-light p-3">
        <p className="font-medium text-navy">{adresseChoisie.adresse}</p>
        <p className="text-sm text-grey-text">
          {[adresseChoisie.ville, adresseChoisie.codePostal]
            .filter(Boolean)
            .join(' · ') || 'Ville non précisée'}
          {adresseChoisie.latitude === null && ' · sans GPS'}
        </p>
        <button
          type="button"
          onClick={reinitialiser}
          className="mt-2 min-h-11 text-sm font-semibold text-brand-strong underline"
        >
          Changer l’adresse
        </button>
      </div>
    )
  }

  // --- Saisie manuelle -----------------------------------------------------
  if (manuel) {
    return (
      <div className="flex flex-col gap-2">
        {/* Ne jamais tomber en saisie manuelle sans dire pourquoi : sinon on
            croit à un bug de l'autocomplete alors que c'est la configuration. */}
        {!placesConfigure() && (
          <p
            role="status"
            className="rounded-lg border border-grey-border bg-grey-light px-3 py-2 text-sm text-grey-text"
          >
            Recherche d’adresse désactivée : aucune clé Google n’est configurée.
            {process.env.NODE_ENV !== 'production' && (
              <span className="mt-1 block text-xs">
                Ajoute <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> dans{' '}
                <code>.env.local</code>, puis <strong>redémarre le serveur</strong>{' '}
                — cette variable est inlinée à la compilation, pas lue à
                l’exécution.
              </span>
            )}
          </p>
        )}
        <input
          value={manuelAdresse}
          onChange={(e) => setManuelAdresse(e.target.value)}
          placeholder="Numéro et rue"
          autoComplete="off"
          className={CLASSE_CHAMP}
          aria-label="Numéro et rue"
        />
        <div className="flex gap-2">
          <input
            value={manuelVille}
            onChange={(e) => setManuelVille(e.target.value)}
            placeholder="Ville"
            autoComplete="off"
            className={CLASSE_CHAMP}
            aria-label="Ville"
          />
          <input
            value={manuelCodePostal}
            onChange={(e) => setManuelCodePostal(e.target.value)}
            placeholder="Code postal"
            autoComplete="off"
            autoCapitalize="characters"
            className={CLASSE_CHAMP}
            aria-label="Code postal"
          />
        </div>

        <button
          type="button"
          onClick={validerManuel}
          disabled={!manuelAdresse.trim()}
          className="min-h-11 rounded-lg border border-grey-border px-4 text-sm font-semibold text-navy transition-colors hover:bg-grey-light disabled:opacity-50"
        >
          Utiliser cette adresse
        </button>

        {placesConfigure() && (
          <button
            type="button"
            onClick={() => {
              setManuel(false)
              setErreurPlaces(null)
            }}
            className="min-h-11 text-sm text-grey-text underline"
          >
            Revenir à la recherche d’adresse
          </button>
        )}
      </div>
    )
  }

  // --- Recherche Places ----------------------------------------------------
  return (
    <div className="flex flex-col gap-2">
      <input
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
        placeholder="Commence à taper l’adresse…"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="search"
        className={CLASSE_CHAMP}
        aria-label="Rechercher une adresse"
      />

      {recherche && <p className="text-sm text-grey-text">Recherche…</p>}

      {erreurPlaces && (
        <p role="alert" className="text-sm text-red-800">
          {erreurPlaces}
        </p>
      )}

      {suggestionsAffichees.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-grey-border bg-white">
          {suggestionsAffichees.map((suggestion) => (
            <li
              key={suggestion.placeId}
              className="border-b border-grey-border last:border-0"
            >
              {/* Cible pleine largeur, ≥ 44px : sélection en un tap au pouce. */}
              <button
                type="button"
                onClick={() => void selectionner(suggestion)}
                className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-grey-light"
              >
                <span className="font-medium text-navy">{suggestion.texte}</span>
                {suggestion.texteSecondaire && (
                  <span className="text-sm text-grey-text">
                    {suggestion.texteSecondaire}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setManuel(true)}
        className="min-h-11 self-start text-sm text-grey-text underline"
      >
        Saisir l’adresse à la main
      </button>
    </div>
  )
}
