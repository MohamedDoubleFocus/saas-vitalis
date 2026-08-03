import { ChevronRight, Search } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { IconeStatut } from '@/components/icones'
import { exigerAdmin } from '@/lib/auth'
import {
  correspondAuFiltreChantier,
  FILTRES_CHANTIER,
  LIBELLES_FILTRE_CHANTIER,
  lireFiltreChantier,
  nettoyerRecherche,
  STATUTS_CHANTIER,
  type FiltreChantier,
} from '@/lib/chantiers'
import { estSourcePorte, LIBELLES_SOURCE } from '@/lib/sources'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'
import { formaterMontant, soldeDu } from '@/lib/vente'

export const metadata: Metadata = {
  title: 'Chantiers — Vitalis',
}

type Props = {
  searchParams: Promise<{ vue?: string; q?: string }>
}

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

/**
 * Plafond de la liste.
 *
 * Bien au-delà d'une saison de chantiers. Le nombre retiré est annoncé si on
 * l'atteint : une troncature silencieuse ferait croire à une liste complète.
 */
const LIMITE = 300

/**
 * TOUS les chantiers, pas seulement ceux qui attendent un roofer.
 *
 * `/admin/assignation` ne montre que la file d'attente — vendu et sans roofer.
 * Dès qu'un chantier est confié, il en sort et devenait introuvable depuis
 * l'administration. C'est l'écran qui referme la boucle.
 *
 * Lecture seule : assigner se fait toujours depuis l'écran d'assignation, et
 * l'avancement depuis la fiche. Deux endroits pour poser le même geste
 * divergeraient.
 */
