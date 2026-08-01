import { describe, expect, it } from 'vitest'

import type { StatutOpp } from './doublons'
import {
  compterParFiltre,
  correspondAuFiltre,
  lireFiltre,
  STATUTS_PORTE,
  trierPortes,
} from './portes'

function porte(id: string, derniereVisite: string, statut: StatutOpp = 'absent') {
  return { id, derniereVisite, statut }
}

describe('lireFiltre', () => {
  it('accepte les quatre onglets', () => {
    expect(lireFiltre('repasser')).toBe('repasser')
    expect(lireFiltre('absent')).toBe('absent')
    expect(lireFiltre('refus')).toBe('refus')
    expect(lireFiltre('toutes')).toBe('toutes')
  })

  it('retombe sur « à repasser », la vraie file de travail', () => {
    expect(lireFiltre(undefined)).toBe('repasser')
    expect(lireFiltre('')).toBe('repasser')
    expect(lireFiltre('vendu')).toBe('repasser')
    expect(lireFiltre('../admin')).toBe('repasser')
  })
})

describe('correspondAuFiltre', () => {
  it('filtre sur un statut précis', () => {
    expect(correspondAuFiltre('repasser', 'repasser')).toBe(true)
    expect(correspondAuFiltre('absent', 'repasser')).toBe(false)
  })

  it('« toutes » couvre les trois statuts de porte', () => {
    for (const statut of STATUTS_PORTE) {
      expect(correspondAuFiltre(statut, 'toutes')).toBe(true)
    }
  })

  it('exclut les portes qui ont décroché un rendez-vous', () => {
    // Elles vivent dans « Mes meetings » : les montrer ici doublonnerait.
    for (const statut of ['rdv', 'vendu', 'planifie', 'complete', 'paye', 'perdu'] as const) {
      expect(correspondAuFiltre(statut, 'toutes')).toBe(false)
    }
  })
})

describe('trierPortes', () => {
  it('met la visite la plus ANCIENNE en haut', () => {
    const trie = trierPortes([
      porte('recente', '2026-08-01T12:00:00Z'),
      porte('ancienne', '2026-07-10T12:00:00Z'),
      porte('moyenne', '2026-07-25T12:00:00Z'),
    ])

    expect(trie.map((p) => p.id)).toEqual(['ancienne', 'moyenne', 'recente'])
  })

  it('renvoie une date illisible en fin de liste plutôt que de la perdre', () => {
    const trie = trierPortes([
      porte('cassee', 'pas une date'),
      porte('bonne', '2026-07-10T12:00:00Z'),
    ])

    expect(trie.map((p) => p.id)).toEqual(['bonne', 'cassee'])
  })

  it('ne mute pas le tableau reçu', () => {
    const portes = [porte('b', '2026-08-01T12:00:00Z'), porte('a', '2026-07-01T12:00:00Z')]
    trierPortes(portes)

    expect(portes.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('tolère une liste vide', () => {
    expect(trierPortes([])).toEqual([])
  })
})

describe('compterParFiltre', () => {
  it('compte chaque onglet', () => {
    const comptes = compterParFiltre([
      { statut: 'repasser' },
      { statut: 'repasser' },
      { statut: 'absent' },
      { statut: 'refus' },
    ])

    expect(comptes).toEqual({ repasser: 2, absent: 1, refus: 1, toutes: 4 })
  })

  it('ignore les statuts hors périmètre', () => {
    const comptes = compterParFiltre([
      { statut: 'absent' },
      { statut: 'rdv' },
      { statut: 'vendu' },
    ])

    expect(comptes.toutes).toBe(1)
    expect(comptes.absent).toBe(1)
  })

  it('renvoie des zéros sur une liste vide', () => {
    expect(compterParFiltre([])).toEqual({
      repasser: 0,
      absent: 0,
      refus: 0,
      toutes: 0,
    })
  })
})
