/** Une rue telle qu'affichée dans « Mes rues ». */
export type RuePourListe = {
  id: string
  nom_rue: string
  ville: string | null
  complete: boolean
}

/**
 * Comparateur fr-CA : accents traités correctement (« Île » près de « I », pas
 * après « Z ») et nombres comparés numériquement, pour que « 2e Avenue » précède
 * « 10e Avenue ».
 */
const COMPARATEUR = new Intl.Collator('fr-CA', {
  numeric: true,
  sensitivity: 'base',
})

/** Une ville absente passe en dernier plutôt que de remonter en tête. */
function comparerVilles(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1

  return COMPARATEUR.compare(a, b)
}

/**
 * Trie par ville puis par nom de rue.
 *
 * Volontairement **indépendant de `complete`** : si cocher une rue la déplaçait
 * en bas de liste, la ligne suivante remonterait sous le pouce du knocker et il
 * cocherait la mauvaise. La liste reste stable pendant qu'on la coche.
 */
export function trierRues<T extends { nom_rue: string; ville: string | null }>(
  rues: readonly T[],
): T[] {
  return [...rues].sort((a, b) => {
    const parVille = comparerVilles(a.ville, b.ville)

    if (parVille !== 0) return parVille

    return COMPARATEUR.compare(a.nom_rue, b.nom_rue)
  })
}

/** Nombre de rues marquées complétées. */
export function compterCompletees(
  rues: readonly { complete: boolean }[],
): number {
  return rues.filter((rue) => rue.complete).length
}
