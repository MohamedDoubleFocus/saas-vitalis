'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { exigerAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? '').trim()

  return texte === '' ? null : texte
}

/**
 * Attribue le secteur à un knocker — ou le libère.
 *
 * C'est `secteurs.knocker_id` qui fait foi : les rues suivent automatiquement,
 * les politiques de `territoires` lisant le secteur (migration du module 5).
 * Rien à recopier sur chaque rue.
 */
export async function assignerSecteur(formData: FormData) {
  await exigerAdmin()

  const secteurId = texteOuNull(formData.get('secteur_id'))
  const knockerId = texteOuNull(formData.get('knocker_id'))

  if (!secteurId) {
    redirect('/admin/secteurs?error=champs_manquants')
  }

  const chemin = `/admin/secteurs/${secteurId}`
  const supabase = await createClient()

  // Le `<select>` ne propose que des knockers, mais un formulaire se falsifie.
  if (knockerId) {
    const { data: knocker } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', knockerId)
      .eq('role', 'knocker')
      .eq('actif', true)
      .maybeSingle()

    if (!knocker) {
      redirect(`${chemin}?error=knocker_invalide`)
    }
  }

  const { error } = await supabase
    .from('secteurs')
    .update({ knocker_id: knockerId })
    .eq('id', secteurId)

  if (error) {
    redirect(`${chemin}?error=maj_impossible`)
  }

  revalidatePath(chemin)
  revalidatePath('/admin/secteurs')
  redirect(`${chemin}?ok=${knockerId ? 'assigne' : 'libere'}`)
}

/**
 * Supprime un secteur.
 *
 * `on delete cascade` emporte ses rues. Les opportunités qui pointaient vers
 * l'une d'elles conservent leur `territoire_id` à NULL (`on delete set null` du
 * module 0) : aucun lead n'est perdu.
 */
export async function supprimerSecteur(formData: FormData) {
  await exigerAdmin()

  const secteurId = texteOuNull(formData.get('secteur_id'))

  if (!secteurId) {
    redirect('/admin/secteurs?error=champs_manquants')
  }

  const supabase = await createClient()

  const { error } = await supabase.from('secteurs').delete().eq('id', secteurId)

  if (error) {
    redirect(`/admin/secteurs/${secteurId}?error=suppression`)
  }

  revalidatePath('/admin/secteurs')
  redirect('/admin/secteurs?ok=supprime')
}
