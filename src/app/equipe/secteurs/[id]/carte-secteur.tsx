'use client'

import { useEffect, useRef, useState } from 'react'

import { chargerPlaces, placesConfigure } from '@/lib/google-places'
import { cadreDuPolygone, type Point } from '@/lib/secteurs'

export type RueTracee = {
  id: string
  nom: string
  complete: boolean
  geometrie: Point[][]
}

/**
 * Carte de consultation d'un secteur : le polygone, et chaque rue en polyligne.
 *
 * Vert = faite, gris = à faire. Les tracés sont redessinés quand l'état des rues
 * change, pour suivre les cases cochées sans recharger la page.
 */
export function CarteSecteur({
  polygone,
  rues,
}: {
  polygone: Point[]
  rues: RueTracee[]
}) {
  const refCarte = useRef<HTMLDivElement>(null)
  const refInstance = useRef<google.maps.Map | null>(null)
  const refTraces = useRef<google.maps.Polyline[]>([])

  const [erreur, setErreur] = useState<string | null>(null)

  // Initialisation : une seule fois, le polygone ne bouge plus.
  useEffect(() => {
    let annule = false

    void (async () => {
      try {
        await chargerPlaces()
      } catch (e) {
        if (!annule) {
          setErreur(e instanceof Error ? e.message : 'Carte indisponible.')
        }
        return
      }

      if (annule || !refCarte.current) return

      const { Map } = (await google.maps.importLibrary(
        'maps',
      )) as google.maps.MapsLibrary

      if (annule || !refCarte.current) return

      const cadre = cadreDuPolygone(polygone)

      const carte = new Map(refCarte.current, {
        center: cadre
          ? { lat: (cadre.sud + cadre.nord) / 2, lng: (cadre.ouest + cadre.est) / 2 }
          : { lat: 45.4, lng: -72.73 },
        zoom: 15,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      })

      new google.maps.Polygon({
        paths: polygone,
        strokeColor: '#0e7ba6',
        strokeWeight: 2,
        fillColor: '#54c3ea',
        fillOpacity: 0.12,
        map: carte,
      })

      if (cadre) {
        carte.fitBounds(
          new google.maps.LatLngBounds(
            { lat: cadre.sud, lng: cadre.ouest },
            { lat: cadre.nord, lng: cadre.est },
          ),
        )
      }

      refInstance.current = carte
    })()

    return () => {
      annule = true
    }
  }, [polygone])

  // Tracés des rues : redessinés à chaque changement d'état.
  useEffect(() => {
    const carte = refInstance.current

    if (!carte) return

    for (const trace of refTraces.current) trace.setMap(null)
    refTraces.current = []

    for (const rue of rues) {
      for (const segment of rue.geometrie) {
        if (segment.length < 2) continue

        refTraces.current.push(
          new google.maps.Polyline({
            path: segment,
            // Une rue faite se voit d'un coup d'œil ; `brand` reste réservé aux
            // actions (CLAUDE.md §6), d'où le vert.
            strokeColor: rue.complete ? '#16a34a' : '#5a6b7b',
            strokeOpacity: rue.complete ? 0.95 : 0.55,
            strokeWeight: rue.complete ? 5 : 3,
            map: carte,
          }),
        )
      }
    }
  }, [rues])

  if (!placesConfigure()) {
    return (
      <p className="rounded-lg border border-grey-border bg-grey-light px-3 py-2 text-sm text-grey-text">
        Carte indisponible : clé Google absente du bundle.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {erreur && (
        <p role="alert" className="text-sm text-red-800">
          {erreur}
        </p>
      )}
      <div className="overflow-hidden rounded-2xl border border-grey-border">
        <div ref={refCarte} className="h-[45vh] min-h-64 w-full bg-grey-light" />
      </div>
    </div>
  )
}
