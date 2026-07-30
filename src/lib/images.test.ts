import { describe, expect, it } from 'vitest'

import { cheminPhoto, COTE_MAX, dimensionsCompressees } from './images'

describe('dimensionsCompressees', () => {
  it('réduit une photo de téléphone au côté maximal', () => {
    // 4032×3024 : format courant d'un capteur 12 Mpx en paysage.
    const d = dimensionsCompressees(4032, 3024)

    expect(d.largeur).toBe(COTE_MAX)
    expect(d.hauteur).toBe(1200)
  })

  it('gère le portrait comme le paysage', () => {
    const d = dimensionsCompressees(3024, 4032)

    expect(d.hauteur).toBe(COTE_MAX)
    expect(d.largeur).toBe(1200)
  })

  it('conserve les proportions', () => {
    const d = dimensionsCompressees(4000, 3000)

    expect(d.largeur / d.hauteur).toBeCloseTo(4000 / 3000, 2)
  })

  it('laisse intacte une image déjà petite', () => {
    // Ré-encoder une petite image dégrade sans rien gagner.
    expect(dimensionsCompressees(800, 600)).toEqual({ largeur: 800, hauteur: 600 })
  })

  it('laisse intacte une image pile à la limite', () => {
    expect(dimensionsCompressees(COTE_MAX, 900)).toEqual({
      largeur: COTE_MAX,
      hauteur: 900,
    })
  })

  it('accepte un côté maximal personnalisé', () => {
    expect(dimensionsCompressees(2000, 1000, 500)).toEqual({
      largeur: 500,
      hauteur: 250,
    })
  })

  it('ne descend jamais sous 1 pixel', () => {
    const d = dimensionsCompressees(10000, 3, 100)

    expect(d.hauteur).toBeGreaterThanOrEqual(1)
    expect(d.largeur).toBe(100)
  })

  it('renvoie zéro sur des dimensions absurdes plutôt que NaN', () => {
    expect(dimensionsCompressees(0, 0)).toEqual({ largeur: 0, hauteur: 0 })
    expect(dimensionsCompressees(-100, 50)).toEqual({ largeur: 0, hauteur: 0 })
  })
})

describe('cheminPhoto', () => {
  it('range la photo sous l’identifiant de l’opportunité', () => {
    expect(cheminPhoto('11111111-1111-1111-1111-111111111111', 'abc')).toBe(
      '11111111-1111-1111-1111-111111111111/abc.jpg',
    )
  })

  it('produit un premier segment exploitable par les politiques Storage', () => {
    // `opportunite_du_chemin()` lit `split_part(chemin, '/', 1)` : le premier
    // segment DOIT être l'UUID nu, sinon l'accès au bucket est refusé.
    const opportuniteId = '22222222-2222-2222-2222-222222222222'
    const chemin = cheminPhoto(opportuniteId, 'photo-1')

    expect(chemin.split('/')[0]).toBe(opportuniteId)
  })
})
