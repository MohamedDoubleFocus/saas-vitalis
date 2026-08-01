import { describe, expect, it } from 'vitest'

import type { StatutOpp } from './doublons'
import {
  agregerEquipe,
  categorieCarte,
  centreDe,
  couleurStatut,
  formaterTaux,
  portesDuJour,
  regrouperParKnocker,
  taux,
  totauxEquipe,
  type LigneEquipe,
  type LignePorteCarte,
} from './equipe'

/** Mercredi 5 août 2026, 14 h, heure locale. */
const MAINTENANT = new Date(2026, 7, 5, 14, 0, 0)

function iso(jour: number, heure = 10): string {
  return new Date(2026, 7, jour, heure, 0, 0).toISOString()
}

function ligne(
  knockerId: string | null,
  statut: StatutOpp,
  options: {
    jour?: number
    nbVisites?: number
    dateRdv?: string | null
  } = {},
): LigneEquipe {
  return {
    knockerId,
    statut,
    derniereVisite: iso(options.jour ?? 5),
    nbVisites: options.nbVisites ?? 1,
    dateRdv: options.dateRdv ?? null,
  }
}

const EQUIPE = [
  { id: 'k1', nom: 'Abderrahmane' },
  { id: 'k2', nom: 'Zoé' },
]

describe('taux', () => {
  it('calcule un rapport simple', () => {
    expect(taux(1, 4)).toBe(0.25)
  })

  it('renvoie 0 sur un dénominateur vide plutôt que NaN', () => {
    expect(taux(0, 0)).toBe(0)
    expect(taux(3, 0)).toBe(0)
    expect(taux(1, -2)).toBe(0)
  })

  it('borne à 1 : un taux de conversion ne dépasse pas 100 %', () => {
    expect(taux(5, 2)).toBe(1)
  })
})

describe('formaterTaux', () => {
  it('arrondit à l’entier', () => {
    expect(formaterTaux(0.336)).toBe('34 %')
    expect(formaterTaux(0)).toBe('0 %')
    expect(formaterTaux(1)).toBe('100 %')
  })
})

describe('regrouperParKnocker', () => {
  it('groupe par identifiant', () => {
    const groupes = regrouperParKnocker([
      ligne('k1', 'absent'),
      ligne('k2', 'refus'),
      ligne('k1', 'rdv'),
    ])

    expect(groupes.get('k1')).toHaveLength(2)
    expect(groupes.get('k2')).toHaveLength(1)
  })

  it('ignore les lignes sans knocker', () => {
    expect(regrouperParKnocker([ligne(null, 'absent')]).size).toBe(0)
  })
})

