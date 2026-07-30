/**
 * Réserve la route pour qu'une redirection par rôle n'aboutisse pas sur un 404.
 * Remplacé par le véritable écran au module correspondant.
 */
export function ModuleAVenir({ description }: { description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-grey-border bg-white p-6 text-center shadow-card">
      <p className="font-display text-base font-semibold text-navy">
        À venir — module suivant
      </p>
      <p className="mt-2 text-sm text-grey-text">{description}</p>
    </div>
  )
}
