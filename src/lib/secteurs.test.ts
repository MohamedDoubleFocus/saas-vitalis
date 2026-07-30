import { describe, expect, it } from 'vitest'

import {
  cadreDuPolygone,
  fusionnerRues,
  normaliserNomRue,
  polygoneValide,
  polygoneVersOverpass,
  progressionSecteur,
  trierRuesSecteur,
  type VoieOverpass,
} from './secteurs'

function voie(nom: string, points: [number, number][]): VoieOverpass {
  return { nom, points: points.map(([lat, lng]) => ({ lat, lng })) }
}

const CARRE: [number, number][] = [
  [45.4, -72.73],
  [45.41, -72.73],
  [45.41, -72.72],
  [45.4, -72.72],
]

describe('normaliserNomRue', () => {
  it('rapproche les abréviations et les accents', () => {
    const attendu = 'boulevard saint denis'

    expect(normaliserNomRue('Boul. St-Denis')).toBe(attendu)
    expect(normaliserNomRue('boulevard Saint-Denis')).toBe(attendu)
    expect(normaliserNomRue('BOULEVARD SAINT DENIS')).toBe(attendu)
    expect(normaliserNomRue('Blvd St Denis')).toBe(attendu)
  })

  it('unifie les autres types de voie', () => {
    expect(normaliserNomRue('Av. du Parc')).toBe(normaliserNomRue('Avenue du Parc'))
    expect(normaliserNomRue('Ch. des Pins')).toBe(normaliserNomRue('Chemin des Pins'))
    expect(normaliserNomRue('Rg 4')).toBe(normaliserNomRue('Rang 4'))
  })

  it('distingue Sainte de Saint', () => {
    // « Ste-Foy » et « St-Foy » ne sont pas la même chose.
    expect(normaliserNomRue('Ste-Foy')).toBe('sainte foy')
    expect(normaliserNomRue('St-Foy')).toBe('saint foy')
    expect(normaliserNomRue('Ste-Foy')).not.toBe(normaliserNomRue('St-Foy'))
  })

  it('NE supprime PAS le type de voie', () => {
    // « Rue Principale » et « Boulevard Principale » coexistent dans beaucoup de
    // municipalités : les fusionner perdrait une vraie distinction.
    expect(normaliserNomRue('Rue Principale')).not.toBe(
      normaliserNomRue('Boulevard Principale'),
    )
  })

  it('efface la ponctuation et les espaces multiples', () => {
    expect(normaliserNomRue('  Rue   des   Érables  ')).toBe('rue des erables')
  })

  it('tolère une chaîne vide', () => {
    expect(normaliserNomRue('')).toBe('')
    expect(normaliserNomRue('   ')).toBe('')
  })
})

describe('fusionnerRues', () => {
  it('fusionne les segments d’une même rue', () => {
    const rues = fusionnerRues([
      voie('Rue Principale', [
        [45.4, -72.73],
        [45.401, -72.73],
      ]),
      voie('Rue Principale', [
        [45.402, -72.73],
        [45.403, -72.73],
      ]),
    ])

    expect(rues).toHaveLength(1)
    // Deux segments CONSERVÉS séparément : les concaténer tracerait un trait
    // fantôme entre les deux tronçons.
    expect(rues[0].geometrie).toHaveLength(2)
  })

  it('fusionne malgré des orthographes différentes', () => {
    const rues = fusionnerRues([
      voie('Boul. St-Denis', [
        [45.4, -72.73],
        [45.401, -72.73],
      ]),
      voie('Boulevard Saint-Denis', [
        [45.402, -72.73],
        [45.403, -72.73],
      ]),
    ])

    expect(rues).toHaveLength(1)
    // Le nom d'affichage est celui du premier segment rencontré.
    expect(rues[0].nom).toBe('Boul. St-Denis')
  })

  it('ne fusionne pas deux rues distinctes', () => {
    const rues = fusionnerRues([
      voie('Rue Principale', [
        [45.4, -72.73],
        [45.401, -72.73],
      ]),
      voie('Rue Wellington', [
        [45.4, -72.72],
        [45.401, -72.72],
      ]),
    ])

    expect(rues).toHaveLength(2)
  })

  it('écarte les segments sans nom', () => {
    const rues = fusionnerRues([
      voie('', [
        [45.4, -72.73],
        [45.401, -72.73],
      ]),
      voie('   ', [
        [45.4, -72.73],
        [45.401, -72.73],
      ]),
    ])

    expect(rues).toEqual([])
  })

  it('écarte un segment d’un seul point — impossible à tracer', () => {
    expect(fusionnerRues([voie('Rue Courte', [[45.4, -72.73]])])).toEqual([])
  })

  it('écarte les coordonnées invalides', () => {
    const rues = fusionnerRues([
      {
        nom: 'Rue Cassée',
        points: [
          { lat: Number.NaN, lng: -72.73 },
          { lat: 45.4, lng: -72.73 },
        ],
      },
    ])

    // Un seul point valide subsiste : insuffisant pour une polyligne.
    expect(rues).toEqual([])
  })

  it('conserve l’ordre d’arrivée', () => {
    const rues = fusionnerRues([
      voie('Rue Wellington', [
        [45.4, -72.72],
        [45.401, -72.72],
      ]),
      voie('Rue Principale', [
        [45.4, -72.73],
        [45.401, -72.73],
      ]),
    ])

    expect(rues.map((r) => r.nom)).toEqual(['Rue Wellington', 'Rue Principale'])
  })

  it('tolère une réponse vide — zone rurale ou polygone minuscule', () => {
    expect(fusionnerRues([])).toEqual([])
  })
})

