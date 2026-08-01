'use client'

import { Check, MapPin, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  chargerPlaces,
  chercherAdresses,
  creerJetonSession,
  detaillerSuggestion,
  placesConfigure,
  type SuggestionAdresse,
} from '@/lib/google-places'
import {
  RAYONS_PROPOSES,
  RAYON_DEFAUT,
  cercleVersPolygone,
  libelleRayon,
  type QuartierOsm,
} from '@/lib/quartiers'
import { cadreDuPolygone, type Point } from '@/lib/secteurs'

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

/** Délai avant d'interroger Places : évite une requête par frappe. */
const DELAI_FRAPPE_MS = 300

/** Centre par défaut : Granby. Recentré dès la première recherche. */
const CENTRE_DEFAUT = { lat: 45.4, lng: -72.73 }

type KnockerOption = {
  id: string
  nom: string
}

/** Ce qui définit le secteur : un quartier OSM, ou un cercle. */
type Zone =
  | { mode: 'quartier'; quartier: QuartierOsm }
  | { mode: 'rayon'; rayon: number }

type EtatQuartiers =
  | { statut: 'inactif' }
  | { statut: 'recherche' }
  | { statut: 'prets'; quartiers: QuartierOsm[] }
  | { statut: 'echec'; message: string }

/**
 * Création d'un secteur SANS tracé à la main.
 *
 * Le manager cherche une adresse, on lui propose les quartiers d'OpenStreetMap
 * qui contiennent ce point, il en tape un. La couverture OSM étant très inégale
 * au Québec, un rayon autour de l'adresse prend le relais quand rien n'est
 * trouvé — c'est un repli qui marche toujours, en un seul geste.
 *
 * Client Component : carte Google, recherche d'adresse au fil de la frappe et
 * aperçu immédiat du contour. Aucun équivalent serveur raisonnable.
 */
