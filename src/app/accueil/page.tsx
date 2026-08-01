import {
  CalendarClock,
  ChevronRight,
  HardHat,
  LayoutGrid,
  Map,
  Trophy,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { CadrePage } from '@/components/cadre-page'
import { casquettesDe, profilCourant } from '@/lib/auth'
import { accueilDuRole, destinationsDe } from '@/lib/roles'

export const metadata: Metadata = {
  title: 'Accueil — Vitalis',
}

type Entree = {
  titre: string
  description: string
  icone: LucideIcon
}

/**
 * Ce que chaque destination veut dire, en clair.
 *
 * Clés = les chemins que renvoie `destinationsDe()` : le hub ne décide de rien,
 * il habille. Toute nouvelle casquette ajoute une ligne ici et une seule.
 */
const ENTREES: Record<string, Entree> = {
  '/terrain/rues': {
    titre: 'Mes rues',
    description: 'Mon secteur, mes portes et mes leads du jour.',
    icone: Map,
  },
  '/terrain/agenda': {
    titre: 'Mon agenda',
    description: 'Mes rendez-vous, les fiches clients et les closes à signer.',
    icone: CalendarClock,
  },
  '/chantiers': {
    titre: 'Mes jobs',
    description: 'Les chantiers qui me sont assignés et leurs photos.',
    icone: HardHat,
  },
  '/admin': {
    titre: 'Administration',
    description: 'Utilisateurs, secteurs, assignations et intégrations.',
    icone: LayoutGrid,
  },
  '/equipe': {
    titre: 'Mon équipe',
    description:
      'Les chiffres de mes knockers, leur détail et la carte des portes du jour.',
    icone: UsersRound,
  },
}

/**
 * Écrans utiles mais secondaires : ils ne sont pas des « chez-soi », donc
 * `destinationsDe()` ne les renvoie pas. Le hub les propose quand même, parce
 * qu'ils peuvent avoir été chassés de la barre de navigation par le cumul des
 * casquettes.
 */
const SECONDAIRES: readonly (Entree & { href: string })[] = [
  {
    href: '/terrain/classement',
    titre: 'Podium',
    description: 'Le classement des knockers, par période.',
    icone: Trophy,
  },
]

/**
 * Hub d'accueil des utilisateurs à deux casquettes.
 *
 * Billal est closer ET manager : aucune des deux fonctions n'est « la vraie »,
 * et le forcer sur l'une le ferait naviguer à contre-courant une fois sur deux.
 * Cet écran ne fait donc rien d'autre que poser la question — il ne charge
 * aucune donnée métier, pour rester instantané.
 *
 * Un utilisateur sans double casquette n'a rien à y faire : on le renvoie
 * directement à son accueil plutôt que de lui offrir un choix à une option.
 */
export default async function PageAccueil() {
  const profil = await profilCourant()

  if (!profil) redirect('/login?error=session')

  const casquettes = casquettesDe(profil)
  const destinations = destinationsDe(profil.role, casquettes)

  // Une seule destination : il n'y a rien à choisir. On l'y envoie plutôt que de
  // lui présenter un menu à une entrée.
  if (destinations.length < 2) {
    redirect(accueilDuRole(profil.role, casquettes))
  }

  const entrees = destinations
    .map((href) => ({ href, ...ENTREES[href] }))
    .filter((entree) => Boolean(entree.titre))

  // Le podium n'a de sens que pour qui cogne.
  const secondaires = casquettes.faitDuTerrain ? SECONDAIRES : []

  const prenom = profil.nomComplet?.trim().split(/\s+/)[0]

  return (
    <CadrePage titre="Accueil" largeur="gestion">
      <p className="mb-1 font-display text-2xl font-bold text-navy">
        Bonjour{prenom ? ` ${prenom}` : ''}
      </p>
      <p className="mb-5 text-sm text-grey-text">
        Tu portes {entrees.length === 2 ? 'deux' : `${entrees.length}`} casquettes
        aujourd’hui. Par où veux-tu commencer&nbsp;?
      </p>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4">
        {entrees.map((entree) => {
          const Icone = entree.icone

          return (
            <li key={entree.href}>
              <Link
                href={entree.href}
                // `h-full` : deux cartes côte à côte doivent avoir la même
                // hauteur même si un texte est plus long.
                className="group flex h-full flex-col rounded-2xl border border-grey-border bg-white p-5 shadow-card transition-colors hover:border-brand hover:bg-grey-light"
              >
                <span
                  aria-hidden
                  className="mb-3 flex size-12 items-center justify-center rounded-xl bg-brand/12 text-brand-strong transition-colors group-hover:bg-brand group-hover:text-white"
                >
                  <Icone className="size-7" />
                </span>

                <span className="flex items-center gap-1 font-display text-lg font-semibold text-navy">
                  {entree.titre}
                  <ChevronRight
                    className="size-5 text-grey-text transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>

                <span className="mt-1 text-sm text-grey-text">
                  {entree.description}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      {secondaires.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {secondaires.map((entree) => {
            const Icone = entree.icone

            return (
              <li key={entree.href}>
                <Link
                  href={entree.href}
                  className="flex min-h-11 items-center gap-2 rounded-full border border-grey-border bg-white px-4 text-sm font-semibold text-navy transition-colors hover:bg-grey-light"
                >
                  <Icone className="size-5 text-grey-text" aria-hidden />
                  {entree.titre}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-6 text-xs text-grey-text">
        Tu peux revenir ici à tout moment depuis l’adresse /accueil.
      </p>
    </CadrePage>
  )
}
