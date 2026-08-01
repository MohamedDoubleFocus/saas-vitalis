'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { chargerPlaces, placesConfigure } from '@/lib/google-places'
import { centreDe, couleurStatut, type PorteCarte } from '@/lib/equipe'
import { formaterHeure, lireDate } from '@/lib/echeances'
import { LIBELLES_STATUT } from '@/lib/statuts'

/** Centre de repli : Granby. Utilisé seulement quand aucune porte n'a de GPS. */
const CENTRE_DEFAUT = { lat: 45.4, lng: -72.73 }

/**
 * Rayon d'une pastille, converti en mètres pour qu'elle garde une taille
 * constante à l'écran.
 *
 * `Circle` raisonne en mètres, pas en pixels : sans cette conversion, une
 * pastille visible au zoom 17 deviendrait invisible au zoom 12.
 */
function rayonPastille(carte: google.maps.Map): number {
  const zoom = carte.getZoom() ?? 15
  const latitude = carte.getCenter()?.lat() ?? 45
  const metresParPixel =
    (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom

  return Math.max(1, 8 * metresParPixel)
}

function bulle(porte: PorteCarte): string {
  const visite = lireDate(porte.derniereVisite)

  // Contenu d'InfoWindow : Google l'insère en HTML. Les valeurs viennent de la
  // base (adresses saisies par des knockers), donc on échappe.
  const echapper = (texte: string) =>
    texte
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  return [
    `<div style="font-family:inherit;max-width:220px">`,
    `<strong>${echapper(porte.adresse)}</strong><br>`,
    `${echapper(LIBELLES_STATUT[porte.statut])}`,
    visite ? ` · ${echapper(formaterHeure(visite))}` : '',
    `<br><span style="color:#4a5b6b">${echapper(porte.nom)}</span>`,
    `</div>`,
  ].join('')
}

/**
 * Carte des portes cognées aujourd'hui par l'équipe.
 *
 * Pas de suivi GPS en temps réel — juste OÙ le travail a eu lieu. Le manager
 * lit une couverture de terrain, il ne surveille pas des personnes.
 *
 * Choix technique : des `Circle` plutôt que des marqueurs. `google.maps.Marker`
 * est déprécié, et `AdvancedMarkerElement` impose un `mapId` configuré côté
 * Google Cloud — une dépendance de plus pour un point de couleur. Le cercle est
 * une primitive stable de l'API, qui n'a jamais bougé.
 */
export function CartePortes({ portes }: { portes: PorteCarte[] }) {
  const refConteneur = useRef<HTMLDivElement>(null)
  const refCarte = useRef<google.maps.Map | null>(null)
  const refPastilles = useRef<google.maps.Circle[]>([])
  const refBulle = useRef<google.maps.InfoWindow | null>(null)

  const [pret, setPret] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  /** Redessine toutes les pastilles. Ne touche que des refs : stable. */
  const redessiner = useCallback(
    (carte: google.maps.Map, aPlacer: PorteCarte[]) => {
      for (const pastille of refPastilles.current) pastille.setMap(null)
      refPastilles.current = []

      const rayon = rayonPastille(carte)

      for (const porte of aPlacer) {
        const pastille = new google.maps.Circle({
          center: { lat: porte.latitude, lng: porte.longitude },
          radius: rayon,
          map: carte,
          fillColor: couleurStatut(porte.statut),
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          clickable: true,
          zIndex: 3,
        })

        pastille.addListener('click', () => {
          const infos = refBulle.current

          if (!infos) return

          infos.setContent(bulle(porte))
          infos.setPosition({ lat: porte.latitude, lng: porte.longitude })
          infos.open({ map: carte })
        })

        refPastilles.current.push(pastille)
      }
    },
    [],
  )

  useEffect(() => {
    let annule = false

    void (async () => {
      try {
        await chargerPlaces()
      } catch (e) {
        if (!annule) {
          setErreur(
            e instanceof Error ? e.message : 'Chargement de la carte impossible.',
          )
        }
        return
      }

      if (annule || !refConteneur.current) return

      const { Map } = (await google.maps.importLibrary(
        'maps',
      )) as google.maps.MapsLibrary

      // React réexécute les effets deux fois en développement : sans ce garde,
      // on créerait deux cartes superposées.
      if (annule || !refConteneur.current || refCarte.current) return

      const carte = new Map(refConteneur.current, {
        center: centreDe(portes) ?? CENTRE_DEFAUT,
        zoom: portes.length > 0 ? 14 : 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      })

      refCarte.current = carte
      refBulle.current = new google.maps.InfoWindow()

      // Les pastilles sont en mètres : leur rayon doit suivre le zoom pour
      // garder une taille constante à l'écran.
      carte.addListener('zoom_changed', () => redessiner(carte, portes))

      if (!annule) setPret(true)
    })()

    return () => {
      annule = true
    }
    // `portes` est volontairement absent : la carte n'est CRÉÉE qu'une fois. Le
    // second effet se charge de replacer les pastilles quand la liste change
    // (changement de filtre de knocker).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redessiner])

  // Replace les pastilles à chaque changement de liste, sans recréer la carte.
  useEffect(() => {
    const carte = refCarte.current

    if (!carte || !pret) return

    redessiner(carte, portes)

    const centre = centreDe(portes)

    if (centre) carte.setCenter(centre)
  }, [portes, pret, redessiner])

  if (!placesConfigure()) {
    return (
      <p
        role="status"
        className="rounded-lg border border-grey-border bg-grey-light px-3 py-2 text-sm text-grey-text"
      >
        Carte indisponible : <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> n’est
        pas dans le bundle. Ajoute-la puis <strong>redémarre le serveur</strong> —
        elle est inlinée à la compilation.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {erreur && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {erreur}
        </p>
      )}

      {/* La carte a besoin d'une hauteur explicite : sans elle, le conteneur
          fait 0 pixel et Google n'affiche rien. */}
      <div className="overflow-hidden rounded-2xl border border-grey-border">
        <div
          ref={refConteneur}
          className="h-[50vh] min-h-72 w-full bg-grey-light"
          role="application"
          aria-label="Carte des portes cognées aujourd’hui"
        />
      </div>

      {!pret && !erreur && (
        <p className="text-sm text-grey-text">Chargement de la carte…</p>
      )}
    </div>
  )
}
