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

import { Kanban } from './kanban'

export const metadata: Metadata = {
  title: 'Chantiers — Vitalis',
}

type Props = {
  searchParams: Promise<{ vue?: string; q?: string; error?: string; ok?: string }>
}

const MESSAGES_ERREUR: Record<string, string> = {
  champs_manquants: 'Information manquante.',
  introuvable: 'Chantier introuvable.',
  transition: 'Cette étape n’est pas autorisée depuis le statut actuel.',
  maj_impossible: 'La mise à jour a échoué. Réessaie.',
  roofer_invalide: 'Ce profil n’est pas un roofer actif.',
}

/**
 * Colonnes du kanban : les mêmes que les onglets, moins « Tous ».
 *
 * « Tous » n'a aucun sens en colonne — il contiendrait la somme des trois
 * autres. Il reste utile sur mobile, où l'on ne voit qu'un onglet à la fois.
 */
const COLONNES = FILTRES_CHANTIER.filter((filtre) => filtre !== 'tous')

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
 * Au-dessus de 1024px : un KANBAN, quatre colonnes visibles d'un coup. En
 * dessous : onglets + liste, §6 interdisant le kanban à cette largeur.
 *
 * Pas de glisser-déposer (§6) — voir la note dans `kanban.tsx` : « À assigner →
 * Planifié » exige de choisir un roofer, ce qu'un dépôt ne sait pas exprimer.
 */
export default async function PageChantiersAdmin({ searchParams }: Props) {
  const { vue, q, error, ok } = await searchParams
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

  const enrichi = tous.map((c) => ({
    id: c.id,
    adresse: c.adresse,
    ville: c.ville,
    clientNom: c.client_nom,
    statut: c.statut,
    source: c.source,
    montantContrat: c.montant_contrat,
    solde: soldeDu(
      c.montant_contrat,
      extrasParChantier.get(c.id) ?? [],
      c.depot_recu,
    ),
    rooferId: c.roofer_id,
    roofer: c.roofer_id ? (nomParRoofer.get(c.roofer_id) ?? null) : null,
    date: c.date_confirmee ?? c.date_cible_debut ?? null,
  }))

  // Le filtrage est fait ICI et non en base : « à assigner » croise le statut ET
  // l'absence de roofer, et `correspondAuFiltreChantier` est la seule définition
  // de cette règle. La dupliquer en SQL la ferait diverger.
  const chantiers = enrichi.filter((c) =>
    correspondAuFiltreChantier(c.statut, c.rooferId, filtre),
  )

  // Une passe par colonne, à partir du même ensemble déjà enrichi : le kanban
  // montre tout d'un coup, il ne dépend pas de l'onglet courant.
  const parColonne = Object.fromEntries(
    COLONNES.map((colonne) => [
      colonne,
      enrichi.filter((c) =>
        correspondAuFiltreChantier(c.statut, c.rooferId, colonne),
      ),
    ]),
  )

  const { data: roofersActifs } = await supabase
    .from('profiles')
    .select('id, nom_complet')
    .eq('role', 'roofer')
    .eq('actif', true)
    .order('nom_complet', { ascending: true })

  const roofers = (roofersActifs ?? []).map((roofer) => ({
    id: roofer.id,
    nom: roofer.nom_complet || 'Sans nom',
  }))

  const compteurs = Object.fromEntries(
    FILTRES_CHANTIER.map((valeur) => [
      valeur,
      enrichi.filter((c) => correspondAuFiltreChantier(c.statut, c.rooferId, valeur))
        .length,
    ]),
  ) as Record<FiltreChantier, number>

  const lien = (valeur: FiltreChantier) =>
    `/admin/chantiers?vue=${valeur}${recherche ? `&q=${encodeURIComponent(recherche)}` : ''}`

  return (
    <CadrePage titre="Chantiers" largeur="pleine">
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {MESSAGES_ERREUR[error] ?? 'Une erreur est survenue.'}
        </p>
      )}

      {ok && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-grey-border bg-white px-3 py-2 text-sm text-grey-text"
        >
          {ok === 'assigne' ? 'Chantier assigné et planifié.' : 'Statut mis à jour.'}
        </p>
      )}

      {roofers.length === 0 && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-grey-border bg-grey-light px-3 py-2 text-sm text-grey-text"
        >
          Aucun roofer actif : les chantiers ne peuvent pas être assignés. Crée-en
          un dans « Utilisateurs ».
        </p>
      )}

      {/* Recherche : formulaire GET, zéro JS (§6). L'état vit dans l'URL, donc
          il survit au rechargement et se partage. */}
      {/* Le champ ne suit PAS la pleine largeur : un champ de recherche de
          1800px de long est plus dur à viser qu'utile. */}
      <form method="get" className="mb-4 flex gap-2 lg:max-w-2xl">
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

      {/* --- Desktop : le kanban, tout d'un coup -------------------------- */}
      <Kanban
        colonnes={COLONNES}
        chantiers={parColonne}
        roofers={roofers}
        vue={filtre}
      />

      {/* --- Sous 1024px : onglets + liste --------------------------------
          §6 interdit le kanban en dessous de ce seuil. Quatre colonnes sur un
          téléphone donneraient quatre bandes illisibles ou un scroll horizontal
          — l'un et l'autre sont exclus. */}

      {/* Rail d'onglets : la seule exception au scroll horizontal (§6). */}
      <nav aria-label="Filtre" className="-mx-4 mb-4 overflow-x-auto px-4 lg:hidden">
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

      {/* Liste mobile uniquement : au-dessus de 1024px, le kanban a pris la
          place et montre les quatre colonnes d'un coup. */}
      <div className="lg:hidden">
        {chantiers.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
            {recherche
              ? `Aucun chantier ne correspond à « ${recherche} » dans cet onglet.`
              : `Aucun chantier dans « ${LIBELLES_FILTRE_CHANTIER[filtre]} ».`}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {chantiers.map((chantier) => (
              <li key={chantier.id}>
                <Link
                  href={`/chantiers/${chantier.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card transition-colors hover:bg-grey-light"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-display text-base font-semibold text-navy">
                        {chantier.clientNom || chantier.adresse}
                      </span>
                      <span className="shrink-0 font-display text-base font-bold text-navy">
                        {chantier.montantContrat === null
                          ? '—'
                          : formaterMontant(chantier.montantContrat)}
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
        )}
      </div>

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
