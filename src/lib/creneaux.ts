import { formaterHeure, formaterJour, jourLocalIso, libelleEcheance } from './echeances'

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
  heures: [17, 18, 19],
  joursOuvres: [1, 2, 3, 4, 5],
  joursAvance: 7,
  delaiMinimumMinutes: 90,
}

/**
 * Génère les créneaux à partir d'un instant donné.
 *
 * Les dates sont construites avec le constructeur `Date(a, m, j, h)`, donc en
 * heure **locale de l'appareil**. C'est voulu : c'est le téléphone du knocker,
 * sur le terrain, qui définit ce que « 17 h » veut dire.
 */
export function genererCreneaux(
  maintenant: Date,
  config: ConfigCreneaux = CONFIG_CRENEAUX,
): Creneau[] {
  const plancher = new Date(
    maintenant.getTime() + config.delaiMinimumMinutes * 60 * 1000,
  )

  const creneaux: Creneau[] = []

  for (let decalage = 0; decalage < config.joursAvance; decalage++) {
    const jour = new Date(
      maintenant.getFullYear(),
      maintenant.getMonth(),
      maintenant.getDate() + decalage,
    )

    if (!config.joursOuvres.includes(jour.getDay())) continue

    for (const heure of config.heures) {
      const debut = new Date(
        jour.getFullYear(),
        jour.getMonth(),
        jour.getDate(),
        heure,
      )

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
 * Source des créneaux — **le point de bascule du module 2.5**.
 *
 * Signature volontairement asynchrone et paramétrée par le closer, alors que
 * l'implémentation actuelle n'a besoin ni de l'un ni de l'autre : le jour où les
 * créneaux viendront du Google Agenda du closer, seul ce corps changera.
 */
export type SourceCreneaux = (
  closerId: string | null,
  maintenant: Date,
) => Promise<Creneau[]>

export const obtenirCreneaux: SourceCreneaux = async (closerId, maintenant) => {
  // `closerId` sera utilisé au module 2.5 pour interroger l'agenda du closer.
  void closerId

  return genererCreneaux(maintenant)
}
