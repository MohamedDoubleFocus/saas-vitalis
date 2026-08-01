import { describe, expect, it } from 'vitest'

import {
  accueilDuRole,
  cheminAutorise,
  destinationApresConnexion,
  destinationsDe,
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
    expect(accueilDuRole('closer', { estManager: true })).toBe('/accueil')
  })

  it('envoie un manager non closer directement sur son équipe', () => {
    expect(accueilDuRole('knocker', { estManager: true })).toBe('/equipe')
    expect(accueilDuRole('roofer', { estManager: true })).toBe('/equipe')
  })

  it('laisse l’admin dans sa console même s’il est manager', () => {
    expect(accueilDuRole('admin', { estManager: true })).toBe('/admin')
  })
})

describe('cheminAutorise — casquette manager', () => {
  it('ouvre le hub et la zone équipe au manager', () => {
    expect(cheminAutorise('closer', '/equipe', { estManager: true })).toBe(true)
    expect(cheminAutorise('closer', '/equipe/abc-123', { estManager: true })).toBe(true)
    expect(cheminAutorise('closer', '/accueil', { estManager: true })).toBe(true)
  })

  it('les ferme à qui n’est pas manager', () => {
    expect(cheminAutorise('closer', '/equipe')).toBe(false)
    expect(cheminAutorise('closer', '/accueil')).toBe(false)
    expect(cheminAutorise('knocker', '/equipe')).toBe(false)
  })

  it('AJOUTE des routes sans en retirer : le closer manager garde son agenda', () => {
    expect(cheminAutorise('closer', '/terrain/agenda', { estManager: true })).toBe(true)
    expect(cheminAutorise('closer', '/terrain/classement', { estManager: true })).toBe(true)
  })

  it('n’élargit pas le reste : un knocker manager ne devient pas closer', () => {
    expect(cheminAutorise('knocker', '/terrain/agenda', { estManager: true })).toBe(false)
    expect(cheminAutorise('knocker', '/admin', { estManager: true })).toBe(false)
  })

  it('l’admin atteint la zone équipe sans casquette', () => {
    expect(cheminAutorise('admin', '/equipe')).toBe(true)
    expect(cheminAutorise('admin', '/accueil')).toBe(true)
  })

  it('ne confond pas un préfixe avec un chemin voisin', () => {
    expect(cheminAutorise('closer', '/equipements', { estManager: true })).toBe(false)
  })
})

describe('destinationApresConnexion — casquette manager', () => {
  it('respecte une destination d’équipe demandée par un manager', () => {
    expect(destinationApresConnexion('closer', '/equipe', { estManager: true })).toBe('/equipe')
  })

  it('renvoie un non-manager sur son accueil plutôt que sur l’équipe', () => {
    expect(destinationApresConnexion('closer', '/equipe')).toBe(
      '/terrain/agenda',
    )
  })
})

describe('casquette terrain', () => {
  it('ouvre les écrans de porte à un closer qui cogne', () => {
    for (const chemin of ['/terrain/rues', '/terrain/lead', '/terrain/portes']) {
      expect(cheminAutorise('closer', chemin, { faitDuTerrain: true })).toBe(true)
    }
  })

  it('les garde fermés au closer qui ne cogne pas', () => {
    expect(cheminAutorise('closer', '/terrain/lead')).toBe(false)
    expect(cheminAutorise('closer', '/terrain/portes')).toBe(false)
  })

  it('n’ouvre PAS « Mes meetings » : ses rendez-vous sont déjà dans son agenda', () => {
    expect(cheminAutorise('closer', '/terrain/meetings', { faitDuTerrain: true })).toBe(
      false,
    )
  })

  it('ne donne aucun droit de closer à un knocker', () => {
    expect(cheminAutorise('knocker', '/terrain/agenda', { faitDuTerrain: true })).toBe(
      false,
    )
  })

  it('envoie sur le hub dès qu’il y a plus d’une destination', () => {
    expect(accueilDuRole('closer', { faitDuTerrain: true })).toBe('/accueil')
    expect(accueilDuRole('roofer', { faitDuTerrain: true })).toBe('/accueil')
  })

  it('ne change rien pour un knocker : il cogne déjà', () => {
    expect(accueilDuRole('knocker', { faitDuTerrain: true })).toBe('/terrain/rues')
  })

  it('cumule les deux casquettes', () => {
    expect(
      cheminAutorise('closer', '/terrain/lead', {
        faitDuTerrain: true,
        estManager: true,
      }),
    ).toBe(true)
    expect(
      cheminAutorise('closer', '/equipe', {
        faitDuTerrain: true,
        estManager: true,
      }),
    ).toBe(true)
    expect(
      cheminAutorise('closer', '/terrain/agenda', {
        faitDuTerrain: true,
        estManager: true,
      }),
    ).toBe(true)
  })
})

describe('destinationsDe', () => {
  it('une seule destination pour un rôle sans casquette', () => {
    expect(destinationsDe('closer')).toEqual(['/terrain/agenda'])
    expect(destinationsDe('roofer')).toEqual(['/chantiers'])
  })

  it('met le terrain en premier — c’est le travail du matin', () => {
    expect(destinationsDe('closer', { faitDuTerrain: true })).toEqual([
      '/terrain/rues',
      '/terrain/agenda',
    ])
  })

  it('ne duplique pas la destination d’un knocker qui cogne', () => {
    expect(destinationsDe('knocker', { faitDuTerrain: true })).toEqual([
      '/terrain/rues',
    ])
  })

  it('ajoute l’équipe en dernier', () => {
    expect(
      destinationsDe('closer', { faitDuTerrain: true, estManager: true }),
    ).toEqual(['/terrain/rues', '/terrain/agenda', '/equipe'])
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
