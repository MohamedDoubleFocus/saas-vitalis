import { describe, expect, it } from 'vitest'

import {
  ajouter,
  classerErreur,
  cleFusion,
  cleTerritoire,
  contientCle,
  creerMutation,
  echouees,
  enAttente,
  estEchouee,
  MAX_TENTATIVES,
  marquerEchec,
  messageErreur,
  prochaine,
  reinitialiser,
  retirer,
  type Mutation,
} from './file'

function rue(territoireId: string, complete: boolean, id: string, creeLe: number) {
  return creerMutation(
    'maj_territoire_complete',
    { territoire_id: territoireId, complete },
    id,
    creeLe,
  )
}

function lead(adresse: string, id: string, creeLe: number) {
  return creerMutation('creation_lead', { adresse }, id, creeLe)
}

describe('ajouter', () => {
  it('empile dans l’ordre des gestes', () => {
    let f: Mutation[] = []
    f = ajouter(f, rue('t1', true, 'm1', 100))
    f = ajouter(f, rue('t2', true, 'm2', 200))

    expect(f.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('ne mute pas la file d’origine', () => {
    const depart: Mutation[] = []
    const apres = ajouter(depart, rue('t1', true, 'm1', 100))

    expect(depart).toHaveLength(0)
    expect(apres).toHaveLength(1)
  })

  it('fusionne les bascules successives d’une même rue', () => {
    let f: Mutation[] = []
    f = ajouter(f, rue('t1', true, 'm1', 100))
    f = ajouter(f, rue('t1', false, 'm2', 200))
    f = ajouter(f, rue('t1', true, 'm3', 300))

    expect(f).toHaveLength(1)
    // Dernière intention conservée…
    expect(f[0].charge).toEqual({ territoire_id: 't1', complete: true })
    // …mais la position et l'identité d'origine sont préservées.
    expect(f[0].id).toBe('m1')
    expect(f[0].creeLe).toBe(100)
  })

  it('ne fusionne pas deux rues différentes', () => {
    let f: Mutation[] = []
    f = ajouter(f, rue('t1', true, 'm1', 100))
    f = ajouter(f, rue('t2', true, 'm2', 200))

    expect(f).toHaveLength(2)
  })

  it('ne fusionne JAMAIS deux créations de lead', () => {
    let f: Mutation[] = []
    f = ajouter(f, lead('12 rue des Érables', 'm1', 100))
    f = ajouter(f, lead('14 rue des Érables', 'm2', 200))

    expect(f).toHaveLength(2)
    expect(cleFusion(f[0])).toBeNull()
  })

  it('conserve la position à la fusion, sans remettre en fin de file', () => {
    let f: Mutation[] = []
    f = ajouter(f, rue('t1', true, 'm1', 100))
    f = ajouter(f, lead('12 rue des Érables', 'm2', 200))
    f = ajouter(f, rue('t1', false, 'm3', 300))

    expect(f.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(f[0].charge).toEqual({ territoire_id: 't1', complete: false })
  })

  it('remet le compteur de tentatives à zéro quand la charge change', () => {
    let f: Mutation[] = [rue('t1', true, 'm1', 100)]
    f = marquerEchec(f, 'm1', 'réseau')
    f = marquerEchec(f, 'm1', 'réseau')
    expect(f[0].tentatives).toBe(2)

    f = ajouter(f, rue('t1', false, 'm9', 900))

    expect(f).toHaveLength(1)
    expect(f[0].tentatives).toBe(0)
    expect(f[0].derniereErreur).toBeNull()
  })
})

describe('retirer', () => {
  it('retire après un envoi réussi', () => {
    let f: Mutation[] = []
    f = ajouter(f, rue('t1', true, 'm1', 100))
    f = ajouter(f, rue('t2', true, 'm2', 200))

    f = retirer(f, 'm1')

    expect(f.map((m) => m.id)).toEqual(['m2'])
  })

  it('reste sans effet sur un identifiant inconnu', () => {
    const f = [rue('t1', true, 'm1', 100)]

    expect(retirer(f, 'inexistant')).toHaveLength(1)
  })
})

describe('marquerEchec et abandon', () => {
  it('compte les tentatives et retient la cause', () => {
    let f: Mutation[] = [rue('t1', true, 'm1', 100)]
    f = marquerEchec(f, 'm1', 'Failed to fetch')

    expect(f[0].tentatives).toBe(1)
    expect(f[0].derniereErreur).toBe('Failed to fetch')
    expect(estEchouee(f[0])).toBe(false)
  })

  it('abandonne après MAX_TENTATIVES', () => {
    let f: Mutation[] = [rue('t1', true, 'm1', 100)]

    for (let i = 0; i < MAX_TENTATIVES; i++) {
      f = marquerEchec(f, 'm1', 'refus RLS')
    }

    expect(estEchouee(f[0])).toBe(true)
    expect(enAttente(f)).toHaveLength(0)
    expect(echouees(f)).toHaveLength(1)
  })

  it('n’affecte que la mutation visée', () => {
    let f: Mutation[] = [rue('t1', true, 'm1', 100), rue('t2', true, 'm2', 200)]
    f = marquerEchec(f, 'm1', 'boum')

    expect(f[1].tentatives).toBe(0)
  })
})

describe('prochaine', () => {
  it('renvoie la plus ancienne encore envoyable', () => {
    const f = [rue('t1', true, 'm1', 100), rue('t2', true, 'm2', 200)]

    expect(prochaine(f)?.id).toBe('m1')
  })

  it('saute les mutations abandonnées', () => {
    let f: Mutation[] = [rue('t1', true, 'm1', 100), rue('t2', true, 'm2', 200)]

    for (let i = 0; i < MAX_TENTATIVES; i++) {
      f = marquerEchec(f, 'm1', 'refus')
    }

    expect(prochaine(f)?.id).toBe('m2')
  })

  it('renvoie null sur une file vide ou entièrement abandonnée', () => {
    expect(prochaine([])).toBeNull()

    let f: Mutation[] = [rue('t1', true, 'm1', 100)]
    for (let i = 0; i < MAX_TENTATIVES; i++) f = marquerEchec(f, 'm1', 'refus')

    expect(prochaine(f)).toBeNull()
  })
})

describe('reinitialiser', () => {
  it('remet une mutation abandonnée dans le circuit', () => {
    let f: Mutation[] = [rue('t1', true, 'm1', 100)]
    for (let i = 0; i < MAX_TENTATIVES; i++) f = marquerEchec(f, 'm1', 'refus')
    expect(prochaine(f)).toBeNull()

    f = reinitialiser(f, 'm1')

    expect(prochaine(f)?.id).toBe('m1')
    expect(f[0].derniereErreur).toBeNull()
  })
})

describe('contientCle', () => {
  it('permet à l’écran de savoir si une rue est en attente', () => {
    let f: Mutation[] = []
    f = ajouter(f, rue('t1', true, 'm1', 100))

    expect(contientCle(f, cleTerritoire('t1'))).toBe(true)
    expect(contientCle(f, cleTerritoire('t2'))).toBe(false)
  })

  it('ignore les mutations abandonnées', () => {
    let f: Mutation[] = [rue('t1', true, 'm1', 100)]
    for (let i = 0; i < MAX_TENTATIVES; i++) f = marquerEchec(f, 'm1', 'refus')

    expect(contientCle(f, cleTerritoire('t1'))).toBe(false)
  })
})

describe('cleFusion', () => {
  it('refuse de fusionner une charge malformée', () => {
    const mauvaise = creerMutation('maj_territoire_complete', {}, 'm1', 100)

    expect(cleFusion(mauvaise)).toBeNull()
  })
})

describe('classerErreur', () => {
  it('classe en réseau dès que l’appareil se déclare hors ligne', () => {
    // Même un refus explicite : hors ligne, la requête n'a jamais atteint le
    // serveur, donc ce message ne peut pas venir de lui.
    expect(classerErreur(new Error('permission denied'), false)).toBe('reseau')
  })

  it('reconnaît les échecs réseau des différents navigateurs', () => {
    for (const message of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
      'fetch failed',
      'The operation timed out',
      'The user aborted a request.',
    ]) {
      expect(classerErreur(new Error(message), true)).toBe('reseau')
    }
  })

  it('classe en refus une réponse du serveur', () => {
    expect(
      classerErreur(
        new Error('new row violates row-level security policy'),
        true,
      ),
    ).toBe('refus')

    expect(classerErreur(new Error('Charge invalide'), true)).toBe('refus')
  })

  it('tolère une valeur levée qui n’est pas une Error', () => {
    expect(classerErreur('Failed to fetch', true)).toBe('reseau')
    expect(classerErreur({ bizarre: true }, true)).toBe('refus')
    expect(messageErreur({ bizarre: true })).toBe('Erreur inconnue')
    expect(messageErreur(new Error('boum'))).toBe('boum')
    expect(messageErreur('texte brut')).toBe('texte brut')
  })
})
