import type { Metadata } from 'next'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'

import { FormulaireLead } from './formulaire-lead'

export const metadata: Metadata = {
  title: 'Nouveau lead — Vitalis',
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
 */
export default async function PageNouveauLead() {
  const session = await exigerSession()

  return (
    <CadrePage titre="Nouveau lead" largeur="terrain">
      <FormulaireLead knockerId={session.userId} closerId={session.closerId} />
    </CadrePage>
  )
}
