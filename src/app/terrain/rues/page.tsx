import type { Metadata } from 'next'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { trierRues } from '@/lib/territoires'

import { ListeRues } from './liste-rues'

export const metadata: Metadata = {
  title: 'Mes rues — Vitalis',
}

export default async function PageRues() {
  const session = await exigerSession()

  const supabase = await createClient()

  // Lecture en direct, sans cache local (CLAUDE.md §5). Le filtre explicite sur
  // `knocker_id` double la RLS : « mes rues » veut dire les miennes, même pour un
  // admin qui verrait tout.
  const { data } = await supabase
    .from('territoires')
    .select('id, nom_rue, ville, complete')
    .eq('knocker_id', session.userId)

  const rues = trierRues(data ?? [])

  return (
    <CadrePage titre="Mes rues" largeur="terrain">
      <ListeRues rues={rues} />
    </CadrePage>
  )
}
