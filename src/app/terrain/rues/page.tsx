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
  await exigerSession()

  const supabase = await createClient()

  // Lecture en direct, sans cache local (CLAUDE.md §5).
  //
  // Aucun filtre sur le knocker : c'est la RLS qui décide. Depuis le module 5,
  // `territoires_select_knocker` renvoie les rues dont le SECTEUR est attribué à
  // l'utilisateur, plus celles qui lui sont directement rattachées (rues saisies
  // à la main, sans secteur). Refiltrer ici sur `knocker_id` masquerait
  // justement les rues venues d'un secteur.
  const { data } = await supabase
    .from('territoires')
    .select('id, nom_rue, ville, complete, secteur_id, secteurs(nom)')

  const rues = trierRues(
    (data ?? []).map((rue) => ({
      id: rue.id,
      nom_rue: rue.nom_rue,
      // Un secteur donne son nom en guise de repère ; une rue isolée garde sa
      // ville.
      ville: rue.secteurs?.nom ?? rue.ville,
      complete: rue.complete,
    })),
  )

  return (
    <CadrePage titre="Mes rues" largeur="terrain">
      <ListeRues rues={rues} />
    </CadrePage>
  )
}
