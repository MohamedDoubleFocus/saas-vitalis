import { estClose, dansPeriode, type Periode } from './classement'
import type { StatutOpp } from './doublons'
import { lireDate } from './echeances'

/**
 * Tableau de bord d'équipe du manager.
 *
 * Tout est agrégé ici, en pur, à partir des lignes brutes lues en ligne. Les
 * écrans ne comptent rien eux-mêmes.
 *
 * `Periode`, `bornesPeriode`, `dansPeriode` et `estClose` viennent du classement
 * (`./classement`) : les deux écrans doivent dire la même chose d'une même
 * semaine, sinon un knocker et son manager se disputeront sur les chiffres.
 */

/** Une opportunité, réduite à ce dont le tableau de bord a besoin. */
export type LigneEquipe = {
  knockerId: string | null
  statut: StatutOpp
  /** `derniere_visite` — l'instant du dernier coup de porte. */
  derniereVisite: string | null
  nbVisites: number
  dateRdv: string | null
}

export type MembreEquipe = {
  id: string
  nom: string
}

export type StatsKnocker = {
  knockerId: string
  nom: string
  /** Coups de porte : la somme des visites, pas le nombre d'adresses. */
  portes: number
  /** Adresses distinctes travaillées dans la période. */
  leads: number
  /** Quelqu'un a répondu — tout sauf « absent ». */
  contacts: number
  rdv: number
  /** Rendez-vous qui ont mené à une vente. */
  closes: number
  /** Fractions entre 0 et 1. */
  tauxContact: number
  tauxRdv: number
  tauxGlobal: number
}

/**
 * ⚠️ PÉRIODE : ici on filtre sur `derniere_visite`, PAS sur `date_rdv`.
 *
 * Le classement compte « les rendez-vous qui TOMBENT cette semaine » ; ce tableau
 * de bord mesure « le travail FAIT cette semaine ». Ce sont deux questions
 * différentes, et un entonnoir n'a de sens que si ses trois étages portent sur le
 * même ensemble de portes : sans ça, un taux de conversion diviserait les
 * rendez-vous d'une semaine par les portes d'une autre.
 *
 * Conséquence assumée : les chiffres de cet écran et ceux du classement ne
 * coïncident pas toujours. C'est correct — ils ne répondent pas à la même
 * question.
 */
function dansLaPeriode(
  ligne: LigneEquipe,
  periode: Periode,
  maintenant: Date,
): boolean {
  const visite = lireDate(ligne.derniereVisite)

  return visite !== null && dansPeriode(visite, periode, maintenant)
}

/**
 * Rapport borné à [0, 1], et 0 quand le dénominateur est vide.
 *
 * « 0 rendez-vous sur 0 porte » vaut 0 %, pas NaN ni l'infini : un knocker qui
 * n'a pas travaillé n'a pas un taux de conversion parfait.
 */
export function taux(numerateur: number, denominateur: number): number {
  if (denominateur <= 0) return 0

  return Math.min(1, numerateur / denominateur)
}

/** « 34 % ». Arrondi à l'entier : le dixième de pourcent n'aide personne ici. */
export function formaterTaux(valeur: number): string {
  return `${Math.round(valeur * 100)} %`
}

/**
 * Stats d'un knocker sur la période.
 *
 * Les dénominateurs de l'entonnoir :
 *   • `tauxContact` = contacts / **portes** — sur cent coups de porte, combien
 *     ont ouvert. C'est bien le nombre de coups qui compte, pas le nombre
 *     d'adresses : repasser trois fois, c'est trois occasions manquées.
 *   • `tauxRdv`     = rdv / **contacts** — quand ça ouvre, combien signent un
 *     rendez-vous. C'est la mesure du discours, isolée de la chance de trouver
 *     quelqu'un.
 *   • `tauxGlobal`  = rdv / **portes** — le rendement brut de la journée.
 */
function statsDe(
  knockerId: string,
  nom: string,
  lignes: readonly LigneEquipe[],
): StatsKnocker {
  let portes = 0
  let contacts = 0
  let rdv = 0
  let closes = 0

  for (const ligne of lignes) {
    // `nb_visites` est un entier non nul en base, mais une ligne venue d'ailleurs
    // ne doit pas pouvoir gonfler ou casser le compteur.
    portes += Number.isFinite(ligne.nbVisites) ? Math.max(0, ligne.nbVisites) : 0

    if (ligne.statut !== 'absent') contacts += 1
    // La présence d'une date fait foi, pas le statut : une porte passée à
    // « perdu » après coup a bel et bien décroché un rendez-vous.
    if (ligne.dateRdv) rdv += 1
    if (estClose(ligne.statut)) closes += 1
  }

  return {
    knockerId,
    nom,
    portes,
    leads: lignes.length,
    contacts,
    rdv,
    closes,
    tauxContact: taux(contacts, portes),
    tauxRdv: taux(rdv, contacts),
    tauxGlobal: taux(rdv, portes),
  }
}

/** Regroupe les lignes par knocker. Les lignes sans knocker sont ignorées. */
export function regrouperParKnocker(
  lignes: readonly LigneEquipe[],
): Map<string, LigneEquipe[]> {
  const groupes = new Map<string, LigneEquipe[]>()

  for (const ligne of lignes) {
    if (!ligne.knockerId) continue

    const groupe = groupes.get(ligne.knockerId)

    if (groupe) groupe.push(ligne)
    else groupes.set(ligne.knockerId, [ligne])
  }

  return groupes
}

