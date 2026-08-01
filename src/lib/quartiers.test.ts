import { describe, expect, it } from 'vitest'

import {
  RAYONS_PROPOSES,
  RAYON_DEFAUT,
  cadreVersPolygone,
  cercleVersPolygone,
  idAireOverpass,
  libelleRayon,
  lirePoint,
  lireQuartiers,
  lireRayon,
  recollerAnneau,
  requeteQuartiers,
  type ElementOsm,
} from './quartiers'
import { distanceMetres } from './doublons'

const GRANBY = { lat: 45.4, lng: -72.73 }

describe('requeteQuartiers', () => {
  it('interroge les quartiers ET les limites administratives', () => {
    const requete = requeteQuartiers(GRANBY.lat, GRANBY.lng)

    expect(requete).toContain('is_in(45.400000,-72.730000)')
    expect(requete).toContain('neighbourhood')
    expect(requete).toContain('admin_level')
    // Les chemins fermés comptent autant que les relations : beaucoup de
    // quartiers québécois sont de simples `way`.
    expect(requete).toContain('way(pivot.zones)')
    expect(requete).toContain('rel(pivot.zones)')
    expect(requete).toContain('out geom;')
  })
})

describe('idAireOverpass', () => {
  it('applique le décalage d’Overpass selon le type', () => {
    expect(idAireOverpass(12345, 'relation')).toBe(3_600_012_345)
    expect(idAireOverpass(12345, 'way')).toBe(2_400_012_345)
  })
})

describe('recollerAnneau', () => {
  it('rend un segment unique tel quel', () => {
    const segment = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 1, lng: 1 },
    ]

    expect(recollerAnneau([segment])).toEqual(segment)
  })

  it('recolle des tronçons donnés dans le désordre', () => {
    const a = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
    ]
    const b = [
      { lat: 1, lng: 1 },
      { lat: 0, lng: 1 },
    ]
    const milieu = [
      { lat: 1, lng: 0 },
      { lat: 1, lng: 1 },
    ]

    const anneau = recollerAnneau([a, b, milieu])

    expect(anneau).not.toBeNull()
    expect(anneau!.length).toBeGreaterThanOrEqual(4)
    expect(anneau![0]).toEqual({ lat: 0, lng: 0 })
  })

  it('retourne un tronçon dont seule la FIN rejoint le contour', () => {
    const a = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
    ]
    // Celui-ci part de (1,1) et finit sur (1,0) : il faut l'inverser.
    const b = [
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
    ]
    const c = [
      { lat: 1, lng: 1 },
      { lat: 0, lng: 1 },
    ]

    const anneau = recollerAnneau([a, b, c])

    expect(anneau).not.toBeNull()
    expect(anneau).toContainEqual({ lat: 0, lng: 1 })
  })

  it('renvoie null plutôt qu’une forme fausse quand ça ne se recolle pas', () => {
    // Deux tronçons qui ne se touchent nulle part.
    const anneau = recollerAnneau([
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      [
        { lat: 50, lng: 50 },
        { lat: 51, lng: 50 },
      ],
    ])

    expect(anneau).toBeNull()
  })

  it('ignore les tronçons dégénérés et tolère le vide', () => {
    expect(recollerAnneau([])).toBeNull()
    expect(recollerAnneau([[{ lat: 0, lng: 0 }]])).toBeNull()
  })
})

describe('cadreVersPolygone', () => {
  it('renvoie les quatre coins', () => {
    const cadre = cadreVersPolygone([
      { lat: 45, lng: -73 },
      { lat: 46, lng: -72 },
    ])

    expect(cadre).toEqual([
      { lat: 45, lng: -73 },
      { lat: 46, lng: -73 },
      { lat: 46, lng: -72 },
      { lat: 45, lng: -72 },
    ])
  })

  it('renvoie null sur une liste vide', () => {
    expect(cadreVersPolygone([])).toBeNull()
  })
})

