import type { Metadata } from 'next'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

import { FormulaireLead, type PortePrechargee } from './formulaire-lead'

export const metadata: Metadata = {
  title: 'Nouveau lead — Vitalis',
}

type Props = {
  searchParams: Promise<{ porte?: string }>
}

/**
 * Le formulaire le plus utilisé de l'app.
 *
 * Le choix de plage est une ÉTAPE du même composant client, pas une autre route :
 * changer de page ferait perdre la saisie et coûterait un aller-retour réseau
 * devant le client. Le knocker enchaîne sans latence.
 *
 * `closerId` vient de la session (donc du JWT depuis le module 2) : aucune
 * requête supplémentaire pour savoir à quel closer rattacher le rendez-vous.
 *
 * `?porte=<id>` : re-cognage depuis « Mes portes ». L'adresse est préremplie et
 * la visite s'ajoutera à l'opportunité existante au lieu d'en créer une seconde.
 */
export default async function PageNouveauLead({ searchParams }: Props) {
  const session = await exigerSession()
  const { porte: porteId } = await searchParams

  const porte = porteId ? await chargerPorte(porteId, session.userId) : null

  /**
   * À qui envoyer le rendez-vous.
   *
   * `profiles.closer_id` ne concerne que les knockers. Un closer qui cogne n'en
   * a pas — et sans ce repli, le rendez-vous qu'il décroche partirait sans
   * closer : ni événement Google, ni SMS, ni fiche dans un agenda. Il ferme
   * évidemment ses propres portes.
   */
  const closerId =
    session.closerId ?? (session.role === 'closer' ? session.userId : null)

  return (
    <CadrePage titre={porte ? 'Re-cogner' : 'Nouveau lead'} largeur="terrain">
      <FormulaireLead
        knockerId={session.userId}
        closerId={closerId}
        porte={porte}
      />
    </CadrePage>
  )
}

/**
 * Charge la porte à re-cogner.
 *
 * Le filtre `knocker_id` n'est pas cosmétique : la RLS laisse un knocker LIRE
 * toutes les opportunités (détection de doublons) mais ne le laisse MODIFIER que
 * les siennes. Préremplir la porte d'un collègue mènerait donc à un échec
 * d'écriture devant le client — mieux vaut retomber sur un lead neuf.
 */
async function chargerPorte(
  id: string,
  knockerId: string,
): Promise<PortePrechargee | null> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('opportunites')
    .select(
      'id, adresse, ville, code_postal, latitude, longitude, client_nom, client_tel, langue, statut, nb_visites, derniere_visite',
    )
    .eq('id', id)
    .eq('knocker_id', knockerId)
    .maybeSingle()

  if (!data) return null

  return {
    id: data.id,
    adresse: {
      adresse: data.adresse,
      ville: data.ville,
      codePostal: data.code_postal,
      latitude: data.latitude,
      longitude: data.longitude,
      adresseComplete: null,
    },
    clientNom: data.client_nom,
    clientTel: data.client_tel,
    langue: data.langue,
    statutPrecedent: data.statut,
    nbVisites: data.nb_visites,
    derniereVisite: data.derniere_visite,
  }
}
