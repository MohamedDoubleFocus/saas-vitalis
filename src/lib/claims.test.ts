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
      claims: { role: 'knocker', closerId: 'c-9', actif: true, estManager: null, faitDuTerrain: true },
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
      claims: { role: 'admin', closerId: null, actif: true, estManager: null, faitDuTerrain: null },
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
      claims: { role: 'roofer', closerId: null, actif: false, estManager: null, faitDuTerrain: null },
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

  it('lit la casquette de manager quand le jeton la porte', () => {
    const r = lireClaimsVitalis({
      ...BASE,
      role_vitalis: 'closer',
      closer_id: null,
      actif: true,
      est_manager: true,
    })

    expect(r).toEqual({
      statut: 'ok',
      claims: {
        role: 'closer',
        closerId: null,
        actif: true,
        estManager: true,
        faitDuTerrain: null,
      },
    })
  })

  it('distingue « pas manager » de « claim absente »', () => {
    // Faux explicite : le jeton est postérieur à la migration manager.
    expect(
      lireClaimsVitalis({
        ...BASE,
        role_vitalis: 'closer',
        actif: true,
        est_manager: false,
      }),
    ).toEqual({
      statut: 'ok',
      claims: {
        role: 'closer',
        closerId: null,
        actif: true,
        estManager: false,
        faitDuTerrain: null,
      },
    })

    // Absente ou du mauvais type : `null`, pas `false`. Le reste du jeton reste
    // exploitable — seule cette valeur ira se chercher en base.
    expect(
      lireClaimsVitalis({ ...BASE, role_vitalis: 'closer', actif: true }).statut,
    ).toBe('ok')
    expect(
      lireClaimsVitalis({
        ...BASE,
        role_vitalis: 'closer',
        actif: true,
        est_manager: 'oui',
      }),
    ).toEqual({
      statut: 'ok',
      claims: { role: 'closer', closerId: null, actif: true, estManager: null, faitDuTerrain: null },
    })
  })

  it('lit la casquette terrain quand le jeton la porte', () => {
    expect(
      lireClaimsVitalis({
        ...BASE,
        role_vitalis: 'closer',
        actif: true,
        est_manager: true,
        fait_du_terrain: true,
      }),
    ).toEqual({
      statut: 'ok',
      claims: {
        role: 'closer',
        closerId: null,
        actif: true,
        estManager: true,
        faitDuTerrain: true,
      },
    })
  })

  it('n’envoie PAS un knocker chercher en base ce qu’on sait déjà', () => {
    // Claim absente, mais un knocker cogne par définition : `true`, pas `null`.
    // Sans ce filet, le cas de très loin le plus fréquent coûterait une lecture
    // de `profiles` à chaque requête pendant la rotation des jetons.
    const r = lireClaimsVitalis({ ...BASE, role_vitalis: 'knocker', actif: true })

    expect(r.statut === 'ok' && r.claims.faitDuTerrain).toBe(true)
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
      claims: { role: 'knocker', closerId: null, actif: true, estManager: null, faitDuTerrain: true },
    })
  })
})
