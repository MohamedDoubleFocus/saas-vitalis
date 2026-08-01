import { describe, expect, it } from 'vitest'

import {
  bornesJourneeLocale,
  formaterDateHeureFuseau,
  FUSEAU_QUEBEC,
  instantDepuisLocal,
  jourDansFuseau,
  partiesDansFuseau,
} from './fuseau'

/**
 * Tous les tests partent d'instants UTC explicites : ils donnent le même
 * résultat quel que soit le fuseau de la machine qui les exécute.
 */
function utc(annee: number, mois: number, jour: number, heure = 0, minute = 0) {
  return new Date(Date.UTC(annee, mois - 1, jour, heure, minute))
}

describe('partiesDansFuseau', () => {
  it('convertit un instant UTC en heure du Québec (été, UTC−4)', () => {
    expect(partiesDansFuseau(utc(2026, 8, 3, 21, 0), FUSEAU_QUEBEC)).toEqual({
      annee: 2026,
      mois: 8,
      jour: 3,
      heure: 17,
      minute: 0,
    })
  })

  it('convertit en heure du Québec (hiver, UTC−5)', () => {
    expect(partiesDansFuseau(utc(2026, 1, 15, 22, 0), FUSEAU_QUEBEC)).toEqual({
      annee: 2026,
      mois: 1,
      jour: 15,
      heure: 17,
      minute: 0,
    })
  })

  it('change de JOUR quand l’heure UTC est au petit matin', () => {
    // 2 h UTC le 4 août = 22 h le 3 août au Québec. C'est exactement le piège
    // qui ferait envoyer les rappels pour le mauvais jour.
    expect(partiesDansFuseau(utc(2026, 8, 4, 2, 0), FUSEAU_QUEBEC)).toMatchObject({
      jour: 3,
      heure: 22,
    })
  })

  it('rend minuit et non 24 h', () => {
    expect(partiesDansFuseau(utc(2026, 8, 3, 4, 0), FUSEAU_QUEBEC).heure).toBe(0)
  })
})

describe('jourDansFuseau', () => {
  it('donne le jour local, pas le jour UTC', () => {
    expect(jourDansFuseau(utc(2026, 8, 4, 2, 0), FUSEAU_QUEBEC)).toBe('2026-08-03')
    expect(jourDansFuseau(utc(2026, 8, 4, 12, 0), FUSEAU_QUEBEC)).toBe('2026-08-04')
  })

  it('remplit les zéros', () => {
    expect(jourDansFuseau(utc(2026, 2, 7, 15, 0), FUSEAU_QUEBEC)).toBe('2026-02-07')
  })
})

describe('instantDepuisLocal', () => {
  it('trouve l’instant UTC d’une heure locale d’été', () => {
    // 9 h au Québec le 3 août = 13 h UTC (UTC−4).
    expect(
      instantDepuisLocal(2026, 8, 3, 9, 0, FUSEAU_QUEBEC).toISOString(),
    ).toBe('2026-08-03T13:00:00.000Z')
  })

  it('trouve l’instant UTC d’une heure locale d’hiver', () => {
    // 9 h au Québec le 15 janvier = 14 h UTC (UTC−5).
    expect(
      instantDepuisLocal(2026, 1, 15, 9, 0, FUSEAU_QUEBEC).toISOString(),
    ).toBe('2026-01-15T14:00:00.000Z')
  })

  it('reste juste le jour du passage à l’heure d’été', () => {
    // Le 8 mars 2026, le Québec passe à UTC−4 à 2 h du matin. Une estimation
    // faite avec le décalage de la veille tomberait une heure à côté.
    expect(
      instantDepuisLocal(2026, 3, 8, 9, 0, FUSEAU_QUEBEC).toISOString(),
    ).toBe('2026-03-08T13:00:00.000Z')
  })

  it('reste juste le jour du retour à l’heure normale', () => {
    // Le 1er novembre 2026, retour à UTC−5 à 2 h du matin.
    expect(
      instantDepuisLocal(2026, 11, 1, 9, 0, FUSEAU_QUEBEC).toISOString(),
    ).toBe('2026-11-01T14:00:00.000Z')
  })

  it('fait l’aller-retour sans dérive', () => {
    const instant = instantDepuisLocal(2026, 8, 3, 17, 30, FUSEAU_QUEBEC)

    expect(partiesDansFuseau(instant, FUSEAU_QUEBEC)).toMatchObject({
      annee: 2026,
      mois: 8,
      jour: 3,
      heure: 17,
      minute: 30,
    })
  })
})

