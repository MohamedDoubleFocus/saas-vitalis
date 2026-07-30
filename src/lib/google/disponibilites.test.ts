import { describe, expect, it } from 'vitest'

import {
  CONFIG_DISPONIBILITES,
  creneauxLibres,
  fenetreInterrogation,
  lireOccupations,
  seChevauchent,
  type ConfigDisponibilites,
} from './disponibilites'

function local(annee: number, mois: number, jour: number, heure = 0, minute = 0) {
  return new Date(annee, mois - 1, jour, heure, minute)
}

function plage(debutHeure: number, finHeure: number, jour = 3) {
  return { debut: local(2026, 8, jour, debutHeure), fin: local(2026, 8, jour, finHeure) }
}

// Lundi 3 août 2026, 8 h du matin.
const LUNDI_MATIN = local(2026, 8, 3, 8)

/** Config resserrée pour des tests lisibles : une seule journée, 9 h–12 h. */
const CONFIG_COURTE: ConfigDisponibilites = {
  heureDebut: 9,
  heureFin: 12,
  dureeMinutes: 60,
  joursOuvres: [1],
  joursAvance: 1,
  delaiMinimumMinutes: 0,
}

describe('seChevauchent', () => {
  it('détecte un recouvrement partiel', () => {
    expect(seChevauchent(plage(10, 11), plage(10, 12))).toBe(true)
    expect(seChevauchent(plage(10, 12), plage(11, 13))).toBe(true)
  })

  it('ne considère pas deux créneaux adjacents comme un conflit', () => {
    // 17-18 puis 18-19 : le closer enchaîne, ce n'est pas un chevauchement.
    expect(seChevauchent(plage(17, 18), plage(18, 19))).toBe(false)
  })

  it('détecte un englobement', () => {
    expect(seChevauchent(plage(10, 11), plage(9, 17))).toBe(true)
  })

  it('ignore deux plages disjointes', () => {
    expect(seChevauchent(plage(9, 10), plage(14, 15))).toBe(false)
  })
})

describe('creneauxLibres', () => {
  it('propose toutes les heures ouvrables quand rien n’est occupé', () => {
    const libres = creneauxLibres(LUNDI_MATIN, [], CONFIG_COURTE)

    expect(libres.map((d) => d.getHours())).toEqual([9, 10, 11])
  })

  it('retire les créneaux qui chevauchent une occupation', () => {
    const libres = creneauxLibres(LUNDI_MATIN, [plage(10, 11)], CONFIG_COURTE)

    expect(libres.map((d) => d.getHours())).toEqual([9, 11])
  })

  it('retire tous les créneaux couverts par une longue occupation', () => {
    const libres = creneauxLibres(LUNDI_MATIN, [plage(9, 12)], CONFIG_COURTE)

    expect(libres).toEqual([])
  })

  it('retire un créneau même sur un chevauchement partiel', () => {
    // Occupé de 10 h 30 à 11 h : le créneau de 10 h ne tient plus.
    const libres = creneauxLibres(
      LUNDI_MATIN,
      [{ debut: local(2026, 8, 3, 10, 30), fin: local(2026, 8, 3, 11) }],
      CONFIG_COURTE,
    )

    expect(libres.map((d) => d.getHours())).toEqual([9, 11])
  })

  it('garde un créneau adjacent à une occupation', () => {
    const libres = creneauxLibres(LUNDI_MATIN, [plage(9, 10)], CONFIG_COURTE)

    expect(libres.map((d) => d.getHours())).toEqual([10, 11])
  })

  it('ne propose jamais un créneau qui déborde la plage ouvrable', () => {
    const libres = creneauxLibres(LUNDI_MATIN, [], CONFIG_COURTE)

    // Dernier créneau à 11 h : il finit à 12 h, pile à la fermeture.
    expect(Math.max(...libres.map((d) => d.getHours()))).toBe(11)
  })

  it('respecte le délai minimum', () => {
    // 10 h 15 avec 90 min de plancher : 11 h est trop tôt, il faut 11 h 45.
    const libres = creneauxLibres(local(2026, 8, 3, 10, 15), [], {
      ...CONFIG_COURTE,
      delaiMinimumMinutes: 90,
    })

    expect(libres).toEqual([])
  })

  it('saute les jours non ouvrés', () => {
    const libres = creneauxLibres(LUNDI_MATIN, [], {
      ...CONFIG_COURTE,
      joursAvance: 7,
    })

    // Seuls les lundis sont ouvrés dans CONFIG_COURTE.
    expect(new Set(libres.map((d) => d.getDay()))).toEqual(new Set([1]))
  })

  it('couvre bien plusieurs journées', () => {
    const libres = creneauxLibres(LUNDI_MATIN, [], {
      ...CONFIG_COURTE,
      joursOuvres: [1, 2],
      joursAvance: 2,
    })

    expect(libres).toHaveLength(6)
    expect(new Set(libres.map((d) => d.getDate()))).toEqual(new Set([3, 4]))
  })

  it('n’applique une occupation qu’au bon jour', () => {
    const libres = creneauxLibres(LUNDI_MATIN, [plage(10, 11, 3)], {
      ...CONFIG_COURTE,
      joursOuvres: [1, 2],
      joursAvance: 2,
    })

    const mardi = libres.filter((d) => d.getDate() === 4)

    expect(mardi.map((d) => d.getHours())).toEqual([9, 10, 11])
  })

  it('reste chronologique', () => {
    const temps = creneauxLibres(LUNDI_MATIN, [], CONFIG_DISPONIBILITES).map((d) =>
      d.getTime(),
    )

    expect(temps).toEqual([...temps].sort((a, b) => a - b))
  })

  it('tolère une journée entièrement bloquée sans planter', () => {
    expect(creneauxLibres(LUNDI_MATIN, [plage(0, 23)], CONFIG_COURTE)).toEqual([])
  })
})

