import { describe, expect, it } from 'vitest'

import {
  dateDeReference,
  estRetourEnArriere,
  estStatutExecution,
  transitionRooferAutorisee,
  transitionsRoofer,
  trierJobs,
} from './chantiers'

function job(dateConfirmee: string | null, dateCibleDebut: string | null, id = '') {
  return { id, dateConfirmee, dateCibleDebut }
}

describe('estStatutExecution', () => {
  it('reconnaît les statuts qui concernent le roofer', () => {
    for (const statut of ['vendu', 'planifie', 'en_cours', 'complete'] as const) {
      expect(estStatutExecution(statut)).toBe(true)
    }
  })

  it('exclut l’avant-vente et l’après-livraison', () => {
    for (const statut of ['absent', 'refus', 'repasser', 'rdv', 'facture', 'paye', 'perdu'] as const) {
      expect(estStatutExecution(statut)).toBe(false)
    }
  })
})

describe('transitionsRoofer', () => {
  it('avance d’une étape à la fois', () => {
    expect(transitionsRoofer('vendu')).toEqual(['planifie'])
    expect(transitionsRoofer('planifie')).toEqual(['en_cours'])
    expect(transitionsRoofer('complete')).toEqual(['en_cours'])
  })

  it('permet le retour en arrière depuis en_cours', () => {
    expect(transitionsRoofer('en_cours')).toEqual(['complete', 'planifie'])
  })

  it('n’ouvre jamais facture, paye ni perdu', () => {
    for (const statut of ['vendu', 'planifie', 'en_cours', 'complete'] as const) {
      const cibles = transitionsRoofer(statut)

      expect(cibles).not.toContain('facture')
      expect(cibles).not.toContain('paye')
      expect(cibles).not.toContain('perdu')
      expect(cibles).not.toContain('vendu')
    }
  })

  it('ne propose rien depuis un statut hors exécution', () => {
    expect(transitionsRoofer('facture')).toEqual([])
    expect(transitionsRoofer('paye')).toEqual([])
    expect(transitionsRoofer('rdv')).toEqual([])
    expect(transitionsRoofer('perdu')).toEqual([])
  })
})

describe('transitionRooferAutorisee', () => {
  it('accepte les pas légitimes', () => {
    expect(transitionRooferAutorisee('planifie', 'en_cours')).toBe(true)
    expect(transitionRooferAutorisee('en_cours', 'complete')).toBe(true)
    expect(transitionRooferAutorisee('complete', 'en_cours')).toBe(true)
  })

  it('refuse de sauter une étape', () => {
    expect(transitionRooferAutorisee('planifie', 'complete')).toBe(false)
    expect(transitionRooferAutorisee('vendu', 'en_cours')).toBe(false)
  })

  it('refuse ce qui sort du périmètre du roofer', () => {
    expect(transitionRooferAutorisee('complete', 'facture')).toBe(false)
    expect(transitionRooferAutorisee('complete', 'paye')).toBe(false)
    expect(transitionRooferAutorisee('en_cours', 'perdu')).toBe(false)
    expect(transitionRooferAutorisee('planifie', 'vendu')).toBe(false)
  })
})

describe('estRetourEnArriere', () => {
  it('distingue une correction d’une avancée', () => {
    expect(estRetourEnArriere('en_cours', 'planifie')).toBe(true)
    expect(estRetourEnArriere('complete', 'en_cours')).toBe(true)
    expect(estRetourEnArriere('planifie', 'en_cours')).toBe(false)
    expect(estRetourEnArriere('en_cours', 'complete')).toBe(false)
  })

  it('renvoie false hors de la chaîne d’exécution', () => {
    expect(estRetourEnArriere('paye', 'complete')).toBe(false)
  })
})

describe('dateDeReference', () => {
  it('préfère la date confirmée à la fenêtre cible', () => {
    expect(dateDeReference(job('2026-08-10', '2026-08-03'))).toBe('2026-08-10')
  })

  it('retombe sur le début de la fenêtre cible', () => {
    expect(dateDeReference(job(null, '2026-08-03'))).toBe('2026-08-03')
  })

  it('renvoie null quand rien n’est planifié', () => {
    expect(dateDeReference(job(null, null))).toBeNull()
  })
})

describe('trierJobs', () => {
  it('met la job la plus proche en haut', () => {
    const trie = trierJobs([
      job(null, '2026-09-01', 'c'),
      job('2026-08-05', null, 'a'),
      job(null, '2026-08-20', 'b'),
    ])

    expect(trie.map((j) => j.id)).toEqual(['a', 'b', 'c'])
  })

  it('renvoie les jobs non planifiées à la fin', () => {
    const trie = trierJobs([
      job(null, null, 'sans'),
      job(null, '2026-09-01', 'avec'),
    ])

    expect(trie.map((j) => j.id)).toEqual(['avec', 'sans'])
  })

  it('classe une date confirmée avant une fenêtre cible plus lointaine', () => {
    const trie = trierJobs([
      job(null, '2026-08-01', 'cible'),
      job('2026-07-25', '2026-09-01', 'confirmee'),
    ])

    expect(trie.map((j) => j.id)).toEqual(['confirmee', 'cible'])
  })

  it('compare les dates comme des chaînes, sans fuseau horaire', () => {
    // Une `date` Postgres n'a pas d'heure : la passer par `new Date()` la
    // décalerait d'un jour selon le fuseau du serveur.
    const trie = trierJobs([
      job(null, '2026-01-01', 'jour1'),
      job(null, '2025-12-31', 'jour0'),
    ])

    expect(trie.map((j) => j.id)).toEqual(['jour0', 'jour1'])
  })

  it('ne mute pas le tableau reçu', () => {
    const jobs = [job(null, '2026-09-01', 'b'), job(null, '2026-08-01', 'a')]
    trierJobs(jobs)

    expect(jobs.map((j) => j.id)).toEqual(['b', 'a'])
  })

  it('tolère une liste vide', () => {
    expect(trierJobs([])).toEqual([])
  })
})
