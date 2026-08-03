import { describe, expect, it } from 'vitest'

import {
  AIDES_SOURCE,
  LIBELLES_SOURCE,
  SOURCES_DIRECTES,
  estSourcePorte,
  lireSourceDirecte,
  type SourceOpp,
} from './sources'

const TOUTES: readonly SourceOpp[] = ['porte', 'reference', 'entrant', 'autre']

describe('LIBELLES_SOURCE / AIDES_SOURCE', () => {
  it('couvre chaque valeur de l’enum', () => {
    for (const source of TOUTES) {
      expect(LIBELLES_SOURCE[source]).toBeTruthy()
      expect(AIDES_SOURCE[source]).toBeTruthy()
    }
  })
})

describe('estSourcePorte', () => {
  it('ne reconnaît que le porte-à-porte', () => {
    expect(estSourcePorte('porte')).toBe(true)
    expect(estSourcePorte('reference')).toBe(false)
    expect(estSourcePorte('entrant')).toBe(false)
    expect(estSourcePorte('autre')).toBe(false)
  })
})

describe('SOURCES_DIRECTES', () => {
  it('exclut « porte » : un lead de porte se crée sur le terrain', () => {
    expect(SOURCES_DIRECTES).not.toContain('porte')
  })

  it('couvre tout le reste de l’enum', () => {
    expect([...SOURCES_DIRECTES].sort()).toEqual(
      TOUTES.filter((s) => s !== 'porte').sort(),
    )
  })
})

describe('lireSourceDirecte', () => {
  it('accepte les sources directes', () => {
    for (const source of SOURCES_DIRECTES) {
      expect(lireSourceDirecte(source)).toBe(source)
    }
  })

  it('REFUSE « porte » — sinon on forgerait une vente de porte sans knocker', () => {
    expect(lireSourceDirecte('porte')).toBeNull()
  })

  it('refuse tout ce qui n’est pas une source connue', () => {
    expect(lireSourceDirecte('')).toBeNull()
    expect(lireSourceDirecte(null)).toBeNull()
    expect(lireSourceDirecte(undefined)).toBeNull()
    expect(lireSourceDirecte('facebook')).toBeNull()
    expect(lireSourceDirecte(42)).toBeNull()
  })
})