/**
 * Agrège l'équipe entière.
 *
 * Un knocker qui n'a rien fait dans la période apparaît quand même, à zéro :
 * c'est précisément l'information que le manager cherche. Une équipe où l'on
 * disparaît en ne travaillant pas ne se supervise pas.
 */
export function agregerEquipe(
  lignes: readonly LigneEquipe[],
  membres: readonly MembreEquipe[],
  periode: Periode,
  maintenant: Date,
): StatsKnocker[] {
  const retenues = lignes.filter((ligne) => dansLaPeriode(ligne, periode, maintenant))
  const groupes = regrouperParKnocker(retenues)

  return membres
    .map((membre) => statsDe(membre.id, membre.nom, groupes.get(membre.id) ?? []))
    .sort(
      (a, b) =>
        b.rdv - a.rdv ||
        b.portes - a.portes ||
        a.nom.localeCompare(b.nom, 'fr-CA'),
    )
}

export type TotauxEquipe = Omit<StatsKnocker, 'knockerId' | 'nom'>

/**
 * Totaux de l'équipe.
 *
 * Les taux sont RECALCULÉS sur les totaux, jamais moyennés : la moyenne des taux
 * individuels donnerait le même poids à un knocker qui a fait dix portes et à
 * un qui en a fait deux cents.
 */
export function totauxEquipe(stats: readonly StatsKnocker[]): TotauxEquipe {
  const somme = (lire: (s: StatsKnocker) => number) =>
    stats.reduce((total, s) => total + lire(s), 0)

  const portes = somme((s) => s.portes)
  const contacts = somme((s) => s.contacts)
  const rdv = somme((s) => s.rdv)

  return {
    portes,
    leads: somme((s) => s.leads),
    contacts,
    rdv,
    closes: somme((s) => s.closes),
    tauxContact: taux(contacts, portes),
    tauxRdv: taux(rdv, contacts),
    tauxGlobal: taux(rdv, portes),
  }
}

/* -------------------------------------------------------------------------- */
/* Carte des portes du jour                                                    */
/* -------------------------------------------------------------------------- */

/** Une porte plaçable sur la carte. */
export type PorteCarte = {
  id: string
  adresse: string
  statut: StatutOpp
  latitude: number
  longitude: number
  knockerId: string
  nom: string
  derniereVisite: string
}

/** Ligne brute candidate à la carte, avant filtrage. */
export type LignePorteCarte = {
  id: string
  adresse: string
  statut: StatutOpp
  latitude: number | null
  longitude: number | null
  knockerId: string | null
  derniereVisite: string | null
}

/**
 * Couleur d'une porte sur la carte, par statut.
 *
 * Volontairement quatre couleurs franches et pas un dégradé : la carte se lit
 * d'un coup d'œil, sur un téléphone, en plein jour.
 *
 * Ces valeurs sont passées à l'API Google (qui veut des chaînes hexadécimales) :
 * elles ne peuvent donc pas être des jetons Tailwind.
 */
export const COULEURS_STATUT: Record<string, string> = {
  absent: '#8a99a8',
  refus: '#c0392b',
  repasser: '#e08e0b',
  rdv: '#0e7ba6',
  /** Tout ce qui a dépassé le rendez-vous : vendu, planifié, complété… */
  vendu: '#1f9d55',
}

/** Regroupe les statuts en catégories de carte. */
export function categorieCarte(statut: StatutOpp): keyof typeof COULEURS_STATUT {
  if (statut === 'absent' || statut === 'refus' || statut === 'repasser') {
    return statut
  }

  if (statut === 'rdv' || statut === 'perdu') return 'rdv'

  return 'vendu'
}

export function couleurStatut(statut: StatutOpp): string {
  return COULEURS_STATUT[categorieCarte(statut)]
}

/**
 * Portes plaçables sur la carte, pour un jour donné.
 *
 * Écarte silencieusement les leads sans GPS — saisie manuelle d'adresse, cf.
 * `champ-adresse.tsx`. L'écran annonce combien ont été écartées : une carte à
 * moitié vide sans explication ferait croire à une équipe inactive.
 */
export function portesDuJour(
  lignes: readonly LignePorteCarte[],
  nomsParId: ReadonlyMap<string, string>,
  maintenant: Date,
  knockerFiltre: string | null = null,
): PorteCarte[] {
  const portes: PorteCarte[] = []

  for (const ligne of lignes) {
    if (!ligne.knockerId) continue
    if (knockerFiltre && ligne.knockerId !== knockerFiltre) continue
    if (ligne.latitude === null || ligne.longitude === null) continue

    const visite = lireDate(ligne.derniereVisite)

    if (!visite || !dansPeriode(visite, 'aujourdhui', maintenant)) continue

    portes.push({
      id: ligne.id,
      adresse: ligne.adresse,
      statut: ligne.statut,
      latitude: ligne.latitude,
      longitude: ligne.longitude,
      knockerId: ligne.knockerId,
      nom: nomsParId.get(ligne.knockerId) ?? 'Sans nom',
      derniereVisite: ligne.derniereVisite as string,
    })
  }

  return portes
}

/** Centre de la carte : le barycentre des portes, ou `null` s'il n'y en a pas. */
export function centreDe(
  portes: readonly PorteCarte[],
): { lat: number; lng: number } | null {
  if (portes.length === 0) return null

  const somme = portes.reduce(
    (acc, porte) => ({
      lat: acc.lat + porte.latitude,
      lng: acc.lng + porte.longitude,
    }),
    { lat: 0, lng: 0 },
  )

  return { lat: somme.lat / portes.length, lng: somme.lng / portes.length }
}
