import { describe, expect, it } from 'vitest'

import {
  boiteEnglobante,
  distanceMetres,
  memeAdresse,
  normaliserAdresse,
  trouverDoublon,
  type OpportuniteProche,
} from './doublons'

function existante(
  partiel: Partial<OpportuniteProche> & { id: string; adresse: string },
): OpportuniteProche {
  return {
    ville: 'Granby',
    latitude: null,
    longitude: null,
    statut: 'absent',
    derniereVisite: '2026-07-12T20:00:00Z',
    nbVisites: 1,
    knockerId: 'k1',
    ...partiel,
  }
}

describe('normaliserAdresse', () => {
  it('efface accents, casse et ponctuation', () => {
    expect(normaliserAdresse('12, Rue des Érables')).toBe('12 rue des erables')
  })

  it('réduit les espaces multiples', () => {
    expect(normaliserAdresse('  12   rue   Principale  ')).toBe('12 rue principale')
  })

  it('unifie les abréviations de voie fr-CA', () => {
    expect(normaliserAdresse('12 Boul. St-Joseph')).toBe(
      normaliserAdresse('12 boulevard Saint-Joseph'),
    )
    expect(normaliserAdresse('40 Av. du Parc')).toBe(
      normaliserAdresse('40 avenue du Parc'),
    )
    expect(normaliserAdresse('8 Ch. des Pins')).toBe(
      normaliserAdresse('8 chemin des Pins'),
    )
  })

  it('rend une chaîne vide sur une entrée vide', () => {
    expect(normaliserAdresse('')).toBe('')
    expect(normaliserAdresse('   ')).toBe('')
  })
})

describe('distanceMetres', () => {
  it('vaut zéro pour un même point', () => {
    const p = { latitude: 45.4, longitude: -72.73 }

    expect(distanceMetres(p, p)).toBe(0)
  })

  it('mesure une courte distance de façon plausible', () => {
    // ~111 m par millième de degré de latitude.
    const d = distanceMetres(
      { latitude: 45.4, longitude: -72.73 },
      { latitude: 45.401, longitude: -72.73 },
    )

    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(118)
  })

  it('mesure une longue distance de façon plausible', () => {
    // Montréal → Québec : ~233 km.
    const d = distanceMetres(
      { latitude: 45.5019, longitude: -73.5674 },
      { latitude: 46.8139, longitude: -71.208 },
    )

    expect(d).toBeGreaterThan(225_000)
    expect(d).toBeLessThan(245_000)
  })

  it('est symétrique', () => {
    const a = { latitude: 45.4, longitude: -72.73 }
    const b = { latitude: 45.41, longitude: -72.74 }

    expect(distanceMetres(a, b)).toBeCloseTo(distanceMetres(b, a), 6)
  })
})

describe('memeAdresse', () => {
  it('reconnaît la même adresse écrite différemment', () => {
    expect(
      memeAdresse(
        { adresse: '12, Boul. St-Joseph', ville: 'Granby', latitude: null, longitude: null },
        existante({ id: 'o1', adresse: '12 boulevard Saint-Joseph' }),
      ),
    ).toBe(true)
  })

  it('ne confond pas deux numéros civiques', () => {
    expect(
      memeAdresse(
        { adresse: '14 rue Principale', ville: 'Granby', latitude: null, longitude: null },
        existante({ id: 'o1', adresse: '12 rue Principale' }),
      ),
    ).toBe(false)
  })

  it('ne confond pas la même rue dans deux villes', () => {
    expect(
      memeAdresse(
        { adresse: '12 rue Principale', ville: 'Magog', latitude: null, longitude: null },
        existante({ id: 'o1', adresse: '12 rue Principale', ville: 'Granby' }),
      ),
    ).toBe(false)
  })

  it('accepte le rapprochement quand une ville est inconnue', () => {
    expect(
      memeAdresse(
        { adresse: '12 rue Principale', ville: null, latitude: null, longitude: null },
        existante({ id: 'o1', adresse: '12 rue Principale', ville: 'Granby' }),
      ),
    ).toBe(true)
  })

  it('rapproche par GPS quand les libellés diffèrent', () => {
    expect(
      memeAdresse(
        {
          adresse: '12 Principale St',
          ville: 'Granby',
          latitude: 45.4,
          longitude: -72.73,
        },
        existante({
          id: 'o1',
          adresse: '12 rue Principale Ouest',
          latitude: 45.40005,
          longitude: -72.73003,
        }),
      ),
    ).toBe(true)
  })

  it('ne rapproche pas deux maisons voisines distinctes', () => {
    expect(
      memeAdresse(
        { adresse: '20 rue du Lac', ville: 'Granby', latitude: 45.4, longitude: -72.73 },
        existante({
          id: 'o1',
          adresse: '18 rue du Lac',
          // ~110 m plus loin : bien au-delà du seuil de 25 m.
          latitude: 45.401,
          longitude: -72.73,
        }),
      ),
    ).toBe(false)
  })

  it('ne conclut rien sans GPS ni libellé concordant', () => {
    expect(
      memeAdresse(
        { adresse: '12 Principale St', ville: 'Granby', latitude: null, longitude: null },
        existante({ id: 'o1', adresse: '12 rue Principale Ouest' }),
      ),
    ).toBe(false)
  })

  it('respecte un seuil personnalisé', () => {
    const candidat = {
      adresse: 'X',
      ville: 'Granby',
      latitude: 45.4,
      longitude: -72.73,
    }
    const voisine = existante({
      id: 'o1',
      adresse: 'Y',
      latitude: 45.4005,
      longitude: -72.73,
    })

    expect(memeAdresse(candidat, voisine, { seuilMetres: 25 })).toBe(false)
    expect(memeAdresse(candidat, voisine, { seuilMetres: 100 })).toBe(true)
  })

  it('ne rapproche pas deux adresses vides', () => {
    expect(
      memeAdresse(
        { adresse: '', ville: null, latitude: null, longitude: null },
        existante({ id: 'o1', adresse: '' }),
      ),
    ).toBe(false)
  })
})

