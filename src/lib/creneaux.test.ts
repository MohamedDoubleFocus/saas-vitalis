import { describe, expect, it } from 'vitest'

import {
  CONFIG_CRENEAUX,
  genererCreneaux,
  grouperParJournee,
  libelleCreneau,
  obtenirCreneaux,
  type ConfigCreneaux,
} from './creneaux'

function local(annee: number, mois: number, jour: number, heure = 0, minute = 0) {
  return new Date(annee, mois - 1, jour, heure, minute)
}

// Lundi 3 août 2026, 9 h du matin.
const LUNDI_MATIN = local(2026, 8, 3, 9, 0)

describe('genererCreneaux', () => {
  it('propose les heures configurées sur les jours ouvrés', () => {
    const creneaux = genererCreneaux(LUNDI_MATIN)

    // Lundi → vendredi = 5 jours ouvrés sur les 7 proposés, × 3 heures.
    expect(creneaux).toHaveLength(15)

    for (const creneau of creneaux) {
      expect(CONFIG_CRENEAUX.heures).toContain(creneau.debut.getHours())
      expect(CONFIG_CRENEAUX.joursOuvres).toContain(creneau.debut.getDay())
      expect(creneau.debut.getMinutes()).toBe(0)
    }
  })

  it('exclut samedi et dimanche', () => {
    const creneaux = genererCreneaux(LUNDI_MATIN)

    expect(creneaux.some((c) => c.debut.getDay() === 0)).toBe(false)
    expect(creneaux.some((c) => c.debut.getDay() === 6)).toBe(false)
  })

  it('reste en ordre chronologique', () => {
    const creneaux = genererCreneaux(LUNDI_MATIN)
    const temps = creneaux.map((c) => c.debut.getTime())

    expect(temps).toEqual([...temps].sort((a, b) => a - b))
  })

  it('respecte le délai minimum', () => {
    // 16 h 15 : 17 h est dans 45 min, sous le plancher de 90 min → écarté.
    // 18 h et 19 h passent.
    const creneaux = genererCreneaux(local(2026, 8, 3, 16, 15))
    const aujourdhui = creneaux.filter((c) => c.jour === '2026-08-03')

    expect(aujourdhui.map((c) => c.debut.getHours())).toEqual([18, 19])
  })

  it('ne propose plus rien le jour même passé la dernière heure', () => {
    const creneaux = genererCreneaux(local(2026, 8, 3, 21, 0))

    expect(creneaux.some((c) => c.jour === '2026-08-03')).toBe(false)
    // Mais demain est toujours là.
    expect(creneaux.some((c) => c.jour === '2026-08-04')).toBe(true)
  })

  it('génère des identifiants stables et uniques', () => {
    const creneaux = genererCreneaux(LUNDI_MATIN)
    const ids = creneaux.map((c) => c.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('2026-08-03T17')

    // Deux appels au même instant donnent les mêmes identifiants : indispensable
    // pour qu'un `key` React ou une valeur de formulaire reste valable.
    expect(genererCreneaux(LUNDI_MATIN).map((c) => c.id)).toEqual(ids)
  })

  it('se reconfigure entièrement — le module 2.5 changera ces valeurs', () => {
    const config: ConfigCreneaux = {
      heures: [9, 12],
      joursOuvres: [0, 6],
      joursAvance: 14,
      delaiMinimumMinutes: 0,
    }

    const creneaux = genererCreneaux(LUNDI_MATIN, config)

    expect(creneaux.every((c) => [0, 6].includes(c.debut.getDay()))).toBe(true)
    expect(creneaux.every((c) => [9, 12].includes(c.debut.getHours()))).toBe(true)
    // 14 jours à partir du lundi = 2 samedis + 2 dimanches, × 2 heures.
    expect(creneaux).toHaveLength(8)
  })

  it('tolère une configuration vide', () => {
    expect(
      genererCreneaux(LUNDI_MATIN, {
        heures: [],
        joursOuvres: [1],
        joursAvance: 7,
        delaiMinimumMinutes: 0,
      }),
    ).toEqual([])
  })
})

describe('grouperParJournee', () => {
  it('regroupe en conservant l’ordre des journées', () => {
    const journees = grouperParJournee(genererCreneaux(LUNDI_MATIN), LUNDI_MATIN)

    expect(journees).toHaveLength(5)
    expect(journees[0].jour).toBe('2026-08-03')
    expect(journees[0].creneaux).toHaveLength(3)
    expect(journees.map((j) => j.jour)).toEqual([...journees.map((j) => j.jour)].sort())
  })

  it('étiquette les journées de façon lisible', () => {
    const journees = grouperParJournee(genererCreneaux(LUNDI_MATIN), LUNDI_MATIN)

    expect(journees[0].libelleEcheance).toBe('Aujourd’hui')
    expect(journees[1].libelleEcheance).toBe('Demain')
    expect(journees[0].libelleJour).toContain('août')
  })

  it('tolère une liste vide', () => {
    expect(grouperParJournee([], LUNDI_MATIN)).toEqual([])
  })
})

describe('libelleCreneau', () => {
  it('affiche l’heure du créneau', () => {
    const [premier] = genererCreneaux(LUNDI_MATIN)

    expect(libelleCreneau(premier)).toContain('17')
  })
})

describe('obtenirCreneaux', () => {
  it('est la source unique consommée par l’UI', async () => {
    const parLaSource = await obtenirCreneaux('closer-1', LUNDI_MATIN)

    expect(parLaSource.map((c) => c.id)).toEqual(
      genererCreneaux(LUNDI_MATIN).map((c) => c.id),
    )
  })

  it('ne dépend pas encore du closer, mais accepte déjà son identifiant', async () => {
    const avec = await obtenirCreneaux('closer-1', LUNDI_MATIN)
    const sans = await obtenirCreneaux(null, LUNDI_MATIN)

    expect(avec.map((c) => c.id)).toEqual(sans.map((c) => c.id))
  })
})