describe('lireOccupations', () => {
  it('analyse la réponse de Google', () => {
    const intervalles = lireOccupations([
      { start: '2026-08-03T14:00:00Z', end: '2026-08-03T15:00:00Z' },
    ])

    expect(intervalles).toHaveLength(1)
    expect(intervalles[0].debut.getTime()).toBe(Date.UTC(2026, 7, 3, 14))
  })

  it('ignore une plage illisible au lieu d’échouer', () => {
    // Mieux vaut proposer un créneau déjà pris que d'empêcher toute prise de
    // rendez-vous à la porte.
    const intervalles = lireOccupations([
      { start: 'pas une date', end: '2026-08-03T15:00:00Z' },
      { start: '2026-08-03T14:00:00Z', end: null },
      { start: '2026-08-03T16:00:00Z', end: '2026-08-03T17:00:00Z' },
    ])

    expect(intervalles).toHaveLength(1)
  })

  it('ignore une plage à l’envers ou vide', () => {
    expect(
      lireOccupations([
        { start: '2026-08-03T15:00:00Z', end: '2026-08-03T14:00:00Z' },
        { start: '2026-08-03T15:00:00Z', end: '2026-08-03T15:00:00Z' },
      ]),
    ).toEqual([])
  })

  it('tolère l’absence de données', () => {
    expect(lireOccupations(null)).toEqual([])
    expect(lireOccupations(undefined)).toEqual([])
    expect(lireOccupations([])).toEqual([])
  })
})

describe('fenetreInterrogation', () => {
  it('couvre la période proposée', () => {
    const { debutIso, finIso } = fenetreInterrogation(LUNDI_MATIN)

    const debut = new Date(debutIso)
    const fin = new Date(finIso)

    expect(debut.getDate()).toBe(3)
    expect(debut.getHours()).toBe(0)
    expect(
      Math.round((fin.getTime() - debut.getTime()) / (24 * 60 * 60 * 1000)),
    ).toBe(CONFIG_DISPONIBILITES.joursAvance)
  })
})
