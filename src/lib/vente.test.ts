import { describe, expect, it } from 'vitest'

import {
  formaterMontant,
  lireMontant,
  precisionsVente,
  soldeDu,
  totalExtras,
  totalVente,
  totalVolets,
  validerClose,
  type ExtraSaisi,
  type VoletSaisi,
} from './vente'

function volet(partiel: Partial<VoletSaisi> = {}): VoletSaisi {
  return {
    cle: 'v1',
    type: 'refection_bardeaux',
    produitGonano: null,
    deuxiemeCoucheFortify: false,
    couleur: '',
    montant: '1000',
    ...partiel,
  }
}

function extra(partiel: Partial<ExtraSaisi> = {}): ExtraSaisi {
  return { cle: 'e1', description: 'Gouttières', montant: '500', ...partiel }
}

const CLIENT_OK = {
  nom: 'Jean Tremblay',
  telephone: '450-555-1234',
  courriel: 'jean@exemple.ca',
}

describe('lireMontant', () => {
  it('lit un nombre simple', () => {
    expect(lireMontant('1200')).toBe(1200)
    expect(lireMontant('1200.50')).toBe(1200.5)
  })

  it('accepte la virgule décimale du fr-CA', () => {
    expect(lireMontant('1200,50')).toBe(1200.5)
  })

  it('accepte les espaces de milliers et le dollar', () => {
    expect(lireMontant('12 400,00 $')).toBe(12400)
    // Espace insécable, celui que produisent les claviers et les copier-coller.
    expect(lireMontant('12 400')).toBe(12400)
  })

  it('renvoie null sur une saisie vide ou illisible', () => {
    expect(lireMontant('')).toBeNull()
    expect(lireMontant('   ')).toBeNull()
    expect(lireMontant('abc')).toBeNull()
  })

  it('accepte zéro sans le confondre avec l’absence', () => {
    expect(lireMontant('0')).toBe(0)
  })
})

describe('totaux', () => {
  it('additionne les volets', () => {
    expect(totalVolets([volet({ montant: '2400' }), volet({ montant: '1800,50' })])).toBe(
      4200.5,
    )
  })

  it('additionne les extras', () => {
    expect(totalExtras([extra({ montant: '500' }), extra({ montant: '350' })])).toBe(850)
  })

  it('ignore les montants non saisis au lieu d’échouer', () => {
    // Le closer ajoute un volet puis tape le montant : entre les deux, le total
    // doit rester affichable.
    expect(totalVolets([volet({ montant: '2400' }), volet({ montant: '' })])).toBe(2400)
  })

  it('le total de la vente est volets + extras', () => {
    expect(totalVente([volet({ montant: '2400' })], [extra({ montant: '500' })])).toBe(
      2900,
    )
  })

  it('arrondit au cent', () => {
    expect(totalVente([volet({ montant: '0.1' }), volet({ montant: '0.2' })], [])).toBe(
      0.3,
    )
  })

  it('vaut zéro sur une vente vide', () => {
    expect(totalVente([], [])).toBe(0)
  })
})

describe('soldeDu', () => {
  it('applique la formule de l’invariant §4.8', () => {
    // montant_contrat + Σ(extras facturables) − depot_recu
    expect(soldeDu(10000, [{ montant: 500 }, { montant: 350 }], 2000)).toBe(8850)
  })

  it('exclut les extras non facturables — à l’appelant de les filtrer', () => {
    expect(soldeDu(10000, [{ montant: 500 }], 0)).toBe(10500)
  })

  it('tolère un contrat ou un dépôt absent', () => {
    expect(soldeDu(null, [], null)).toBe(0)
    expect(soldeDu(10000, [], null)).toBe(10000)
    expect(soldeDu(null, [{ montant: 500 }], 100)).toBe(400)
  })

  it('passe en négatif si le client a trop payé', () => {
    expect(soldeDu(1000, [], 1500)).toBe(-500)
  })

  it('vaut zéro quand tout est payé', () => {
    expect(soldeDu(10000, [{ montant: 500 }], 10500)).toBe(0)
  })
})

describe('formaterMontant', () => {
  it('formate en dollars canadiens', () => {
    const texte = formaterMontant(12400)

    expect(texte).toContain('12')
    expect(texte).toContain('400')
    expect(texte).toContain('$')
  })

  it('affiche toujours les cents', () => {
    expect(formaterMontant(1200.5)).toContain('50')
  })
})

