import { ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { IconeStatut } from '@/components/icones'
import { exigerSession } from '@/lib/auth'
import type { StatutOpp } from '@/lib/doublons'
import { formaterDateHeure, libelleEcheance, lireDate } from '@/lib/echeances'
import {
  FILTRES_PORTES,
  LIBELLES_FILTRES,
  STATUTS_PORTE,
  correspondAuFiltre,
  lireFiltre,
  trierPortes,
  type FiltrePortes,
} from '@/lib/portes'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Mes portes — Vitalis',
}

/**
 * Plafond de la liste affichée.
 *
 * Un knocker cogne des centaines de portes par saison ; en rapatrier l'intégralité
 * sur un téléphone en 4G n'aiderait personne. Le tri part de la plus ancienne, donc
 * les 150 premières sont exactement les plus utiles. Le nombre retiré est annoncé
 * (jamais de troncature silencieuse).
 */
const LIMITE = 150

type Props = {
  searchParams: Promise<{ vue?: string }>
}

/**
 * Les portes déjà cognées par le knocker : absents, refus, à repasser.
 *
 * Ces trois statuts étaient écrits et jamais relus — « à repasser » ne menait
 * donc nulle part. C'est l'écran qui referme la boucle : le knocker retrouve sa
 * porte et la re-cogne en un tap, ce qui incrémente `nb_visites` au lieu de créer
 * un doublon.
 *
 * Les portes ayant décroché un rendez-vous vivent dans « Mes meetings » : les
 * deux écrans ne se recouvrent jamais.
 *
 * Onglets en liens `?vue=` : zéro JS (§6), état rechargeable et partageable.
 * Lecture en direct, sans cache (§5).
 */
