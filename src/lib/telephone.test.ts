import { describe, expect, it } from 'vitest'

import {
  chiffres,
  estTelephoneValide,
  formaterTelephone,
  lienTelephone,
  versE164,
} from './telephone'

describe('chiffres', () => {
  it('ne garde que les chiffres', () => {
    expect(chiffres('(450) 555-1234')).toBe('4505551234')
    expect(chiffres('450.555.1234')).toBe('4505551234')
    expect(chiffres('+1 450 555 1234')).toBe('14505551234')
  })
})

describe('estTelephoneValide', () => {
  it('accepte les formats que les gens tapent vraiment', () => {
    for (const saisie of [
      '4505551234',
      '450-555-1234',
      '(450) 555-1234',
      '450 555 1234',
      '+1 450 555 1234',
      '1-450-555-1234',
    ]) {
      expect(estTelephoneValide(saisie)).toBe(true)
    }
  })

  it('refuse un nombre de chiffres incorrect', () => {
    expect(estTelephoneValide('')).toBe(false)
    expect(estTelephoneValide('555-1234')).toBe(false)
    expect(estTelephoneValide('450555123')).toBe(false)
    expect(estTelephoneValide('45055512345')).toBe(false)
  })

  it('refuse un indicatif ou un préfixe impossible', () => {
    // Aucun indicatif régional nord-américain ne commence par 0 ou 1.
    expect(estTelephoneValide('0505551234')).toBe(false)
    expect(estTelephoneValide('1505551234')).toBe(false)
    expect(estTelephoneValide('4500551234')).toBe(false)
  })

  it('ne se laisse pas avoir par du texte', () => {
    expect(estTelephoneValide('pas un numéro')).toBe(false)
    expect(estTelephoneValide('----')).toBe(false)
  })
})

describe('versE164', () => {
  it('normalise vers la forme stockée', () => {
    expect(versE164('(450) 555-1234')).toBe('+14505551234')
    expect(versE164('1-450-555-1234')).toBe('+14505551234')
    expect(versE164('450 555 1234')).toBe('+14505551234')
  })

  it('renvoie null plutôt que de stocker n’importe quoi', () => {
    expect(versE164('555-1234')).toBeNull()
    expect(versE164('')).toBeNull()
  })

  it('est idempotent', () => {
    const e164 = versE164('4505551234')!

    expect(versE164(e164)).toBe(e164)
  })
})

describe('formaterTelephone', () => {
  it('affiche à la québécoise', () => {
    expect(formaterTelephone('+14505551234')).toBe('(450) 555-1234')
    expect(formaterTelephone('4505551234')).toBe('(450) 555-1234')
  })

  it('renvoie une chaîne vide sur une valeur absente', () => {
    expect(formaterTelephone(null)).toBe('')
    expect(formaterTelephone(undefined)).toBe('')
    expect(formaterTelephone('')).toBe('')
  })

  it('n’efface pas une valeur qu’il ne sait pas lire', () => {
    // Mieux vaut afficher une donnée douteuse que rien du tout.
    expect(formaterTelephone('poste 4501')).toBe('poste 4501')
  })
})

describe('lienTelephone', () => {
  it('produit une cible composable', () => {
    expect(lienTelephone('(450) 555-1234')).toBe('tel:+14505551234')
  })

  it('renvoie null quand il n’y a rien à composer', () => {
    expect(lienTelephone(null)).toBeNull()
    expect(lienTelephone('poste 4501')).toBeNull()
  })
})
