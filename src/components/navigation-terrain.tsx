'use client'

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
  /** Glyphe décoratif — `aria-hidden`, le libellé porte le sens. */
  icone: string
}

const ONGLETS_KNOCKER: readonly Onglet[] = [
  { href: '/terrain/rues', libelle: 'Rues', icone: '▤' },
  { href: '/terrain/meetings', libelle: 'Meetings', icone: '◷' },
  { href: '/terrain/classement', libelle: 'Classement', icone: '▲' },
]

const ONGLETS_CLOSER: readonly Onglet[] = [
  { href: '/terrain/agenda', libelle: 'Agenda', icone: '◷' },
  { href: '/terrain/classement', libelle: 'Classement', icone: '▲' },
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

          return (
            <li key={onglet.href} className="flex-1">
              <Link
                href={onglet.href}
                aria-current={actif ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs font-medium transition-colors ${
                  actif ? 'text-brand-strong' : 'text-grey-text'
                }`}
              >
                <span aria-hidden className="text-base leading-none">
                  {onglet.icone}
                </span>
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
              className="flex min-h-14 flex-col items-center justify-center py-1"
            >
              {/* Pastille surélevée : `brand` est réservé aux actions
                  (CLAUDE.md §6), et créer un lead EST l'action de l'app. */}
              <span className="flex size-12 items-center justify-center rounded-full bg-brand text-2xl leading-none font-semibold text-white shadow-cta">
                <span aria-hidden>+</span>
              </span>
              <span className="sr-only">Nouveau lead</span>
            </Link>
          </li>
        )}
      </ul>
    </nav>
  )
}
