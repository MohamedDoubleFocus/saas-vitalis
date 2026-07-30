import type { StatutOpp } from '@/lib/doublons'
import { createClient } from '@/lib/supabase/client'

import type { Mutation } from './file'

/**
 * Exécution effective des mutations en file.
 *
 * Les écritures passent par le client Supabase **du navigateur**, donc par la
 * session du knocker et par la RLS. Aucune route API à écrire, et aucun moyen
 * pour la file d'écrire quelque chose que l'utilisateur n'aurait pas le droit
 * d'écrire lui-même.
 *
 * Convention : lever une erreur = échec. `classerErreur` (dans `file.ts`) décide
 * ensuite s'il faut réessayer (réseau) ou compter une tentative (refus).
 */

/* -------------------------------------------------------------------------- */
/* maj_territoire_complete                                                     */
/* -------------------------------------------------------------------------- */

export type ChargeMajTerritoire = {
  territoire_id: string
  complete: boolean
}

function lireChargeMajTerritoire(charge: unknown): ChargeMajTerritoire {
  const c = charge as Partial<ChargeMajTerritoire> | null

  if (typeof c?.territoire_id !== 'string' || typeof c?.complete !== 'boolean') {
    throw new Error('Charge invalide pour une mise à jour de territoire.')
  }

  return { territoire_id: c.territoire_id, complete: c.complete }
}

async function majTerritoireComplete(charge: unknown): Promise<void> {
  const { territoire_id, complete } = lireChargeMajTerritoire(charge)

  const supabase = createClient()

  // Seul `complete` est envoyé : le trigger
  // `territoires_restreindre_maj_knocker` (module 1) rejette toute autre
  // modification faite par un knocker.
  const { error } = await supabase
    .from('territoires')
    .update({ complete })
    .eq('id', territoire_id)

  if (error) throw new Error(error.message)
}

/* -------------------------------------------------------------------------- */
/* creation_lead                                                               */
/* -------------------------------------------------------------------------- */

export type ChargeCreationLead = {
  /**
   * Opportunité existante à mettre à jour au lieu d'en créer une nouvelle.
   *
   * Renseignée uniquement quand le doublon détecté appartient AU KNOCKER COURANT :
   * la RLS du module 1 (`opportunites_update_knocker`) n'autorise la mise à jour
   * que de ses propres lignes. Sur la porte d'un collègue, le formulaire crée sa
   * propre opportunité.
   */
  opportuniteId: string | null
  knockerId: string
  adresse: string
  ville: string | null
  codePostal: string | null
  latitude: number | null
  longitude: number | null
  clientNom: string | null
  note: string | null
  statut: StatutOpp
  /** ISO. Renseigné seulement si `statut === 'rdv'`. */
  dateRdv: string | null
  closerId: string | null
  /**
   * Instant réel du coup de porte, capturé à la saisie.
   *
   * Sert de `derniere_visite`. Sans lui, une mutation partie vingt minutes plus
   * tard daterait la visite de l'envoi et fausserait la métrique de haut de
   * funnel (CLAUDE.md §4.6).
   */
  saisiLe: string
}

function texteOuNull(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null

  const texte = valeur.trim()

  return texte === '' ? null : texte
}

function nombreOuNull(valeur: unknown): number | null {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null
}

const STATUTS_LEAD: readonly StatutOpp[] = ['absent', 'refus', 'repasser', 'rdv']

function lireChargeCreationLead(charge: unknown): ChargeCreationLead {
  const c = charge as Partial<ChargeCreationLead> | null

  if (typeof c?.knockerId !== 'string' || !c.knockerId) {
    throw new Error('Charge invalide : knocker manquant.')
  }

  const adresse = texteOuNull(c.adresse)

  if (!adresse) {
    throw new Error('Charge invalide : adresse manquante.')
  }

  if (!c.statut || !STATUTS_LEAD.includes(c.statut)) {
    throw new Error('Charge invalide : statut de contact inattendu.')
  }

  const saisiLe = texteOuNull(c.saisiLe) ?? new Date().toISOString()

  return {
    opportuniteId: texteOuNull(c.opportuniteId),
    knockerId: c.knockerId,
    adresse,
    ville: texteOuNull(c.ville),
    codePostal: texteOuNull(c.codePostal),
    latitude: nombreOuNull(c.latitude),
    longitude: nombreOuNull(c.longitude),
    clientNom: texteOuNull(c.clientNom),
    note: texteOuNull(c.note),
    statut: c.statut,
    dateRdv: texteOuNull(c.dateRdv),
    closerId: texteOuNull(c.closerId),
    saisiLe,
  }
}

