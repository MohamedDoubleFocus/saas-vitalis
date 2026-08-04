import {
  AlertTriangle,
  Banknote,
  CalendarCheck,
  CalendarClock,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  DoorClosed,
  FileText,
  Hammer,
  HardHat,
  Home,
  Languages,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Repeat,
  Ruler,
  Trophy,
  UserRound,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

import type { StatutOpp } from '@/lib/doublons'
import type { RoleUser } from '@/lib/roles'

/**
 * Icônes de l'application.
 *
 * Une seule librairie (`lucide-react`), une seule correspondance par notion :
 * un knocker doit reconnaître un statut à sa forme avant même de lire le mot.
 *
 * Les icônes héritent de `currentColor` : elles prennent la couleur du texte
 * voisin et ne peuvent donc jamais être plus pâles que lui (CLAUDE.md §6).
 */

/** Correspondance statut → icône. Une forme distincte par étape du cycle. */
export const ICONES_STATUT: Record<StatutOpp, LucideIcon> = {
  absent: DoorClosed,
  refus: XCircle,
  repasser: Repeat,
  rdv: CalendarClock,
  vendu: CheckCircle2,
  planifie: CalendarCheck,
  en_cours: Hammer,
  complete: CheckCircle2,
  facture: FileText,
  paye: Banknote,
  perdu: XCircle,
}

export const ICONES_ROLE: Record<RoleUser, LucideIcon> = {
  knocker: DoorClosed,
  closer: CalendarClock,
  roofer: HardHat,
  admin: UserRound,
}

/** Icônes de champs de formulaire, pour la reconnaissance immédiate. */
export const ICONE_TELEPHONE = Phone
export const ICONE_COURRIEL = Mail
export const ICONE_ADRESSE = MapPin
export const ICONE_MONTANT = CircleDollarSign
export const ICONE_DATE = CalendarClock
export const ICONE_SUPERFICIE = Ruler
export const ICONE_NOM = UserRound
export const ICONE_NOTE = ClipboardList
export const ICONE_LANGUE = Languages
export const ICONE_ITINERAIRE = Navigation
export const ICONE_PHOTO = Camera
export const ICONE_MAISON = Home
export const ICONE_CLASSEMENT = Trophy
export const ICONE_ALERTE = AlertTriangle

/**
 * Badge de statut : icône + libellé.
 *
 * Taille d'icône alignée sur le texte du badge (14px) mais jamais en dessous —
 * une icône plus petite que sa légende devient décorative.
 */
export function IconeStatut({
  statut,
  className = 'size-5',
}: {
  statut: StatutOpp
  className?: string
}) {
  const Icone = ICONES_STATUT[statut]

  return <Icone className={`${className} shrink-0`} aria-hidden />
}

/**
 * Icône d'un champ de formulaire, posée devant son libellé.
 *
 * `aria-hidden` systématique : le libellé porte déjà le sens, l'icône ne doit
 * pas être annoncée deux fois par un lecteur d'écran.
 */
export function IconeChamp({
  icone: Icone,
  className = 'size-5',
}: {
  icone: LucideIcon
  className?: string
}) {
  return <Icone className={`${className} shrink-0 text-grey-text`} aria-hidden />
}
