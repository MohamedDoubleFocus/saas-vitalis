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
  /** Déjà normalisé en E.164 par le formulaire (`versE164`). */
  clientTel: string | null
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
    clientTel: texteOuNull(c.clientTel),
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

/**
 * Demande au serveur de créer l'événement Google du rendez-vous.
 *
 * Volontairement **sans conséquence en cas d'échec** : le rendez-vous est déjà
 * en base, et le jeton Google ne peut vivre que côté serveur. Si l'appel rate —
 * hors ligne, Google en panne, calendrier non associé — `google_event_id` reste
 * NULL, ce qui sert de marqueur pour une resynchronisation ultérieure.
 *
 * On ne lève jamais : faire échouer la mutation ferait réessayer la création du
 * lead lui-même, alors qu'elle a réussi.
 */
async function synchroniserEvenementGoogle(opportuniteId: string): Promise<void> {
  try {
    await fetch('/api/rdv/evenement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opportuniteId }),
    })
  } catch {
    // Silencieux par conception — voir le commentaire ci-dessus.
  }
}

/**
 * Demande au serveur d'envoyer le SMS de confirmation au client.
 *
 * Même règle que la synchro Google : **jamais bloquant**. Le rendez-vous est
 * déjà en base ; qu'OpenPhone soit à court de crédits, que le closer n'ait pas
 * de numéro ou que le réseau ait sauté ne doit rien changer au booking.
 *
 * La clé d'API vit exclusivement côté serveur — d'où le passage par une route.
 */
async function envoyerSmsConfirmation(opportuniteId: string): Promise<void> {
  try {
    await fetch('/api/rdv/sms-confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opportuniteId }),
    })
  } catch {
    // Silencieux par conception — voir le commentaire ci-dessus.
  }
}

/**
 * Ce qui suit un rendez-vous fraîchement booké : l'événement Google et le SMS.
 *
 * Les deux partent en parallèle et aucun ne peut faire échouer l'autre.
 */
async function apresBooking(opportuniteId: string): Promise<void> {
  await Promise.allSettled([
    synchroniserEvenementGoogle(opportuniteId),
    envoyerSmsConfirmation(opportuniteId),
  ])
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
      client_tel: charge.clientTel,
      statut: charge.statut,
      date_rdv: charge.dateRdv,
      nb_visites: 1,
      derniere_visite: charge.saisiLe,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  await ajouterNote(data.id, charge.note, 'Knocker')

  if (charge.dateRdv) {
    await apresBooking(data.id)
  }
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
    .select('nb_visites, statut, date_rdv, nb_reports, client_nom, client_tel')
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
      client_tel: charge.clientTel ?? existante.client_tel,
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

  if (charge.dateRdv) {
    await apresBooking(charge.opportuniteId)
  }
}

