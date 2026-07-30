import { describe, expect, it } from 'vitest'

import {
  agregerClassement,
  bornesPeriode,
  dansPeriode,
  estClose,
  type LigneClassement,
} from './classement'

function local(annee: number, mois: number, jour: number, heure = 0) {
  return new Date(annee, mois - 1, jour, heure)
}

/** ISO d'une date locale, comme le renvoie Supabase après un aller-retour. */
function iso(annee: number, mois: number, jour: number, heure = 17): string {
  return local(annee, mois, jour, heure).toISOString()
}

// Mercredi 5 août 2026, 14 h.
const MERCREDI = local(2026, 8, 5, 14)

const NOMS = new Map<string, string | null>([
  ['k1', 'Marc Dubé'],
  ['k2', 'Sarah Lemieux'],
  ['k3', 'Ali Benali'],
])

function ligne(
  knockerId: string | null,
  dateRdv: string | null,
  statut: LigneClassement['statut'] = 'rdv',
): LigneClassement {
  return { knockerId, dateRdv, statut }
}

describe('estClose', () => {
  it('reconnaît les statuts qui ont mené à une vente', () => {
    for (const statut of ['vendu', 'planifie', 'en_cours', 'complete', 'facture', 'paye'] as const) {
      expect(estClose(statut)).toBe(true)
    }
  })

  it('exclut perdu, malgré sa position dans l’enum', () => {
    // `perdu` vient après `vendu` dans l'enum Postgres : une comparaison
    // d'ordre le compterait à tort comme une vente.
    expect(estClose('perdu')).toBe(false)
  })

  it('exclut les statuts d’avant-vente', () => {
    for (const statut of ['absent', 'refus', 'repasser', 'rdv'] as const) {
      expect(estClose(statut)).toBe(false)
    }
  })
})

describe('bornesPeriode', () => {
  it('borne la journée de minuit à minuit', () => {
    const { debut, fin } = bornesPeriode('aujourdhui', MERCREDI)

    expect(debut.getDate()).toBe(5)
    expect(debut.getHours()).toBe(0)
    expect(fin.getDate()).toBe(6)
    expect(fin.getHours()).toBe(0)
  })

  it('fait commencer la semaine le lundi', () => {
    const { debut, fin } = bornesPeriode('semaine', MERCREDI)

    expect(debut.getDay()).toBe(1) // lundi
    expect(debut.getDate()).toBe(3)
    expect(fin.getDate()).toBe(10)
  })

  it('rattache le dimanche à la semaine qui vient de finir', () => {
    // Dimanche 9 août : la semaine doit commencer le lundi 3, pas le lundi 10.
    const dimanche = local(2026, 8, 9, 12)
    const { debut } = bornesPeriode('semaine', dimanche)

    expect(debut.getDate()).toBe(3)
    expect(debut.getDay()).toBe(1)
  })

  it('borne le mois du 1er au 1er', () => {
    const { debut, fin } = bornesPeriode('mois', MERCREDI)

    expect(debut.getDate()).toBe(1)
    expect(debut.getMonth()).toBe(7) // août
    expect(fin.getDate()).toBe(1)
    expect(fin.getMonth()).toBe(8) // septembre
  })

  it('passe l’année sur le mois de décembre', () => {
    const { fin } = bornesPeriode('mois', local(2026, 12, 20))

    expect(fin.getFullYear()).toBe(2027)
    expect(fin.getMonth()).toBe(0)
  })
})

describe('dansPeriode', () => {
  it('inclut le début et exclut la fin', () => {
    const { debut, fin } = bornesPeriode('aujourdhui', MERCREDI)

    expect(dansPeriode(debut, 'aujourdhui', MERCREDI)).toBe(true)
    expect(dansPeriode(fin, 'aujourdhui', MERCREDI)).toBe(false)
  })

  it('distingue les trois périodes', () => {
    const lundi = local(2026, 8, 3, 17)

    expect(dansPeriode(lundi, 'aujourdhui', MERCREDI)).toBe(false)
    expect(dansPeriode(lundi, 'semaine', MERCREDI)).toBe(true)
    expect(dansPeriode(lundi, 'mois', MERCREDI)).toBe(true)
  })
})

