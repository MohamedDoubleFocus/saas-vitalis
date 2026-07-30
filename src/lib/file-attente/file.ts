/**
 * Cœur pur de la file d'attente d'écritures (CLAUDE.md §5).
 *
 * Aucune dépendance au navigateur, à React ou à Supabase : uniquement des
 * transformations de tableaux. Le stockage vit dans `stockage.ts`, l'exécution
 * dans `executeurs.ts`, le pilotage dans `fournisseur.tsx`.
 *
 * Ce n'est PAS une synchronisation : rien ne redescend du serveur. Une seule
 * direction, des écritures sortantes.
 */

/** Mutations que la file sait porter. */
export type TypeMutation =
  | 'maj_territoire_complete'
  | 'creation_lead'
  | 'close_vente'
  | 'maj_statut_rdv'

export type Mutation = {
  id: string
  type: TypeMutation
  /** Charge utile, propre à chaque type. Validée par son exécuteur. */
  charge: unknown
  creeLe: number
  tentatives: number
  derniereErreur: string | null
}

/**
 * Au-delà, on arrête de réessayer et on signale.
 *
 * Une erreur qui persiste n'est presque jamais un problème de réseau : c'est un
 * refus de la RLS, une charge invalide, une ligne supprimée. Réessayer sans fin
 * masquerait le vrai problème et ferait tourner la batterie du téléphone.
 */
export const MAX_TENTATIVES = 5

export function estEchouee(mutation: Mutation): boolean {
  return mutation.tentatives >= MAX_TENTATIVES
}

export function creerMutation(
  type: TypeMutation,
  charge: unknown,
  id: string,
  creeLe: number,
): Mutation {
  return { id, type, charge, creeLe, tentatives: 0, derniereErreur: null }
}

/**
 * Clé de fusion, ou `null` si la mutation ne doit jamais être fusionnée.
 *
 * Cocher puis décocher puis recocher une rue hors réseau ne doit produire QU'UNE
 * écriture — la dernière. À l'inverse, deux créations de lead sont deux leads :
 * les fusionner en perdrait un, ce qui violerait « ne jamais perdre une saisie ».
 */
export function cleFusion(mutation: Mutation): string | null {
  if (mutation.type === 'maj_territoire_complete') {
    const charge = mutation.charge as { territoire_id?: unknown }

    return typeof charge?.territoire_id === 'string'
      ? `maj_territoire_complete:${charge.territoire_id}`
      : null
  }

  // Une vente corrigée avant d'être partie remplace la précédente : deux closes
  // en attente sur le même rendez-vous décriraient le même contrat, dont seul le
  // dernier état compte. `conclure_vente()` est de toute façon idempotente en
  // base — la fusion évite juste un aller-retour inutile.
  if (mutation.type === 'close_vente') {
    const charge = mutation.charge as { opportuniteId?: unknown }

    return typeof charge?.opportuniteId === 'string'
      ? `close_vente:${charge.opportuniteId}`
      : null
  }

  // Idem : seul le dernier statut choisi compte.
  if (mutation.type === 'maj_statut_rdv') {
    const charge = mutation.charge as { opportuniteId?: unknown }

    return typeof charge?.opportuniteId === 'string'
      ? `maj_statut_rdv:${charge.opportuniteId}`
      : null
  }

  return null
}

/** Clé de fusion d'un close, pour savoir si une vente attend encore. */
export function cleClose(opportuniteId: string): string {
  return `close_vente:${opportuniteId}`
}

/** Clé de fusion d'un changement de statut de rendez-vous. */
export function cleStatutRdv(opportuniteId: string): string {
  return `maj_statut_rdv:${opportuniteId}`
}

/**
 * Ajoute une mutation.
 *
 * Si une mutation fusionnable de même clé est déjà en file, elle est remplacée
 * **sur place** : la charge et le compteur de tentatives sont réinitialisés,
 * mais la position et `creeLe` d'origine sont conservés, pour que l'ordre
 * d'émission reste celui des gestes de l'utilisateur.
 */
export function ajouter(file: Mutation[], mutation: Mutation): Mutation[] {
  const cle = cleFusion(mutation)

  if (cle !== null) {
    const index = file.findIndex((m) => cleFusion(m) === cle)

    if (index !== -1) {
      const copie = [...file]

      copie[index] = {
        ...mutation,
        id: file[index].id,
        creeLe: file[index].creeLe,
      }

      return copie
    }
  }

  return [...file, mutation]
}

/** Retire une mutation — appelé après un envoi réussi. */
export function retirer(file: Mutation[], id: string): Mutation[] {
  return file.filter((m) => m.id !== id)
}

/** Incrémente le compteur de tentatives et retient la cause. */
export function marquerEchec(
  file: Mutation[],
  id: string,
  erreur: string,
): Mutation[] {
  return file.map((m) =>
    m.id === id
      ? { ...m, tentatives: m.tentatives + 1, derniereErreur: erreur }
      : m,
  )
}

/** Remet une mutation abandonnée dans le circuit (action manuelle). */
export function reinitialiser(file: Mutation[], id: string): Mutation[] {
  return file.map((m) =>
    m.id === id ? { ...m, tentatives: 0, derniereErreur: null } : m,
  )
}

/** Prochaine mutation à envoyer : la plus ancienne non abandonnée. FIFO. */
export function prochaine(file: Mutation[]): Mutation | null {
  return file.find((m) => !estEchouee(m)) ?? null
}

/** Mutations encore susceptibles de partir. */
export function enAttente(file: Mutation[]): Mutation[] {
  return file.filter((m) => !estEchouee(m))
}

/** Mutations abandonnées, à signaler à l'utilisateur. */
export function echouees(file: Mutation[]): Mutation[] {
  return file.filter(estEchouee)
}

/** Vrai si une mutation fusionnable concernant cette clé est encore en file. */
export function contientCle(file: Mutation[], cle: string): boolean {
  return file.some((m) => !estEchouee(m) && cleFusion(m) === cle)
}

/** Clé de fusion d'une mise à jour de territoire, pour interroger la file. */
export function cleTerritoire(territoireId: string): string {
  return `maj_territoire_complete:${territoireId}`
}

/** Message lisible extrait de n'importe quelle valeur levée. */
export function messageErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message
  if (typeof erreur === 'string') return erreur

  return 'Erreur inconnue'
}

/**
 * Nature d'un échec d'envoi.
 *
 * - `reseau` : rien n'est parti. On NE compte PAS de tentative et on arrête de
 *   vider la file — sinon une coupure brûlerait les 5 tentatives en une seconde
 *   et abandonnerait une saisie que le réseau aurait fini par accepter. C'est
 *   exactement le scénario que §5 interdit (« ne jamais perdre une saisie »).
 * - `refus` : le serveur a répondu et a dit non (RLS, charge invalide, ligne
 *   disparue). Réessayer à l'identique ne changera rien : on compte la tentative.
 */
export type Classement = 'reseau' | 'refus'

const MOTIFS_RESEAU =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|econnreset|enotfound|aborted/i

export function classerErreur(erreur: unknown, enLigne: boolean): Classement {
  // `navigator.onLine` à false est un signal fiable dans ce sens-là : le
  // système affirme qu'il n'y a aucune interface réseau.
  if (!enLigne) return 'reseau'

  return MOTIFS_RESEAU.test(messageErreur(erreur)) ? 'reseau' : 'refus'
}
