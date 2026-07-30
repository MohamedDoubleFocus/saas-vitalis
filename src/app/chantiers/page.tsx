import type { Metadata } from 'next'

import { CadrePage } from '@/components/cadre-page'
import { ModuleAVenir } from '@/components/module-a-venir'

export const metadata: Metadata = {
  title: 'Chantiers — Vitalis',
}

export default function PageChantiers() {
  return (
    <CadrePage titre="Chantiers" largeur="gestion">
      <ModuleAVenir description="Travaux planifiés, fenêtres cibles, photos et extras de chantier." />
    </CadrePage>
  )
}
