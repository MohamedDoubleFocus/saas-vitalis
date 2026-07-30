import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerAdmin } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Administration — Vitalis',
}

export default async function PageAdmin() {
  await exigerAdmin()

  return (
    <CadrePage titre="Administration" largeur="gestion">
      {/* Mobile : une carte par ligne. Desktop : grille qui occupe la largeur. */}
      <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
        <li>
          <Link
            href="/admin/utilisateurs"
            className="flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-card transition-colors hover:bg-grey-light"
          >
            <span>
              <span className="block font-display text-base font-semibold text-navy">
                Utilisateurs
              </span>
              <span className="block text-sm text-grey-text">
                Créer un compte, changer un rôle, désactiver un accès
              </span>
            </span>
            <span aria-hidden className="text-grey-text">
              →
            </span>
          </Link>
        </li>
      </ul>

      <p className="mt-6 text-xs text-grey-text">
        Les tableaux de bord, l’assignation des territoires et le suivi des
        paiements arrivent aux modules suivants.
      </p>
    </CadrePage>
  )
}