describe('trierRuesSecteur', () => {
  it('trie en fr-CA avec les nombres', () => {
    const trie = trierRuesSecteur([
      { nom: '10e Avenue' },
      { nom: '2e Avenue' },
      { nom: 'Rue des Érables' },
    ])

    expect(trie.map((r) => r.nom)).toEqual(['2e Avenue', '10e Avenue', 'Rue des Érables'])
  })

  it('ne mute pas le tableau reçu', () => {
    const rues = [{ nom: 'B' }, { nom: 'A' }]
    trierRuesSecteur(rues)

    expect(rues.map((r) => r.nom)).toEqual(['B', 'A'])
  })
})

describe('polygoneValide', () => {
  it('accepte un polygone à trois sommets ou plus', () => {
    expect(polygoneValide(CARRE.map(([lat, lng]) => ({ lat, lng })))).toBe(true)
  })

  it('refuse moins de trois sommets', () => {
    expect(polygoneValide([{ lat: 45.4, lng: -72.73 }])).toBe(false)
    expect(
      polygoneValide([
        { lat: 45.4, lng: -72.73 },
        { lat: 45.41, lng: -72.73 },
      ]),
    ).toBe(false)
  })

  it('refuse des coordonnées hors du monde', () => {
    expect(
      polygoneValide([
        { lat: 91, lng: 0 },
        { lat: 45, lng: 0 },
        { lat: 46, lng: 1 },
      ]),
    ).toBe(false)
  })

  it('refuse ce qui n’est pas un tableau de points', () => {
    expect(polygoneValide(null)).toBe(false)
    expect(polygoneValide('polygone')).toBe(false)
    expect(polygoneValide([{ lat: 'a', lng: 0 }, null, undefined])).toBe(false)
  })
})

describe('cadreDuPolygone', () => {
  it('encadre tous les sommets', () => {
    const cadre = cadreDuPolygone(CARRE.map(([lat, lng]) => ({ lat, lng })))

    expect(cadre).toEqual({ sud: 45.4, nord: 45.41, ouest: -72.73, est: -72.72 })
  })

  it('renvoie null sur un polygone vide', () => {
    expect(cadreDuPolygone([])).toBeNull()
  })
})

describe('polygoneVersOverpass', () => {
  it('produit « lat lon » séparés par des espaces', () => {
    expect(
      polygoneVersOverpass([
        { lat: 45.4, lng: -72.73 },
        { lat: 45.41, lng: -72.72 },
      ]),
    ).toBe('45.400000 -72.730000 45.410000 -72.720000')
  })

  it('arrondit à six décimales', () => {
    expect(polygoneVersOverpass([{ lat: 45.123456789, lng: -72.987654321 }])).toBe(
      '45.123457 -72.987654',
    )
  })
})

describe('progressionSecteur', () => {
  it('compte les rues faites', () => {
    expect(
      progressionSecteur([
        { complete: true },
        { complete: false },
        { complete: true },
        { complete: false },
      ]),
    ).toEqual({ faites: 2, total: 4, pourcentage: 50 })
  })

  it('ne divise pas par zéro sur un secteur sans rue', () => {
    expect(progressionSecteur([])).toEqual({ faites: 0, total: 0, pourcentage: 0 })
  })

  it('atteint 100 quand tout est fait', () => {
    expect(progressionSecteur([{ complete: true }]).pourcentage).toBe(100)
  })
})