export default async function PagePortes({ searchParams }: Props) {
  const { vue } = await searchParams
  const session = await exigerSession()

  const filtre = lireFiltre(vue)
  const maintenant = new Date()

  const supabase = await createClient()

  // Les compteurs se font en base (`head: true` : aucune ligne transférée), donc
  // ils restent exacts même quand la liste est plafonnée.
  const [comptes, liste] = await Promise.all([
    Promise.all(
      STATUTS_PORTE.map(async (statut) => {
        const { count } = await supabase
          .from('opportunites')
          .select('id', { count: 'exact', head: true })
          .eq('knocker_id', session.userId)
          .eq('statut', statut)

        return [statut, count ?? 0] as const
      }),
    ),
    supabase
      .from('opportunites')
      .select(
        'id, adresse, ville, statut, nb_visites, derniere_visite, client_nom',
      )
      .eq('knocker_id', session.userId)
      .in(
        'statut',
        filtre === 'toutes' ? [...STATUTS_PORTE] : [filtre],
      )
      // La plus ancienne d'abord : le haut de la liste est la prochaine porte à
      // retravailler, pas la dernière cognée.
      .order('derniere_visite', { ascending: true })
      .limit(LIMITE),
  ])

  const comptesParStatut = new Map<string, number>(comptes)
  const total = STATUTS_PORTE.reduce(
    (somme, statut) => somme + (comptesParStatut.get(statut) ?? 0),
    0,
  )

  const compteurs: Record<FiltrePortes, number> = {
    repasser: comptesParStatut.get('repasser') ?? 0,
    absent: comptesParStatut.get('absent') ?? 0,
    refus: comptesParStatut.get('refus') ?? 0,
    toutes: total,
  }

  const portes = trierPortes(
    (liste.data ?? [])
      // Ceinture et bretelles : le filtre est déjà posé en base, mais la logique
      // de périmètre est celle de `correspondAuFiltre` — une seule vérité.
      .filter((ligne) => correspondAuFiltre(ligne.statut, filtre))
      .map((ligne) => ({ ...ligne, derniereVisite: ligne.derniere_visite })),
  )

  const masquees = Math.max(0, compteurs[filtre] - portes.length)

  return (
    <CadrePage titre="Mes portes" largeur="terrain">
      {/* Rail d'onglets : la seule exception au scroll horizontal (§6). */}
      <nav aria-label="Filtre" className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {FILTRES_PORTES.map((valeur) => {
            const actif = valeur === filtre

            return (
              <li key={valeur}>
                <Link
                  href={`/terrain/portes?vue=${valeur}`}
                  aria-current={actif ? 'page' : undefined}
                  className={`flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
                    actif
                      ? 'border-navy bg-navy text-white'
                      : 'border-grey-border bg-white text-grey-text'
                  }`}
                >
                  {LIBELLES_FILTRES[valeur]}
                  <span
                    className={`rounded-full px-1.5 text-xs ${
                      actif ? 'bg-white/20 text-white' : 'bg-grey-light text-grey-text'
                    }`}
                  >
                    {compteurs[valeur]}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {portes.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          {total === 0
            ? 'Aucune porte enregistrée pour l’instant. Chaque lead que tu saisis apparaîtra ici tant qu’il n’a pas décroché de rendez-vous.'
            : `Aucune porte dans « ${LIBELLES_FILTRES[filtre]} ».`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {portes.map((porte) => (
            <CartePorte
              key={porte.id}
              id={porte.id}
              adresse={porte.adresse}
              ville={porte.ville}
              clientNom={porte.client_nom}
              statut={porte.statut}
              nbVisites={porte.nb_visites}
              derniereVisite={porte.derniere_visite}
              maintenant={maintenant}
            />
          ))}
        </ul>
      )}

      {masquees > 0 && (
        <p className="mt-3 text-xs text-grey-text">
          {masquees} {masquees === 1 ? 'porte plus récente n’est' : 'portes plus récentes ne sont'}{' '}
          pas affichée{masquees === 1 ? '' : 's'} — la liste s’arrête aux {LIMITE}{' '}
          plus anciennes.
        </p>
      )}

      <p className="mt-4 text-xs text-grey-text">
        Les portes qui ont décroché un rendez-vous sont dans « Mes meetings ».
      </p>
    </CadrePage>
  )
}

/**
 * Une porte. Toute la carte est cliquable et mène au formulaire de lead
 * prérempli : re-cogner ne doit coûter qu'un seul tap, gant au poing.
 */
function CartePorte({
  id,
  adresse,
  ville,
  clientNom,
  statut,
  nbVisites,
  derniereVisite,
  maintenant,
}: {
  id: string
  adresse: string
  ville: string | null
  clientNom: string | null
  statut: StatutOpp
  nbVisites: number
  derniereVisite: string
  maintenant: Date
}) {
  const visite = lireDate(derniereVisite)

  return (
    <li>
      <Link
        href={`/terrain/lead?porte=${encodeURIComponent(id)}`}
        className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card transition-colors hover:bg-grey-light"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate font-display text-base font-semibold text-navy">
              {adresse}
            </span>
            {/* `brand` reste réservé aux actions : un statut de porte se marque
                en gris, ou en rouge pour un refus. */}
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                statut === 'refus'
                  ? 'bg-red-50 text-red-800'
                  : statut === 'repasser'
                    ? 'bg-navy text-white'
                    : 'bg-grey-light text-grey-text'
              }`}
            >
              <IconeStatut statut={statut} className="size-4" />
              {LIBELLES_STATUT[statut]}
            </span>
          </span>

          {(ville || clientNom) && (
            <span className="mt-0.5 block truncate text-sm text-grey-text">
              {[clientNom, ville].filter(Boolean).join(' · ')}
            </span>
          )}

          <span className="mt-1 block truncate text-xs text-grey-text">
            {visite ? libelleEcheance(visite, maintenant) : 'Date inconnue'}
            {' · '}
            {nbVisites} {nbVisites === 1 ? 'visite' : 'visites'}
            {visite && (
              <span className="hidden sm:inline"> · {formaterDateHeure(visite)}</span>
            )}
          </span>
        </span>

        <ChevronRight className="size-6 shrink-0 text-grey-text" aria-hidden />
      </Link>
    </li>
  )
}
