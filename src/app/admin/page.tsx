import { CalendarDays, HardHat, Map, Users, type LucideIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerAdmin } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Administration — Vitalis',
}

type Outil = {
  href: string
  titre: string
  description: string
  icone: LucideIcon
}

/**
 * Les outils d'administration, dans l'ordre du cycle de vie d'un chantier :
 * on crée les gens, on découpe le territoire, on attribue le travail, on branche
 * les intégrations.
 */
const OUTILS: readonly Outil[] = [
  {
    href: '/admin/utilisateurs',
    titre: 'Utilisateurs',
    description:
      'Créer un compte, changer un rôle, rattacher un knocker à son closer, désactiver un accès.',
    icone: Users,
  },
  {
    href: '/admin/secteurs',
    titre: 'Secteurs',
    description:
      'Tracer une zone sur la carte, importer ses rues automatiquement, l’attribuer à un knocker.',
    icone: Map,
  },
  {
    href: '/admin/assignation',
    titre: 'Assignation des chantiers',
    description:
      'Attribuer une vente signée à un roofer et confirmer la date d’exécution.',
    icone: HardHat,
  },
  {
    href: '/admin/google',
    titre: 'Google Calendar',
    description:
      'Connecter le compte de l’entreprise et associer un calendrier à chaque closer.',
    icone: CalendarDays,
  },
]

export default async function PageAdmin() {
  await exigerAdmin()

  return (
    <CadrePage titre="Administration" largeur="gestion">
      <p className="mb-4 text-sm text-grey-text">Outils internes pour l’équipe</p>

      {/* Une colonne sur mobile, deux dès que la largeur le permet. */}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4">
        {OUTILS.map((outil) => {
          const Icone = outil.icone

          return (
            <li key={outil.href}>
              <Link
                href={outil.href}
                // `h-full` : dans une grille, deux cartes côte à côte doivent
                // avoir la même hauteur même si un texte est plus long.
                className="group flex h-full flex-col rounded-2xl border border-grey-border bg-white p-5 shadow-card transition-colors hover:border-brand hover:bg-grey-light"
              >
                {/* L'icône dans une pastille teintée : elle porte la couleur
                    d'action sans la répandre sur tout le texte. */}
                <span
                  aria-hidden
                  className="mb-3 flex size-12 items-center justify-center rounded-xl bg-brand/12 text-brand-strong transition-colors group-hover:bg-brand group-hover:text-white"
                >
                  <Icone className="size-7" />
                </span>

                <span className="font-display text-lg font-semibold text-navy">
                  {outil.titre}
                </span>

                <span className="mt-1 text-sm text-grey-text">
                  {outil.description}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      <p className="mt-6 text-xs text-grey-text">
        Les tableaux de bord, le suivi des paiements et les rapports arrivent aux
        modules suivants.
      </p>
    </CadrePage>
  )
}
