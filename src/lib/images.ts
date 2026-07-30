/**
 * Compression des photos de chantier, côté appareil (CLAUDE.md §4.12).
 *
 * Un téléphone récent produit des JPEG de 4 à 8 Mo. Sur un toit en LTE moyen,
 * les envoyer tels quels prend des minutes et fait échouer l'upload. On réduit
 * donc avant d'envoyer — pas après réception.
 */

/** Côté le plus long, en pixels, après réduction. */
export const COTE_MAX = 1600

/** Qualité JPEG. 0,72 : la différence ne se voit pas sur une photo de toiture. */
export const QUALITE_JPEG = 0.72

/**
 * Dimensions réduites en conservant les proportions.
 *
 * Une image déjà plus petite que `coteMax` est laissée telle quelle : la
 * ré-encoder ne ferait que dégrader la qualité sans gagner d'octets.
 */
export function dimensionsCompressees(
  largeur: number,
  hauteur: number,
  coteMax: number = COTE_MAX,
): { largeur: number; hauteur: number } {
  if (largeur <= 0 || hauteur <= 0) {
    return { largeur: 0, hauteur: 0 }
  }

  const plusGrandCote = Math.max(largeur, hauteur)

  if (plusGrandCote <= coteMax) {
    return { largeur: Math.round(largeur), hauteur: Math.round(hauteur) }
  }

  const facteur = coteMax / plusGrandCote

  return {
    largeur: Math.max(1, Math.round(largeur * facteur)),
    hauteur: Math.max(1, Math.round(hauteur * facteur)),
  }
}

/**
 * Chemin de l'objet dans le bucket : `<opportunite_id>/<uuid>.jpg`.
 *
 * Le premier segment n'est pas décoratif — les politiques Storage en dérivent
 * l'opportunité pour décider de l'accès (`opportunite_du_chemin`). Le changer
 * romprait la sécurité du bucket.
 */
export function cheminPhoto(opportuniteId: string, identifiant: string): string {
  return `${opportuniteId}/${identifiant}.jpg`
}

/**
 * Réduit une image et la ré-encode en JPEG.
 *
 * Navigateur uniquement (canvas). `createImageBitmap` respecte l'orientation
 * EXIF, ce qu'un `<img>` ne fait pas toujours — sans quoi les photos prises en
 * mode portrait ressortiraient couchées.
 */
export async function compresserImage(fichier: File): Promise<Blob> {
  const image = await createImageBitmap(fichier)

  try {
    const { largeur, hauteur } = dimensionsCompressees(image.width, image.height)

    const canvas = document.createElement('canvas')
    canvas.width = largeur
    canvas.height = hauteur

    const contexte = canvas.getContext('2d')

    if (!contexte) throw new Error('Canvas indisponible sur cet appareil.')

    contexte.drawImage(image, 0, 0, largeur, hauteur)

    const blob = await new Promise<Blob | null>((resoudre) =>
      canvas.toBlob(resoudre, 'image/jpeg', QUALITE_JPEG),
    )

    if (!blob) throw new Error('Compression impossible.')

    return blob
  } finally {
    // Libère la mémoire GPU : une dizaine de photos non fermées font planter
    // l'onglet sur un téléphone d'entrée de gamme.
    image.close()
  }
}