export function ChoixQuartier({ knockers }: { knockers: KnockerOption[] }) {
  const router = useRouter()

  const refConteneur = useRef<HTMLDivElement>(null)
  const refCarte = useRef<google.maps.Map | null>(null)
  const refContour = useRef<google.maps.Polygon | null>(null)
  const refMarqueur = useRef<google.maps.Circle | null>(null)
  const refJeton = useRef<google.maps.places.AutocompleteSessionToken | null>(null)

  const [pret, setPret] = useState(false)
  const [erreurCarte, setErreurCarte] = useState<string | null>(null)

  const [saisie, setSaisie] = useState('')
  const [suggestions, setSuggestions] = useState<SuggestionAdresse[]>([])
  const [adresse, setAdresse] = useState<{ texte: string; point: Point } | null>(null)

  const [quartiers, setQuartiers] = useState<EtatQuartiers>({ statut: 'inactif' })
  const [zone, setZone] = useState<Zone | null>(null)

  const [nom, setNom] = useState('')
  const [notes, setNotes] = useState('')
  const [knockerId, setKnockerId] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  /** Contour effectivement défini par la zone choisie. */
  const polygone: Point[] | null =
    zone === null || adresse === null
      ? null
      : zone.mode === 'quartier'
        ? zone.quartier.polygone
        : cercleVersPolygone(adresse.point, zone.rayon)

  // --- Carte ----------------------------------------------------------------
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

      if (annule || !refConteneur.current) return

      const { Map } = (await google.maps.importLibrary(
        'maps',
      )) as google.maps.MapsLibrary

      // React réexécute les effets deux fois en développement : sans ce garde,
      // on créerait deux cartes superposées.
      if (annule || !refConteneur.current || refCarte.current) return

      refCarte.current = new Map(refConteneur.current, {
        center: CENTRE_DEFAUT,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      })

      if (!annule) setPret(true)
    })()

    return () => {
      annule = true
    }
  }, [])

  /** Redessine le contour et recentre. */
  useEffect(() => {
    const carte = refCarte.current

    if (!carte || !pret) return

    refContour.current?.setMap(null)
    refContour.current = null

    if (!polygone || polygone.length < 3) return

    const contour = new google.maps.Polygon({
      paths: polygone,
      strokeColor: '#0e7ba6',
      strokeWeight: 3,
      fillColor: '#54c3ea',
      fillOpacity: 0.25,
      clickable: false,
      map: carte,
    })

    refContour.current = contour

    const cadre = cadreDuPolygone(polygone)

    if (cadre) {
      carte.fitBounds(
        new google.maps.LatLngBounds(
          { lat: cadre.sud, lng: cadre.ouest },
          { lat: cadre.nord, lng: cadre.est },
        ),
        24,
      )
    }
  }, [polygone, pret])

  /** Pastille sur l'adresse cherchée : le repère du manager. */
  useEffect(() => {
    const carte = refCarte.current

    if (!carte || !pret) return

    refMarqueur.current?.setMap(null)
    refMarqueur.current = null

    if (!adresse) return

    refMarqueur.current = new google.maps.Circle({
      center: adresse.point,
      // 25 m : visible sans masquer le quartier.
      radius: 25,
      map: carte,
      fillColor: '#111418',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      clickable: false,
      zIndex: 5,
    })
  }, [adresse, pret])

  // --- Recherche d'adresse --------------------------------------------------
  const texte = saisie.trim()
  const suggestionsAffichees = texte.length < 3 || adresse ? [] : suggestions

  useEffect(() => {
    if (adresse || texte.length < 3) return

    let annule = false

    const minuteur = setTimeout(async () => {
      try {
        // Un jeton par secteur créé : Google facture la session, pas la frappe.
        refJeton.current ??= await creerJetonSession()

        const resultats = await chercherAdresses(texte, refJeton.current)

        if (!annule) setSuggestions(resultats)
      } catch {
        if (!annule) setSuggestions([])
      }
    }, DELAI_FRAPPE_MS)

    return () => {
      annule = true
      clearTimeout(minuteur)
    }
  }, [texte, adresse])

  const chercherQuartiers = useCallback(async (point: Point) => {
    setQuartiers({ statut: 'recherche' })

    try {
      const reponse = await fetch(
        `/api/quartiers?lat=${point.lat}&lng=${point.lng}`,
        { cache: 'no-store' },
      )

      const donnees = (await reponse.json()) as {
        quartiers?: QuartierOsm[]
        erreur?: string
      }

      if (!reponse.ok) {
        setQuartiers({
          statut: 'echec',
          message: donnees.erreur ?? 'OpenStreetMap n’a pas répondu.',
        })
        return
      }

      setQuartiers({ statut: 'prets', quartiers: donnees.quartiers ?? [] })
    } catch {
      setQuartiers({
        statut: 'echec',
        message: 'Réseau indisponible. Utilise un rayon autour de l’adresse.',
      })
    }
  }, [])

  async function choisirAdresse(suggestion: SuggestionAdresse) {
    setSuggestions([])
    setSaisie(suggestion.texte)
    setZone(null)

    try {
      const detail = await detaillerSuggestion(suggestion)

      // Le jeton est consommé par `fetchFields` : la prochaine recherche en aura
      // un neuf.
      refJeton.current = null

      if (detail.latitude === null || detail.longitude === null) {
        setErreur('Cette adresse n’a pas de coordonnées. Essaie une adresse voisine.')
        return
      }

      const point = { lat: detail.latitude, lng: detail.longitude }

      setAdresse({ texte: suggestion.texte, point })
      setErreur(null)
      refCarte.current?.setCenter(point)
      refCarte.current?.setZoom(14)

      await chercherQuartiers(point)
    } catch {
      setErreur('Impossible de récupérer cette adresse. Réessaie.')
    }
  }

  function recommencer() {
    setAdresse(null)
    setSaisie('')
    setSuggestions([])
    setQuartiers({ statut: 'inactif' })
    setZone(null)
    setNom('')
  }

  function choisirQuartier(quartier: QuartierOsm) {
    setZone({ mode: 'quartier', quartier })
    // Nom pré-rempli, modifiable : c'est presque toujours le bon.
    setNom((actuel) => (actuel.trim() === '' ? quartier.nom : actuel))
  }

  function choisirRayon(rayon: number) {
    setZone({ mode: 'rayon', rayon })
    setNom((actuel) =>
      actuel.trim() === '' && adresse
        ? `${adresse.texte} — ${libelleRayon(rayon)}`
        : actuel,
    )
  }

  async function enregistrer() {
    if (!zone || !adresse || !polygone) return

    if (!nom.trim()) {
      setErreur('Donne un nom au secteur.')
      return
    }

    setEnvoi(true)
    setErreur(null)

    try {
      const reponse = await fetch('/api/secteurs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: nom.trim(),
          notes: notes.trim(),
          knockerId: knockerId || null,
          ...(zone.mode === 'quartier'
            ? {
                osmId: zone.quartier.osmId,
                osmType: zone.quartier.osmType,
                polygone: zone.quartier.polygone,
              }
            : { centre: adresse.point, rayon: zone.rayon }),
        }),
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

      router.push(`/equipe/secteurs/${donnees.secteurId}${suffixe}`)
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
        <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> n’est pas dans le bundle.
        Ajoute-la puis <strong>redémarre le serveur</strong> — elle est inlinée à
        la compilation.
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

      {/* --- 1. L'adresse --------------------------------------------------- */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-navy">
          <Search className="size-5 text-grey-text" aria-hidden />
          Où veux-tu envoyer ton knocker&nbsp;?
        </h2>

        {adresse ? (
          <div className="mt-3 rounded-lg border border-grey-border bg-grey-light p-3">
            <p className="flex items-start gap-2 font-medium text-navy">
              <MapPin className="mt-0.5 size-5 shrink-0 text-grey-text" aria-hidden />
              {adresse.texte}
            </p>
            <button
              type="button"
              onClick={recommencer}
              className="mt-2 min-h-11 text-sm font-semibold text-brand-strong underline"
            >
              Chercher une autre adresse
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <label className="sr-only" htmlFor="recherche">
              Adresse ou quartier
            </label>
            <input
              id="recherche"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              placeholder="Une adresse dans le quartier visé…"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="search"
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
                      onClick={() => void choisirAdresse(suggestion)}
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

            <p className="text-xs text-grey-text">
              N’importe quelle adresse du quartier suffit : elle sert seulement à
              savoir où chercher.
            </p>
          </div>
        )}
      </section>

      {/* --- 2. La zone ------------------------------------------------------ */}
      {adresse && (
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-navy">
            Quel secteur&nbsp;?
          </h2>

          {quartiers.statut === 'recherche' && (
            <p className="mt-3 text-sm text-grey-text">
              Recherche des quartiers autour de cette adresse…
            </p>
          )}

          {quartiers.statut === 'echec' && (
            <p className="mt-3 text-sm text-grey-text">{quartiers.message}</p>
          )}

          {quartiers.statut === 'prets' && quartiers.quartiers.length === 0 && (
            <p className="mt-3 text-sm text-grey-text">
              OpenStreetMap ne connaît aucun quartier ici — c’est fréquent hors
              des grands centres. Choisis un rayon ci-dessous.
            </p>
          )}

          {quartiers.statut === 'prets' && quartiers.quartiers.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {quartiers.quartiers.map((quartier) => {
                const actif =
                  zone?.mode === 'quartier' &&
                  zone.quartier.osmId === quartier.osmId &&
                  zone.quartier.osmType === quartier.osmType

                return (
                  <li key={`${quartier.osmType}/${quartier.osmId}`}>
                    <button
                      type="button"
                      onClick={() => choisirQuartier(quartier)}
                      aria-pressed={actif}
                      className={`flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                        actif
                          ? 'border-brand bg-brand/10'
                          : 'border-grey-border bg-white hover:bg-grey-light'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-base font-semibold ${
                            actif ? 'text-brand-strong' : 'text-navy'
                          }`}
                        >
                          {quartier.nom}
                        </span>
                        <span className="block text-xs text-grey-text">
                          {quartier.categorie}
                          {quartier.approximatif && ' · contour approximatif'}
                        </span>
                      </span>

                      {actif && (
                        <Check className="size-6 shrink-0 text-brand-strong" aria-hidden />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Le rayon reste toujours proposé : même quand OSM connaît le
              quartier, il peut être trop grand pour une journée de porte. */}
          <div className="mt-4 border-t border-grey-border pt-3">
            <p className="text-sm font-semibold text-navy">
              Ou simplement un rayon autour de l’adresse
            </p>
            <ul className="mt-2 flex gap-2">
              {RAYONS_PROPOSES.map((rayon) => {
                const actif = zone?.mode === 'rayon' && zone.rayon === rayon

                return (
                  <li key={rayon} className="flex-1">
                    <button
                      type="button"
                      onClick={() => choisirRayon(rayon)}
                      aria-pressed={actif}
                      className={`flex h-11 w-full items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${
                        actif
                          ? 'border-brand bg-brand/10 text-brand-strong'
                          : 'border-grey-border bg-white text-navy hover:bg-grey-light'
                      }`}
                    >
                      {libelleRayon(rayon)}
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="mt-1 text-xs text-grey-text">
              Défaut conseillé : {libelleRayon(RAYON_DEFAUT)}.
            </p>
          </div>
        </section>
      )}

      {/* --- La carte -------------------------------------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-grey-border">
        <div
          ref={refConteneur}
          className="h-[45vh] min-h-72 w-full bg-grey-light"
          role="application"
          aria-label="Aperçu du secteur"
        />
      </div>

      {!pret && !erreurCarte && (
        <p className="text-sm text-grey-text">Chargement de la carte…</p>
      )}

      {/* --- 3. Nom et attribution ------------------------------------------- */}
      {zone && (
        <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-navy">
            Nommer et attribuer
          </h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="nom" className="text-sm font-semibold text-navy">
              Nom du secteur
            </label>
            <input
              id="nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              autoComplete="off"
              className={CLASSE_CHAMP}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="knocker" className="text-sm font-semibold text-navy">
              Knocker
            </label>
            <select
              id="knocker"
              value={knockerId}
              onChange={(e) => setKnockerId(e.target.value)}
              className={CLASSE_CHAMP}
            >
              <option value="">— Attribuer plus tard —</option>
              {knockers.map((knocker) => (
                <option key={knocker.id} value={knocker.id}>
                  {knocker.nom}
                </option>
              ))}
            </select>
            {knockers.length === 0 && (
              <p className="text-xs text-grey-text">
                Aucun knocker ne t’est rattaché. Un administrateur doit t’en
                assigner depuis « Utilisateurs ».
              </p>
            )}
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
            disabled={envoi || !nom.trim()}
            className="h-12 rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong disabled:opacity-50"
          >
            {envoi ? 'Récupération des rues…' : 'Créer le secteur'}
          </button>

          <p className="text-xs text-grey-text">
            Les rues sont récupérées depuis OpenStreetMap. Ça peut prendre jusqu’à
            une minute.
          </p>
        </section>
      )}
    </div>
  )
}
