import {
  FUSEAU_QUEBEC,
  instantDepuisLocal,
  partiesDansFuseau,
} from '@/lib/fuseau'

/**
 * Créneaux libres = heures ouvrables − occupations du calendrier.
 *
 * Entièrement pur : aucune dépendance à Google, au réseau ni au navigateur. On
 * lui passe les plages occupées, il rend les débuts de créneaux disponibles.
 *
 * Le résultat ne dépend PAS du fuseau du processus — voir `creneauxLibres`.
 */

export type Intervalle = {
  debut: Date
  fin: Date
}

export type ConfigDisponibilites = {
  /** Première heure de début proposée (9 = 9 h). */
  heureDebut: number
  /**
   * Heure de fin des plages : un créneau doit se TERMINER avant.
   * 20 avec une durée de 60 min ⇒ le dernier créneau commence à 19 h.
   */
  heureFin: number
  /** Durée d'un rendez-vous, en minutes. */
  dureeMinutes: number
  /** Jours travaillés — 0 = dimanche … 6 = samedi. */
  joursOuvres: readonly number[]
  /** Nombre de jours proposés, aujourd'hui compris. */
  joursAvance: number
  /** Délai minimal entre maintenant et un créneau proposé. */
  delaiMinimumMinutes: number
}

/**
 * ⚙️ Réglage unique des disponibilités. Modifier ici change l'offre de créneaux
 * de toute l'application.
 *
 * Plage large (9 h–20 h) parce que c'est désormais l'agenda réel du closer qui
 * retire ce qui est pris : inutile de deviner ses habitudes, il suffit de ne pas
 * proposer ce qui est déjà occupé.
 */
export const CONFIG_DISPONIBILITES: ConfigDisponibilites = {
  heureDebut: 9,
  heureFin: 20,
  dureeMinutes: 60,
  // 7 jours sur 7 : les closers travaillent aussi le week-end.
  joursOuvres: [0, 1, 2, 3, 4, 5, 6],
  joursAvance: 7,
  delaiMinimumMinutes: 90,
}

/** Deux intervalles se chevauchent-ils ? Bornes ouvertes : 17-18 et 18-19 non. */
export function seChevauchent(a: Intervalle, b: Intervalle): boolean {
  return a.debut.getTime() < b.fin.getTime() && a.fin.getTime() > b.debut.getTime()
}

/**
 * Le jour calendaire à `decalage` jours du jour de `instant`, dans le fuseau
 * de l'entreprise.
 *
 * `Date.UTC` normalise les débordements : le 31 + 1 devient le 1er du mois
 * suivant, changement d'année compris. On lit ensuite le jour de la semaine sur
 * cette date UTC pure — c'est bien le jour calendaire, sans influence de fuseau.
 */
function jourCalendaire(
  instant: Date,
  decalage: number,
): { annee: number; mois: number; jour: number; jourSemaine: number } {
  const p = partiesDansFuseau(instant, FUSEAU_QUEBEC)
  const cible = new Date(Date.UTC(p.annee, p.mois - 1, p.jour + decalage))

  return {
    annee: cible.getUTCFullYear(),
    mois: cible.getUTCMonth() + 1,
    jour: cible.getUTCDate(),
    jourSemaine: cible.getUTCDay(),
  }
}

/**
 * Débuts de créneaux disponibles.
 *
 * ⚠️ Les instants sont construits par `instantDepuisLocal(...FUSEAU_QUEBEC)`, et
 * SURTOUT PAS par `new Date(a, m, j, h)`.
 *
 * Cette fonction tourne côté serveur (`/api/creneaux`). Sur Vercel, `TZ` vaut
 * UTC : `new Date(a, m, j, 9)` y construisait 9 h UTC, soit 5 h du matin au
 * Québec. Le knocker se voyait proposer des créneaux décalés de quatre heures,
 * et le rendez-vous atterrissait à la mauvaise heure dans l'agenda du closer.
 *
 * Le code d'origine dépendait du réglage `TZ` du déploiement. Un fuseau
 * d'entreprise est un fait métier : il est désormais explicite.
 */
export function creneauxLibres(
  maintenant: Date,
  occupations: readonly Intervalle[],
  config: ConfigDisponibilites = CONFIG_DISPONIBILITES,
): Date[] {
  const plancher = new Date(
    maintenant.getTime() + config.delaiMinimumMinutes * 60 * 1000,
  )

  const libres: Date[] = []

  for (let decalage = 0; decalage < config.joursAvance; decalage++) {
    const j = jourCalendaire(maintenant, decalage)

    if (!config.joursOuvres.includes(j.jourSemaine)) continue

    for (let heure = config.heureDebut; heure < config.heureFin; heure++) {
      // Un créneau doit tenir ENTIÈREMENT dans la plage ouvrable. Comparaison
      // arithmétique sur l'heure locale : l'ancienne version relisait
      // `fin.getHours()`, donc l'heure du processus — fausse hors du Québec, et
      // fausse aussi le jour du changement d'heure.
      if (heure * 60 + config.dureeMinutes > config.heureFin * 60) continue

      const debut = instantDepuisLocal(
        j.annee,
        j.mois,
        j.jour,
        heure,
        0,
        FUSEAU_QUEBEC,
      )

      const fin = new Date(debut.getTime() + config.dureeMinutes * 60 * 1000)

      if (debut.getTime() < plancher.getTime()) continue

      const occupe = occupations.some((occupation) =>
        seChevauchent({ debut, fin }, occupation),
      )

      if (!occupe) libres.push(debut)
    }
  }

  return libres
}

/**
 * Convertit la réponse `freeBusy` de Google en intervalles.
 *
 * Ignore les entrées illisibles plutôt que d'échouer : une plage non analysable
 * ferait au pire proposer un créneau déjà pris, alors qu'une exception
 * empêcherait toute prise de rendez-vous à la porte.
 */
export function lireOccupations(
  brut: readonly { start?: string | null; end?: string | null }[] | null | undefined,
): Intervalle[] {
  if (!brut) return []

  const intervalles: Intervalle[] = []

  for (const plage of brut) {
    if (!plage?.start || !plage?.end) continue

    const debut = new Date(plage.start)
    const fin = new Date(plage.end)

    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) continue
    if (fin.getTime() <= debut.getTime()) continue

    intervalles.push({ debut, fin })
  }

  return intervalles
}

/**
 * Fenêtre à interroger auprès de Google, en ISO.
 *
 * Bornée à minuit **du Québec**, pas du serveur : une fenêtre décalée de quatre
 * heures manquerait les occupations de fin de journée du dernier jour.
 */
export function fenetreInterrogation(
  maintenant: Date,
  config: ConfigDisponibilites = CONFIG_DISPONIBILITES,
): { debutIso: string; finIso: string } {
  const premier = jourCalendaire(maintenant, 0)
  const dernier = jourCalendaire(maintenant, config.joursAvance)

  const debut = instantDepuisLocal(
    premier.annee,
    premier.mois,
    premier.jour,
    0,
    0,
    FUSEAU_QUEBEC,
  )

  const fin = instantDepuisLocal(
    dernier.annee,
    dernier.mois,
    dernier.jour,
    0,
    0,
    FUSEAU_QUEBEC,
  )

  return { debutIso: debut.toISOString(), finIso: fin.toISOString() }
}