describe('agregerClassement', () => {
  it('compte les rendez-vous de la période', () => {
    const lignes = [
      ligne('k1', iso(2026, 8, 5)),
      ligne('k1', iso(2026, 8, 5, 19)),
      ligne('k2', iso(2026, 8, 5)),
      ligne('k1', iso(2026, 8, 3)), // cette semaine, pas aujourd'hui
    ]

    const aujourdhui = agregerClassement(lignes, NOMS, 'aujourdhui', MERCREDI)

    expect(aujourdhui.find((r) => r.knockerId === 'k1')?.rdv).toBe(2)
    expect(aujourdhui.find((r) => r.knockerId === 'k2')?.rdv).toBe(1)

    const semaine = agregerClassement(lignes, NOMS, 'semaine', MERCREDI)

    expect(semaine.find((r) => r.knockerId === 'k1')?.rdv).toBe(3)
  })

  it('compte séparément les rendez-vous qui ont closé', () => {
    const lignes = [
      ligne('k1', iso(2026, 8, 5), 'vendu'),
      ligne('k1', iso(2026, 8, 5), 'rdv'),
      ligne('k1', iso(2026, 8, 5), 'perdu'),
    ]

    const [premier] = agregerClassement(lignes, NOMS, 'aujourdhui', MERCREDI)

    expect(premier.rdv).toBe(3)
    expect(premier.closes).toBe(1)
  })

  it('classe par rendez-vous, puis par closes, puis par nom', () => {
    const lignes = [
      ligne('k2', iso(2026, 8, 5)),
      ligne('k2', iso(2026, 8, 5)),
      ligne('k2', iso(2026, 8, 5)),
      ligne('k1', iso(2026, 8, 5)),
      ligne('k1', iso(2026, 8, 5), 'vendu'),
      ligne('k3', iso(2026, 8, 5)),
      ligne('k3', iso(2026, 8, 5)),
    ]

    const classement = agregerClassement(lignes, NOMS, 'aujourdhui', MERCREDI)

    // k2 : 3 rdv. k1 et k3 : 2 rdv chacun, mais k1 a une close.
    expect(classement.map((r) => r.knockerId)).toEqual(['k2', 'k1', 'k3'])
    expect(classement.map((r) => r.rang)).toEqual([1, 2, 3])
  })

  it('donne le même rang aux ex æquo et fait sauter le suivant', () => {
    const lignes = [
      ligne('k1', iso(2026, 8, 5)),
      ligne('k1', iso(2026, 8, 5)),
      ligne('k2', iso(2026, 8, 5)),
      ligne('k2', iso(2026, 8, 5)),
      ligne('k3', iso(2026, 8, 5)),
    ]

    const classement = agregerClassement(lignes, NOMS, 'aujourdhui', MERCREDI)

    expect(classement.map((r) => r.rang)).toEqual([1, 1, 3])
  })

  it('départage les ex æquo parfaits par nom, en fr-CA', () => {
    const lignes = [ligne('k1', iso(2026, 8, 5)), ligne('k3', iso(2026, 8, 5))]

    const classement = agregerClassement(lignes, NOMS, 'aujourdhui', MERCREDI)

    // Les deux à 1 rdv sont départagés par le nom : « Ali Benali » avant
    // « Marc Dubé ». Sarah Lemieux suit, à zéro.
    expect(classement.slice(0, 2).map((r) => r.nom)).toEqual([
      'Ali Benali',
      'Marc Dubé',
    ])
    expect(classement.map((r) => r.rang)).toEqual([1, 1, 3])
  })

  it('garde les knockers à zéro dans le classement', () => {
    const classement = agregerClassement(
      [ligne('k1', iso(2026, 8, 5))],
      NOMS,
      'aujourdhui',
      MERCREDI,
    )

    expect(classement).toHaveLength(3)
    expect(classement.filter((r) => r.rdv === 0)).toHaveLength(2)
  })

  it('ignore les lignes sans rendez-vous ou sans knocker', () => {
    const classement = agregerClassement(
      [
        ligne('k1', null),
        ligne(null, iso(2026, 8, 5)),
        ligne('k1', 'pas une date'),
        ligne('k1', iso(2026, 8, 5)),
      ],
      NOMS,
      'aujourdhui',
      MERCREDI,
    )

    expect(classement.find((r) => r.knockerId === 'k1')?.rdv).toBe(1)
  })

  it('ignore un knocker absent de l’annuaire plutôt que d’échouer', () => {
    const classement = agregerClassement(
      [ligne('inconnu', iso(2026, 8, 5))],
      NOMS,
      'aujourdhui',
      MERCREDI,
    )

    const inconnu = classement.find((r) => r.knockerId === 'inconnu')

    expect(inconnu?.nom).toBe('Sans nom')
    expect(inconnu?.rdv).toBe(1)
  })

  it('remplace un nom vide par un libellé lisible', () => {
    const noms = new Map<string, string | null>([['k9', null]])
    const classement = agregerClassement([ligne('k9', iso(2026, 8, 5))], noms, 'aujourdhui', MERCREDI)

    expect(classement[0].nom).toBe('Sans nom')
  })

  it('tolère une base vide', () => {
    expect(agregerClassement([], new Map(), 'mois', MERCREDI)).toEqual([])
  })

  it('classe par ventes quand on le demande', () => {
    const lignes = [
      // k1 : beaucoup de rendez-vous, aucune vente.
      ligne('k1', iso(2026, 8, 5)),
      ligne('k1', iso(2026, 8, 5)),
      ligne('k1', iso(2026, 8, 5)),
      // k2 : moins de rendez-vous, mais deux ventes.
      ligne('k2', iso(2026, 8, 5), 'vendu'),
      ligne('k2', iso(2026, 8, 5), 'paye'),
    ]

    const parRdv = agregerClassement(lignes, NOMS, 'aujourdhui', MERCREDI, 'rdv')
    const parVentes = agregerClassement(lignes, NOMS, 'aujourdhui', MERCREDI, 'closes')

    expect(parRdv[0].knockerId).toBe('k1')
    expect(parVentes[0].knockerId).toBe('k2')
    // Les compteurs ne changent pas, seul l'ordre change.
    expect(parVentes[0].rdv).toBe(2)
    expect(parVentes[0].closes).toBe(2)
  })

  it('utilise l’autre métrique pour départager', () => {
    const lignes = [
      ligne('k1', iso(2026, 8, 5), 'vendu'),
      ligne('k1', iso(2026, 8, 5)),
      ligne('k2', iso(2026, 8, 5), 'vendu'),
    ]

    // Une vente chacun : k1 passe devant grâce à son rendez-vous de plus.
    const parVentes = agregerClassement(lignes, NOMS, 'aujourdhui', MERCREDI, 'closes')

    expect(parVentes.slice(0, 2).map((r) => r.knockerId)).toEqual(['k1', 'k2'])
  })
})
