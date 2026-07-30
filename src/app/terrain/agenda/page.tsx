import type { Metadata } from 'next'

import { CadrePage } from '@/components/cadre-page'
import { ModuleAVenir } from '@/components/module-a-venir'

export const metadata: Metadata = {
  title: 'Agenda — Vitalis',
}

export default function PageAgenda() {
  return (
    <CadrePage titre="Agenda" largeur="terrain">
      <ModuleAVenir description="Rendez-vous de vente, disponibilités et signature des contrats." />
    </CadrePage>
  )
}
