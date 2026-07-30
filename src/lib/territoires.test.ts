import { describe, expect, it } from 'vitest'

import { compterCompletees, trierRues, type RuePourListe } from './territoires'

function rue(
  id: string,
  nom_rue: string,
  ville: string | null,
  complete = false,
): RuePourListe {
  return { id, nom_rue, ville, complete }
}

describe('trierRues', () => {
  it('trie par ville puis par nom de rue', () => {
    const trie = trierRues([
      rue('3', 'Avenue du Parc', 'Sherbrooke'),
      rue('1', 'Rue Wellington', 'Granby'),
      rue('2', 'Rue Principale', 'Granby'),
    ])

    expect(trie.map((r) => r.id)).toEqual(['2', '1', '3'])
  })

  it('compare les nombres numériquement, pas alphabétiquement', () => {
    const trie = trierRues([
      rue('a', '10e Avenue', 'Granby'),
      rue('b', '2e Avenue', 'Granby'),
      rue('c', '1re Avenue', 'Granby'),
    ])

    expect(trie.map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('classe une lettre accentuée avec sa lettre de base, pas après Z', () => {
    const trie = trierRues([
      rue('z', 'Rue Zotique', 'Granby'),
      rue('i', 'Rue Îlot', 'Granby'),
      rue('e', 'Rue Érables', 'Granby'),
    ])

    // É se classe en E et Î en I : un tri par point de code aurait mis les deux
    // après « Zotique ».
    expect(trie.map((r) => r.id)).toEqual(['e', 'i', 'z'])
  })

  it('renvoie les rues sans ville en dernier', () => {
    const trie = trierRues([
      rue('sans', 'Rue Inconnue', null),
      rue('avec', 'Rue Wellington', 'Granby'),
    ])

    expect(trie.map((r) => r.id)).toEqual(['avec', 'sans'])
  })

  it('ne dépend pas de `complete` : la liste ne bouge pas quand on coche', () => {
    const rues = [
      rue('1', 'Rue Principale', 'Granby', false),
      rue('2', 'Rue Wellington', 'Granby', false),
    ]

    const avant = trierRues(rues).map((r) => r.id)

    const apres = trierRues(
      rues.map((r) => (r.id === '1' ? { ...r, complete: true } : r)),
    ).map((r) => r.id)

    expect(apres).toEqual(avant)
  })

  it('ne mute pas le tableau reçu', () => {
    const rues = [rue('b', 'Rue B', 'Granby'), rue('a', 'Rue A', 'Granby')]
    trierRues(rues)

    expect(rues.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('tolère une liste vide', () => {
    expect(trierRues([])).toEqual([])
  })
})

describe('compterCompletees', () => {
  it('compte les rues complétées', () => {
    expect(
      compterCompletees([
        rue('1', 'A', 'G', true),
        rue('2', 'B', 'G', false),
        rue('3', 'C', 'G', true),
      ]),
    ).toBe(2)
  })

  it('renvoie 0 sur une liste vide', () => {
    expect(compterCompletees([])).toBe(0)
  })
})
