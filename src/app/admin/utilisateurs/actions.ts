'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { exigerAdmin } from '@/lib/auth'
import { estRoleUser } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const CHEMIN = '/admin/utilisateurs'

/** Longueur minimale du mot de passe temporaire. */
const LONGUEUR_MIN_MOT_DE_PASSE = 8

/**
 * ~100 ans. Supabase n'accepte pas d'unité plus grande que l'heure, et un
 * bannissement se lève avec `ban_duration: 'none'` — rien n'est détruit.
 */
const BANNISSEMENT_LONG = '876000h'

/** `''` → `null`, sinon la valeur nettoyée. */
function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? '').trim()
  return texte === '' ? null : texte
}

/**
 * Vérifie qu'un `closer_id` désigne bien un closer actif.
 *
 * Le formulaire ne propose que des closers, mais un `<select>` se falsifie :
 * sans cette vérification, un admin (ou n'importe qui rejouant la requête)
 * pourrait rattacher un knocker à un roofer.
 */
async function closerValide(closerId: string | null): Promise<boolean> {
  if (!closerId) return true

  const admin = createAdminClient()

  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('id', closerId)
    .eq('role', 'closer')
    .eq('actif', true)
    .maybeSingle()

  return data !== null
}

/**
 * Crée un compte auth + son profil.
 *
 * Se fait avec la clé `service_role` : un admin n'a aucun droit sur
 * `auth.users`. C'est aussi pourquoi cette action vérifie elle-même que
 * l'appelant est admin — la RLS ne protège plus rien à ce niveau.
 */
export async function creerUtilisateur(formData: FormData) {
  await exigerAdmin()

  const nomComplet = String(formData.get('nom_complet') ?? '').trim()
  const courriel = String(formData.get('courriel') ?? '')
    .trim()
    .toLowerCase()
  const motDePasse = String(formData.get('mot_de_passe') ?? '')
  const role = formData.get('role')

  if (!nomComplet || !courriel || !motDePasse) {
    redirect(`${CHEMIN}?error=champs_manquants`)
  }

  if (!estRoleUser(role)) {
    redirect(`${CHEMIN}?error=role_invalide`)
  }

  if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
    redirect(`${CHEMIN}?error=mot_de_passe_court`)
  }

  // Le rattachement à un closer n'a de sens que pour un knocker. Le formulaire
  // affiche le champ en permanence (interactions zéro-JS, CLAUDE.md §6) : c'est
  // ici qu'on le neutralise pour les autres rôles.
  const closerId = role === 'knocker' ? texteOuNull(formData.get('closer_id')) : null

  if (!(await closerValide(closerId))) {
    redirect(`${CHEMIN}?error=closer_invalide`)
  }

  const admin = createAdminClient()

  const { data, error } = await admin.auth.admin.createUser({
    email: courriel,
    password: motDePasse,
    // Compte interne créé par un admin : pas de courriel de confirmation à
    // attendre, l'employé se connecte tout de suite.
    email_confirm: true,
    user_metadata: { nom_complet: nomComplet },
  })

  if (error || !data.user) {
    redirect(`${CHEMIN}?error=creation_auth`)
  }

  const { error: erreurProfil } = await admin.from('profiles').insert({
    id: data.user.id,
    nom_complet: nomComplet,
    role,
    closer_id: closerId,
  })

  if (erreurProfil) {
    // Le compte auth existe désormais sans profil : il ne peut pas se
    // connecter (le proxy renvoie `profil_absent`). On ne le supprime PAS —
    // aucun hard-delete de user (CLAUDE.md §4.2). La reprise se fait par un
    // INSERT manuel dans `profiles`, cf. le message affiché.
    redirect(`${CHEMIN}?error=creation_profil`)
  }

  revalidatePath(CHEMIN)
  redirect(`${CHEMIN}?ok=cree`)
}

/**
 * Change le closer auquel un knocker est rattaché (ou le délie).
 *
 * Le `closer_id` voyage dans le JWT : le nouveau rattachement ne sera visible de
 * la zone terrain qu'au prochain rafraîchissement du jeton du knocker (une heure
 * au plus). Sans effet sur la RLS, qui lit toujours la base.
 */
export async function modifierCloser(formData: FormData) {
  await exigerAdmin()

  const profilId = texteOuNull(formData.get('profil_id'))
  const closerId = texteOuNull(formData.get('closer_id'))

  if (!profilId) {
    redirect(`${CHEMIN}?error=champs_manquants`)
  }

  // Garde-fou doublé par la contrainte `profiles_closer_id_pas_soi_meme`.
  if (closerId === profilId) {
    redirect(`${CHEMIN}?error=closer_invalide`)
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

  if (cible.role !== 'knocker') {
    redirect(`${CHEMIN}?error=pas_un_knocker`)
  }

  if (!(await closerValide(closerId))) {
    redirect(`${CHEMIN}?error=closer_invalide`)
  }

  const { error } = await supabase
    .from('profiles')
    .update({ closer_id: closerId })
    .eq('id', profilId)

  if (error) {
    redirect(`${CHEMIN}?error=maj_impossible`)
  }

  revalidatePath(CHEMIN)
  redirect(`${CHEMIN}?ok=${closerId ? 'closer_change' : 'closer_retire'}`)
}

/**
 * Active ou désactive un profil — jamais de suppression (CLAUDE.md §4.2).
 *
 * Deux volets, parce que le rôle voyage maintenant dans le JWT :
 *   1. `profiles.actif`, que lisent la RLS et l'application ;
 *   2. le bannissement du compte auth, qui invalide les jetons de
 *      rafraîchissement. Sans lui, le jeton d'accès déjà émis continuerait de
 *      porter `actif: true` jusqu'à son expiration (une heure par défaut).
 *      Le bannissement se lève avec `ban_duration: 'none'` : rien n'est détruit.
 */
export async function basculerActif(formData: FormData) {
  const session = await exigerAdmin()

  const profilId = texteOuNull(formData.get('profil_id'))
  const actif = formData.get('actif') === 'true'

  if (!profilId) {
    redirect(`${CHEMIN}?error=champs_manquants`)
  }

  // Un admin qui se désactive se verrouille dehors — et il est peut-être le
  // seul admin de l'organisation.
  if (profilId === session.userId && !actif) {
    redirect(`${CHEMIN}?error=auto_desactivation`)
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('profiles')
    .update({ actif })
    .eq('id', profilId)

  if (error) {
    redirect(`${CHEMIN}?error=maj_impossible`)
  }

  const admin = createAdminClient()
  const { error: erreurAuth } = await admin.auth.admin.updateUserById(profilId, {
    ban_duration: actif ? 'none' : BANNISSEMENT_LONG,
  })

  if (erreurAuth) {
    // `profiles.actif` est déjà à jour, donc la RLS bloque déjà l'accès aux
    // données. Seule la session en cours peut survivre jusqu'à expiration du
    // jeton : on le dit plutôt que de laisser croire à un succès complet.
    redirect(`${CHEMIN}?error=auth_non_synchronisee`)
  }

  revalidatePath(CHEMIN)
  redirect(`${CHEMIN}?ok=${actif ? 'reactive' : 'desactive'}`)
}
