import { describe, expect, it } from 'vitest'

import {
  accueilDuRole,
  cheminAutorise,
  destinationApresConnexion,
  estRoleUser,
} from './roles'

describe('accueilDuRole', () => {
  it('envoie chaque rôle dans sa zone', () => {
    expect(accueilDuRole('knocker')).toBe('/terrain/rues')
    expect(accueilDuRole('closer')).toBe('/terrain/agenda')
    expect(accueilDuRole('roofer')).toBe('/chantiers')
    expect(accueilDuRole('admin')).toBe('/admin')
  })
})

describe('cheminAutorise', () => {
  it('autorise un rôle sur sa propre zone et ses descendants', () => {
    expect(cheminAutorise('knocker', '/terrain/rues')).toBe(true)
    expect(cheminAutorise('knocker', '/terrain/rues/rue-principale')).toBe(true)
    expect(cheminAutorise('roofer', '/chantiers/abc-123')).toBe(true)
  })

  it('sépare knocker et closer malgré le préfixe /terrain commun', () => {
    expect(cheminAutorise('knocker', '/terrain/agenda')).toBe(false)
    expect(cheminAutorise('closer', '/terrain/rues')).toBe(false)
    expect(cheminAutorise('closer', '/terrain/lead')).toBe(false)
    expect(cheminAutorise('closer', '/terrain/meetings')).toBe(false)
  })

  it('ouvre les quatre écrans du knocker', () => {
    for (const chemin of [
      '/terrain/rues',
      '/terrain/lead',
      '/terrain/meetings',
      '/terrain/classement',
    ]) {
      expect(cheminAutorise('knocker', chemin)).toBe(true)
    }
  })

  it('partage le classement avec le closer', () => {
    expect(cheminAutorise('closer', '/terrain/classement')).toBe(true)
  })

  it('refuse une zone qui n’est pas la sienne', () => {
    expect(cheminAutorise('knocker', '/admin')).toBe(false)
    expect(cheminAutorise('knocker', '/admin/utilisateurs')).toBe(false)
    expect(cheminAutorise('closer', '/chantiers')).toBe(false)
    expect(cheminAutorise('roofer', '/terrain/rues')).toBe(false)
  })

  it('donne à l’admin l’accès à toutes les zones', () => {
    expect(cheminAutorise('admin', '/admin/utilisateurs')).toBe(true)
    expect(cheminAutorise('admin', '/terrain/rues')).toBe(true)
    expect(cheminAutorise('admin', '/terrain/agenda')).toBe(true)
    expect(cheminAutorise('admin', '/chantiers')).toBe(true)
  })

  it('ne confond pas un préfixe avec un début de segment', () => {
    expect(cheminAutorise('roofer', '/chantiers-secrets')).toBe(false)
    expect(cheminAutorise('admin', '/administration')).toBe(false)
  })

  it('refuse la racine, traitée séparément par le proxy', () => {
    expect(cheminAutorise('admin', '/')).toBe(false)
    expect(cheminAutorise('knocker', '/')).toBe(false)
  })
})

describe('destinationApresConnexion', () => {
  it('respecte ?suivant= quand le rôle y a droit', () => {
    expect(destinationApresConnexion('admin', '/admin/utilisateurs')).toBe(
      '/admin/utilisateurs',
    )
  })

  it('conserve la chaîne de requête de ?suivant=', () => {
    expect(destinationApresConnexion('admin', '/admin/utilisateurs?page=2')).toBe(
      '/admin/utilisateurs?page=2',
    )
  })

  it('retombe sur l’accueil du rôle quand ?suivant= est absent ou interdit', () => {
    expect(destinationApresConnexion('knocker', null)).toBe('/terrain/rues')
    expect(destinationApresConnexion('knocker', '')).toBe('/terrain/rues')
    expect(destinationApresConnexion('knocker', '/admin')).toBe('/terrain/rues')
  })

  it('refuse les redirections ouvertes', () => {
    expect(destinationApresConnexion('admin', '//evil.com')).toBe('/admin')
    expect(destinationApresConnexion('admin', 'https://evil.com')).toBe('/admin')
    expect(destinationApresConnexion('admin', 'admin/utilisateurs')).toBe('/admin')
  })
})

describe('estRoleUser', () => {
  it('reconnaît les quatre rôles', () => {
    expect(estRoleUser('knocker')).toBe(true)
    expect(estRoleUser('admin')).toBe(true)
  })

  it('rejette tout le reste', () => {
    expect(estRoleUser('superadmin')).toBe(false)
    expect(estRoleUser('')).toBe(false)
    expect(estRoleUser(null)).toBe(false)
    expect(estRoleUser(undefined)).toBe(false)
  })
})