describe('lireQuartiers', () => {
  const CARRE = [
    { lat: 45.4, lon: -72.74 },
    { lat: 45.41, lon: -72.74 },
    { lat: 45.41, lon: -72.72 },
    { lat: 45.4, lon: -72.72 },
  ]

  function way(id: number, tags: Record<string, string>): ElementOsm {
    return { type: 'way', id, tags, geometry: CARRE }
  }

  it('lit un chemin fermé tagué quartier', () => {
    const quartiers = lireQuartiers([
      way(1, { name: 'Quartier des Érables', place: 'neighbourhood' }),
    ])

    expect(quartiers).toHaveLength(1)
    expect(quartiers[0]).toMatchObject({
      osmId: 1,
      osmType: 'way',
      nom: 'Quartier des Érables',
      categorie: 'Quartier',
      approximatif: false,
    })
    // Overpass dit `lon`, la carte dit `lng`.
    expect(quartiers[0].polygone[0]).toEqual({ lat: 45.4, lng: -72.74 })
  })

  it('écarte les zones sans nom : on ne choisit pas entre deux entrées vides', () => {
    expect(lireQuartiers([way(1, { place: 'neighbourhood' })])).toEqual([])
  })

  it('met le plus PRÉCIS en premier — on cherche un secteur, pas une ville', () => {
    const quartiers = lireQuartiers([
      way(1, { name: 'Granby', boundary: 'administrative', admin_level: '8' }),
      way(2, { name: 'Quartier Nord', place: 'neighbourhood' }),
      way(3, { name: 'Arrondissement Ouest', place: 'borough' }),
    ])

    expect(quartiers.map((q) => q.nom)).toEqual([
      'Quartier Nord',
      'Arrondissement Ouest',
      'Granby',
    ])
  })

  it('recolle les membres « outer » d’une relation et ignore les « inner »', () => {
    const relation: ElementOsm = {
      type: 'relation',
      id: 7,
      tags: { name: 'Vieux-Granby', place: 'suburb' },
      members: [
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 45.4, lon: -72.74 },
            { lat: 45.41, lon: -72.74 },
          ],
        },
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 45.41, lon: -72.74 },
            { lat: 45.41, lon: -72.72 },
          ],
        },
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 45.41, lon: -72.72 },
            { lat: 45.4, lon: -72.72 },
          ],
        },
        // Un trou intérieur : ne doit pas entrer dans le contour.
        {
          type: 'way',
          role: 'inner',
          geometry: [
            { lat: 10, lon: 10 },
            { lat: 11, lon: 10 },
          ],
        },
      ],
    }

    const quartiers = lireQuartiers([relation])

    expect(quartiers).toHaveLength(1)
    expect(quartiers[0].approximatif).toBe(false)
    // Le trou est resté dehors : aucune coordonnée aberrante.
    expect(quartiers[0].polygone.every((p) => p.lat < 46)).toBe(true)
  })

  it('retombe sur le cadre englobant et le SIGNALE quand ça ne se recolle pas', () => {
    const relation: ElementOsm = {
      type: 'relation',
      id: 8,
      tags: { name: 'Quartier éclaté', place: 'neighbourhood' },
      members: [
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 45.4, lon: -72.74 },
            { lat: 45.41, lon: -72.74 },
          ],
        },
        // Morceau détaché : impossible de fermer l'anneau.
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 45.5, lon: -72.6 },
            { lat: 45.51, lon: -72.6 },
          ],
        },
      ],
    }

    const quartiers = lireQuartiers([relation])

    expect(quartiers[0].approximatif).toBe(true)
    expect(quartiers[0].polygone).toHaveLength(4)
  })

  it('ne propose pas deux fois la même zone', () => {
    const quartiers = lireQuartiers([
      way(1, { name: 'Quartier Nord', place: 'neighbourhood' }),
      way(1, { name: 'Quartier Nord', place: 'neighbourhood' }),
    ])

    expect(quartiers).toHaveLength(1)
  })

  it('tolère une réponse vide ou inexploitable', () => {
    expect(lireQuartiers([])).toEqual([])
    expect(lireQuartiers([{ type: 'node', id: 1, tags: { name: 'X' } }])).toEqual([])
  })
})

describe('cercleVersPolygone', () => {
  it('produit un polygone dont chaque sommet est à la bonne distance', () => {
    const polygone = cercleVersPolygone(GRANBY, 500)

    expect(polygone).toHaveLength(32)

    for (const sommet of polygone) {
      const distance = distanceMetres(
        { latitude: GRANBY.lat, longitude: GRANBY.lng },
        { latitude: sommet.lat, longitude: sommet.lng },
      )

      // 1 % de tolérance : l'approximation sphérique locale suffit largement.
      expect(distance).toBeGreaterThan(495)
      expect(distance).toBeLessThan(505)
    }
  })

  it('corrige la longitude par la latitude — sinon le cercle serait un ovale', () => {
    const polygone = cercleVersPolygone(GRANBY, 500, 4)

    const ecartLat = Math.abs(polygone[0].lat - GRANBY.lat)
    const ecartLng = Math.abs(polygone[1].lng - GRANBY.lng)

    // À 45° de latitude, un degré de longitude est ~1,4 fois plus court : le
    // delta en longitude doit donc être plus GRAND que celui en latitude.
    expect(ecartLng).toBeGreaterThan(ecartLat * 1.3)
  })

  it('reste valide comme polygone', () => {
    expect(cercleVersPolygone(GRANBY, 300).length).toBeGreaterThanOrEqual(3)
  })
})

describe('lireRayon', () => {
  it('accepte les rayons proposés', () => {
    for (const rayon of RAYONS_PROPOSES) {
      expect(lireRayon(rayon)).toBe(rayon)
      expect(lireRayon(String(rayon))).toBe(rayon)
    }
  })

  it('refuse tout le reste — pas de rayon de 50 km par requête forgée', () => {
    expect(lireRayon(50000)).toBe(RAYON_DEFAUT)
    expect(lireRayon('abc')).toBe(RAYON_DEFAUT)
    expect(lireRayon(null)).toBe(RAYON_DEFAUT)
    expect(lireRayon(-300)).toBe(RAYON_DEFAUT)
  })
})

describe('libelleRayon', () => {
  it('passe en kilomètres au-delà de 1000 m', () => {
    expect(libelleRayon(300)).toBe('300 m')
    expect(libelleRayon(1000)).toBe('1 km')
  })
})

describe('lirePoint', () => {
  it('accepte des coordonnées valides, en nombre comme en texte', () => {
    expect(lirePoint(45.4, -72.73)).toEqual({ lat: 45.4, lng: -72.73 })
    expect(lirePoint('45.4', '-72.73')).toEqual({ lat: 45.4, lng: -72.73 })
  })

  it('refuse ce qui n’est pas une coordonnée', () => {
    expect(lirePoint('abc', 0)).toBeNull()
    expect(lirePoint(91, 0)).toBeNull()
    expect(lirePoint(0, 181)).toBeNull()
  })

  it('ne transforme PAS un paramètre manquant en point (0, 0)', () => {
    // `Number(null)` et `Number('')` valent 0 : sans filtre explicite, on
    // chercherait des quartiers au large de l'Afrique.
    expect(lirePoint(null, null)).toBeNull()
    expect(lirePoint(undefined, undefined)).toBeNull()
    expect(lirePoint('', '')).toBeNull()
    expect(lirePoint('  ', '  ')).toBeNull()
    expect(lirePoint([], [])).toBeNull()
    expect(lirePoint(45.4, null)).toBeNull()
  })
})
