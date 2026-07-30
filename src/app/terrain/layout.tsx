import { NavigationTerrain } from '@/components/navigation-terrain'
import { exigerSession } from '@/lib/auth'
import { FournisseurFileAttente } from '@/lib/file-attente/fournisseur'

/**
 * Zone terrain (knocker, closer).
 *
 * Deux responsabilités :
 *   • monter la file d'attente une seule fois pour toute la zone, afin que les
 *     écrans partagent la même file et le même indicateur d'état ;
 *   • poser la barre de navigation basse.
 *
 * Les pages enfants restent des Server Components — React accepte de les passer
 * en `children` à un composant client.
 */
export default async function LayoutTerrain({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await exigerSession()

  return (
    <FournisseurFileAttente>
      {/* `pb-24` réserve la hauteur de la barre basse : sans ça, la dernière
          carte de chaque liste passe sous la navigation. */}
      <div className="flex flex-1 flex-col pb-24">{children}</div>

      <NavigationTerrain role={session.role} />
    </FournisseurFileAttente>
  )
}
