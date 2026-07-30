'use client'

import { Check, MapPin, Trash2, Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import {
  chargerPlaces,
  chercherAdresses,
  detaillerSuggestion,
  placesConfigure,
  type SuggestionAdresse,
} from '@/lib/google-places'
import { polygoneValide, type Point } from '@/lib/secteurs'

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

const CLASSE_SECONDAIRE =
  'flex min-h-11 items-center justify-center gap-2 rounded-lg border border-grey-border bg-white px-4 text-sm font-semibold text-navy transition-colors hover:bg-grey-light disabled:opacity-50'

/** Centre par défaut : Granby. Recentré dès la première recherche d'adresse. */
const CENTRE_DEFAUT = { lat: 45.4, lng: -72.73 }

/**
 * Tracé d'un secteur sur une carte Google.
 *
 * ⚠️ `DrawingManager` a été RETIRÉ de l'API Maps en v3.65. Le tracé est donc
 * fait à la main : chaque clic sur la carte ajoute un sommet au `Polygon`, et
 * le polygone devient `editable` une fois fermé pour que les coins restent
 * déplaçables.
 *
 * Le double-clic ferme le tracé, comme dans l'ancien outil. Mais Google émet
 * `click`, `click`, PUIS `dblclick` : les deux clics du double auraient ajouté
 * deux sommets parasites, qu'on retire au moment de fermer. Un bouton
 * « Terminer » fait la même chose — indispensable sur mobile, où le double-tap
 * est le geste de zoom.
 */
export function CarteDessin() {
  const router = useRouter()

  const refCarte = useRef<HTMLDivElement>(null)
  const refPolygone = useRef<google.maps.Polygon | null>(null)
  const refChemin = useRef<google.maps.MVCArray<google.maps.LatLng> | null>(null)
  const refInstance = useRef<google.maps.Map | null>(null)
  /** Lu par les écouteurs Google, qui capturent l'état à leur création. */
  const refMode = useRef<'dessin' | 'termine'>('dessin')

  const [pret, setPret] = useState(false)
  const [erreurCarte, setErreurCarte] = useState<string | null>(null)
  const [sommets, setSommets] = useState<Point[]>([])
  const [mode, setMode] = useState<'dessin' | 'termine'>('dessin')

  const [recherche, setRecherche] = useState('')
  const [suggestions, setSuggestions] = useState<SuggestionAdresse[]>([])

  const [nom, setNom] = useState('')
  const [notes, setNotes] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  /** Recopie le chemin Google dans l'état React. */
  function relireSommets(chemin: google.maps.MVCArray<google.maps.LatLng>) {
    const points: Point[] = []

    for (let i = 0; i < chemin.getLength(); i++) {
      const sommet = chemin.getAt(i)
      points.push({ lat: sommet.lat(), lng: sommet.lng() })
    }

    setSommets(points)
  }

  useEffect(() => {
    let annule = false

    void (async () => {
      try {
        await chargerPlaces()
      } catch (e) {
        if (!annule) {
          setErreurCarte(
            e instanceof Error ? e.message : 'Chargement de la carte impossible.',
          )
        }
        return
      }

      if (annule || !refCarte.current) return

      const { Map } = (await google.maps.importLibrary(
        'maps',
      )) as google.maps.MapsLibrary

      // React réexécute les effets deux fois en développement : sans ce garde,
      // on créerait deux cartes et surtout DEUX écouteurs de clic, donc deux
      // sommets par clic.
      if (annule || !refCarte.current || refInstance.current) return

      const carte = new Map(refCarte.current, {
        center: CENTRE_DEFAUT,
        zoom: 16,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        // Sinon le double-clic de fermeture zoome au lieu de fermer le tracé.
        disableDoubleClickZoom: true,
      })

      refInstance.current = carte

      // ⚠️ On construit le chemin NOUS-MÊMES et on le passe au polygone.
      //
      // `paths: []` crée un polygone à ZÉRO chemin : `getPath()` renvoie alors
      // `undefined`, et tout ce qui suit explose. En possédant l'objet, on est
      // sûr qu'il existe — et on ne le remplace jamais par la suite, car
      // `setPath()` en créerait un nouveau et les écouteurs ci-dessous seraient
      // perdus en silence.
      const chemin = new google.maps.MVCArray<google.maps.LatLng>()

      const polygone = new google.maps.Polygon({
        paths: chemin,
        strokeColor: '#0e7ba6',
        strokeWeight: 3,
        fillColor: '#54c3ea',
        fillOpacity: 0.25,
        editable: false,
        map: carte,
      })

      refPolygone.current = polygone
      refChemin.current = chemin

      for (const evenement of ['set_at', 'insert_at', 'remove_at'] as const) {
        chemin.addListener(evenement, () => relireSommets(chemin))
      }

      carte.addListener('click', (evenement: google.maps.MapMouseEvent) => {
        if (refMode.current !== 'dessin' || !evenement.latLng) return

        chemin.push(evenement.latLng)
      })

      carte.addListener('dblclick', () => {
        if (refMode.current !== 'dessin') return

        // Les deux clics du double-clic viennent d'ajouter deux sommets au même
        // endroit : on les retire avant de fermer.
        for (let i = 0; i < 2 && chemin.getLength() > 0; i++) {
          chemin.removeAt(chemin.getLength() - 1)
        }

        if (chemin.getLength() >= 3) terminer()
      })

      if (!annule) setPret(true)
    })()

    return () => {
      annule = true
    }
    // Monté une seule fois : la carte et ses écouteurs vivent hors de React.
  }, [])

  /** Ferme le tracé et rend les coins déplaçables. */
  function terminer() {
    const polygone = refPolygone.current
    const chemin = refChemin.current

    if (!polygone || !chemin || chemin.getLength() < 3) return

    refMode.current = 'termine'
    setMode('termine')
    polygone.setEditable(true)
  }

  function reprendre() {
    refMode.current = 'dessin'
    setMode('dessin')
    refPolygone.current?.setEditable(false)
  }

  function annulerDernierPoint() {
    const chemin = refChemin.current

    if (!chemin || chemin.getLength() === 0) return

    chemin.removeAt(chemin.getLength() - 1)
  }

  function effacer() {
    refChemin.current?.clear()
    reprendre()
  }

  // --- Recherche d'adresse : recentre la carte -----------------------------
  useEffect(() => {
    const texte = recherche.trim()

    if (texte.length < 3) {
      return
    }

    let annule = false

    const minuteur = setTimeout(async () => {
      try {
        const resultats = await chercherAdresses(texte)

        if (!annule) setSuggestions(resultats)
      } catch {
        if (!annule) setSuggestions([])
      }
    }, 300)

    return () => {
      annule = true
      clearTimeout(minuteur)
    }
  }, [recherche])

  const suggestionsAffichees = recherche.trim().length < 3 ? [] : suggestions

  async function allerA(suggestion: SuggestionAdresse) {
    setSuggestions([])
    setRecherche(suggestion.texte)

    try {
      const adresse = await detaillerSuggestion(suggestion)

      if (adresse.latitude !== null && adresse.longitude !== null) {
        refInstance.current?.setCenter({
          lat: adresse.latitude,
          lng: adresse.longitude,
        })
        refInstance.current?.setZoom(17)
      }
    } catch {
      // Recentrage impossible : sans conséquence, l'admin peut naviguer à la main.
    }
  }

  async function enregistrer() {
    setErreur(null)

    if (!nom.trim()) {
      setErreur('Donne un nom au secteur.')
      return
    }

    if (!polygoneValide(sommets)) {
      setErreur('Trace un polygone d’au moins trois coins.')
      return
    }

    setEnvoi(true)

    try {
      const reponse = await fetch('/api/secteurs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: nom.trim(), notes: notes.trim(), polygone: sommets }),
      })

      const donnees = (await reponse.json()) as {
        secteurId?: string
        erreur?: string
        avertissement?: string
      }

      if (!reponse.ok || !donnees.secteurId) {
        setErreur(donnees.erreur ?? 'Création impossible.')
        return
      }

      const suffixe = donnees.avertissement
        ? `?avertissement=${encodeURIComponent(donnees.avertissement)}`
        : '?ok=cree'

      router.push(`/admin/secteurs/${donnees.secteurId}${suffixe}`)
    } catch {
      setErreur('Réseau indisponible. Réessaie.')
    } finally {
      setEnvoi(false)
    }
  }

  if (!placesConfigure()) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` n’est pas dans le bundle. Ajoute-la puis
        <strong> redémarre le serveur</strong> — elle est inlinée à la compilation.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {erreurCarte && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {erreurCarte}
        </p>
      )}

      {/* --- Recherche d'adresse -------------------------------------------
          Réutilise l'API Places « nouvelle génération » du formulaire de lead
          plutôt que le widget `Autocomplete` historique, lui aussi déprécié. */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="recherche"
          className="flex items-center gap-2 text-sm font-semibold text-navy"
        >
          <MapPin className="size-5 shrink-0 text-grey-text" aria-hidden />
          Aller à une adresse
        </label>
        <input
          id="recherche"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Quartier, rue, ville…"
          autoComplete="off"
          className={CLASSE_CHAMP}
        />

        {suggestionsAffichees.length > 0 && (
          <ul className="overflow-hidden rounded-lg border border-grey-border bg-white">
            {suggestionsAffichees.map((suggestion) => (
              <li
                key={suggestion.placeId}
                className="border-b border-grey-border last:border-0"
              >
                <button
                  type="button"
                  onClick={() => void allerA(suggestion)}
                  className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-grey-light"
                >
                  <span className="font-medium text-navy">{suggestion.texte}</span>
                  {suggestion.texteSecondaire && (
                    <span className="text-xs text-grey-text">
                      {suggestion.texteSecondaire}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* La carte a besoin d'une hauteur explicite : sans elle, le conteneur
          fait 0 pixel et Google n'affiche rien. */}
      <div className="overflow-hidden rounded-2xl border border-grey-border">
        <div ref={refCarte} className="h-[55vh] min-h-80 w-full bg-grey-light" />
      </div>

      <p className="text-sm text-grey-text">
        {!pret
          ? 'Chargement de la carte…'
          : mode === 'dessin'
            ? sommets.length === 0
              ? 'Touche chaque coin du secteur sur la carte.'
              : `${sommets.length} coin${sommets.length > 1 ? 's' : ''} — touche « Terminer » ou double-clique pour fermer.`
            : `Tracé fermé, ${sommets.length} coins. Fais glisser un coin pour l’ajuster.`}
      </p>

      <div className="flex flex-col gap-2 lg:flex-row">
        {mode === 'dessin' ? (
          <>
            <button
              type="button"
              onClick={terminer}
              disabled={sommets.length < 3}
              className={`${CLASSE_SECONDAIRE} lg:flex-1`}
            >
              <Check className="size-5" aria-hidden />
              Terminer le tracé
            </button>
            <button
              type="button"
              onClick={annulerDernierPoint}
              disabled={sommets.length === 0}
              className={`${CLASSE_SECONDAIRE} lg:flex-1`}
            >
              <Undo2 className="size-5" aria-hidden />
              Annuler le dernier coin
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={reprendre}
            className={`${CLASSE_SECONDAIRE} lg:flex-1`}
          >
            <Undo2 className="size-5" aria-hidden />
            Reprendre le tracé
          </button>
        )}

        <button
          type="button"
          onClick={effacer}
          disabled={sommets.length === 0}
          className={`${CLASSE_SECONDAIRE} lg:flex-1`}
        >
          <Trash2 className="size-5" aria-hidden />
          Tout effacer
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-card">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="nom" className="text-sm font-semibold text-navy">
            Nom du secteur
          </label>
          <input
            id="nom"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Centre-ville nord, Quartier des Érables…"
            autoComplete="off"
            className={CLASSE_CHAMP}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="notes" className="text-sm font-semibold text-navy">
            Notes (facultatif)
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-grey-border bg-white px-3 py-2 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>

        {erreur && (
          <p role="alert" className="text-sm font-semibold text-red-800">
            {erreur}
          </p>
        )}

        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={envoi || sommets.length < 3}
          className="h-12 rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong disabled:opacity-50"
        >
          {envoi
            ? 'Récupération des rues…'
            : sommets.length < 3
              ? 'Trace d’abord le secteur'
              : 'Enregistrer et importer les rues'}
        </button>

        <p className="text-xs text-grey-text">
          Les rues sont récupérées depuis OpenStreetMap. Ça peut prendre jusqu’à
          une minute.
        </p>
      </div>
    </div>
  )
}
