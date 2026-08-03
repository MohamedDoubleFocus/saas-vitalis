'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { exigerAdmin } from '@/lib/auth'
import {
  estRetourChantier,
  LIBELLES_TRANSITION,
  transitionAdminAutorisee,
} from '@/lib/chantiers'
import type { StatutOpp } from '@/lib/doublons'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'

const CHEMIN = '/admin/chantiers'

function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? '').trim()

  return texte === '' ? null : texte
}

/**
 * Avance (ou corrige) le statut d'un chantier depuis le tableau de suivi.
 *
 * L'admin va plus loin que le roofer : `facture` et `paye` closent le cycle et
 * n'étaient posables par aucun écran jusqu'ici.
 *
 * ⚠️ La transition est REVALIDÉE ici. `transitionsAdmin()` ne sert qu'à dessiner
 * les boutons ; un formulaire se falsifie, et rien en base n'empêche un admin de
 * sauter de « vendu » à « payé » — `opportunites_update_admin` l'autorise. C'est
 * donc cette fonction qui fait respecter « une étape à la fois » (CLAUDE.md §6).
 */
export async function avancerChantier(formData: FormData) {
  await exigerAdmin()

  const opportuniteId = texteOuNull(formData.get('opportunite_id'))
  const cible = texteOuNull(formData.get('statut')) as StatutOpp | null
  const vue = texteOuNull(formData.get('vue'))

  const retour = `${CHEMIN}${vue ? `?vue=${encodeURIComponent(vue)}` : ''}`

  if (!opportuniteId || !cible) {
    redirect(`${retour}${vue ? '&' : '?'}error=champs_manquants`)
  }

  const supabase = await createClient()

  const { data: chantier } = await supabase
    .from('opportunites')
    .select('id, statut')
    .eq('id', opportuniteId)
    .maybeSingle()

  if (!chantier) {
    redirect(`${retour}${vue ? '&' : '?'}error=introuvable`)
  }

  if (!transitionAdminAutorisee(chantier.statut, cible)) {
    redirect(`${retour}${vue ? '&' : '?'}error=transition`)
  }

  const { error } = await supabase
    .from('opportunites')
    .update({ statut: cible })
    .eq('id', opportuniteId)

  if (error) {
    redirect(`${retour}${vue ? '&' : '?'}error=maj_impossible`)
  }

  // Piste d'audit (§4.10) : toute transition de statut écrit une note système.
  const correction = estRetourChantier(chantier.statut, cible)

  await supabase.from('notes').insert({
    opportunite_id: opportuniteId,
    texte: `${correction ? 'Correction' : 'Statut'} : ${LIBELLES_STATUT[chantier.statut]} → ${LIBELLES_STATUT[cible]}${
      correction ? '' : ` (${LIBELLES_TRANSITION[cible] ?? LIBELLES_STATUT[cible]})`
    }.`,
    auteur: 'Système',
  })

  revalidatePath(CHEMIN)
  revalidatePath(`/chantiers/${opportuniteId}`)
  redirect(`${retour}${vue ? '&' : '?'}ok=statut`)
}