describe('trouverDoublon', () => {
  const candidat = {
    adresse: '12 rue Principale',
    ville: 'Granby',
    latitude: 45.4,
    longitude: -72.73,
  }

  it('renvoie null quand la porte est neuve', () => {
    expect(
      trouverDoublon(candidat, [
        existante({ id: 'o1', adresse: '99 rue Ailleurs' }),
      ]),
    ).toBeNull()
  })

  it('renvoie null sur une base vide', () => {
    expect(trouverDoublon(candidat, [])).toBeNull()
  })

  it('renvoie la visite la plus récente en cas de plusieurs correspondances', () => {
    const doublon = trouverDoublon(candidat, [
      existante({
        id: 'ancienne',
        adresse: '12 rue Principale',
        derniereVisite: '2026-06-01T20:00:00Z',
      }),
      existante({
        id: 'recente',
        adresse: '12, Rue Principale',
        derniereVisite: '2026-07-20T20:00:00Z',
      }),
      existante({
        id: 'autre',
        adresse: '48 rue Ailleurs',
        derniereVisite: '2026-07-28T20:00:00Z',
      }),
    ])

    expect(doublon?.id).toBe('recente')
  })

  it('remonte l’information utile à la porte', () => {
    const doublon = trouverDoublon(candidat, [
      existante({
        id: 'o1',
        adresse: '12 rue Principale',
        statut: 'absent',
        nbVisites: 2,
        knockerId: 'k-marc',
      }),
    ])

    expect(doublon).toMatchObject({
      statut: 'absent',
      nbVisites: 2,
      knockerId: 'k-marc',
    })
  })
})

describe('boiteEnglobante', () => {
  it('encadre le point demandé', () => {
    const centre = { latitude: 45.4, longitude: -72.73 }
    const boite = boiteEnglobante(centre, 100)

    expect(boite.latMin).toBeLessThan(centre.latitude)
    expect(boite.latMax).toBeGreaterThan(centre.latitude)
    expect(boite.lonMin).toBeLessThan(centre.longitude)
    expect(boite.lonMax).toBeGreaterThan(centre.longitude)
  })

  it('contient tout point à l’intérieur du rayon', () => {
    const centre = { latitude: 45.4, longitude: -72.73 }
    const boite = boiteEnglobante(centre, 100)

    // Un point à ~50 m au nord-est.
    const proche = { latitude: 45.40032, longitude: -72.72955 }

    expect(distanceMetres(centre, proche)).toBeLessThan(100)
    expect(proche.latitude).toBeGreaterThan(boite.latMin)
    expect(proche.latitude).toBeLessThan(boite.latMax)
    expect(proche.longitude).toBeGreaterThan(boite.lonMin)
    expect(proche.longitude).toBeLessThan(boite.lonMax)
  })

  it('élargit la fenêtre de longitude avec la latitude', () => {
    // Un degré de longitude « vaut » moins de mètres près des pôles : la boîte
    // doit donc s'élargir en degrés pour couvrir le même rayon.
    const sud = boiteEnglobante({ latitude: 10, longitude: 0 }, 100)
    const nord = boiteEnglobante({ latitude: 60, longitude: 0 }, 100)

    expect(nord.lonMax - nord.lonMin).toBeGreaterThan(sud.lonMax - sud.lonMin)
  })
})
