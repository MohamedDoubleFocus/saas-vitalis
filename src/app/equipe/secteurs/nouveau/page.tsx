import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerManager } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

import { ChoixQuartier } from './choix-quartier'

export const metadata: Metadata = {
  title: 'Nouveau secteur — Vitalis',
}

/**
 * Création d'un secteur.
 *
 * Plus de tracé à la main : on cherche une adresse, on choisit le quartier
 * qu'OpenStreetMap connaît à cet endroit, ou un rayon quand il n'en connaît
 * aucun. Le geste passe de « poser quinze coins un par un » à « deux taps ».
 */
export default async function PageNouveauSecteur() {
  const session = await exigerManager()

  const supabase = await createClient()

  // Un manager ne propose que SES knockers (`profiles_select_manager` ne lui
  // montre qu'eux). L'admin, lui, voit tout le monde — c'est la même requête,
  // c'est la RLS qui fait la différence.
  const requete = supabase
    .from('profiles')
    .select('id, nom_complet')
    .eq('role', 'knocker')
    .eq('actif', true)
    .order('nom_complet', { ascending: true })

  const { data: profils } = session.estManager
    ? await requete.eq('manager_id', session.userId)
    : await requete

  const knockers = (profils ?? []).map((profil) => ({
    id: profil.id,
    nom: profil.nom_complet || 'Sans nom',
  }))

  return (
    <CadrePage titre="Nouveau secteur" largeur="gestion">
      <Link
        href="/equipe/secteurs"
        className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-strong"
      >
        <ArrowLeft className="size-5" aria-hidden />
        Tous les secteurs
      </Link>

      <ChoixQuartier knockers={knockers} />
    </CadrePage>
  )
}
