import { describe, expect, it } from 'vitest'

import {
  CONFIG_CRENEAUX,
  genererCreneaux,
  grouperParJournee,
  libelleCreneau,
  obtenirCreneaux,
  type ConfigCreneaux,
} from './creneaux'
import { FUSEAU_QUEBEC, instantDepuisLocal, partiesDansFuseau } from './fuseau'

/** Heure lue dans le fuseau de l'ENTREPRISE, jamais via `getHours()`. */
function heureQc(instant: Date): number {
  return partiesDansFuseau(instant, FUSEAU_QUEBEC).heure
}

/** Jour de la semaine dans le fuseau de l'entreprise (0 = dimanche). */
function jourSemaineQc(instant: Date): number {
  const p = partiesDansFuseau(instant, FUSEAU_QUEBEC)

  return new Date(Date.UTC(p.annee, p.mois - 1, p.jour)).getUTCDay()
}

/**
 * Instant construit à partir d'une heure QUÉBÉCOISE.
 *
 * ⚠️ Surtout pas `new Date(a, m, j, h)` : ce serait l'heure de la machine de
 * test. Les tests passeraient à Montréal et échoueraient sur une CI en UTC —
 * exactement le bug corrigé ici. Lancer `TZ=UTC npm test` doit rester vert.
 */
function local(annee: number, mois: number, jour: number, heure = 0, minute = 0) {
  return instantDepuisLocal(annee, mois, jour, heure, minute, FUSEAU_QUEBEC)
}

// Lundi 3 août 2026, 9 h du matin.
const LUNDI_MATIN = local(2026, 8, 3, 9, 0)

describe('genererCreneaux', () => {
  it('propose les heures configurées, à l’heure pile', () => {
    const creneaux = genererCreneaux(LUNDI_MATIN)

    expect(creneaux.length).toBeGreaterThan(0)

    for (const creneau of creneaux) {
      expect(CONFIG_CRENEAUX.heures).toContain(heureQc(creneau.debut))
      expect(CONFIG_CRENEAUX.joursOuvres).toContain(jourSemaineQc(creneau.debut))
      expect(creneau.debut.getMinutes()).toBe(0)
    }
  })

  it('couvre la semaine entière, week-end compris', () => {
    // Les closers travaillent 7 jours sur 7.
    const jours = new Set(genererCreneaux(LUNDI_MATIN).map((c) => jourSemaineQc(c.debut)))

    expect(jours.size).toBe(7)
    expect(jours.has(6)).toBe(true) // samedi
    expect(jours.has(0)).toBe(true) // dimanche
  })

  it('couvre 9 h à 19 h, dernier rendez-vous fini à 20 h', () => {
    const heures = genererCreneaux(LUNDI_MATIN)
      .filter((c) => c.jour === '2026-08-04')
      .map((c) => heureQc(c.debut))

    expect(heures).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })

  it('reste en ordre chronologique', () => {
    const creneaux = genererCreneaux(LUNDI_MATIN)
    const temps = creneaux.map((c) => c.debut.getTime())

    expect(temps).toEqual([...temps].sort((a, b) => a - b))
  })

  it('respecte le délai minimum', () => {
    // 16 h 15 + 90 min de plancher = 17 h 45 : 17 h est écarté, 18 h et 19 h
    // passent.
    const creneaux = genererCreneaux(local(2026, 8, 3, 16, 15))
    const aujourdhui = creneaux.filter((c) => c.jour === '2026-08-03')

    expect(aujourdhui.map((c) => heureQc(c.debut))).toEqual([18, 19])
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
    // 9 h + 90 min de plancher : le premier créneau du jour est 11 h.
    expect(ids[0]).toBe('2026-08-03T11')

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

    expect(creneaux.every((c) => [0, 6].includes(jourSemaineQc(c.debut)))).toBe(true)
    expect(creneaux.every((c) => [9, 12].includes(heureQc(c.debut)))).toBe(true)
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

    expect(journees).toHaveLength(7)
    expect(journees[0].jour).toBe('2026-08-03')
    // Aujourd'hui commence à 11 h à cause du plancher ; demain est complet.
    expect(journees[0].creneaux).toHaveLength(9)
    expect(journees[1].creneaux).toHaveLength(11)
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

    expect(libelleCreneau(premier)).toContain('11')
  })
})

