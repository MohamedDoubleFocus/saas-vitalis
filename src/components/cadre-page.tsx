import { BoutonDeconnexion } from '@/components/bouton-deconnexion'
import { profilCourant } from '@/lib/auth'
import { LIBELLES_ROLES } from '@/lib/roles'

/** Régime de largeur, calqué sur les deux zones de l'app (CLAUDE.md §3). */
export type Largeur = 'terrain' | 'gestion' | 'pleine'

/**
 * Largeur du conteneur par zone (CLAUDE.md §6). Seul endroit du code où cette
 * décision est écrite : aucune page ne pose de `max-w-*` elle-même.
 *
 * Classes écrites en clair : le scanner Tailwind lit le texte source, une
 * classe assemblée par concaténation ne serait jamais générée.
 */
const CLASSES_LARGEUR: Record<Largeur, string> = {
  // Téléphone, dehors, une main : jamais plus large que la référence 380px plus
  // ses marges. Aucun breakpoint, volontairement.
  terrain: 'max-w-[440px]',
  // Mobile d'abord, puis on ouvre à partir de `lg` (1024px) — le seuil à partir
  // duquel le kanban redevient permis.
  gestion: 'max-w-[440px] lg:max-w-5xl',
  // Pleine largeur au-delà de `lg`, pour les écrans qui EXPLOITENT vraiment
  // l'espace : un kanban à quatre colonnes étranglé dans 1024px donnerait des
  // colonnes de 240px, où chaque adresse serait tronquée.
  //
  // ⚠️ `max-w-[440px]` sous `lg` reste intact, sans exception : la contrainte
  // mobile de §6 ne se négocie pas, c'est seulement le plafond desktop qui saute.
  pleine: 'max-w-[440px] lg:max-w-none',
}

type Props = {
  titre: string
  /**
   * `terrain` par défaut : en cas d'oubli, on retombe sur la contrainte la plus
   * stricte plutôt que d'élargir un écran terrain par accident.
   */
  largeur?: Largeur
  children: React.ReactNode
}

/**
 * Cadre commun des écrans : en-tête (titre, utilisateur, déconnexion) et
 * conteneur centré dont la largeur dépend de la zone.
 */
export async function CadrePage({ titre, largeur = 'terrain', children }: Props) {
  // `profilCourant()` et non `sessionCourante()` : l'en-tête affiche le nom, qui
  // ne voyage pas dans le JWT et exige donc une lecture de `profiles`.
  const profil = await profilCourant()

  const identite = profil
    ? [profil.nomComplet, LIBELLES_ROLES[profil.role]].filter(Boolean).join(' · ')
    : null

  // En-tête et contenu partagent la même largeur, sinon ils se désalignent
  // au-delà du breakpoint.
  const classeLargeur = CLASSES_LARGEUR[largeur]

  return (
    <>
      <header className="border-b border-grey-border bg-white">
        <div
          className={`mx-auto flex ${classeLargeur} items-center justify-between gap-3 px-4 py-2`}
        >
          <div className="min-w-0">
            <p className="truncate font-display text-base font-semibold leading-tight text-navy">
              {titre}
            </p>
            {identite && (
              <p className="truncate text-xs text-grey-text">{identite}</p>
            )}
          </div>
          <BoutonDeconnexion />
        </div>
      </header>

      <main className={`mx-auto w-full ${classeLargeur} flex-1 px-4 py-5`}>
        {children}
      </main>
    </>
  )
}
