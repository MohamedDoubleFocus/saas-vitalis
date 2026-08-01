'use client'

import {
  CalendarClock,
  DoorClosed,
  Map,
  Plus,
  Trophy,
  UsersRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { RoleUser } from '@/lib/roles'

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
 * Libellés courts, pas des abréviations de confort : avec quatre onglets ET le
 * bouton central, une cible fait ~73 px sur un écran de 375 px. « Classement » y
 * déborderait ou passerait sous le plancher de 14 px (CLAUDE.md §6). Le titre
 * complet reste en haut de chaque écran.
 */
const ONGLETS_KNOCKER: readonly Onglet[] = [
  { href: '/terrain/rues', libelle: 'Rues', icone: Map },
  { href: '/terrain/portes', libelle: 'Portes', icone: DoorClosed },
  { href: '/terrain/meetings', libelle: 'RDV', icone: CalendarClock },
  { href: '/terrain/classement', libelle: 'Podium', icone: Trophy },
]

const ONGLETS_CLOSER: readonly Onglet[] = [
  { href: '/terrain/agenda', libelle: 'Agenda', icone: CalendarClock },
  { href: '/terrain/classement', libelle: 'Podium', icone: Trophy },
]

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

function ongletsPour(role: RoleUser, estManager: boolean): readonly Onglet[] {
  // Un admin qui visite la zone terrain voit la navigation du knocker.
  const base = role === 'closer' ? ONGLETS_CLOSER : ONGLETS_KNOCKER

  // Le knocker a déjà quatre onglets plus le bouton central : un cinquième
  // libellé ne tiendrait pas à 375px. Le cas ne se pose pas aujourd'hui (les
  // managers sont des closers) ; si un knocker devient manager, il passera par
  // /accueil plutôt que par une barre illisible.
  if (!estManager || base === ONGLETS_KNOCKER) return base

  return [...base, ONGLET_EQUIPE]
}

function estActif(chemin: string, href: string): boolean {
  return chemin === href || chemin.startsWith(`${href}/`)
}

export function NavigationTerrain({
  role,
  estManager = false,
}: {
  role: RoleUser
  estManager?: boolean
}) {
  const chemin = usePathname()

  const onglets = ongletsPour(role, estManager)
  // Seul le knocker crée des leads.
  const avecBoutonLead = role === 'knocker' || role === 'admin'

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