describe('obtenirCreneaux', () => {
  /** Remplace `fetch` le temps d'un test, puis le restaure. */
  async function avecFetch<T>(
    faux: typeof globalThis.fetch,
    executer: () => Promise<T>,
  ): Promise<T> {
    const original = globalThis.fetch
    globalThis.fetch = faux

    try {
      return await executer()
    } finally {
      globalThis.fetch = original
    }
  }

  function reponseJson(corps: unknown, ok = true) {
    return {
      ok,
      json: async () => corps,
    } as Response
  }

  it('convertit les créneaux renvoyés par le serveur', async () => {
    const debut = local(2026, 8, 3, 17)

    const resultat = await avecFetch(
      async () =>
        reponseJson({ source: 'google', creneaux: [debut.toISOString()] }),
      () => obtenirCreneaux('closer-1', LUNDI_MATIN),
    )

    expect(resultat.source).toBe('google')
    expect(resultat.creneaux).toHaveLength(1)
    expect(resultat.creneaux[0].debut.getTime()).toBe(debut.getTime())
    expect(resultat.creneaux[0].id).toBe('2026-08-03T17')
  })

  it('respecte une réponse vide sans la remplacer par des créneaux fixes', async () => {
    // Agenda plein : proposer des heures fixes serait proposer des heures prises.
    const resultat = await avecFetch(
      async () => reponseJson({ source: 'google', creneaux: [] }),
      () => obtenirCreneaux('closer-1', LUNDI_MATIN),
    )

    expect(resultat.creneaux).toEqual([])
    expect(resultat.source).toBe('google')
  })

  it('replie sur les créneaux fixes quand le serveur répond en erreur', async () => {
    const resultat = await avecFetch(
      async () => reponseJson({}, false),
      () => obtenirCreneaux('closer-1', LUNDI_MATIN),
    )

    expect(resultat.source).toBe('repli')
    expect(resultat.creneaux.map((c) => c.id)).toEqual(
      genererCreneaux(LUNDI_MATIN).map((c) => c.id),
    )
  })

  it('replie quand le réseau échoue — jamais de vente bloquée à la porte', async () => {
    const resultat = await avecFetch(
      async () => {
        throw new Error('Failed to fetch')
      },
      () => obtenirCreneaux('closer-1', LUNDI_MATIN),
    )

    expect(resultat.source).toBe('repli')
    expect(resultat.creneaux.length).toBeGreaterThan(0)
  })

  it('replie sur une charge malformée', async () => {
    const resultat = await avecFetch(
      async () => reponseJson({ source: 'google', creneaux: 'pas un tableau' }),
      () => obtenirCreneaux('closer-1', LUNDI_MATIN),
    )

    expect(resultat.source).toBe('repli')
  })

  it('ignore les dates illisibles au lieu de tout perdre', async () => {
    const resultat = await avecFetch(
      async () =>
        reponseJson({
          source: 'google',
          creneaux: ['pas une date', local(2026, 8, 3, 18).toISOString()],
        }),
      () => obtenirCreneaux('closer-1', LUNDI_MATIN),
    )

    expect(resultat.creneaux).toHaveLength(1)
    expect(heureQc(resultat.creneaux[0].debut)).toBe(18)
  })

  it('transmet le closer au serveur', async () => {
    let urlAppelee = ''

    await avecFetch(
      async (entree) => {
        urlAppelee = String(entree)
        return reponseJson({ source: 'google', creneaux: [] })
      },
      () => obtenirCreneaux('closer-42', LUNDI_MATIN),
    )

    expect(urlAppelee).toContain('closer=closer-42')
  })
})
