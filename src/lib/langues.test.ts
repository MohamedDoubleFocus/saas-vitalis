import { describe, expect, it } from 'vitest'

import {
  LANGUES,
  LANGUE_DEFAUT,
  LIBELLES_LANGUE,
  LIBELLES_LANGUE_LONG,
  codeLangueExterne,
  lireLangue,
} from './langues'

describe('LIBELLES_LANGUE', () => {
  it('couvre chaque valeur de l’enum', () => {
    for (const langue of LANGUES) {
      expect(LIBELLES_LANGUE[langue]).toBeTruthy()
      expect(LIBELLES_LANGUE_LONG[langue]).toBeTruthy()
    }
  })

  it('utilise les mêmes codes que GHL', () => {
    expect(LIBELLES_LANGUE.fr).toBe('FR')
    expect(LIBELLES_LANGUE.en).toBe('ENG')
  })
})

describe('lireLangue', () => {
  it('accepte les langues connues', () => {
    expect(lireLangue('fr')).toBe('fr')
    expect(lireLangue('en')).toBe('en')
  })

  it('retombe sur le français plutôt que d’échouer', () => {
    // Une valeur inattendue ne doit jamais empêcher d'enregistrer un lead à la
    // porte (CLAUDE.md §5).
    expect(lireLangue(undefined)).toBe(LANGUE_DEFAUT)
    expect(lireLangue(null)).toBe(LANGUE_DEFAUT)
    expect(lireLangue('')).toBe(LANGUE_DEFAUT)
    expect(lireLangue('ENG')).toBe(LANGUE_DEFAUT)
    expect(lireLangue('espagnol')).toBe(LANGUE_DEFAUT)
    expect(lireLangue(42)).toBe(LANGUE_DEFAUT)
  })

  it('le défaut est le français', () => {
    expect(LANGUE_DEFAUT).toBe('fr')
  })
})

describe('codeLangueExterne', () => {
  it('rend le code attendu par GHL', () => {
    expect(codeLangueExterne('fr')).toBe('FR')
    expect(codeLangueExterne('en')).toBe('ENG')
  })
})
