'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { exigerManager } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

const LISTE = '/equipe/secteurs'

function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? '').trim()

  return texte === '' ? null : texte
}

/**
 * Attribue le secteur à un knocker — ou le libère.
 *
 * C'est `secteurs.knocker_id` qui fait foi : les rues suivent automatiquement,
 * les politiques de `territoires` lisant le secteur. Rien à recopier sur chaque
 * rue.
 *
 * Le périmètre n'est PAS décidé ici : `secteurs_update_manager` refuse en base
 * un knocker hors de l'équipe de l'appelant, et un secteur qu'il n'a pas créé.
 * La vérification ci-dessous ne sert qu'à donner un message clair plutôt qu'une
 * erreur Postgres.
 */
export async function assignerSecteur(formData: FormData) {
  const session = await exigerManager()

  const secteurId = texteOuNull(formData.get('secteur_id'))
  const knockerId = texteOuNull(formData.get('knocker_id'))

  if (!secteurId) {
    redirect(`${LISTE}?error=champs_manquants`)
  }

  const chemin = `${LISTE}/${secteurId}`
  const supabase = await createClient()

  // Le `<select>` ne propose que ses knockers, mais un formulaire se falsifie.
  if (knockerId) {
    const requete = supabase
      .from('profiles')
      .select('id')
      .eq('id', knockerId)
      .eq('role', 'knocker')
      .eq('actif', true)

    const { data: knocker } = session.estManager
      ? await requete.eq('manager_id', session.userId).maybeSingle()
      : await requete.maybeSingle()

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
  revalidatePath(LISTE)
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
  await exigerManager()

  const secteurId = texteOuNull(formData.get('secteur_id'))

  if (!secteurId) {
    redirect(`${LISTE}?error=champs_manquants`)
  }

  const supabase = await createClient()

  const { error } = await supabase.from('secteurs').delete().eq('id', secteurId)

  if (error) {
    redirect(`${LISTE}/${secteurId}?error=suppression`)
  }

  revalidatePath(LISTE)
  redirect(`${LISTE}?ok=supprime`)
}