async function enregistrerLead(chargeBrute: unknown): Promise<void> {
  const charge = lireChargeCreationLead(chargeBrute)

  if (charge.opportuniteId) {
    return majLead({ ...charge, opportuniteId: charge.opportuniteId })
  }

  return creerLead(charge)
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* close_vente                                                                 */
/* -------------------------------------------------------------------------- */

/** Un volet, tel qu'attendu par `conclure_vente()`. */
export type VoletAEnvoyer = {
  type: string
  produit_gonano: string | null
  deuxieme_couche_fortify: boolean
  montant: number
}

export type ExtraAEnvoyer = {
  description: string
  montant: number
}

export type ChargeCloseVente = {
  opportuniteId: string
  clientNom: string
  clientTel: string
  clientCourriel: string
  superficiePi2: number | null
  depotRecu: number
  dateCibleDebut: string | null
  dateCibleFin: string | null
  volets: VoletAEnvoyer[]
  extras: ExtraAEnvoyer[]
  /** Ce que le schéma ne sait pas stocker (couleur des bardeaux), joint à la note. */
  precisions: string | null
}

function lireChargeClose(charge: unknown): ChargeCloseVente {
  const c = charge as Partial<ChargeCloseVente> | null

  if (typeof c?.opportuniteId !== 'string' || !c.opportuniteId) {
    throw new Error('Charge invalide : rendez-vous manquant.')
  }

  if (!Array.isArray(c.volets) || !Array.isArray(c.extras)) {
    throw new Error('Charge invalide : volets ou extras manquants.')
  }

  return {
    opportuniteId: c.opportuniteId,
    clientNom: String(c.clientNom ?? ''),
    clientTel: String(c.clientTel ?? ''),
    clientCourriel: String(c.clientCourriel ?? ''),
    superficiePi2: nombreOuNull(c.superficiePi2),
    depotRecu: nombreOuNull(c.depotRecu) ?? 0,
    dateCibleDebut: texteOuNull(c.dateCibleDebut),
    dateCibleFin: texteOuNull(c.dateCibleFin),
    volets: c.volets,
    extras: c.extras,
    precisions: texteOuNull(c.precisions),
  }
}

/**
 * Rétablit la nullabilité d'un argument de fonction Postgres.
 *
 * `supabase gen types` ne modélise pas la nullabilité des ARGUMENTS : il déclare
 * `p_superficie_pi2: number` et `p_date_cible_debut: string` alors que la
 * fonction accepte `NULL` pour les deux (seuls les paramètres munis d'un
 * `default` deviennent optionnels côté TypeScript).
 *
 * Envoyer `0` pi² ou une date bidon pour contourner le typage écrirait une
 * fausse donnée en base. On garde donc `null` et on corrige le type ici.
 */
function argNullable<T>(valeur: T | null): T {
  return valeur as T
}

/**
 * Conclut la vente via la fonction `conclure_vente()`.
 *
 * UN seul appel : les quatre tables sont écrites dans une transaction Postgres.
 * Une coupure réseau ne peut donc pas laisser une vente à moitié enregistrée —
 * soit le serveur a tout validé, soit rien n'a bougé et la file rejouera.
 *
 * La fonction est `security invoker` : ce sont les politiques du module 1 qui
 * autorisent ou refusent, pas elle.
 */
async function closeVente(chargeBrute: unknown): Promise<void> {
  const charge = lireChargeClose(chargeBrute)

  const supabase = createClient()

  const { error } = await supabase.rpc('conclure_vente', {
    p_opportunite_id: charge.opportuniteId,
    p_client_nom: charge.clientNom,
    p_client_tel: charge.clientTel,
    p_client_courriel: charge.clientCourriel,
    p_superficie_pi2: argNullable(charge.superficiePi2),
    p_depot_recu: charge.depotRecu,
    p_date_cible_debut: argNullable(charge.dateCibleDebut),
    p_date_cible_fin: argNullable(charge.dateCibleFin),
    p_volets: charge.volets,
    p_extras: charge.extras,
    // Muni d'un `default null` en SQL, donc optionnel côté types : on l'omet
    // plutôt que de passer `null`.
    p_precisions: charge.precisions ?? undefined,
  })

  if (error) throw new Error(error.message)
}

/* -------------------------------------------------------------------------- */
/* maj_statut_rdv                                                              */
/* -------------------------------------------------------------------------- */

export type ChargeMajStatutRdv = {
  opportuniteId: string
  statut: StatutOpp
  /** Motif saisi par le closer, joint à la note système. */
  motif: string | null
}

/**
 * Rendez-vous non conclu : le closer passe l'opportunité à `perdu` ou la renvoie
 * à `repasser`.
 *
 * Deux écritures, mais sans enjeu d'atomicité comparable au close : si la note
 * manquait, seule la piste d'audit serait incomplète, pas le contrat. La lecture
 * préalable du statut rend l'opération idempotente — un rejeu de la file ne
 * réécrit pas la note.
 */
async function majStatutRdv(chargeBrute: unknown): Promise<void> {
  const c = chargeBrute as Partial<ChargeMajStatutRdv> | null

  if (typeof c?.opportuniteId !== 'string' || !c.opportuniteId) {
    throw new Error('Charge invalide : rendez-vous manquant.')
  }

  if (c.statut !== 'perdu' && c.statut !== 'repasser') {
    throw new Error('Charge invalide : statut de clôture inattendu.')
  }

  const statut = c.statut
  const motif = texteOuNull(c.motif)
  const supabase = createClient()

  const { data: existante, error: erreurLecture } = await supabase
    .from('opportunites')
    .select('statut')
    .eq('id', c.opportuniteId)
    .single()

  if (erreurLecture) throw new Error(erreurLecture.message)

  // Déjà dans l'état voulu : rien à faire, et surtout pas de note en double.
  if (existante.statut === statut) return

  const { error } = await supabase
    .from('opportunites')
    .update({ statut })
    .eq('id', c.opportuniteId)

  if (error) throw new Error(error.message)

  const libelle = statut === 'perdu' ? 'Rendez-vous perdu' : 'Rendez-vous à repasser'

  await ajouterNote(
    c.opportuniteId,
    motif ? `${libelle} — ${motif}` : `${libelle}.`,
    'Système',
  )
}

/* -------------------------------------------------------------------------- */

export async function executer(mutation: Mutation): Promise<void> {
  switch (mutation.type) {
    case 'maj_territoire_complete':
      return majTerritoireComplete(mutation.charge)

    case 'creation_lead':
      return enregistrerLead(mutation.charge)

    case 'close_vente':
      return closeVente(mutation.charge)

    case 'maj_statut_rdv':
      return majStatutRdv(mutation.charge)
  }
}
