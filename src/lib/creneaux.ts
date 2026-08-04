import {
  formaterHeure,
  formaterJour,
  heureLocale,
  jourLocalIso,
  libelleEcheance,
} from './echeances'
import { FUSEAU_QUEBEC, instantDepuisLocal, partiesDansFuseau } from './fuseau'

/**
 * Créneaux de rendez-vous proposés au client, à la porte.
 *
 * ⚠️ SOURCE TEMPORAIRE. Les créneaux sont aujourd'hui *générés* selon des heures
 * fixes. Au module 2.5, ils viendront du Google Agenda du closer. Toute l'UI
 * passe par `obtenirCreneaux()` : il suffira de remplacer le corps de cette
 * fonction, sans toucher aux écrans.
 */

export type Creneau = {
  /** Clé stable — utilisable en `key` React et en valeur de formulaire. */
  id: string
  /** Début du rendez-vous. C'est ce qui part dans `opportunites.date_rdv`. */
  debut: Date
  /** Jour local AAAA-MM-JJ, pour regrouper l'affichage par journée. */
  jour: string
}

export type ConfigCreneaux = {
  /** Heures de début proposées, en heure locale (17 = 17 h). */
  heures: readonly number[]
  /** Jours ouvrés — 0 = dimanche, 1 = lundi … 6 = samedi. */
  joursOuvres: readonly number[]
  /** Nombre de jours proposés, aujourd'hui compris. */
  joursAvance: number
  /**
   * Délai minimal entre maintenant et un créneau proposé. Évite de proposer
   * 17 h à 16 h 58 alors que le closer ne pourrait jamais y être.
   */
  delaiMinimumMinutes: number
}

/**
 * ⚙️ Les heures et jours de rendez-vous se règlent ICI. Une seule constante à
 * modifier pour changer l'offre de créneaux de toute l'app.
 */
export const CONFIG_CRENEAUX: ConfigCreneaux = {
  // 9 h à 19 h : le dernier rendez-vous commence à 19 h et finit à 20 h.
  // Mêmes bornes que `CONFIG_DISPONIBILITES` (module 2.5), pour que le repli
  // ressemble à ce que le knocker voit d'habitude.
  heures: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  // 7 jours sur 7 : les closers travaillent aussi le week-end.
  joursOuvres: [0, 1, 2, 3, 4, 5, 6],
  joursAvance: 7,
  delaiMinimumMinutes: 90,
}

/**
 * Génère les créneaux à partir d'un instant donné.
 *
 * ⚠️ « 17 h » veut dire 17 h **au Québec**, pas 17 h sur l'appareil.
 *
 * L'ancienne version utilisait `new Date(a, m, j, h)` et se fiait au fuseau de
 * l'appareil. C'était juste sur le téléphone d'un knocker à Granby, et faux
 * partout ailleurs : un repli calculé sur un serveur en UTC proposait des
 * créneaux décalés de quatre heures. L'heure d'un rendez-vous est un fait
 * métier, pas une propriété de la machine qui l'affiche.
 */
export function genererCreneaux(
  maintenant: Date,
  config: ConfigCreneaux = CONFIG_CRENEAUX,
): Creneau[] {
  const plancher = new Date(
    maintenant.getTime() + config.delaiMinimumMinutes * 60 * 1000,
  )

  const creneaux: Creneau[] = []
  const aujourdhui = partiesDansFuseau(maintenant, FUSEAU_QUEBEC)

  for (let decalage = 0; decalage < config.joursAvance; decalage++) {
    // `Date.UTC` normalise les débordements de mois et d'année.
    const cible = new Date(
      Date.UTC(aujourdhui.annee, aujourdhui.mois - 1, aujourdhui.jour + decalage),
    )

    if (!config.joursOuvres.includes(cible.getUTCDay())) continue

    const annee = cible.getUTCFullYear()
    const mois = cible.getUTCMonth() + 1
    const jour = cible.getUTCDate()

    for (const heure of config.heures) {
      const debut = instantDepuisLocal(annee, mois, jour, heure, 0, FUSEAU_QUEBEC)

      if (debut.getTime() < plancher.getTime()) continue

      const jourIso = jourLocalIso(debut)

      creneaux.push({
        id: `${jourIso}T${String(heure).padStart(2, '0')}`,
        debut,
        jour: jourIso,
      })
    }
  }

  return creneaux
}

