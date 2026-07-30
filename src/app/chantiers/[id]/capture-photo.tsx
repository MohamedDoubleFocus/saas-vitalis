'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { cheminPhoto, compresserImage } from '@/lib/images'
import { createClient } from '@/lib/supabase/client'

/**
 * Capture et dépôt d'une photo de chantier.
 *
 * Seul Client Component de la zone gestion, et c'est l'exception prévue par
 * CLAUDE.md §6 : la capture caméra et la compression n'ont pas d'équivalent
 * serveur. Tout le reste de l'écran est rendu côté serveur.
 *
 * La compression se fait sur l'appareil (§4.12) : une photo de 6 Mo devient
 * ~200 Ko avant de partir, ce qui rend l'envoi possible en LTE faible.
 */
export function CapturePhoto({ opportuniteId }: { opportuniteId: string }) {
  const router = useRouter()
  const refFichier = useRef<HTMLInputElement>(null)

  const [envoi, setEnvoi] = useState(false)
  const [progression, setProgression] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  async function deposer(fichiers: FileList | null) {
    if (!fichiers || fichiers.length === 0) return

    setEnvoi(true)
    setErreur(null)

    const supabase = createClient()
    let deposees = 0

    try {
      for (const [index, fichier] of Array.from(fichiers).entries()) {
        setProgression(`Photo ${index + 1} sur ${fichiers.length}…`)

        const compressee = await compresserImage(fichier)

        // Le premier segment DOIT être l'opportunité : les politiques Storage en
        // dérivent le droit d'accès (`opportunite_du_chemin`).
        const chemin = cheminPhoto(opportuniteId, crypto.randomUUID())

        const { error: erreurDepot } = await supabase.storage
          .from('photos')
          .upload(chemin, compressee, {
            contentType: 'image/jpeg',
            upsert: false,
          })

        if (erreurDepot) throw new Error(erreurDepot.message)

        // La ligne référence le CHEMIN, jamais une URL publique (§4.12).
        const { error: erreurLigne } = await supabase.from('photos').insert({
          opportunite_id: opportuniteId,
          photo_url: chemin,
        })

        if (erreurLigne) {
          // Ligne manquante = photo invisible dans la galerie. On retire l'objet
          // plutôt que de laisser un fichier orphelin dans le bucket.
          await supabase.storage.from('photos').remove([chemin])
          throw new Error(erreurLigne.message)
        }

        deposees += 1
      }
    } catch (e) {
      setErreur(
        deposees > 0
          ? `${deposees} photo(s) envoyée(s), puis échec : ${e instanceof Error ? e.message : 'erreur inconnue'}`
          : `Envoi impossible : ${e instanceof Error ? e.message : 'erreur inconnue'}`,
      )
    } finally {
      setEnvoi(false)
      setProgression(null)

      // Réinitialise le champ, sinon reprendre la même photo ne déclenche pas
      // d'événement `change`.
      if (refFichier.current) refFichier.current.value = ''

      if (deposees > 0) router.refresh()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={refFichier}
        id="photos"
        type="file"
        accept="image/*"
        // `capture` ouvre directement l'appareil photo arrière sur mobile.
        capture="environment"
        multiple
        onChange={(e) => void deposer(e.target.files)}
        disabled={envoi}
        className="sr-only"
      />

      <label
        htmlFor="photos"
        aria-disabled={envoi}
        className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-4 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong ${
          envoi ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        <span aria-hidden>◎</span>
        {envoi ? (progression ?? 'Envoi…') : 'Prendre une photo'}
      </label>

      {erreur && (
        <p role="alert" className="text-sm text-red-800">
          {erreur}
        </p>
      )}

      <p className="text-xs text-grey-text">
        Compressée sur l’appareil avant l’envoi. Les photos sont facultatives.
      </p>
    </div>
  )
}