describe('agregerEquipe', () => {
  it('compte portes, leads, contacts, rdv et ventes', () => {
    const stats = agregerEquipe(
      [
        // 3 coups de porte sur une seule adresse, personne n'a jamais répondu.
        ligne('k1', 'absent', { nbVisites: 3 }),
        ligne('k1', 'refus'),
        ligne('k1', 'rdv', { dateRdv: iso(6, 17) }),
        ligne('k1', 'vendu', { dateRdv: iso(4, 17) }),
      ],
      [{ id: 'k1', nom: 'Abderrahmane' }],
      'semaine',
      MAINTENANT,
    )

    expect(stats[0]).toMatchObject({
      portes: 6,
      leads: 4,
      contacts: 3,
      rdv: 2,
      closes: 1,
    })
  })

  it('compte le rendez-vous d’une porte passée à « perdu »', () => {
    // Le rendez-vous a bien eu lieu : le résultat ne l'efface pas.
    const stats = agregerEquipe(
      [ligne('k1', 'perdu', { dateRdv: iso(4, 17) })],
      [{ id: 'k1', nom: 'A' }],
      'semaine',
      MAINTENANT,
    )

    expect(stats[0].rdv).toBe(1)
    expect(stats[0].closes).toBe(0)
  })

  it('filtre sur la DERNIÈRE VISITE, pas sur la date du rendez-vous', () => {
    const stats = agregerEquipe(
      [
        // Porte cognée le mois dernier, rendez-vous fixé aujourd'hui : le
        // travail n'a pas été fait cette semaine.
        {
          knockerId: 'k1',
          statut: 'rdv',
          derniereVisite: new Date(2026, 6, 2, 10).toISOString(),
          nbVisites: 1,
          dateRdv: iso(5, 17),
        },
      ],
      [{ id: 'k1', nom: 'A' }],
      'semaine',
      MAINTENANT,
    )

    expect(stats[0].portes).toBe(0)
    expect(stats[0].rdv).toBe(0)
  })

  it('garde à zéro un knocker qui n’a rien fait — c’est l’information utile', () => {
    const stats = agregerEquipe([ligne('k1', 'rdv', { dateRdv: iso(5) })], EQUIPE, 'semaine', MAINTENANT)

    expect(stats).toHaveLength(2)
    expect(stats.find((s) => s.knockerId === 'k2')).toMatchObject({
      portes: 0,
      rdv: 0,
      tauxGlobal: 0,
    })
  })

  it('ignore les lignes d’un knocker hors équipe', () => {
    const stats = agregerEquipe(
      [ligne('intrus', 'rdv', { dateRdv: iso(5) })],
      [{ id: 'k1', nom: 'A' }],
      'semaine',
      MAINTENANT,
    )

    expect(stats).toHaveLength(1)
    expect(stats[0].rdv).toBe(0)
  })

  it('trie par rendez-vous décroissants, puis par portes', () => {
    const stats = agregerEquipe(
      [
        ligne('k1', 'absent', { nbVisites: 50 }),
        ligne('k2', 'rdv', { dateRdv: iso(5) }),
      ],
      EQUIPE,
      'semaine',
      MAINTENANT,
    )

    expect(stats.map((s) => s.knockerId)).toEqual(['k2', 'k1'])
  })

  it('calcule l’entonnoir sur les bons dénominateurs', () => {
    const stats = agregerEquipe(
      [
        ligne('k1', 'absent', { nbVisites: 6 }),
        ligne('k1', 'refus', { nbVisites: 2 }),
        ligne('k1', 'rdv', { nbVisites: 2, dateRdv: iso(6) }),
      ],
      [{ id: 'k1', nom: 'A' }],
      'semaine',
      MAINTENANT,
    )

    // 10 portes, 2 contacts, 1 rdv.
    expect(stats[0].portes).toBe(10)
    expect(stats[0].contacts).toBe(2)
    expect(stats[0].tauxContact).toBeCloseTo(0.2)
    expect(stats[0].tauxRdv).toBeCloseTo(0.5)
    expect(stats[0].tauxGlobal).toBeCloseTo(0.1)
  })
})

describe('totauxEquipe', () => {
  it('somme les compteurs et RECALCULE les taux', () => {
    const stats = agregerEquipe(
      [
        // k1 : 100 portes, 1 contact, 0 rdv.
        ligne('k1', 'absent', { nbVisites: 100 }),
        // k2 : 2 portes, 2 contacts, 2 rdv → taux individuel parfait.
        ligne('k2', 'rdv', { nbVisites: 1, dateRdv: iso(6) }),
        ligne('k2', 'rdv', { nbVisites: 1, dateRdv: iso(6) }),
      ],
      EQUIPE,
      'semaine',
      MAINTENANT,
    )

    const totaux = totauxEquipe(stats)

    expect(totaux.portes).toBe(102)
    expect(totaux.rdv).toBe(2)
    // Moyenner les taux individuels donnerait ~50 % : absurde.
    expect(totaux.tauxGlobal).toBeCloseTo(2 / 102)
  })

  it('tolère une équipe vide', () => {
    expect(totauxEquipe([])).toEqual({
      portes: 0,
      leads: 0,
      contacts: 0,
      rdv: 0,
      closes: 0,
      tauxContact: 0,
      tauxRdv: 0,
      tauxGlobal: 0,
    })
  })
})