describe('validerClose', () => {
  it('accepte une vente complète', () => {
    expect(
      validerClose(CLIENT_OK, [volet()], [], '', ''),
    ).toEqual([])
  })

  it('exige les trois infos client', () => {
    const erreurs = validerClose(
      { nom: '', telephone: '', courriel: '' },
      [volet()],
      [],
      '',
      '',
    )

    expect(erreurs).toHaveLength(3)
    expect(erreurs.join(' ')).toMatch(/nom/i)
    expect(erreurs.join(' ')).toMatch(/téléphone/i)
    expect(erreurs.join(' ')).toMatch(/courriel/i)
  })

  it('refuse un téléphone incomplet', () => {
    expect(
      validerClose({ ...CLIENT_OK, telephone: '555-1234' }, [volet()], [], '', ''),
    ).toContain('Un téléphone valide est obligatoire.')
  })

  it('refuse un courriel sans arobase ni point', () => {
    expect(
      validerClose({ ...CLIENT_OK, courriel: 'jean.exemple.ca' }, [volet()], [], '', ''),
    ).toContain('Un courriel valide est obligatoire.')

    expect(
      validerClose({ ...CLIENT_OK, courriel: 'jean@exemple' }, [volet()], [], '', ''),
    ).toContain('Un courriel valide est obligatoire.')
  })

  it('exige au moins un volet ou un extra', () => {
    expect(validerClose(CLIENT_OK, [], [], '', '')).toContain(
      'Ajoute au moins un volet de travaux ou un extra.',
    )
  })

  it('accepte une vente faite uniquement d’extras', () => {
    expect(validerClose(CLIENT_OK, [], [extra()], '', '')).toEqual([])
  })

  it('refuse un volet sans montant', () => {
    const erreurs = validerClose(CLIENT_OK, [volet({ montant: '' })], [], '', '')

    expect(erreurs.join(' ')).toMatch(/Montant manquant/)
  })

  it('refuse un montant à zéro ou négatif', () => {
    expect(validerClose(CLIENT_OK, [volet({ montant: '0' })], [], '', '').length)
      .toBeGreaterThan(0)
    expect(validerClose(CLIENT_OK, [volet({ montant: '-500' })], [], '', '').length)
      .toBeGreaterThan(0)
  })

  it('exige le produit sur un volet GoNano', () => {
    expect(
      validerClose(
        CLIENT_OK,
        [volet({ type: 'traitement_gonano', produitGonano: null })],
        [],
        '',
        '',
      ),
    ).toContain('Choisis le produit GoNano.')

    expect(
      validerClose(
        CLIENT_OK,
        [volet({ type: 'traitement_gonano', produitGonano: 'fortify' })],
        [],
        '',
        '',
      ),
    ).toEqual([])
  })

  it('exige une description sur chaque extra', () => {
    expect(
      validerClose(CLIENT_OK, [], [extra({ description: '  ' })], '', ''),
    ).toContain('Chaque extra a besoin d’une description.')
  })

  it('refuse une fenêtre cible à l’envers', () => {
    expect(
      validerClose(CLIENT_OK, [volet()], [], '2026-09-15', '2026-09-01'),
    ).toContain('La fin de la fenêtre cible précède son début.')
  })

  it('accepte une fenêtre cible partielle ou absente', () => {
    expect(validerClose(CLIENT_OK, [volet()], [], '2026-09-01', '')).toEqual([])
    expect(validerClose(CLIENT_OK, [volet()], [], '', '2026-09-15')).toEqual([])
  })

  it('ne répète pas deux fois la même erreur', () => {
    const erreurs = validerClose(
      CLIENT_OK,
      [],
      [extra({ description: '' }), extra({ cle: 'e2', description: '' })],
      '',
      '',
    )

    expect(
      erreurs.filter((e) => e === 'Chaque extra a besoin d’une description.'),
    ).toHaveLength(1)
  })
})

describe('precisionsVente', () => {
  it('remonte la couleur des bardeaux, faute de colonne dédiée', () => {
    expect(
      precisionsVente([volet({ type: 'refection_bardeaux', couleur: 'Charcoal' })]),
    ).toBe('Couleur des bardeaux : Charcoal.')
  })

  it('ignore les volets sans couleur et les volets GoNano', () => {
    expect(
      precisionsVente([
        volet({ type: 'refection_bardeaux', couleur: '' }),
        volet({ type: 'traitement_gonano', couleur: 'Bleu' }),
      ]),
    ).toBe('')
  })

  it('ne répète pas une couleur identique sur deux volets', () => {
    expect(
      precisionsVente([
        volet({ cle: 'a', couleur: 'Charcoal' }),
        volet({ cle: 'b', couleur: 'Charcoal' }),
      ]),
    ).toBe('Couleur des bardeaux : Charcoal.')
  })
})
