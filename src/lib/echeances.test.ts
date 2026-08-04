import { describe, expect, it } from 'vitest'

import {
  estPasse,
  formaterDateHeure,
  formaterHeure,
  heureLocale,
  jourLocalIso,
  joursDEcart,
  libelleEcheance,
  lireDate,
  minuitLocal,
} from './echeances'
import { FUSEAU_QUEBEC, instantDepuisLocal } from './fuseau'

/**
 * Construit un instant à partir d'une heure QUÉBÉCOISE.
 *
 * ⚠️ Surtout pas `new Date(a, m, j, h)` : ce serait l'heure de la machine qui
 * exécute les tests. Ils passeraient à Montréal et échoueraient sur une CI en
 * UTC — exactement le bug qu'on corrige ici.
 */
function local(
  annee: number,
  mois: number,
  jour: number,
  heure = 0,
  minute = 0,
): Date {
  return instantDepuisLocal(annee, mois, jour, heure, minute, FUSEAU_QUEBEC)
}

describe('jourLocalIso', () => {
  it('utilise le jour local, pas le jour UTC', () => {
    // 23 h le 3 août en local peut être le 4 août en UTC : `toISOString()`
    // donnerait le mauvais jour.
    expect(jourLocalIso(local(2026, 8, 3, 23, 30))).toBe('2026-08-03')
    expect(jourLocalIso(local(2026, 1, 9, 0, 15))).toBe('2026-01-09')
  })

  it('remplit les zéros', () => {
    expect(jourLocalIso(local(2026, 2, 7))).toBe('2026-02-07')
  })
})

describe('minuitLocal', () => {
  it('ramène à minuit sans changer de jour', () => {
    const m = minuitLocal(local(2026, 8, 3, 19, 45))

    // Assertions dans le fuseau de l'entreprise, jamais via `getHours()` :
    // celui-ci lirait l'heure de la machine de test.
    expect(heureLocale(m)).toBe(0)
    expect(jourLocalIso(m)).toBe('2026-08-03')
  })

  it('donne bien 4 h UTC en été — le décalage du Québec', () => {
    // Minuit le 3 août au Québec (EDT, UTC−4) = 04:00 UTC. Vérification en dur :
    // c'est le décalage exact qui affichait 14 h pour un rendez-vous de 10 h.
    expect(minuitLocal(local(2026, 8, 3, 19, 45)).toISOString()).toBe(
      '2026-08-03T04:00:00.000Z',
    )
  })

  it('donne 5 h UTC en hiver — le passage à l’heure normale est pris en compte', () => {
    expect(minuitLocal(local(2026, 1, 15, 12)).toISOString()).toBe(
      '2026-01-15T05:00:00.000Z',
    )
  })
})

describe('joursDEcart', () => {
  it('compte des jours calendaires, pas des tranches de 24 h', () => {
    // 23 h hier → 19 h aujourd'hui : moins de 24 h, mais bien 1 jour d'écart.
    const maintenant = local(2026, 8, 2, 23, 0)
    const rdv = local(2026, 8, 3, 19, 0)

    expect(joursDEcart(rdv, maintenant)).toBe(1)
  })

  it('renvoie 0 le même jour, quelle que soit l’heure', () => {
    expect(joursDEcart(local(2026, 8, 3, 1, 0), local(2026, 8, 3, 23, 0))).toBe(0)
    expect(joursDEcart(local(2026, 8, 3, 23, 0), local(2026, 8, 3, 1, 0))).toBe(0)
  })

  it('compte négatif dans le passé', () => {
    expect(joursDEcart(local(2026, 8, 1), local(2026, 8, 4))).toBe(-3)
  })

  it('traverse les mois et les années', () => {
    expect(joursDEcart(local(2026, 9, 1), local(2026, 8, 30))).toBe(2)
    expect(joursDEcart(local(2027, 1, 1), local(2026, 12, 30))).toBe(2)
  })
})

describe('libelleEcheance', () => {
  const maintenant = local(2026, 8, 3, 10, 0)

  it('nomme les jours proches', () => {
    expect(libelleEcheance(local(2026, 8, 3, 19, 0), maintenant)).toBe('Aujourd’hui')
    expect(libelleEcheance(local(2026, 8, 4, 9, 0), maintenant)).toBe('Demain')
    expect(libelleEcheance(local(2026, 8, 2, 9, 0), maintenant)).toBe('Hier')
  })

  it('compte les jours au-delà', () => {
    expect(libelleEcheance(local(2026, 8, 6), maintenant)).toBe('Dans 3 jours')
    expect(libelleEcheance(local(2026, 7, 31), maintenant)).toBe('Il y a 3 jours')
  })
})

describe('estPasse', () => {
  it('compare les instants, pas les jours', () => {
    const maintenant = local(2026, 8, 3, 18, 0)

    expect(estPasse(local(2026, 8, 3, 17, 0), maintenant)).toBe(true)
    expect(estPasse(local(2026, 8, 3, 19, 0), maintenant)).toBe(false)
  })
})

describe('formatage fr-CA', () => {
  it('formate l’heure à la québécoise', () => {
    // fr-CA écrit « 17 h 00 », pas « 5:00 PM ».
    const texte = formaterHeure(local(2026, 8, 3, 17, 0))

    expect(texte).toContain('17')
    expect(texte).toMatch(/h/)
  })

  it('formate le jour en français', () => {
    const texte = formaterDateHeure(local(2026, 8, 3, 17, 0))

    expect(texte).toContain('août')
    expect(texte).toContain('lundi')
  })
})

describe('lireDate', () => {
  it('lit un timestamptz Supabase', () => {
    expect(lireDate('2026-08-03T21:00:00+00:00')?.getTime()).toBe(
      Date.UTC(2026, 7, 3, 21, 0, 0),
    )
  })

  it('renvoie null plutôt qu’une date invalide', () => {
    expect(lireDate(null)).toBeNull()
    expect(lireDate(undefined)).toBeNull()
    expect(lireDate('')).toBeNull()
    expect(lireDate('pas une date')).toBeNull()
  })
})
