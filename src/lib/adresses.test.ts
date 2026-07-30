import { describe, expect, it } from 'vitest'

import {
  extraireAdresse,
  libelleAdresse,
  type ComposanteAdresse,
} from './adresses'

function composante(
  longText: string,
  types: string[],
  shortText = longText,
): ComposanteAdresse {
  return { longText, shortText, types }
}

describe('extraireAdresse', () => {
  it('assemble numéro civique et voie', () => {
    const resultat = extraireAdresse([
      composante('12', ['street_number']),
      composante('Rue Principale', ['route']),
      composante('Granby', ['locality', 'political']),
      composante('J2G 3M9', ['postal_code']),
    ])

    expect(resultat).toEqual({
      adresse: '12 Rue Principale',
      ville: 'Granby',
      codePostal: 'J2G 3M9',
    })
  })

  it('accepte les composantes dans n’importe quel ordre', () => {
    const resultat = extraireAdresse([
      composante('J2G 3M9', ['postal_code']),
      composante('Rue Principale', ['route']),
      composante('12', ['street_number']),
    ])

    expect(resultat.adresse).toBe('12 Rue Principale')
  })

  it('dégrade sur administrative_area_level_3 quand locality manque', () => {
    // Cas réel des municipalités fusionnées au Québec.
    const resultat = extraireAdresse([
      composante('40', ['street_number']),
      composante('Chemin du Lac', ['route']),
      composante('Saint-Élie-de-Caxton', ['administrative_area_level_3', 'political']),
    ])

    expect(resultat.ville).toBe('Saint-Élie-de-Caxton')
  })

  it('préfère locality à sublocality quand les deux existent', () => {
    const resultat = extraireAdresse([
      composante('Le Plateau-Mont-Royal', ['sublocality', 'political']),
      composante('Montréal', ['locality', 'political']),
    ])

    expect(resultat.ville).toBe('Montréal')
  })

  it('retombe sur une sublocality si c’est tout ce qu’il y a', () => {
    const resultat = extraireAdresse([
      composante('Ahuntsic', ['sublocality_level_1', 'political']),
    ])

    expect(resultat.ville).toBe('Ahuntsic')
  })

  it('utilise l’adresse formatée quand numéro et voie manquent', () => {
    const resultat = extraireAdresse(
      [composante('Saint-Zénon', ['locality'])],
      'Rang 4, Saint-Zénon, QC J0K 3N0, Canada',
    )

    expect(resultat.adresse).toBe('Rang 4')
    expect(resultat.ville).toBe('Saint-Zénon')
  })

  it('accepte une voie sans numéro civique', () => {
    const resultat = extraireAdresse([
      composante('Chemin des Pins', ['route']),
      composante('Magog', ['locality']),
    ])

    expect(resultat.adresse).toBe('Chemin des Pins')
  })

  it('ne renvoie jamais undefined, même sans rien d’exploitable', () => {
    expect(extraireAdresse([])).toEqual({
      adresse: '',
      ville: null,
      codePostal: null,
    })

    expect(extraireAdresse([], null)).toEqual({
      adresse: '',
      ville: null,
      codePostal: null,
    })
  })

  it('tolère un longText absent', () => {
    const resultat = extraireAdresse([
      { longText: null, shortText: '12', types: ['street_number'] },
      composante('Rue Principale', ['route']),
    ])

    expect(resultat.adresse).toBe('Rue Principale')
  })
})

describe('libelleAdresse', () => {
  it('joint adresse et ville', () => {
    expect(
      libelleAdresse({
        adresse: '12 Rue Principale',
        ville: 'Granby',
        codePostal: 'J2G 3M9',
      }),
    ).toBe('12 Rue Principale, Granby')
  })

  it('omet la ville manquante sans laisser de virgule', () => {
    expect(
      libelleAdresse({ adresse: '12 Rue Principale', ville: null, codePostal: null }),
    ).toBe('12 Rue Principale')
  })
})
