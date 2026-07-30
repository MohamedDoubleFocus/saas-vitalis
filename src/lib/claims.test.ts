import { describe, expect, it } from 'vitest'

import { lireClaimsVitalis } from './claims'

const BASE = { sub: 'u-1', role: 'authenticated', aud: 'authenticated' }

describe('lireClaimsVitalis', () => {
  it('lit un jeton complet', () => {
    const r = lireClaimsVitalis({
      ...BASE,
      role_vitalis: 'knocker',
      closer_id: 'c-9',
      actif: true,
    })

    expect(r).toEqual({
      statut: 'ok',
      claims: { role: 'knocker', closerId: 'c-9', actif: true },
    })
  })

  it('accepte un closer_id nul', () => {
    const r = lireClaimsVitalis({
      ...BASE,
      role_vitalis: 'admin',
      closer_id: null,
      actif: true,
    })

    expect(r).toEqual({
      statut: 'ok',
      claims: { role: 'admin', closerId: null, actif: true },
    })
  })

  it('remonte un compte désactivé sans le masquer', () => {
    const r = lireClaimsVitalis({
      ...BASE,
      role_vitalis: 'roofer',
      closer_id: null,
      actif: false,
    })

    expect(r).toEqual({
      statut: 'ok',
      claims: { role: 'roofer', closerId: null, actif: false },
    })
  })

  it('distingue « compte sans profil » de « hook non activé »', () => {
    expect(
      lireClaimsVitalis({ ...BASE, role_vitalis: null, closer_id: null, actif: false }),
    ).toEqual({ statut: 'sans_profil' })

    // Claim absente = hook pas encore activé → repli sur profiles.
    expect(lireClaimsVitalis(BASE)).toEqual({ statut: 'absent' })
  })

  it('replie sur la base plutôt que de deviner, en cas de claim douteuse', () => {
    // Rôle inconnu
    expect(
      lireClaimsVitalis({ ...BASE, role_vitalis: 'superadmin', actif: true }),
    ).toEqual({ statut: 'absent' })

    // `actif` absent ou du mauvais type
    expect(lireClaimsVitalis({ ...BASE, role_vitalis: 'knocker' })).toEqual({
      statut: 'absent',
    })
    expect(
      lireClaimsVitalis({ ...BASE, role_vitalis: 'knocker', actif: 'oui' }),
    ).toEqual({ statut: 'absent' })
  })

  it('tolère l’absence totale de claims', () => {
    expect(lireClaimsVitalis(null)).toEqual({ statut: 'absent' })
    expect(lireClaimsVitalis(undefined)).toEqual({ statut: 'absent' })
    expect(lireClaimsVitalis({})).toEqual({ statut: 'absent' })
  })

  it('ignore un closer_id du mauvais type au lieu d’échouer', () => {
    const r = lireClaimsVitalis({
      ...BASE,
      role_vitalis: 'knocker',
      closer_id: 42,
      actif: true,
    })

    expect(r).toEqual({
      statut: 'ok',
      claims: { role: 'knocker', closerId: null, actif: true },
    })
  })
})