describe('bornesJourneeLocale', () => {
  it('borne la journée d’aujourd’hui de minuit à minuit', () => {
    const { debut, fin } = bornesJourneeLocale(utc(2026, 8, 3, 21, 0), FUSEAU_QUEBEC)

    expect(debut.toISOString()).toBe('2026-08-03T04:00:00.000Z')
    expect(fin.toISOString()).toBe('2026-08-04T04:00:00.000Z')
  })

  it('borne DEMAIN avec un décalage de 1', () => {
    // Le cron tourne à 9 h le 3 août : il doit viser le 4 août.
    const { debut, fin } = bornesJourneeLocale(
      instantDepuisLocal(2026, 8, 3, 9, 0, FUSEAU_QUEBEC),
      FUSEAU_QUEBEC,
      1,
    )

    expect(debut.toISOString()).toBe('2026-08-04T04:00:00.000Z')
    expect(fin.toISOString()).toBe('2026-08-05T04:00:00.000Z')
  })

  it('passe au mois suivant', () => {
    const { debut } = bornesJourneeLocale(utc(2026, 8, 31, 21, 0), FUSEAU_QUEBEC, 1)

    expect(jourDansFuseau(debut, FUSEAU_QUEBEC)).toBe('2026-09-01')
  })

  it('passe à l’année suivante', () => {
    const { debut } = bornesJourneeLocale(utc(2026, 12, 31, 21, 0), FUSEAU_QUEBEC, 1)

    expect(jourDansFuseau(debut, FUSEAU_QUEBEC)).toBe('2027-01-01')
  })

  it('couvre 24 h en temps normal, 23 h au passage à l’heure d’été', () => {
    const normale = bornesJourneeLocale(utc(2026, 8, 3, 12, 0), FUSEAU_QUEBEC)
    const printemps = bornesJourneeLocale(utc(2026, 3, 8, 12, 0), FUSEAU_QUEBEC)

    expect(normale.fin.getTime() - normale.debut.getTime()).toBe(24 * 3600_000)
    expect(printemps.fin.getTime() - printemps.debut.getTime()).toBe(23 * 3600_000)
  })

  it('encadre un rendez-vous de demain et exclut celui d’après-demain', () => {
    const maintenant = instantDepuisLocal(2026, 8, 3, 9, 0, FUSEAU_QUEBEC)
    const { debut, fin } = bornesJourneeLocale(maintenant, FUSEAU_QUEBEC, 1)

    const rdvDemain = instantDepuisLocal(2026, 8, 4, 19, 0, FUSEAU_QUEBEC)
    const rdvApresDemain = instantDepuisLocal(2026, 8, 5, 9, 0, FUSEAU_QUEBEC)
    const rdvCeSoir = instantDepuisLocal(2026, 8, 3, 19, 0, FUSEAU_QUEBEC)

    expect(rdvDemain >= debut && rdvDemain < fin).toBe(true)
    expect(rdvApresDemain >= debut && rdvApresDemain < fin).toBe(false)
    expect(rdvCeSoir >= debut && rdvCeSoir < fin).toBe(false)
  })
})

describe('formaterDateHeureFuseau', () => {
  it('formate en français, à l’heure du Québec', () => {
    const texte = formaterDateHeureFuseau(utc(2026, 8, 3, 21, 0))

    expect(texte).toContain('lundi')
    expect(texte).toContain('août')
    expect(texte).toContain('17')
    expect(texte).toContain(' à ')
  })

  it('ne dépend pas du fuseau du serveur', () => {
    // Même instant, deux fuseaux : deux heures différentes affichées.
    const instant = utc(2026, 8, 3, 21, 0)

    expect(formaterDateHeureFuseau(instant, 'America/Toronto')).toContain('17')
    expect(formaterDateHeureFuseau(instant, 'UTC')).toContain('21')
  })
})
