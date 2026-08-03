import type { Database } from '@/lib/supabase/database.types'
import { estTelephoneValide } from '@/lib/telephone'

export type TypeTravail = Database['public']['Enums']['type_travail']
export type ProduitGonano = Database['public']['Enums']['produit_gonano']

/** Un volet de travaux en cours de saisie, avant écriture. */
export type VoletSaisi = {
  /** Clé locale de rendu — jamais envoyée au serveur. */
  cle: string
  type: TypeTravail
  produitGonano: ProduitGonano | null
  deuxiemeCoucheFortify: boolean
  /** Couleur des bardeaux. Faute de colonne dédiée, part dans la note d'audit. */
  couleur: string
  /** Saisie libre : le champ peut être vide ou en cours de frappe. */
  montant: string
}

export type ExtraSaisi = {
  cle: string
  description: string
  montant: string
}

export const LIBELLES_TYPE_TRAVAIL: Record<TypeTravail, string> = {
  traitement_gonano: 'Traitement GoNano',
  refection_bardeaux: 'Réfection bardeaux',
  refection_metal: 'Réfection métal',
  gouttieres: 'Gouttières',
  autre: 'Autre',
}

/** Types proposés au closer. Pas de métal (décision produit du module 3). */
export const TYPES_VOLET_VENDABLES: readonly TypeTravail[] = [
  'traitement_gonano',
  'refection_bardeaux',
]

export const LIBELLES_PRODUIT_GONANO: Record<ProduitGonano, string> = {
  fortify: 'Fortify',
  revive: 'Revive',
  bio_boost: 'Bio-Boost',
}

export const PRODUITS_GONANO: readonly ProduitGonano[] = [
  'fortify',
  'revive',
  'bio_boost',
]

/**
 * Lit un montant saisi à la main.
 *
 * Accepte la virgule décimale (fr-CA), les espaces de milliers et le signe de
 * dollar : le closer tape vite, sur un téléphone, devant un client.
 * Renvoie `null` si ce n'est pas un nombre exploitable.
 */
export function lireMontant(saisie: string): number | null {
  const nettoye = saisie
    .replace(/\s| |\$/g, '')
    .replace(',', '.')
    .trim()

  if (nettoye === '') return null

  const valeur = Number(nettoye)

  return Number.isFinite(valeur) ? valeur : null
}

/** Arrondi au cent — les montants sont des `numeric(12,2)` en base. */
function auCent(valeur: number): number {
  return Math.round(valeur * 100) / 100
}

export function totalVolets(volets: readonly VoletSaisi[]): number {
  return auCent(
    volets.reduce((somme, volet) => somme + (lireMontant(volet.montant) ?? 0), 0),
  )
}

export function totalExtras(extras: readonly ExtraSaisi[]): number {
  return auCent(
    extras.reduce((somme, extra) => somme + (lireMontant(extra.montant) ?? 0), 0),
  )
}

/** Ce que le client signe : volets + extras. */
export function totalVente(
  volets: readonly VoletSaisi[],
  extras: readonly ExtraSaisi[],
): number {
  return auCent(totalVolets(volets) + totalExtras(extras))
}

/**
 * Solde dû — **jamais stocké** (CLAUDE.md §4.8).
 *
 * `montantContrat + Σ(extras facturables) − depotRecu`. Les extras non
 * facturables (absorbés par l'entreprise) sont exclus.
 *
 * `montantContrat` ne contient que les volets : c'est ce que `conclure_vente()`
 * écrit. Additionner les extras ici et les avoir déjà dans le contrat les
 * compterait deux fois.
 */
export function soldeDu(
  montantContrat: number | null,
  extrasFacturables: readonly { montant: number }[],
  depotRecu: number | null,
): number {
  const extras = extrasFacturables.reduce((somme, extra) => somme + extra.montant, 0)

  return auCent((montantContrat ?? 0) + extras - (depotRecu ?? 0))
}

export type StatutPaiement = Database['public']['Enums']['statut_paiement']

export const LIBELLES_STATUT_PAIEMENT: Record<StatutPaiement, string> = {
  non_paye: 'Non payé',
  depot: 'Dépôt reçu',
  complet: 'Payé en entier',
}

const FORMAT_CAD = new Intl.NumberFormat('fr-CA', {
  style: 'currency',
  currency: 'CAD',
})

/** « 12 400,00 $ » — devise CAD, convention fr-CA. */
export function formaterMontant(valeur: number): string {
  return FORMAT_CAD.format(valeur)
}

export type InfosClient = {
  nom: string
  telephone: string
  courriel: string
}

/**
 * Validation du formulaire de close.
 *
 * Double de la validation faite par `conclure_vente()` en base. Celle-ci sert à
 * guider le closer en direct ; **c'est la fonction SQL qui fait autorité** — une
 * validation dans le navigateur se contourne.
 */
export function validerClose(
  client: InfosClient,
  volets: readonly VoletSaisi[],
  extras: readonly ExtraSaisi[],
  dateCibleDebut: string,
  dateCibleFin: string,
): string[] {
  const erreurs: string[] = []

  if (client.nom.trim() === '') {
    erreurs.push('Le nom du client est obligatoire.')
  }

  if (!estTelephoneValide(client.telephone)) {
    erreurs.push('Un téléphone valide est obligatoire.')
  }

  // Volontairement permissif : un `@` et un point suffisent. Le but est
  // d'attraper la faute de frappe, pas de refuser une adresse exotique.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.courriel.trim())) {
    erreurs.push('Un courriel valide est obligatoire.')
  }

  if (volets.length === 0 && extras.length === 0) {
    erreurs.push('Ajoute au moins un volet de travaux ou un extra.')
  }

  for (const volet of volets) {
    const montant = lireMontant(volet.montant)

    if (montant === null || montant <= 0) {
      erreurs.push(
        `Montant manquant ou invalide pour « ${LIBELLES_TYPE_TRAVAIL[volet.type]} ».`,
      )
    }

    if (volet.type === 'traitement_gonano' && !volet.produitGonano) {
      erreurs.push('Choisis le produit GoNano.')
    }
  }

  for (const extra of extras) {
    if (extra.description.trim() === '') {
      erreurs.push('Chaque extra a besoin d’une description.')
    }

    const montant = lireMontant(extra.montant)

    if (montant === null || montant <= 0) {
      erreurs.push('Montant manquant ou invalide pour un extra.')
    }
  }

  if (totalVente(volets, extras) <= 0) {
    erreurs.push('Le total de la vente doit être supérieur à zéro.')
  }

  if (dateCibleDebut && dateCibleFin && dateCibleFin < dateCibleDebut) {
    erreurs.push('La fin de la fenêtre cible précède son début.')
  }

  // Deux volets peuvent avoir le même libellé d'erreur : on ne répète pas.
  return [...new Set(erreurs)]
}

/**
 * Texte des précisions jointes à la note d'audit.
 *
 * Recueille ce que le schéma ne sait pas stocker — aujourd'hui la couleur des
 * bardeaux, faute de colonne dédiée sur `opportunite_travaux`.
 */
export function precisionsVente(volets: readonly VoletSaisi[]): string {
  const lignes = volets
    .filter((volet) => volet.type === 'refection_bardeaux' && volet.couleur.trim())
    .map((volet) => `Couleur des bardeaux : ${volet.couleur.trim()}.`)

  return [...new Set(lignes)].join('\n')
}
