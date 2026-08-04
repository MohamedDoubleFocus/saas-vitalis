import { describe, expect, it } from 'vitest'

import { messageConfirmation, peutEnvoyer } from './messages'

/** Instant UTC explicite : le test ne dépend pas du fuseau de la machine. */
function utc(annee: number, mois: number, jour: number, heure = 0) {
  return new Date(Date.UTC(annee, mois - 1, jour, heure))
}

// 21 h UTC = 17 h au Québec, un lundi.
const RDV = utc(2026, 8, 3, 21)

describe('messageConfirmation', () => {
  it('compose le message complet', () => {
    const texte = messageConfirmation({
      clientNom: 'Jean Tremblay',
      closerNom: 'Billal',
      dateRdv: RDV,
    })

    expect(texte).toContain('Bonjour Jean Tremblay,')
    expect(texte).toContain('c’est Billal de Toitures Vitalis')
    expect(texte).toContain('lundi')
    expect(texte).toContain('août')
    expect(texte).toContain('À bientôt!')
  })

  it('donne l’heure du QUÉBEC, pas celle du serveur', () => {
    // 21 h UTC doit se lire 17 h : c'est l'heure que le client verra.
    const texte = messageConfirmation({
      clientNom: 'Jean',
      closerNom: 'Billal',
      dateRdv: RDV,
    })

    expect(texte).toContain('17')
    expect(texte).not.toContain('21 h')
  })

  it('reste correct sans nom de client', () => {
    const texte = messageConfirmation({
      clientNom: null,
      closerNom: 'Billal',
      dateRdv: RDV,
    })

    expect(texte).toContain('Bonjour, c’est Billal')
    expect(texte).not.toContain('null')
    expect(texte).not.toContain('Bonjour ,')
  })

  it('reste correct sans nom de closer', () => {
    const texte = messageConfirmation({
      clientNom: 'Jean',
      closerNom: null,
      dateRdv: RDV,
    })

    expect(texte).toContain('c’est l’équipe de Toitures Vitalis')
    expect(texte).not.toContain('null')
  })

  it('ignore un nom fait d’espaces', () => {
    const texte = messageConfirmation({
      clientNom: '   ',
      closerNom: '  ',
      dateRdv: RDV,
    })

    expect(texte).toContain('Bonjour, c’est l’équipe')
  })

  it('tient dans une longueur raisonnable pour un SMS', () => {
    const texte = messageConfirmation({
      clientNom: 'Jean-Sébastien Tremblay-Gagnon',
      closerNom: 'Billal',
      dateRdv: RDV,
    })

    // Au-delà de 3 segments GSM (~480 caractères), la facture grimpe vite.
    expect(texte.length).toBeLessThan(480)
  })
})

describe('peutEnvoyer', () => {
  it('exige un expéditeur ET un destinataire', () => {
    expect(peutEnvoyer('+15145551234', '+14505551234')).toBe(true)
  })

  it('refuse sans numéro de closer', () => {
    expect(peutEnvoyer(null, '+14505551234')).toBe(false)
    expect(peutEnvoyer('', '+14505551234')).toBe(false)
    expect(peutEnvoyer('   ', '+14505551234')).toBe(false)
  })

  it('refuse sans numéro de client', () => {
    expect(peutEnvoyer('+15145551234', null)).toBe(false)
    expect(peutEnvoyer('+15145551234', undefined)).toBe(false)
  })
})