describe('categorieCarte / couleurStatut', () => {
  it('garde les trois statuts de porte distincts', () => {
    expect(categorieCarte('absent')).toBe('absent')
    expect(categorieCarte('refus')).toBe('refus')
    expect(categorieCarte('repasser')).toBe('repasser')
  })

  it('range « perdu » avec les rendez-vous : le rendez-vous a bien eu lieu', () => {
    expect(categorieCarte('rdv')).toBe('rdv')
    expect(categorieCarte('perdu')).toBe('rdv')
  })

  it('range tout le pipeline de vente ensemble', () => {
    for (const statut of ['vendu', 'planifie', 'en_cours', 'complete', 'paye'] as const) {
      expect(categorieCarte(statut)).toBe('vendu')
    }
  })

  it('renvoie une couleur hexadécimale pour chaque statut', () => {
    for (const statut of [
      'absent', 'refus', 'repasser', 'rdv', 'vendu', 'planifie',
      'en_cours', 'complete', 'facture', 'paye', 'perdu',
    ] as const) {
      expect(couleurStatut(statut)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('portesDuJour', () => {
  const NOMS = new Map([['k1', 'Abderrahmane'], ['k2', 'Zoé']])

  function porte(over: Partial<LignePorteCarte> = {}): LignePorteCarte {
    return {
      id: 'o1',
      adresse: '12 rue Principale',
      statut: 'absent',
      latitude: 45.4,
      longitude: -72.73,
      knockerId: 'k1',
      derniereVisite: iso(5, 9),
      ...over,
    }
  }

  it('ne garde que les portes cognées aujourd’hui', () => {
    const portes = portesDuJour(
      [porte(), porte({ id: 'o2', derniereVisite: iso(4, 9) })],
      NOMS,
      MAINTENANT,
    )

    expect(portes.map((p) => p.id)).toEqual(['o1'])
  })

  it('écarte les leads sans GPS plutôt que de les placer au hasard', () => {
    const portes = portesDuJour(
      [porte({ latitude: null }), porte({ id: 'o2', longitude: null })],
      NOMS,
      MAINTENANT,
    )

    expect(portes).toEqual([])
  })

  it('filtre par knocker quand on le demande', () => {
    const portes = portesDuJour(
      [porte(), porte({ id: 'o2', knockerId: 'k2' })],
      NOMS,
      MAINTENANT,
      'k2',
    )

    expect(portes.map((p) => p.id)).toEqual(['o2'])
    expect(portes[0].nom).toBe('Zoé')
  })

  it('retombe sur « Sans nom » pour un knocker absent de l’annuaire', () => {
    const portes = portesDuJour([porte({ knockerId: 'inconnu' })], NOMS, MAINTENANT)

    expect(portes[0].nom).toBe('Sans nom')
  })

  it('ignore les lignes sans knocker', () => {
    expect(portesDuJour([porte({ knockerId: null })], NOMS, MAINTENANT)).toEqual([])
  })
})

describe('centreDe', () => {
  it('renvoie le barycentre', () => {
    const centre = centreDe([
      {
        id: 'a', adresse: 'a', statut: 'absent', latitude: 45, longitude: -73,
        knockerId: 'k1', nom: 'A', derniereVisite: iso(5),
      },
      {
        id: 'b', adresse: 'b', statut: 'absent', latitude: 47, longitude: -71,
        knockerId: 'k1', nom: 'A', derniereVisite: iso(5),
      },
    ])

    expect(centre).toEqual({ lat: 46, lng: -72 })
  })

  it('renvoie null quand il n’y a rien à centrer', () => {
    expect(centreDe([])).toBeNull()
  })
})
