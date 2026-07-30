import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { formaterTelephone } from '@/lib/telephone'

import { FormulaireClose } from './formulaire-close'

export const metadata: Metadata = {
  title: 'Conclure la vente — Vitalis',
}

type Props = {
  params: Promise<{ id: string }>
}

/**
 * Formulaire de close.
 *
 * Les infos client déjà connues (saisies par le knocker) sont préremplies : le
 * closer les complète plutôt que de les retaper devant le client.
 *
 * L'accès est contrôlé par la RLS — une opportunité hors du périmètre du closer
 * revient vide, donc 404. La fonction `conclure_vente()` revalide de toute façon
 * tout à l'écriture.
 */
export default async function PageClose({ params }: Props) {
  const { id } = await params
  await exigerSession()

  const supabase = await createClient()

  const { data: opportunite } = await supabase
    .from('opportunites')
    .select(
      'id, adresse, ville, code_postal, client_nom, client_tel, client_courriel, superficie_pi2',
    )
    .eq('id', id)
    .maybeSingle()

  if (!opportunite) notFound()

  const adresse = [opportunite.adresse, opportunite.ville, opportunite.code_postal]
    .filter(Boolean)
    .join(', ')

  return (
    <CadrePage titre="Conclure la vente" largeur="terrain">
      <FormulaireClose
        opportuniteId={opportunite.id}
        clientNomInitial={opportunite.client_nom ?? ''}
        clientTelInitial={formaterTelephone(opportunite.client_tel)}
        clientCourrielInitial={opportunite.client_courriel ?? ''}
        superficieInitiale={
          opportunite.superficie_pi2 === null ? '' : String(opportunite.superficie_pi2)
        }
        adresse={adresse}
      />
    </CadrePage>
  )
}
