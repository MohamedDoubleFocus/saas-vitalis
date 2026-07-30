'use server'

import { redirect } from 'next/navigation'

import { destinationApresConnexion } from '@/lib/roles'
import { createClient } from '@/lib/supabase/server'

/**
 * Connexion par courriel + mot de passe.
 *
 * Toute sortie d'erreur passe par `/login?error=<code>` : la page traduit le
 * code, aucun message brut de Supabase n'atteint l'utilisateur.
 */
export async function login(formData: FormData) {
  const courriel = String(formData.get('courriel') ?? '').trim()
  const motDePasse = String(formData.get('mot_de_passe') ?? '')
  const suivant = String(formData.get('suivant') ?? '')

  if (!courriel || !motDePasse) {
    redirect('/login?error=champs_manquants')
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: courriel,
    password: motDePasse,
  })

  // Message identique pour un courriel inconnu et un mot de passe erroné : ne
  // pas révéler quels comptes existent.
  if (error || !data.user) {
    redirect('/login?error=identifiants')
  }

  const { data: profil } = await supabase
    .from('profiles')
    .select('role, actif')
    .eq('id', data.user.id)
    .maybeSingle()

  // Un compte auth sans profil ne peut rien faire : la RLS ne lui accorde
  // aucun rôle. On coupe la session tout de suite plutôt que de le laisser
  // tourner en rond dans une app vide.
  if (!profil) {
    await supabase.auth.signOut()
    redirect('/login?error=profil_absent')
  }

  if (!profil.actif) {
    await supabase.auth.signOut()
    redirect('/login?error=compte_desactive')
  }

  redirect(destinationApresConnexion(profil.role, suivant))
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