/** Note libre du knocker, si présente. */
async function ajouterNote(
  opportuniteId: string,
  texte: string | null,
  auteur: string,
): Promise<void> {
  if (!texte) return

  const supabase = createClient()

  const { error } = await supabase
    .from('notes')
    .insert({ opportunite_id: opportuniteId, texte, auteur })

  // Une note qui échoue ne doit pas faire réessayer toute l'opportunité : elle
  // est déjà enregistrée, et rejouer la mutation la dupliquerait. On ne lève pas.
  if (error) {
    console.warn('Note non enregistrée :', error.message)
  }
}

async function creerLead(charge: ChargeCreationLead): Promise<void> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('opportunites')
    .insert({
      knocker_id: charge.knockerId,
      closer_id: charge.closerId,
      adresse: charge.adresse,
      ville: charge.ville,
      code_postal: charge.codePostal,
      latitude: charge.latitude,
      longitude: charge.longitude,
      client_nom: charge.clientNom,
      statut: charge.statut,
      date_rdv: charge.dateRdv,
      nb_visites: 1,
      derniere_visite: charge.saisiLe,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  await ajouterNote(data.id, charge.note, 'Knocker')
}

/**
 * Le knocker recogne une porte qu'il a déjà enregistrée.
 *
 * Incrémente `nb_visites` au lieu de créer un doublon (CLAUDE.md §4.6 : chaque
 * porte cognée compte, absents compris).
 *
 * ⚠️ L'incrément est un lire-puis-écrire, pas une opération atomique : PostgREST
 * n'expose pas `nb_visites = nb_visites + 1`. Acceptable ici — une porte est
 * cognée par un knocker à la fois. Une fonction RPC serait nécessaire si deux
 * appareils pouvaient écrire la même ligne simultanément.
 */
async function majLead(charge: ChargeCreationLead & { opportuniteId: string }): Promise<void> {
  const supabase = createClient()

  const { data: existante, error: erreurLecture } = await supabase
    .from('opportunites')
    .select('nb_visites, statut, date_rdv, nb_reports, client_nom')
    .eq('id', charge.opportuniteId)
    .single()

  if (erreurLecture) throw new Error(erreurLecture.message)

  const changeDeStatut = existante.statut !== charge.statut
  // Un rendez-vous qui se déplace est un report (CLAUDE.md §4.10).
  const reporteLeRdv =
    Boolean(charge.dateRdv) &&
    Boolean(existante.date_rdv) &&
    charge.dateRdv !== existante.date_rdv

  const { error } = await supabase
    .from('opportunites')
    .update({
      statut: charge.statut,
      nb_visites: existante.nb_visites + 1,
      derniere_visite: charge.saisiLe,
      // Ne jamais effacer une donnée déjà saisie avec un champ laissé vide.
      client_nom: charge.clientNom ?? existante.client_nom,
      ...(charge.dateRdv ? { date_rdv: charge.dateRdv } : {}),
      ...(charge.closerId ? { closer_id: charge.closerId } : {}),
      ...(reporteLeRdv ? { nb_reports: existante.nb_reports + 1 } : {}),
    })
    .eq('id', charge.opportuniteId)

  if (error) throw new Error(error.message)

  // Piste d'audit : le fil de notes garde la trace des transitions (§4.10).
  if (changeDeStatut) {
    await ajouterNote(
      charge.opportuniteId,
      `Statut : ${existante.statut} → ${charge.statut} (nouvelle visite).`,
      'Système',
    )
  }

  if (reporteLeRdv) {
    await ajouterNote(
      charge.opportuniteId,
      `Rendez-vous déplacé au ${charge.dateRdv}.`,
      'Système',
    )
  }

  await ajouterNote(charge.opportuniteId, charge.note, 'Knocker')
}

async function enregistrerLead(chargeBrute: unknown): Promise<void> {
  const charge = lireChargeCreationLead(chargeBrute)

  if (charge.opportuniteId) {
    return majLead({ ...charge, opportuniteId: charge.opportuniteId })
  }

  return creerLead(charge)
}

/* -------------------------------------------------------------------------- */

export async function executer(mutation: Mutation): Promise<void> {
  switch (mutation.type) {
    case 'maj_territoire_complete':
      return majTerritoireComplete(mutation.charge)

    case 'creation_lead':
      return enregistrerLead(mutation.charge)
  }
}
