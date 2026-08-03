'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { exigerAdmin } from '@/lib/auth'
import { lireSourceDirecte, LIBELLES_SOURCE } from '@/lib/sources'
import { argNullable } from '@/lib/supabase/args'
import { createClient } from '@/lib/supabase/server'
import type { ProduitGonano, TypeTravail } from '@/lib/vente'

const CHEMIN = '/admin/assignation'

function texteOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? '').trim()

  return texte === '' ? null : texte
}

/** Ce que le formulaire de vente directe envoie. */
export type ChargeVenteDirecte = {
  source: string
  adresse: string
  ville: string | null
  codePostal: string | null
  closerId: string
  clientNom: string
  clientTel: string
  clientCourriel: string
  superficiePi2: number | null
  depotRecu: number
  dateCibleDebut: string | null
  dateCibleFin: string | null
  volets: {
    type: TypeTravail
    produit_gonano: ProduitGonano | null
    deuxieme_couche_fortify: boolean
    montant: number
  }[]
  extras: { description: string; montant: number }[]
  precisions: string | null
  notes: string | null
}

export type ResultatVenteDirecte =
  | { statut: 'ok'; opportuniteId: string }
  | { statut: 'erreur'; message: string }

/**
 * Crée de toutes pièces une vente qui n'est jamais passée par une porte.
 *
 * Référence d'un client, appel entrant, salon : jusqu'ici ces ventes n'avaient
 * aucune porte d'entrée, le seul chemin de création étant `/terrain/lead`.
 *
 * DEUX ÉTAPES, ET C'EST VOULU :
 *   1. on insère l'opportunité au statut `rdv` ;
 *   2. on appelle `conclure_vente()`, exactement comme le ferait un closer.
 *
 * Réutiliser la fonction SQL plutôt que d'écrire les montants à la main donne
 * gratuitement toute la validation serveur du module 3 — totaux RECALCULÉS
 * depuis les lignes, champs client obligatoires, statut de paiement dérivé du
 * dépôt, note d'audit. Dupliquer cette logique ici l'aurait fait diverger au
 * premier changement.
 *
 * Les deux étapes ne sont PAS dans la même transaction. Si la seconde échoue, on
 * supprime l'opportunité qu'on vient de créer : mieux vaut ne rien laisser
 * qu'un fantôme au statut `rdv` sans rendez-vous, qui polluerait l'agenda du
 * closer sans que personne comprenne d'où il sort.
 */
export async function creerVenteDirecte(
  charge: ChargeVenteDirecte,
): Promise<ResultatVenteDirecte> {
  await exigerAdmin()

  const source = lireSourceDirecte(charge.source)

  // `lireSourceDirecte` refuse `porte` : un lead de porte-à-porte se crée sur le
  // terrain, avec son knocker, son GPS et son compteur de visites. L'autoriser
  // ici créerait une seconde façon de faire la même chose, sans traçabilité.
  if (!source) {
    return { statut: 'erreur', message: 'Choisis l’origine de cette vente.' }
  }

  const adresse = charge.adresse.trim()

  if (!adresse) {
    return { statut: 'erreur', message: 'L’adresse du chantier est obligatoire.' }
  }

  if (!charge.closerId) {
    return {
      statut: 'erreur',
      message: 'Choisis le closer à créditer : sans lui, la commission est perdue.',
    }
  }

  const supabase = await createClient()

  // Le `<select>` ne propose que des closers actifs, mais un formulaire se
  // falsifie — et `closer_id` porte la commission (§4.3).
  const { data: closer } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', charge.closerId)
    .eq('role', 'closer')
    .eq('actif', true)
    .maybeSingle()

  if (!closer) {
    return { statut: 'erreur', message: 'Ce profil n’est pas un closer actif.' }
  }

  // --- 1. L'opportunité -----------------------------------------------------
  const { data: opportunite, error: erreurInsert } = await supabase
    .from('opportunites')
    .insert({
      source,
      adresse,
      ville: charge.ville,
      code_postal: charge.codePostal,
      closer_id: charge.closerId,
      // Jamais de knocker sur une vente hors porte-à-porte : personne n'a cogné.
      knocker_id: null,
      client_nom: charge.clientNom.trim(),
      client_tel: charge.clientTel.trim(),
      client_courriel: charge.clientCourriel.trim(),
      // Statut de départ : `conclure_vente()` le fera passer à `vendu`. Il sert
      // aussi de garde — si l'étape 2 échoue, la ligne n'apparaît nulle part
      // comme un chantier à assigner.
      statut: 'rdv',
      // Zéro porte cognée : ne pas laisser le défaut de 1 gonfler la métrique de
      // haut de funnel (§4.6).
      nb_visites: 0,
    })
    .select('id')
    .single()

  if (erreurInsert || !opportunite) {
    return {
      statut: 'erreur',
      message: erreurInsert?.message ?? 'Création de l’opportunité impossible.',
    }
  }

  // --- 2. La vente ----------------------------------------------------------
  const { error: erreurVente } = await supabase.rpc('conclure_vente', {
    p_opportunite_id: opportunite.id,
    p_client_nom: charge.clientNom.trim(),
    p_client_tel: charge.clientTel.trim(),
    p_client_courriel: charge.clientCourriel.trim(),
    // `argNullable` : le générateur de types ne modélise pas la nullabilité des
    // arguments. Envoyer 0 pi² ou une date bidon écrirait une fausse donnée.
    p_superficie_pi2: argNullable(charge.superficiePi2),
    p_depot_recu: charge.depotRecu,
    p_date_cible_debut: argNullable(charge.dateCibleDebut),
    p_date_cible_fin: argNullable(charge.dateCibleFin),
    p_volets: charge.volets,
    p_extras: charge.extras,
    p_precisions: argNullable(charge.precisions),
  })

  if (erreurVente) {
    // Nettoyage : `on delete cascade` emporte volets, extras et notes.
    await supabase.from('opportunites').delete().eq('id', opportunite.id)

    return { statut: 'erreur', message: erreurVente.message }
  }

  // Piste d'audit (§4.10). La note de `conclure_vente()` dit le montant ; celle-ci
  // dit d'où vient l'affaire — sans quoi on ne saurait plus, dans six mois,
  // pourquoi ce chantier n'a pas de knocker.
  await supabase.from('notes').insert({
    opportunite_id: opportunite.id,
    texte: [
      `Vente enregistrée par l’administration — origine : ${LIBELLES_SOURCE[source].toLowerCase()}.`,
      charge.notes?.trim() ? charge.notes.trim() : null,
    ]
      .filter(Boolean)
      .join('\n'),
    auteur: 'Système',
  })

  revalidatePath(CHEMIN)

  return { statut: 'ok', opportuniteId: opportunite.id }
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

  /**
   * Écran d'où vient la demande, pour y revenir.
   *
   * Liste FERMÉE de deux chemins connus, pas la valeur brute du formulaire :
   * `redirect()` suit ce qu'on lui donne, et un champ caché se falsifie — ce
   * serait une redirection ouverte offerte à qui sait poster un formulaire.
   */
  const retour =
    formData.get('retour') === 'chantiers' ? '/admin/chantiers' : CHEMIN

  if (!opportuniteId || !rooferId) {
    redirect(`${retour}?error=champs_manquants`)
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
    redirect(`${retour}?error=roofer_invalide`)
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
    redirect(`${retour}?error=maj_impossible`)
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
  revalidatePath('/admin/chantiers')
  redirect(`${retour}?ok=assigne`)
}