/** Créneaux regroupés par journée, pour l'affichage. */
export type JourneeCreneaux = {
  jour: string
  /** « lundi 3 août ». */
  libelleJour: string
  /** « Aujourd'hui », « Demain », « Dans 3 jours ». */
  libelleEcheance: string
  creneaux: Creneau[]
}

export function grouperParJournee(
  creneaux: readonly Creneau[],
  maintenant: Date,
): JourneeCreneaux[] {
  const journees: JourneeCreneaux[] = []

  for (const creneau of creneaux) {
    let journee = journees.find((j) => j.jour === creneau.jour)

    if (!journee) {
      journee = {
        jour: creneau.jour,
        libelleJour: formaterJour(creneau.debut),
        libelleEcheance: libelleEcheance(creneau.debut, maintenant),
        creneaux: [],
      }
      journees.push(journee)
    }

    journee.creneaux.push(creneau)
  }

  return journees
}

/** Libellé d'un créneau seul : « 17 h 00 ». */
export function libelleCreneau(creneau: Creneau): string {
  return formaterHeure(creneau.debut)
}

/**
 * D'où viennent les créneaux affichés.
 *
 * - `google` : lus dans l'agenda réel du closer, les heures prises sont exclues.
 * - `repli`  : créneaux fixes, parce que Google est injoignable ou que le closer
 *   n'a pas de calendrier associé. Ils peuvent proposer une heure déjà prise —
 *   l'écran doit le dire.
 */
export type SourceCreneauxUtilisee = 'google' | 'repli'

export type ResultatCreneaux = {
  creneaux: Creneau[]
  source: SourceCreneauxUtilisee
}

export type SourceCreneaux = (
  closerId: string | null,
  maintenant: Date,
) => Promise<ResultatCreneaux>

function versCreneau(iso: string): Creneau | null {
  const debut = new Date(iso)

  if (Number.isNaN(debut.getTime())) return null

  const jour = jourLocalIso(debut)

  return {
    // `heureLocale` et non `debut.getHours()` : l'identifiant doit désigner la
    // même heure pour tout le monde, serveur comme téléphone.
    id: `${jour}T${String(heureLocale(debut)).padStart(2, '0')}`,
    debut,
    jour,
  }
}

/**
 * Source des créneaux — **branchée sur le Google Agenda du closer**.
 *
 * L'appel passe par `/api/creneaux` : lire l'agenda exige le jeton du compte
 * Google, donc le serveur. Le jeton ne descend jamais ici.
 *
 * Tout échec — réseau coupé, Google en panne, route indisponible — retombe sur
 * les créneaux fixes plutôt que de laisser le knocker sans rien à proposer
 * devant le client (CLAUDE.md §5).
 */
export const obtenirCreneaux: SourceCreneaux = async (closerId, maintenant) => {
  const repli = (): ResultatCreneaux => ({
    creneaux: genererCreneaux(maintenant),
    source: 'repli',
  })

  if (typeof fetch === 'undefined') return repli()

  try {
    const parametres = new URLSearchParams()

    if (closerId) parametres.set('closer', closerId)

    const reponse = await fetch(`/api/creneaux?${parametres.toString()}`, {
      cache: 'no-store',
    })

    if (!reponse.ok) return repli()

    const donnees = (await reponse.json()) as {
      source?: unknown
      creneaux?: unknown
    }

    if (!Array.isArray(donnees.creneaux)) return repli()

    const creneaux = donnees.creneaux
      .filter((valeur): valeur is string => typeof valeur === 'string')
      .map(versCreneau)
      .filter((creneau): creneau is Creneau => creneau !== null)

    // Le serveur a répondu mais n'a rien de libre : c'est une information, pas
    // une panne. On ne substitue pas des créneaux fixes qui seraient faux.
    return {
      creneaux,
      source: donnees.source === 'google' ? 'google' : 'repli',
    }
  } catch {
    return repli()
  }
}
