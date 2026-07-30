import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Hors ligne — Vitalis',
}

/**
 * Page de secours servie par le service worker quand une navigation échoue faute
 * de réseau.
 *
 * Contraintes : aucune donnée, aucune session, aucune API dynamique — elle doit
 * être prérendue en statique pour que le service worker puisse la précharger, et
 * elle est exclue du proxy (voir le `matcher` dans `src/proxy.ts`).
 */
export default function PageHorsLigne() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px] rounded-2xl bg-white p-6 text-center shadow-card">
        <h1 className="font-display text-xl font-semibold text-navy">
          Pas de connexion
        </h1>

        <p className="mt-3 text-sm text-grey-text">
          Vitalis n’arrive pas à joindre le serveur. Ça arrive sur un toit en LTE
          faible — ça repartira tout seul.
        </p>

        <p className="mt-3 text-sm text-grey-text">
          <strong className="font-medium text-navy">
            Rien de ce que tu as saisi n’est perdu.
          </strong>{' '}
          Les enregistrements en attente sont conservés sur l’appareil et
          renvoyés automatiquement dès que le réseau revient.
        </p>

        {/* `<a>` volontairement, pas `<Link>` : il faut un rechargement complet
            du document pour que le service worker retente vraiment le réseau.
            Une navigation côté client échouerait sans rien retenter — et le JS
            de cette page n'est de toute façon pas garanti d'être en cache. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong"
        >
          Réessayer
        </a>
      </div>
    </main>
  )
}
