'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { exigerAdmin } from '@/lib/auth'
import { deconnecter } from '@/lib/google/credentials'
import { createClient } from '@/lib/supabase/server'

const CHEMIN = '/admin/google'

function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? '').trim()

  return texte === '' ? null : texte
}

/**
 * Associe un calendrier Google à un closer.
 *
 * Écriture via la session de l'admin : `profiles_update_admin` fait foi. La
 * valeur reste un simple texte — c'est Google qui validera l'existence du
 * calendrier au premier appel, et l'écran d'administration ne propose que des
 * calendriers réellement accessibles en écriture.
 */
export async function associerCalendrier(formData: FormData) {
  await exigerAdmin()

  const profilId = texteOuNull(formData.get('profil_id'))
  const calendrierId = texteOuNull(formData.get('google_calendar_id'))

  if (!profilId) {
    redirect(`${CHEMIN}?error=champs_manquants`)
  }

  const supabase = await createClient()

  const { data: cible } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', profilId)
    .maybeSingle()

  if (!cible) {
    redirect(`${CHEMIN}?error=maj_impossible`)
  }

  if (cible.role !== 'closer') {
    redirect(`${CHEMIN}?error=pas_un_closer`)
  }

  const { error } = await supabase
    .from('profiles')
    .update({ google_calendar_id: calendrierId })
    .eq('id', profilId)

  if (error) {
    redirect(`${CHEMIN}?error=maj_impossible`)
  }

  revalidatePath(CHEMIN)
  redirect(`${CHEMIN}?ok=${calendrierId ? 'associe' : 'dissocie'}`)
}

/**
 * Oublie le compte Google connecté.
 *
 * Supprime seulement notre jeton : l'autorisation reste active côté Google tant
 * qu'elle n'est pas révoquée depuis le compte lui-même. C'est volontaire — une
 * reconnexion accidentelle ne doit pas exiger de repasser par les réglages
 * Google.
 */
export async function deconnecterGoogle() {
  await exigerAdmin()

  try {
    await deconnecter()
  } catch {
    redirect(`${CHEMIN}?error=deconnexion`)
  }

  revalidatePath(CHEMIN)
  redirect(`${CHEMIN}?ok=deconnecte`)
}
