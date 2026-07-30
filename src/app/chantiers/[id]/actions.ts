'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { exigerSession } from '@/lib/auth'
import { estRetourEnArriere, transitionRooferAutorisee } from '@/lib/chantiers'
import type { StatutOpp } from '@/lib/doublons'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'

/**
 * Zone gestion : server actions et formulaires natifs (CLAUDE.md §3), pas la
 * file de résilience du terrain. Un roofer au chantier a du réseau la plupart du
 * temps, et une transition de statut ratée se rejoue d'un tap.
 */

function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? '').trim()

  return texte === '' ? null : texte
}

const STATUTS_CIBLES: readonly StatutOpp[] = [
  'planifie',
  'en_cours',
  'complete',
]

/** Avance (ou corrige) le statut d'exécution d'un chantier. */
export async function avancerStatut(formData: FormData) {
  await exigerSession()

  const opportuniteId = texteOuNull(formData.get('opportunite_id'))
  const cible = texteOuNull(formData.get('statut')) as StatutOpp | null

  if (!opportuniteId || !cible || !STATUTS_CIBLES.includes(cible)) {
    redirect(`/chantiers?error=transition`)
  }

  const chemin = `/chantiers/${opportuniteId}`
  const supabase = await createClient()

  const { data: existante, error: erreurLecture } = await supabase
    .from('opportunites')
    .select('statut')
    .eq('id', opportuniteId)
    .maybeSingle()

  if (erreurLecture || !existante) {
    redirect(`${chemin}?error=introuvable`)
  }

  // Déjà dans l'état voulu : ne rien faire, et surtout ne pas polluer le fil de
  // notes avec une transition qui n'a pas eu lieu.
  if (existante.statut === cible) {
    redirect(chemin)
  }

  // Garde applicative. Le trigger `opportunites_restreindre_maj_roofer` fait
  // autorité en base — celle-ci évite un aller-retour et donne un message clair.
  if (!transitionRooferAutorisee(existante.statut, cible)) {
    redirect(`${chemin}?error=transition`)
  }

  const { error } = await supabase
    .from('opportunites')
    .update({ statut: cible })
    .eq('id', opportuniteId)

  if (error) {
    redirect(`${chemin}?error=refus`)
  }

  // Piste d'audit : toute transition de statut écrit une note (§4.10).
  const sens = estRetourEnArriere(existante.statut, cible) ? ' (correction)' : ''

  await supabase.from('notes').insert({
    opportunite_id: opportuniteId,
    texte: `Statut : ${LIBELLES_STATUT[existante.statut]} → ${LIBELLES_STATUT[cible]}${sens}.`,
    auteur: 'Système',
  })

  revalidatePath(chemin)
  redirect(`${chemin}?ok=statut`)
}

/**
 * Supprime une photo : l'objet du bucket ET la ligne `photos`.
 *
 * L'objet d'abord. Si l'ordre était inversé et que la suppression du bucket
 * échouait, on garderait un fichier orphelin sans trace pour le retrouver.
 */
export async function supprimerPhoto(formData: FormData) {
  await exigerSession()

  const photoId = texteOuNull(formData.get('photo_id'))
  const opportuniteId = texteOuNull(formData.get('opportunite_id'))
  const cheminObjet = texteOuNull(formData.get('chemin'))

  if (!photoId || !opportuniteId || !cheminObjet) {
    redirect(`/chantiers?error=photo`)
  }

  const chemin = `/chantiers/${opportuniteId}`
  const supabase = await createClient()

  const { error: erreurObjet } = await supabase.storage
    .from('photos')
    .remove([cheminObjet])

  if (erreurObjet) {
    redirect(`${chemin}?error=photo`)
  }

  const { error } = await supabase.from('photos').delete().eq('id', photoId)

  if (error) {
    redirect(`${chemin}?error=photo_ligne`)
  }

  revalidatePath(chemin)
  redirect(`${chemin}?ok=photo_supprimee`)
}
