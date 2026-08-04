import { describe, expect, it } from 'vitest'

import { FUSEAU_QUEBEC, instantDepuisLocal } from '@/lib/fuseau'

import { chargeRdvMake, type ContexteRdvMake } from './rdv'

function contexte(over: Partial<ContexteRdvMake> = {}): ContexteRdvMake {
  return {
    opportuniteId: 'opp-1',
    clientNom: 'Mohamed Wafi',
    clientTel: '+15147014657',
    clientCourriel: 'wafimohamed04@gmail.com',
    adresse: '124 rue test',
    ville: 'Laval',
    codePostal: 'H7P 3Y5',
    // Mercredi 5 août 2026, 10 h au Québec.
    dateRdv: instantDepuisLocal(2026, 8, 5, 10, 0, FUSEAU_QUEBEC),
    dureeMinutes: 60,
    langue: 'fr',
    closerNom: 'Billal Ouadria',
    knockerNom: 'Abderrahmane Wafi',
    notes: 'Toit en mauvais état côté nord',
    ...over,
  }
}

describe('chargeRdvMake', () => {
  it('rend les clés attendues par le scénario Make', () => {
    const charge = chargeRdvMake(contexte())

    // Ces noms sont mappés un par un dans Make : les changer casse le scénario
    // en silence.
    expect(Object.keys(charge).sort()).toEqual(
      [
        'address',
        'city',
        'clientEmail',
        'clientName',
        'clientPhone',
        'closer',
        'durationMinutes',
        'knocker',
        'langue',
        'notes',
        'opportuniteId',
        'postalCode',
        'scheduledAt',
        'source',
      ].sort(),
    )
  })

  it('envoie l’heure LOCALE avec son décalage, pas en Z', () => {
    // Le champ « Due Date » de Make est réglé sur America/Toronto. Une chaîne en
    // `Z` l'obligerait à reconvertir — un aller-retour de plus où se glisser
    // une erreur de quatre heures.
    expect(chargeRdvMake(contexte()).scheduledAt).toBe('2026-08-05T10:00:00-04:00')
  })

  it('suit le changement d’heure', () => {
    const charge = chargeRdvMake(
      contexte({ dateRdv: instantDepuisLocal(2026, 1, 15, 10, 0, FUSEAU_QUEBEC) }),
    )

    expect(charge.scheduledAt).toBe('2026-01-15T10:00:00-05:00')
  })

  it('sépare la rue, la ville et le code postal', () => {
    const charge = chargeRdvMake(contexte())

    expect(charge.address).toBe('124 rue test')
    expect(charge.city).toBe('Laval')
    expect(charge.postalCode).toBe('H7P 3Y5')
  })

  it('met l’adresse complète en tête du corps de la tâche', () => {
    expect(chargeRdvMake(contexte()).notes).toBe(
      '124 rue test, Laval, H7P 3Y5\nToit en mauvais état côté nord',
    )
  })

  it('rend le code de langue attendu par GHL', () => {
    expect(chargeRdvMake(contexte({ langue: 'en' })).langue).toBe('ENG')
    expect(chargeRdvMake(contexte({ langue: 'fr' })).langue).toBe('FR')
  })

  it('marque la source pour distinguer du inbound', () => {
    expect(chargeRdvMake(contexte()).source).toBe('Porte-à-porte')
  })

  it('n’envoie JAMAIS null — chaîne vide à la place', () => {
    // Une tâche GHL avec « null » écrit dedans est pire qu'un champ vide.
    const charge = chargeRdvMake(
      contexte({
        clientNom: null,
        clientTel: null,
        clientCourriel: null,
        ville: null,
        codePostal: null,
        closerNom: null,
        knockerNom: null,
        notes: null,
      }),
    )

    for (const [cle, valeur] of Object.entries(charge)) {
      expect(valeur, `champ ${cle}`).not.toBeNull()
      expect(valeur, `champ ${cle}`).not.toBeUndefined()
    }

    expect(charge.clientName).toBe('')
    expect(charge.notes).toBe('124 rue test')
  })

  it('nettoie les espaces autour des valeurs', () => {
    const charge = chargeRdvMake(
      contexte({ clientNom: '  Mohamed Wafi  ', ville: ' Laval ' }),
    )

    expect(charge.clientName).toBe('Mohamed Wafi')
    expect(charge.city).toBe('Laval')
  })
})
