/**
 * Créneaux libres = heures ouvrables − occupations du calendrier.
 *
 * Entièrement pur : aucune dépendance à Google, au réseau ni au navigateur. On
 * lui passe les plages occupées, il rend les débuts de créneaux disponibles.
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
  /** Jours ouvrés — 0 = dimanche … 6 = samedi. */
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
  joursOuvres: [1, 2, 3, 4, 5],
  joursAvance: 7,
  delaiMinimumMinutes: 90,
}

/** Deux intervalles se chevauchent-ils ? Bornes ouvertes : 17-18 et 18-19 non. */
export function seChevauchent(a: Intervalle, b: Intervalle): boolean {
  return a.debut.getTime() < b.fin.getTime() && a.fin.getTime() > b.debut.getTime()
}

/**
 * Débuts de créneaux disponibles.
 *
 * Les dates sont construites avec `new Date(a, m, j, h)`, donc en heure LOCALE
 * du processus qui appelle. Côté serveur, cela suppose que le fuseau du
 * déploiement est celui de l'entreprise — voir `TZ` dans la configuration
 * Vercel, sans quoi « 9 h » signifierait 9 h UTC, soit 5 h du matin au Québec.
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
    const jour = new Date(
      maintenant.getFullYear(),
      maintenant.getMonth(),
      maintenant.getDate() + decalage,
    )

    if (!config.joursOuvres.includes(jour.getDay())) continue

    for (let heure = config.heureDebut; heure < config.heureFin; heure++) {
      const debut = new Date(
        jour.getFullYear(),
        jour.getMonth(),
        jour.getDate(),
        heure,
      )

      const fin = new Date(debut.getTime() + config.dureeMinutes * 60 * 1000)

      // Un créneau doit tenir ENTIÈREMENT dans la plage ouvrable.
      if (fin.getHours() > config.heureFin || (fin.getHours() === 0 && fin.getDate() !== debut.getDate())) {
        continue
      }

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

/** Fenêtre à interroger auprès de Google, en ISO. */
export function fenetreInterrogation(
  maintenant: Date,
  config: ConfigDisponibilites = CONFIG_DISPONIBILITES,
): { debutIso: string; finIso: string } {
  const debut = new Date(
    maintenant.getFullYear(),
    maintenant.getMonth(),
    maintenant.getDate(),
  )

  const fin = new Date(
    maintenant.getFullYear(),
    maintenant.getMonth(),
    maintenant.getDate() + config.joursAvance,
  )

  return { debutIso: debut.toISOString(), finIso: fin.toISOString() }
}
