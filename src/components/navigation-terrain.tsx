'use client'

import { CalendarClock, Map, Plus, Trophy } from 'lucide-react'
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

const ONGLETS_KNOCKER: readonly Onglet[] = [
  { href: '/terrain/rues', libelle: 'Rues', icone: Map },
  { href: '/terrain/meetings', libelle: 'Meetings', icone: CalendarClock },
  { href: '/terrain/classement', libelle: 'Classement', icone: Trophy },
]

const ONGLETS_CLOSER: readonly Onglet[] = [
  { href: '/terrain/agenda', libelle: 'Agenda', icone: CalendarClock },
  { href: '/terrain/classement', libelle: 'Classement', icone: Trophy },
]

function ongletsPour(role: RoleUser): readonly Onglet[] {
  if (role === 'knocker') return ONGLETS_KNOCKER
  if (role === 'closer') return ONGLETS_CLOSER

  // Un admin qui visite la zone terrain voit la navigation du knocker.
  return ONGLETS_KNOCKER
}

function estActif(chemin: string, href: string): boolean {
  return chemin === href || chemin.startsWith(`${href}/`)
}

export function NavigationTerrain({ role }: { role: RoleUser }) {
  const chemin = usePathname()

  const onglets = ongletsPour(role)
  // Seul le knocker crée des leads.
  const avecBoutonLead = role === 'knocker' || role === 'admin'

  return (
    <nav
      aria-label="Navigation terrain"
      // `pb-[env(safe-area-inset-bottom)]` : la barre gestuelle de l'iPhone
      // mangerait sinon les cibles tactiles du bas.
      className="fixed inset-x-0 bottom-0 z-20 border-t border-grey-border bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-[440px] items-stretch justify-around px-2">
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
                className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-1.5 text-xs font-semibold transition-colors ${
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
