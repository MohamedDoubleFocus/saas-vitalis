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

  it('envoie un closer manager sur le hub — deux casquettes, aucune n’est « la vraie »', () => {
    expect(accueilDuRole('closer', true)).toBe('/accueil')
  })

  it('envoie un manager non closer directement sur son équipe', () => {
    expect(accueilDuRole('knocker', true)).toBe('/equipe')
    expect(accueilDuRole('roofer', true)).toBe('/equipe')
  })

  it('laisse l’admin dans sa console même s’il est manager', () => {
    expect(accueilDuRole('admin', true)).toBe('/admin')
  })
})

describe('cheminAutorise — casquette manager', () => {
  it('ouvre le hub et la zone équipe au manager', () => {
    expect(cheminAutorise('closer', '/equipe', true)).toBe(true)
    expect(cheminAutorise('closer', '/equipe/abc-123', true)).toBe(true)
    expect(cheminAutorise('closer', '/accueil', true)).toBe(true)
  })

  it('les ferme à qui n’est pas manager', () => {
    expect(cheminAutorise('closer', '/equipe', false)).toBe(false)
    expect(cheminAutorise('closer', '/accueil', false)).toBe(false)
    expect(cheminAutorise('knocker', '/equipe', false)).toBe(false)
  })

  it('AJOUTE des routes sans en retirer : le closer manager garde son agenda', () => {
    expect(cheminAutorise('closer', '/terrain/agenda', true)).toBe(true)
    expect(cheminAutorise('closer', '/terrain/classement', true)).toBe(true)
  })

  it('n’élargit pas le reste : un knocker manager ne devient pas closer', () => {
    expect(cheminAutorise('knocker', '/terrain/agenda', true)).toBe(false)
    expect(cheminAutorise('knocker', '/admin', true)).toBe(false)
  })

  it('l’admin atteint la zone équipe sans casquette', () => {
    expect(cheminAutorise('admin', '/equipe', false)).toBe(true)
    expect(cheminAutorise('admin', '/accueil', false)).toBe(true)
  })

  it('ne confond pas un préfixe avec un chemin voisin', () => {
    expect(cheminAutorise('closer', '/equipements', true)).toBe(false)
  })
})

describe('destinationApresConnexion — casquette manager', () => {
  it('respecte une destination d’équipe demandée par un manager', () => {
    expect(destinationApresConnexion('closer', '/equipe', true)).toBe('/equipe')
  })

  it('renvoie un non-manager sur son accueil plutôt que sur l’équipe', () => {
    expect(destinationApresConnexion('closer', '/equipe', false)).toBe(
      '/terrain/agenda',
    )
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
