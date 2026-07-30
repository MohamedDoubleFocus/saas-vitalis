import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerAdmin } from '@/lib/auth'

import { CarteDessin } from './carte-dessin'

export const metadata: Metadata = {
  title: 'Nouveau secteur — Vitalis',
}

export default async function PageNouveauSecteur() {
  await exigerAdmin()

  return (
    <CadrePage titre="Nouveau secteur" largeur="gestion">
      <div className="flex flex-col gap-4">
        <Link href="/admin/secteurs" className="text-sm text-grey-text underline">
          ← Tous les secteurs
        </Link>

        <CarteDessin />
      </div>
    </CadrePage>
  )
}
