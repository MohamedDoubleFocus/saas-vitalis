import type { Metadata } from 'next'

import { login } from '@/app/actions'
import { messageErreurAuth } from '@/lib/auth-messages'

export const metadata: Metadata = {
  title: 'Connexion — Vitalis',
}

type Props = {
  searchParams: Promise<{ error?: string; suivant?: string }>
}

const CLASSE_CHAMP =
  'h-11 rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

export default async function PageConnexion({ searchParams }: Props) {
  const { error, suivant } = await searchParams
  const messageErreur = messageErreurAuth(error)

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-navy">
            Vitalis
          </h1>
          <p className="mt-1 text-sm text-grey-text">
            Toitures Vitalis — gestion interne
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-card">
          <h2 className="font-display text-lg font-semibold text-navy">Connexion</h2>

          {messageErreur && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {messageErreur}
            </p>
          )}

          <form action={login} className="mt-5 flex flex-col gap-4">
            {/* Destination demandée avant la redirection vers /login. */}
            <input type="hidden" name="suivant" value={suivant ?? ''} />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="courriel" className="text-sm font-medium text-navy">
                Courriel
              </label>
              {/* `text-base` (16px) évite le zoom automatique de Safari iOS. */}
              <input
                id="courriel"
                name="courriel"
                type="email"
                required
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={CLASSE_CHAMP}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="mot_de_passe" className="text-sm font-medium text-navy">
                Mot de passe
              </label>
              <input
                id="mot_de_passe"
                name="mot_de_passe"
                type="password"
                required
                autoComplete="current-password"
                className={CLASSE_CHAMP}
              />
            </div>

            <button
              type="submit"
              className="mt-1 h-11 rounded-lg bg-brand px-4 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong"
            >
              Se connecter
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-grey-text">
          Accès réservé à l’équipe. Les comptes sont créés par un administrateur.
        </p>
      </div>
    </main>
  )
}
