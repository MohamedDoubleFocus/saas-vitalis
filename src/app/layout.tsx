import type { Metadata, Viewport } from 'next'
import { Figtree } from 'next/font/google'

import { EnregistrementServiceWorker } from '@/components/enregistrement-service-worker'

import './globals.css'

const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Vitalis',
  description: 'Gestion des ventes et des opérations — Toitures Vitalis',
  applicationName: 'Vitalis',
  // iOS n'utilise pas le manifest pour le mode plein écran : il lui faut ces
  // balises `apple-mobile-web-app-*`.
  appleWebApp: {
    capable: true,
    title: 'Vitalis',
    statusBarStyle: 'default',
  },
  other: {
    // Next 16 émet `mobile-web-app-capable`, que Safari ne comprend que depuis
    // iOS 17.4. La balise historique reste nécessaire pour que les iPhone plus
    // anciens lancent l'app en plein écran plutôt que dans Safari.
    'apple-mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  // Référence 380px, testé à 375px (CLAUDE.md §6). Le zoom manuel reste permis.
  width: 'device-width',
  initialScale: 1,
  // `navy` des tokens : colore la barre d'état en mode standalone.
  themeColor: '#111418',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr-CA" className={`${figtree.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <EnregistrementServiceWorker />
      </body>
    </html>
  )
}
