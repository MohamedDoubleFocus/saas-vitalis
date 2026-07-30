'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { chargerPlaces, placesConfigure } from '@/lib/google-places'
import { polygoneValide, type Point } from '@/lib/secteurs'

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

/** Centre par défaut : Granby. Recentré dès la première recherche d'adresse. */
const CENTRE_DEFAUT = { lat: 45.4, lng: -72.73 }

/**
 * `@types/google.maps` déclare `DrawingManager` comme une classe VIDE : ni
 * constructeur, ni méthodes. On décrit donc ici la surface qu'on utilise
 * réellement, conforme à la documentation Google.
 */
type GestionnaireDessin = {
  setMap(carte: google.maps.Map | null): void
  setDrawingMode(mode: google.maps.drawing.OverlayType | null): void
}

type ConstructeurDessin = new (options: {
  drawingMode?: google.maps.drawing.OverlayType | null
  drawingControl?: boolean
  polygonOptions?: google.maps.PolygonOptions
}) => GestionnaireDessin

/**
 * Dessin d'un secteur sur une carte Google.
 *
 * Client Component par nécessité — l'API Maps est un SDK navigateur, il n'y a
 * pas d'équivalent serveur (CLAUDE.md §6).
 */
export function CarteDessin() {
  const router = useRouter()

  const refCarte = useRef<HTMLDivElement>(null)
  const refRecherche = useRef<HTMLInputElement>(null)
  const refPolygone = useRef<google.maps.Polygon | null>(null)
  const refGestionnaire = useRef<GestionnaireDessin | null>(null)

  const [pret, setPret] = useState(false)
  const [erreurCarte, setErreurCarte] = useState<string | null>(null)
  const [sommets, setSommets] = useState<Point[]>([])

  const [nom, setNom] = useState('')
  const [notes, setNotes] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  /** Relit les sommets depuis le polygone Google et les met dans l'état React. */
  function relireSommets(polygone: google.maps.Polygon) {
    const chemin = polygone.getPath()
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

      const { DrawingManager } = (await google.maps.importLibrary(
        'drawing',
      )) as unknown as { DrawingManager: ConstructeurDessin }

      if (annule || !refCarte.current) return

      const carte = new Map(refCarte.current, {
        center: CENTRE_DEFAUT,
        zoom: 15,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      })

      const gestionnaire = new DrawingManager({
        drawingMode: google.maps.drawing.OverlayType.POLYGON,
        drawingControl: false,
        polygonOptions: {
          strokeColor: '#0e7ba6',
          strokeWeight: 2,
          fillColor: '#54c3ea',
          fillOpacity: 0.25,
          editable: true,
        },
      })

      gestionnaire.setMap(carte)
      refGestionnaire.current = gestionnaire

      google.maps.event.addListener(
        gestionnaire,
        'polygoncomplete',
        (polygone: google.maps.Polygon) => {
          // Un seul secteur à la fois : le précédent tracé est retiré.
          refPolygone.current?.setMap(null)
          refPolygone.current = polygone

          // Le mode dessin se désactive, sinon un clic de plus démarre un
          // deuxième polygone par-dessus.
          gestionnaire.setDrawingMode(null)

          relireSommets(polygone)

          // Les coins restent déplaçables après coup : on suit les trois
          // événements du chemin pour garder l'état à jour.
          const chemin = polygone.getPath()
          for (const evenement of ['set_at', 'insert_at', 'remove_at'] as const) {
            google.maps.event.addListener(chemin, evenement, () =>
              relireSommets(polygone),
            )
          }
        },
      )

      // Recherche d'adresse : recentre la carte sur le bon quartier.
      if (refRecherche.current) {
        const { Autocomplete } = (await google.maps.importLibrary(
          'places',
        )) as google.maps.PlacesLibrary

        const recherche = new Autocomplete(refRecherche.current, {
          componentRestrictions: { country: 'ca' },
          fields: ['geometry'],
        })

        recherche.addListener('place_changed', () => {
          const lieu = recherche.getPlace()

          if (lieu.geometry?.viewport) {
            carte.fitBounds(lieu.geometry.viewport)
          } else if (lieu.geometry?.location) {
            carte.setCenter(lieu.geometry.location)
            carte.setZoom(17)
          }
        })
      }

      if (!annule) setPret(true)
    })()

    return () => {
      annule = true
    }
  }, [])

  function effacer() {
    refPolygone.current?.setMap(null)
    refPolygone.current = null
    setSommets([])
    refGestionnaire.current?.setDrawingMode(
      google.maps.drawing.OverlayType.POLYGON,
    )
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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="recherche" className="text-sm font-medium text-navy">
          Aller à une adresse
        </label>
        <input
          ref={refRecherche}
          id="recherche"
          type="text"
          placeholder="Quartier, rue, ville…"
          autoComplete="off"
          className={CLASSE_CHAMP}
        />
      </div>

      {/* La carte a besoin d'une hauteur explicite : sans elle, le conteneur
          fait 0 pixel et Google n'affiche rien. */}
      <div className="overflow-hidden rounded-2xl border border-grey-border">
        <div ref={refCarte} className="h-[55vh] min-h-80 w-full bg-grey-light" />
      </div>

      <p className="text-sm text-grey-text">
        {sommets.length === 0
          ? pret
            ? 'Clique les coins du secteur, puis double-clique pour fermer le tracé.'
            : 'Chargement de la carte…'
          : `${sommets.length} coins tracés — les points restent déplaçables.`}
      </p>

      {sommets.length > 0 && (
        <button
          type="button"
          onClick={effacer}
          className="min-h-11 rounded-lg border border-grey-border px-4 text-sm font-semibold text-navy transition-colors hover:bg-grey-light"
        >
          Effacer et recommencer
        </button>
      )}

      <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-card">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="nom" className="text-sm font-medium text-navy">
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
          <label htmlFor="notes" className="text-sm font-medium text-navy">
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
          <p role="alert" className="text-sm text-red-800">
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
