import type { StatutOpp } from './doublons'

/**
 * Chantiers côté roofer : quels statuts le concernent, dans quel ordre les
 * afficher, et quelles transitions il a le droit de poser.
 *
 * Ces règles doublent le trigger `opportunites_restreindre_maj_roofer` : ici
 * pour guider l'interface, en base pour faire autorité.
 */

/** Statuts pendant lesquels une job appartient au roofer. */
export const STATUTS_EXECUTION: readonly StatutOpp[] = [
  'vendu',
  'planifie',
  'en_cours',
  'complete',
]

export function estStatutExecution(statut: StatutOpp): boolean {
  return STATUTS_EXECUTION.includes(statut)
}

/**
 * Transitions qu'un roofer peut poser depuis un statut donné.
 *
 * Une étape à la fois, en avant comme en arrière (CLAUDE.md §6) — un chantier
 * remis en cours après une inspection est un cas normal. `facture`, `paye` et
 * `perdu` n'y figurent jamais : ils sortent de son périmètre.
 */
export function transitionsRoofer(statut: StatutOpp): StatutOpp[] {
  switch (statut) {
    case 'vendu':
      return ['planifie']
    case 'planifie':
      return ['en_cours']
    case 'en_cours':
      return ['complete', 'planifie']
    case 'complete':
      return ['en_cours']
    default:
      return []
  }
}

export function transitionRooferAutorisee(
  depuis: StatutOpp,
  vers: StatutOpp,
): boolean {
  return transitionsRoofer(depuis).includes(vers)
}

/** Libellé du bouton qui pose la transition. */
export const LIBELLES_TRANSITION: Record<string, string> = {
  planifie: 'Planifier',
  en_cours: 'Démarrer les travaux',
  complete: 'Marquer terminé',
}

/**
 * Vers un statut ANTÉRIEUR dans la chaîne : l'interface doit le présenter comme
 * une correction, pas comme une avancée.
 */
export function estRetourEnArriere(depuis: StatutOpp, vers: StatutOpp): boolean {
  const ordre = STATUTS_EXECUTION.indexOf(depuis)
  const cible = STATUTS_EXECUTION.indexOf(vers)

  return ordre !== -1 && cible !== -1 && cible < ordre
}

/* -------------------------------------------------------------------------- */
/* Vue d'administration : TOUS les chantiers, pas seulement ceux à assigner     */
/* -------------------------------------------------------------------------- */

/**
 * Statuts qui font d'une opportunité un chantier.
 *
 * `perdu` en est exclu même s'il vient après dans l'ordre de l'enum : une
 * affaire perdue n'est pas un chantier, et la faire figurer dans une liste de
 * travaux à suivre serait trompeur.
 */
export const STATUTS_CHANTIER: readonly StatutOpp[] = [
  'vendu',
  'planifie',
  'en_cours',
  'complete',
  'facture',
  'paye',
]

export type FiltreChantier =
  | 'a_assigner'
  | 'planifies'
  | 'en_cours'
  | 'termines'
  | 'tous'

/** Ordre des onglets : ce qui demande une action d'abord. */
export const FILTRES_CHANTIER: readonly FiltreChantier[] = [
  'a_assigner',
  'planifies',
  'en_cours',
  'termines',
  'tous',
]

export const LIBELLES_FILTRE_CHANTIER: Record<FiltreChantier, string> = {
  a_assigner: 'À assigner',
  planifies: 'Planifiés',
  en_cours: 'En cours',
  termines: 'Terminés',
  tous: 'Tous',
}

export function lireFiltreChantier(valeur: string | undefined): FiltreChantier {
  return FILTRES_CHANTIER.includes(valeur as FiltreChantier)
    ? (valeur as FiltreChantier)
    : 'a_assigner'
}

/**
 * Un chantier correspond-il à cet onglet ?
 *
 * ⚠️ « À assigner » n'est PAS un statut : c'est « vendu ET sans roofer ». Un
 * chantier vendu déjà confié à quelqu'un ne demande plus rien. C'est pour ça que
 * cette fonction prend le roofer en plus du statut — un filtre sur le seul
 * statut se tromperait.
 */
export function correspondAuFiltreChantier(
  statut: StatutOpp,
  rooferId: string | null,
  filtre: FiltreChantier,
): boolean {
  if (!STATUTS_CHANTIER.includes(statut)) return false

  switch (filtre) {
    case 'a_assigner':
      return statut === 'vendu' && rooferId === null
    case 'planifies':
      return statut === 'planifie'
    case 'en_cours':
      return statut === 'en_cours'
    case 'termines':
      return statut === 'complete' || statut === 'facture' || statut === 'paye'
    case 'tous':
      return true
  }
}

/**
 * Nettoie une recherche libre avant de la passer à PostgREST.
 *
 * ⚠️ `.or()` de PostgREST se lit comme une liste séparée par des VIRGULES, et
 * `ilike` interprète `%` et `_`. Une recherche contenant une virgule casserait
 * le filtre ; une recherche valant `%` retournerait tout. On retire donc les
 * caractères de syntaxe plutôt que de les échapper — dans un champ de recherche
 * d'adresse, aucun d'eux n'a de valeur pour l'utilisateur.
 */
export function nettoyerRecherche(valeur: string): string {
  return valeur
    .replace(/[,%_()\\*"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

export type JobTriable = {
  dateConfirmee: string | null
  dateCibleDebut: string | null
}

/**
 * Date qui fait foi pour un chantier.
 *
 * `date_confirmee` d'abord, `date_cible_debut` ensuite (CLAUDE.md §4.9 : ce sont
 * deux champs distincts, la fenêtre cible n'est qu'une fourchette). `null` quand
 * rien n'est encore planifié.
 */
export function dateDeReference(job: JobTriable): string | null {
  return job.dateConfirmee ?? job.dateCibleDebut ?? null
}

/**
 * Trie les jobs : la plus proche en haut, les non planifiées à la fin.
 *
 * Les dates sont des `date` Postgres (AAAA-MM-JJ) : la comparaison de chaînes
 * suffit et évite tout décalage de fuseau — un chantier prévu le 3 août n'a pas
 * d'heure, il ne doit pas glisser au 2 août selon le fuseau du serveur.
 */
export function trierJobs<T extends JobTriable>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => {
    const da = dateDeReference(a)
    const db = dateDeReference(b)

    if (da === db) return 0
    if (da === null) return 1
    if (db === null) return -1

    return da < db ? -1 : 1
  })
}
