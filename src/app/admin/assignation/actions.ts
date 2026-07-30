'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { exigerAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

const CHEMIN = '/admin/assignation'

function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? '').trim()

  return texte === '' ? null : texte
}

/**
 * Assigne un roofer à un chantier vendu, et confirme éventuellement la date.
 *
 * L'admin écrit via sa propre session : `opportunites_update_admin` autorise
 * tout, et le trigger du module 4 ne s'applique qu'au rôle roofer.
 */
export async function assignerRoofer(formData: FormData) {
  await exigerAdmin()

  const opportuniteId = texteOuNull(formData.get('opportunite_id'))
  const rooferId = texteOuNull(formData.get('roofer_id'))
  const dateConfirmee = texteOuNull(formData.get('date_confirmee'))

  if (!opportuniteId || !rooferId) {
    redirect(`${CHEMIN}?error=champs_manquants`)
  }

  const supabase = await createClient()

  // Le `<select>` ne propose que des roofers actifs, mais un formulaire se
  // falsifie : on revérifie avant d'assigner un chantier à un knocker.
  const { data: roofer } = await supabase
    .from('profiles')
    .select('id, nom_complet')
    .eq('id', rooferId)
    .eq('role', 'roofer')
    .eq('actif', true)
    .maybeSingle()

  if (!roofer) {
    redirect(`${CHEMIN}?error=roofer_invalide`)
  }

  const { error } = await supabase
    .from('opportunites')
    .update({
      roofer_id: rooferId,
      // Assigner, c'est planifier : sans ce passage, le chantier resterait
      // `vendu` et le roofer n'aurait aucune transition disponible.
      statut: 'planifie',
      ...(dateConfirmee ? { date_confirmee: dateConfirmee } : {}),
    })
    .eq('id', opportuniteId)

  if (error) {
    redirect(`${CHEMIN}?error=maj_impossible`)
  }

  // Piste d'audit (§4.10) : une ligne par fait, dans le fil chronologique.
  const lignes = [
    {
      opportunite_id: opportuniteId,
      texte: `Assigné à ${roofer.nom_complet || 'un roofer'}. Statut : Vendu → Planifié.`,
      auteur: 'Système',
    },
  ]

  if (dateConfirmee) {
    lignes.push({
      opportunite_id: opportuniteId,
      texte: `Date confirmée : ${dateConfirmee}.`,
      auteur: 'Système',
    })
  }

  await supabase.from('notes').insert(lignes)

  revalidatePath(CHEMIN)
  redirect(`${CHEMIN}?ok=assigne`)
}
