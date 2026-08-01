'use client'

import {
  CalendarClock,
  DoorClosed,
  LayoutGrid,
  Map,
  Plus,
  Trophy,
  UsersRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { Casquettes, RoleUser } from '@/lib/roles'

/**
 * Barre de navigation basse de la zone terrain.
 *
 * Client Component parce qu'elle a besoin du chemin courant pour marquer
 * l'onglet actif — c'est la seule raison.
 *
 * Le bouton « Lead » est central et surélevé : c'est le geste répété cent fois
 * par jour, il doit être atteignable au pouce sans regarder.
 */

type Onglet = {
  href: string
  libelle: string
  icone: LucideIcon
}

/**
 * Onglets candidats, PAR ORDRE DE PRIORITÉ.
 *
 * L'ordre n'est pas cosmétique : c'est lui qui décide ce qui saute quand la
 * barre déborde (voir `ongletsPour`). Du plus utilisé au moins utilisé.
 *
 * Libellés courts, pas des abréviations de confort : avec quatre onglets ET le
 * bouton central, une cible fait ~73 px sur un écran de 375 px. « Classement » y
 * déborderait ou passerait sous le plancher de 14 px (CLAUDE.md §6). Le titre
 * complet reste en haut de chaque écran.
 */
const ONGLETS_TERRAIN: readonly Onglet[] = [
  { href: '/terrain/rues', libelle: 'Rues', icone: Map },
  { href: '/terrain/portes', libelle: 'Portes', icone: DoorClosed },
]

const ONGLET_MEETINGS: Onglet = {
  href: '/terrain/meetings',
  libelle: 'RDV',
  icone: CalendarClock,
}

const ONGLET_AGENDA: Onglet = {
  href: '/terrain/agenda',
  libelle: 'Agenda',
  icone: CalendarClock,
}

/**
 * Sortie vers la zone manager.
 *
 * Sans cet onglet, un closer manager entré dans son agenda n'aurait aucun chemin
 * de retour vers « Mon équipe » : la barre basse est la seule navigation de la
 * zone terrain.
 */
const ONGLET_EQUIPE: Onglet = {
  href: '/equipe',
  libelle: 'Équipe',
  icone: UsersRound,
}

const ONGLET_PODIUM: Onglet = {
  href: '/terrain/classement',
  libelle: 'Podium',
  icone: Trophy,
}

/** Repli quand la barre déborde : tout le reste vit dans le hub. */
const ONGLET_ACCUEIL: Onglet = {
  href: '/accueil',
  libelle: 'Accueil',
  icone: LayoutGrid,
}

/**
 * Nombre maximum d'onglets à côté du bouton central.
 *
 * Quatre onglets + le bouton = cinq cibles, soit ~73 px chacune à 375 px. C'est
 * la limite basse du confortable ; à six, les libellés passeraient sous 14 px.
 */
const MAX_ONGLETS = 4

/**
 * Onglets d'un utilisateur, casquettes comprises.
 *
 * Le cumul des casquettes peut produire plus de destinations que la barre n'en
 * accepte — un closer qui cogne ET manage en a cinq. Plutôt que de rétrécir le
 * texte (interdit, §6) ou d'inventer un menu, on garde les plus utilisées et on
 * remplace la dernière place par « Accueil », qui mène au hub où TOUT figure.
 * Rien ne devient inaccessible, seulement un tap plus loin.
 */
function ongletsPour(role: RoleUser, casquettes: Casquettes): readonly Onglet[] {
  const cogne = role === 'knocker' || Boolean(casquettes.faitDuTerrain)
  // Un admin qui visite la zone terrain voit la navigation du knocker.
  const closer = role === 'closer'

  const candidats: Onglet[] = []

  if (cogne || role === 'admin') candidats.push(...ONGLETS_TERRAIN)
  // « Mes meetings » ne concerne que le knocker : les rendez-vous d'un closer
  // qui cogne sont déjà dans son agenda, puisqu'il en est le closer.
  if (role === 'knocker' || role === 'admin') candidats.push(ONGLET_MEETINGS)
  if (closer) candidats.push(ONGLET_AGENDA)
  if (casquettes.estManager) candidats.push(ONGLET_EQUIPE)
  candidats.push(ONGLET_PODIUM)

  if (candidats.length <= MAX_ONGLETS) return candidats

  return [...candidats.slice(0, MAX_ONGLETS - 1), ONGLET_ACCUEIL]
}

function estActif(chemin: string, href: string): boolean {
  return chemin === href || chemin.startsWith(`${href}/`)
}

export function NavigationTerrain({
  role,
  casquettes = {},
}: {
  role: RoleUser
  casquettes?: Casquettes
}) {
  const chemin = usePathname()

  const onglets = ongletsPour(role, casquettes)
  // Le bouton « + » suit la casquette terrain, pas le rôle : un closer qui cogne
  // en a autant besoin qu'un knocker.
  const avecBoutonLead =
    role === 'knocker' || role === 'admin' || Boolean(casquettes.faitDuTerrain)

  return (
    <nav
      aria-label="Navigation terrain"
      // `pb-[env(safe-area-inset-bottom)]` : la barre gestuelle de l'iPhone
      // mangerait sinon les cibles tactiles du bas.
      className="fixed inset-x-0 bottom-0 z-20 border-t border-grey-border bg-white pb-[env(safe-area-inset-bottom)]"
    >
      {/* `px-1` et non `px-2` : avec cinq cibles, chaque pixel rendu au bord est
          un pixel gagné sur la largeur d'un onglet. */}
      <ul className="mx-auto flex max-w-[440px] items-stretch justify-around px-1">
        {onglets.map((onglet) => {
          const actif = estActif(chemin, onglet.href)
          const Icone = onglet.icone

          return (
            <li key={onglet.href} className="flex-1">
              <Link
                href={onglet.href}
                aria-current={actif ? 'page' : undefined}
                // Inactif en `grey-text` (contraste AAA) et non en gris pâle :
                // un onglet non sélectionné doit rester lisible au soleil.
                className={`flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  actif ? 'text-brand-strong' : 'text-grey-text'
                }`}
              >
                <Icone className="size-7 shrink-0" aria-hidden />
                {onglet.libelle}
              </Link>
            </li>
          )
        })}

        {avecBoutonLead && (
          <li className="flex-1">
            <Link
              href="/terrain/lead"
              aria-current={estActif(chemin, '/terrain/lead') ? 'page' : undefined}
              className="flex min-h-16 flex-col items-center justify-center py-1.5"
            >
              {/* Pastille surélevée : `brand` est réservé aux actions
                  (CLAUDE.md §6), et créer un lead EST l'action de l'app. */}
              <span className="flex size-14 items-center justify-center rounded-full bg-brand text-white shadow-cta">
                <Plus className="size-8" aria-hidden strokeWidth={2.75} />
              </span>
              <span className="sr-only">Nouveau lead</span>
            </Link>
          </li>
        )}
      </ul>
    </nav>
  )
}
