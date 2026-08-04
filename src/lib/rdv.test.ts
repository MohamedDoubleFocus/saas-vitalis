import { describe, expect, it } from 'vitest'

import { titreEvenementRdv } from './rdv'

describe('titreEvenementRdv', () => {
  it('rend le format demandé', () => {
    expect(
      titreEvenementRdv({
        clientNom: 'Jean Tremblay',
        closerNom: 'Billal',
        adresse: '12 rue Principale',
      }),
    ).toBe('VITALIS- Jean Tremblay- Billal -')
  })

  it('retombe sur l’adresse quand le lead n’a pas encore de nom', () => {
    // Nom nullable au stade lead (CLAUDE.md §4.7).
    expect(
      titreEvenementRdv({
        clientNom: null,
        closerNom: 'Billal',
        adresse: '12 rue Principale',
      }),
    ).toBe('VITALIS- 12 rue Principale- Billal -')
  })

  it('retombe sur « Client » quand il n’y a ni nom ni adresse', () => {
    expect(
      titreEvenementRdv({ clientNom: null, closerNom: 'Billal', adresse: null }),
    ).toBe('VITALIS- Client- Billal -')
  })

  it('retire le segment du closer plutôt que de laisser un trou', () => {
    // « VITALIS-  - » se lirait comme une donnée corrompue.
    expect(
      titreEvenementRdv({
        clientNom: 'Jean Tremblay',
        closerNom: null,
        adresse: null,
      }),
    ).toBe('VITALIS- Jean Tremblay -')
  })

  it('ignore les champs qui ne contiennent que des espaces', () => {
    expect(
      titreEvenementRdv({
        clientNom: '   ',
        closerNom: '  ',
        adresse: '12 rue Principale',
      }),
    ).toBe('VITALIS- 12 rue Principale -')
  })

  it('nettoie les espaces autour des valeurs', () => {
    expect(
      titreEvenementRdv({
        clientNom: '  Jean Tremblay  ',
        closerNom: ' Billal ',
        adresse: null,
      }),
    ).toBe('VITALIS- Jean Tremblay- Billal -')
  })
})
