import { createClient } from '@/lib/supabase/client'

import {
  boiteEnglobante,
  trouverDoublon,
  type AdresseCandidate,
  type OpportuniteProche,
} from './doublons'

/**
 * Recherche d'un doublon **en ligne** (CLAUDE.md §5 : les vérifications se font
 * contre la base, sans cache local).
 *
 * Deux requêtes complémentaires, puis le filtrage précis en pur :
 *   1. une boîte englobante GPS — précise et peu coûteuse, mais aveugle aux
 *      opportunités sans coordonnées ;
 *   2. la même ville — rattrape les leads saisis à la main, sans GPS.
 *
 * Le knocker peut lire TOUTES les opportunités (politique
 * `opportunites_select_knocker` du module 1), donc la détection fonctionne aussi
 * sur les portes cognées par ses collègues — c'est tout l'intérêt.
 */

const COLONNES =
  'id, adresse, ville, latitude, longitude, statut, derniere_visite, nb_visites, knocker_id'

/** Rayon de la fenêtre de recherche : large, le filtrage fin est ensuite pur. */
const RAYON_RECHERCHE_METRES = 80

/** Garde-fou : au-delà, on ne rapatrie pas plus de lignes. */
const LIMITE = 200

type LigneBrute = {
  id: string
  adresse: string
  ville: string | null
  latitude: number | null
  longitude: number | null
  statut: OpportuniteProche['statut']
  derniere_visite: string
  nb_visites: number
  knocker_id: string | null
}

function versOpportuniteProche(ligne: LigneBrute): OpportuniteProche {
  return {
    id: ligne.id,
    adresse: ligne.adresse,
    ville: ligne.ville,
    latitude: ligne.latitude,
    longitude: ligne.longitude,
    statut: ligne.statut,
    derniereVisite: ligne.derniere_visite,
    nbVisites: ligne.nb_visites,
    knockerId: ligne.knocker_id,
  }
}

export type DoublonTrouve = {
  opportunite: OpportuniteProche
  /** Nom du knocker qui a cogné, ou `null` si introuvable. */
  nomKnocker: string | null
  /** Vrai si c'est le knocker courant qui l'a cognée. */
  estLaMienne: boolean
}

/**
 * Cherche un doublon pour l'adresse sélectionnée.
 *
 * Lève en cas d'échec réseau — l'appelant doit alors **laisser passer** : hors
 * ligne, on ne bloque pas la saisie (CLAUDE.md §5).
 */
export async function chercherDoublon(
  candidat: AdresseCandidate,
  knockerCourantId: string,
): Promise<DoublonTrouve | null> {
  const supabase = createClient()

  const requetes: PromiseLike<{ data: LigneBrute[] | null }>[] = []

  if (typeof candidat.latitude === 'number' && typeof candidat.longitude === 'number') {
    const boite = boiteEnglobante(
      { latitude: candidat.latitude, longitude: candidat.longitude },
      RAYON_RECHERCHE_METRES,
    )

    requetes.push(
      supabase
        .from('opportunites')
        .select(COLONNES)
        .gte('latitude', boite.latMin)
        .lte('latitude', boite.latMax)
        .gte('longitude', boite.lonMin)
        .lte('longitude', boite.lonMax)
        .limit(LIMITE),
    )
  }

  if (candidat.ville) {
    requetes.push(
      supabase
        .from('opportunites')
        .select(COLONNES)
        .eq('ville', candidat.ville)
        .limit(LIMITE),
    )
  }

  if (requetes.length === 0) return null

  const reponses = await Promise.all(requetes)

  // Fusion par identifiant : les deux requêtes se recoupent largement.
  const parId = new Map<string, OpportuniteProche>()

  for (const reponse of reponses) {
    for (const ligne of reponse.data ?? []) {
      parId.set(ligne.id, versOpportuniteProche(ligne))
    }
  }

  const doublon = trouverDoublon(candidat, [...parId.values()])

  if (!doublon) return null

  let nomKnocker: string | null = null

  if (doublon.knockerId) {
    // `annuaire_profils` : vue en lecture seule qui expose id, nom et rôle à tout
    // utilisateur authentifié (`profiles` reste fermé).
    const { data } = await supabase
      .from('annuaire_profils')
      .select('nom_complet')
      .eq('id', doublon.knockerId)
      .maybeSingle()

    nomKnocker = data?.nom_complet ?? null
  }

  return {
    opportunite: doublon,
    nomKnocker,
    estLaMienne: doublon.knockerId === knockerCourantId,
  }
}
