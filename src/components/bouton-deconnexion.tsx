import { signOut } from '@/app/actions'

/** Déconnexion sans JS client : un simple formulaire vers une server action. */
export function BoutonDeconnexion() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="h-11 rounded-lg px-3 text-sm font-medium text-grey-text transition-colors hover:bg-grey-light hover:text-navy"
      >
        Déconnexion
      </button>
    </form>
  )
}