export default async function PageChantiersAdmin({ searchParams }: Props) {
  const { vue, q } = await searchParams
  await exigerAdmin()

  const filtre = lireFiltreChantier(vue)
  const recherche = nettoyerRecherche(q ?? '')

  const supabase = await createClient()

  let requete = supabase
    .from('opportunites')
    .select(
      'id, adresse, ville, client_nom, statut, source, montant_contrat, depot_recu, roofer_id, date_confirmee, date_cible_debut, vendu_le',
    )
    .in('statut', [...STATUTS_CHANTIER])
    .order('vendu_le', { ascending: false })
    .limit(LIMITE)

  if (recherche) {
    // `nettoyerRecherche` a retiré les virgules et les jokers : sans ça, une
    // adresse contenant une virgule casserait la syntaxe du `or`.
    requete = requete.or(
      `adresse.ilike.%${recherche}%,client_nom.ilike.%${recherche}%,ville.ilike.%${recherche}%`,
    )
  }

  const { data: brutes } = await requete

  const tous = brutes ?? []

  // Les extras entrent dans le solde (§4.8) : une requête pour tous les
  // chantiers listés, regroupée en mémoire, plutôt qu'une par ligne.
  const { data: extras } = tous.length
    ? await supabase
        .from('extras')
        .select('opportunite_id, montant, facturable')
        .in(
          'opportunite_id',
          tous.map((c) => c.id),
        )
    : { data: null }

  const extrasParChantier = new Map<string, { montant: number }[]>()

  for (const extra of extras ?? []) {
    if (!extra.facturable) continue

    const liste = extrasParChantier.get(extra.opportunite_id) ?? []
    liste.push({ montant: extra.montant })
    extrasParChantier.set(extra.opportunite_id, liste)
  }

  const idsRoofers = [
    ...new Set(tous.map((c) => c.roofer_id).filter((id): id is string => Boolean(id))),
  ]

  // L'annuaire plutôt que `profiles` : il liste aussi les profils désactivés,
  // pour qu'un roofer parti reste nommé sur ses anciens chantiers (§4.2).
  const { data: annuaire } = idsRoofers.length
    ? await supabase
        .from('annuaire_profils')
        .select('id, nom_complet')
        .in('id', idsRoofers)
    : { data: null }

  const nomParRoofer = new Map(
    (annuaire ?? [])
      .filter((profil): profil is typeof profil & { id: string } => Boolean(profil.id))
      .map((profil) => [profil.id, profil.nom_complet || 'Sans nom']),
  )

  // Le filtrage est fait ICI et non en base : « à assigner » croise le statut ET
  // l'absence de roofer, et `correspondAuFiltreChantier` est la seule définition
  // de cette règle. La dupliquer en SQL la ferait diverger.
  const chantiers = tous
    .filter((c) => correspondAuFiltreChantier(c.statut, c.roofer_id, filtre))
    .map((c) => ({
      ...c,
      solde: soldeDu(
        c.montant_contrat,
        extrasParChantier.get(c.id) ?? [],
        c.depot_recu,
      ),
      roofer: c.roofer_id ? (nomParRoofer.get(c.roofer_id) ?? null) : null,
      date: c.date_confirmee ?? c.date_cible_debut ?? null,
    }))

  const compteurs = Object.fromEntries(
    FILTRES_CHANTIER.map((valeur) => [
      valeur,
      tous.filter((c) => correspondAuFiltreChantier(c.statut, c.roofer_id, valeur))
        .length,
    ]),
  ) as Record<FiltreChantier, number>

  const lien = (valeur: FiltreChantier) =>
    `/admin/chantiers?vue=${valeur}${recherche ? `&q=${encodeURIComponent(recherche)}` : ''}`

  return (
    <CadrePage titre="Chantiers" largeur="gestion">
      {/* Recherche : formulaire GET, zéro JS (§6). L'état vit dans l'URL, donc
          il survit au rechargement et se partage. */}
      <form method="get" className="mb-4 flex gap-2">
        <input type="hidden" name="vue" value={filtre} />
        <label className="sr-only" htmlFor="q">
          Rechercher une adresse, une ville ou un client
        </label>
        <input
          id="q"
          name="q"
          defaultValue={recherche}
          placeholder="Adresse, ville ou nom du client…"
          autoComplete="off"
          className={CLASSE_CHAMP}
        />
        <button
          type="submit"
          className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-grey-border bg-white px-4 text-sm font-semibold text-navy transition-colors hover:bg-grey-light"
        >
          <Search className="size-5" aria-hidden />
          Chercher
        </button>
      </form>

      {/* Rail d'onglets : la seule exception au scroll horizontal (§6). */}
      <nav aria-label="Filtre" className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {FILTRES_CHANTIER.map((valeur) => {
            const actif = valeur === filtre

            return (
              <li key={valeur}>
                <Link
                  href={lien(valeur)}
                  aria-current={actif ? 'page' : undefined}
                  className={`flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
                    actif
                      ? 'border-navy bg-navy text-white'
                      : 'border-grey-border bg-white text-grey-text'
                  }`}
                >
                  {LIBELLES_FILTRE_CHANTIER[valeur]}
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

      {chantiers.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          {recherche
            ? `Aucun chantier ne correspond à « ${recherche} » dans cet onglet.`
            : `Aucun chantier dans « ${LIBELLES_FILTRE_CHANTIER[filtre]} ».`}
        </p>
      ) : (
        <>
          {/* Mobile : cartes, deux lignes d'info (§6). */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {chantiers.map((chantier) => (
              <li key={chantier.id}>
                <Link
                  href={`/chantiers/${chantier.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card transition-colors hover:bg-grey-light"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-display text-base font-semibold text-navy">
                        {chantier.client_nom || chantier.adresse}
                      </span>
                      <span className="shrink-0 font-display text-base font-bold text-navy">
                        {chantier.montant_contrat === null
                          ? '—'
                          : formaterMontant(chantier.montant_contrat)}
                      </span>
                    </span>

                    <span className="mt-0.5 block truncate text-sm text-grey-text">
                      {[chantier.adresse, chantier.ville].filter(Boolean).join(', ')}
                    </span>

                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <BadgeStatut statut={chantier.statut} />
                      {!estSourcePorte(chantier.source) && (
                        <span className="rounded-full bg-grey-light px-2 py-0.5 text-xs font-medium text-grey-text">
                          {LIBELLES_SOURCE[chantier.source]}
                        </span>
                      )}
                      <span className="text-xs text-grey-text">
                        {chantier.roofer ?? 'Sans roofer'}
                      </span>
                    </span>
                  </span>

                  <ChevronRight
                    className="size-6 shrink-0 text-grey-text"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop : le tableau occupe la largeur. `table-fixed` + `truncate`
              garantissent qu'aucune colonne ne déborde (§6). */}
          <div className="hidden overflow-hidden rounded-2xl bg-white shadow-card lg:block">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-grey-border text-left text-xs font-semibold tracking-wide text-grey-text uppercase">
                  <th scope="col" className="w-[20%] px-4 py-3">
                    Client
                  </th>
                  <th scope="col" className="w-[22%] px-4 py-3">
                    Adresse
                  </th>
                  <th scope="col" className="w-[15%] px-4 py-3">
                    Statut
                  </th>
                  <th scope="col" className="w-[14%] px-4 py-3">
                    Roofer
                  </th>
                  <th scope="col" className="w-[10%] px-4 py-3">
                    Date
                  </th>
                  <th scope="col" className="w-[10%] px-4 py-3 text-right">
                    Contrat
                  </th>
                  <th scope="col" className="w-[9%] px-4 py-3 text-right">
                    Solde
                  </th>
                </tr>
              </thead>

              <tbody>
                {chantiers.map((chantier) => (
                  <tr
                    key={chantier.id}
                    className="border-b border-grey-border align-top last:border-0"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/chantiers/${chantier.id}`}
                        className="flex items-center gap-1 font-medium text-navy transition-colors hover:text-brand-strong"
                      >
                        <span className="truncate">
                          {chantier.client_nom || 'Sans nom'}
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-grey-text"
                          aria-hidden
                        />
                      </Link>
                      {!estSourcePorte(chantier.source) && (
                        <span className="text-xs text-grey-text">
                          {LIBELLES_SOURCE[chantier.source]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate text-sm text-grey-text">
                        {[chantier.adresse, chantier.ville].filter(Boolean).join(', ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <BadgeStatut statut={chantier.statut} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate text-sm text-navy">
                        {chantier.roofer ?? (
                          <span className="text-grey-text">Non assigné</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-grey-text">
                      {chantier.date ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-navy">
                      {chantier.montant_contrat === null
                        ? '—'
                        : formaterMontant(chantier.montant_contrat)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-navy">
                      {formaterMontant(chantier.solde)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tous.length >= LIMITE && (
        <p className="mt-3 text-xs text-grey-text">
          Seuls les {LIMITE} chantiers les plus récents sont chargés. Affine la
          recherche pour aller plus loin.
        </p>
      )}

      <p className="mt-4 text-xs text-grey-text">
        Le solde est recalculé à l’affichage : contrat + extras facturables −
        dépôt. Il n’est jamais stocké.
      </p>
    </CadrePage>
  )
}

function BadgeStatut({
  statut,
}: {
  statut: Parameters<typeof IconeStatut>[0]['statut']
}) {
  // `brand` est réservé aux actions (§6) : un chantier en cours est la seule
  // exception assumée, c'est celui qui bouge aujourd'hui.
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
        statut === 'en_cours'
          ? 'bg-brand/15 text-brand-strong'
          : statut === 'paye'
            ? 'bg-navy text-white'
            : 'bg-grey-light text-grey-text'
      }`}
    >
      <IconeStatut statut={statut} className="size-4" />
      {LIBELLES_STATUT[statut]}
    </span>
  )
}
