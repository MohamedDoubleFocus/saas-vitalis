import { ArrowLeft, ChevronRight, MapPin } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { CadrePage } from '@/components/cadre-page'
import { exigerManager } from '@/lib/auth'
import {
  LIBELLES_PERIODES,
  PERIODES,
  bornesPeriode,
  dansPeriode,
  type Periode,
} from '@/lib/classement'
import { lireDate } from '@/lib/echeances'
import {
  COULEURS_STATUT,
  agregerEquipe,
  formaterTaux,
  portesDuJour,
  totauxEquipe,
  type LigneEquipe,
  type LignePorteCarte,
  type MembreEquipe,
  type StatsKnocker,
} from '@/lib/equipe'
import { createClient } from '@/lib/supabase/server'

import { CartePortes } from './carte-portes'

export const metadata: Metadata = {
  title: 'Mon équipe — Vitalis',
}

type Props = {
  searchParams: Promise<{ periode?: string; knocker?: string }>
}

function lirePeriode(valeur: string | undefined): Periode {
  return PERIODES.includes(valeur as Periode) ? (valeur as Periode) : 'semaine'
}

/** Légende de la carte : une couleur, un mot. */
const LEGENDE: readonly { cle: string; libelle: string }[] = [
  { cle: 'absent', libelle: 'Absent' },
  { cle: 'refus', libelle: 'Refus' },
  { cle: 'repasser', libelle: 'À repasser' },
  { cle: 'rdv', libelle: 'Rendez-vous' },
  { cle: 'vendu', libelle: 'Vendu' },
]

/**
 * Tableau de bord d'équipe du manager.
 *
 * LECTURE SEULE de bout en bout : aucun formulaire, aucune server action. Ce
 * n'est pas une convention d'écran mais la conséquence de la RLS — la migration
 * manager n'accorde que des politiques SELECT (`opportunites_select_manager`).
 * Un bouton d'écriture ici échouerait en base.
 *
 * Zone gestion : le manager consulte surtout sur desktop, mais l'écran reste
 * lisible sur téléphone (cartes empilées sous `lg`, tableau au-delà).
 */
export default async function PageEquipe({ searchParams }: Props) {
  const { periode: periodeBrute, knocker: knockerBrut } = await searchParams
  const session = await exigerManager()

  const periode = lirePeriode(periodeBrute)
  const maintenant = new Date()

  const supabase = await createClient()

  // Un admin n'a pas d'équipe au sens de `manager_id` : il supervise tout le
  // monde (CLAUDE.md §1). Sans ce cas, l'écran lui serait vide.
  const requeteMembres = supabase
    .from('profiles')
    .select('id, nom_complet, actif')
    .eq('role', 'knocker')
    .order('nom_complet', { ascending: true })

  const { data: profils } = session.estManager
    ? await requeteMembres.eq('manager_id', session.userId)
    : await requeteMembres

  const membres: MembreEquipe[] = (profils ?? []).map((profil) => ({
    id: profil.id,
    nom: profil.nom_complet || 'Sans nom',
  }))

  const nomsParId = new Map(membres.map((m) => [m.id, m.nom]))
  const inactifs = new Set(
    (profils ?? []).filter((p) => !p.actif).map((p) => p.id),
  )

  // La fenêtre de la période couvre aussi la journée en cours (toutes les
  // périodes contiennent aujourd'hui) : une seule requête alimente les stats ET
  // la carte.
  const { debut, fin } = bornesPeriode(periode, maintenant)

  const { data: brutes } =
    membres.length === 0
      ? { data: [] }
      : await supabase
          .from('opportunites')
          .select(
            'id, adresse, knocker_id, statut, derniere_visite, nb_visites, date_rdv, latitude, longitude',
          )
          .in(
            'knocker_id',
            membres.map((m) => m.id),
          )
          .gte('derniere_visite', debut.toISOString())
          .lt('derniere_visite', fin.toISOString())

  const lignes: LigneEquipe[] = (brutes ?? []).map((ligne) => ({
    knockerId: ligne.knocker_id,
    statut: ligne.statut,
    derniereVisite: ligne.derniere_visite,
    nbVisites: ligne.nb_visites,
    dateRdv: ligne.date_rdv,
  }))

  const stats = agregerEquipe(lignes, membres, periode, maintenant)
  const totaux = totauxEquipe(stats)

  // --- Carte du jour --------------------------------------------------------
  const filtreKnocker =
    knockerBrut && nomsParId.has(knockerBrut) ? knockerBrut : null

  const lignesCarte: LignePorteCarte[] = (brutes ?? []).map((ligne) => ({
    id: ligne.id,
    adresse: ligne.adresse,
    statut: ligne.statut,
    latitude: ligne.latitude,
    longitude: ligne.longitude,
    knockerId: ligne.knocker_id,
    derniereVisite: ligne.derniere_visite,
  }))

  const portes = portesDuJour(lignesCarte, nomsParId, maintenant, filtreKnocker)

  // Combien de portes du jour n'ont pas de GPS : une carte à moitié vide sans
  // explication ferait croire à une équipe inactive.
  const sansGps = lignesCarte.filter((ligne) => {
    if (ligne.latitude !== null && ligne.longitude !== null) return false
    if (!ligne.knockerId) return false
    if (filtreKnocker && ligne.knockerId !== filtreKnocker) return false

    const visite = lireDate(ligne.derniereVisite)

    return visite !== null && dansPeriode(visite, 'aujourdhui', maintenant)
  }).length

  const lien = (params: { periode?: Periode; knocker?: string | null }) => {
    const p = params.periode ?? periode
    const k = params.knocker === undefined ? filtreKnocker : params.knocker

    return `/equipe?periode=${p}${k ? `&knocker=${encodeURIComponent(k)}` : ''}`
  }

  return (
    <CadrePage titre="Mon équipe" largeur="gestion">
      {/* Chemin de retour vers l'autre casquette. Un manager qui est aussi
          closer doit pouvoir repasser à son agenda sans taper une URL. */}
      {session.estManager && session.role !== 'admin' && (
        <Link
          href="/accueil"
          className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-strong"
        >
          <ArrowLeft className="size-5" aria-hidden />
          Accueil
        </Link>
      )}

      {/* Rail de périodes : liens `?periode=`, zéro JS (§6). */}
      <nav aria-label="Période" className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {PERIODES.map((valeur) => {
            const actif = valeur === periode

            return (
              <li key={valeur}>
                <Link
                  href={lien({ periode: valeur })}
                  aria-current={actif ? 'page' : undefined}
                  className={`flex h-11 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
                    actif
                      ? 'border-navy bg-navy text-white'
                      : 'border-grey-border bg-white text-grey-text'
                  }`}
                >
                  {LIBELLES_PERIODES[valeur]}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {membres.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun knocker ne t’est rattaché pour l’instant. Un administrateur doit
          t’en assigner depuis « Utilisateurs ».
        </p>
      ) : (
        <>
          {/* --- Totaux ---------------------------------------------------- */}
          <section className="mb-5">
            <h2 className="sr-only">Total de l’équipe</h2>
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Chiffre libelle="Portes cognées" valeur={totaux.portes} />
              <Chiffre libelle="Contacts" valeur={totaux.contacts} />
              <Chiffre libelle="Rendez-vous" valeur={totaux.rdv} />
              <Chiffre libelle="Ventes" valeur={totaux.closes} />
              <Chiffre
                libelle="Portes → RDV"
                valeur={formaterTaux(totaux.tauxGlobal)}
              />
            </ul>
          </section>

          {/* --- Par knocker ----------------------------------------------- */}
          <section className="mb-6">
            <h2 className="mb-2 font-display text-lg font-semibold text-navy">
              Par knocker
            </h2>

            {/* Mobile : une carte par knocker. */}
            <ul className="flex flex-col gap-3 lg:hidden">
              {stats.map((s) => (
                <li key={s.knockerId}>
                  <Link
                    href={`/equipe/${s.knockerId}?periode=${periode}`}
                    className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card transition-colors hover:bg-grey-light"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-display text-base font-semibold text-navy">
                          {s.nom}
                        </span>
                        {inactifs.has(s.knockerId) && (
                          <span className="shrink-0 text-xs text-red-700">
                            désactivé
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-sm text-grey-text">
                        {s.portes} portes · {s.contacts} contacts ·{' '}
                        {formaterTaux(s.tauxGlobal)}
                      </span>
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block font-display text-2xl font-bold text-navy">
                        {s.rdv}
                      </span>
                      <span className="block text-xs text-grey-text">RDV</span>
                    </span>

                    <ChevronRight
                      className="size-6 shrink-0 text-grey-text"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop : le tableau occupe la largeur. `table-fixed` +
                `truncate` : aucun scroll horizontal (§6). */}
            <div className="hidden overflow-hidden rounded-2xl bg-white shadow-card lg:block">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b border-grey-border text-left text-xs font-semibold tracking-wide text-grey-text uppercase">
                    <th scope="col" className="w-[22%] px-4 py-3">
                      Knocker
                    </th>
                    <th scope="col" className="w-[11%] px-4 py-3 text-right">
                      Portes
                    </th>
                    <th scope="col" className="w-[10%] px-4 py-3 text-right">
                      Leads
                    </th>
                    <th scope="col" className="w-[11%] px-4 py-3 text-right">
                      Contacts
                    </th>
                    <th scope="col" className="w-[9%] px-4 py-3 text-right">
                      RDV
                    </th>
                    <th scope="col" className="w-[10%] px-4 py-3 text-right">
                      Ventes
                    </th>
                    <th scope="col" className="w-[27%] px-4 py-3 text-right">
                      Conversion
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {stats.map((s) => (
                    <LigneTableau
                      key={s.knockerId}
                      stats={s}
                      periode={periode}
                      inactif={inactifs.has(s.knockerId)}
                    />
                  ))}
                </tbody>

                <tfoot>
                  <tr className="border-t border-grey-border bg-grey-light text-sm font-semibold text-navy">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{totaux.portes}</td>
                    <td className="px-4 py-3 text-right">{totaux.leads}</td>
                    <td className="px-4 py-3 text-right">{totaux.contacts}</td>
                    <td className="px-4 py-3 text-right">{totaux.rdv}</td>
                    <td className="px-4 py-3 text-right">{totaux.closes}</td>
                    <td className="px-4 py-3 text-right">
                      {formaterTaux(totaux.tauxContact)} ·{' '}
                      {formaterTaux(totaux.tauxRdv)} ·{' '}
                      {formaterTaux(totaux.tauxGlobal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="mt-2 text-xs text-grey-text">
              Conversion : portes → contacts, contacts → rendez-vous, puis
              rendement global. Les chiffres portent sur le travail{' '}
              <strong>fait</strong> dans la période (date de la dernière visite),
              là où le classement compte les rendez-vous qui <strong>tombent</strong>{' '}
              dans la période.
            </p>
          </section>

          {/* --- Carte du jour --------------------------------------------- */}
          <section>
            <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-navy">
              <MapPin className="size-5 text-grey-text" aria-hidden />
              Portes du jour
            </h2>
            <p className="mb-3 text-sm text-grey-text">
              Où l’équipe a travaillé aujourd’hui. Aucun suivi en direct : ce sont
              les adresses saisies, pas la position des téléphones.
            </p>

            {/* Filtre par knocker : liens, zéro JS. */}
            {membres.length > 1 && (
              <nav aria-label="Filtrer par knocker" className="-mx-4 mb-3 overflow-x-auto px-4">
                <ul className="flex gap-2">
                  <li>
                    <Link
                      href={lien({ knocker: null })}
                      aria-current={filtreKnocker === null ? 'page' : undefined}
                      className={`flex h-11 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
                        filtreKnocker === null
                          ? 'border-navy bg-navy text-white'
                          : 'border-grey-border bg-white text-grey-text'
                      }`}
                    >
                      Toute l’équipe
                    </Link>
                  </li>
                  {membres.map((membre) => {
                    const actif = filtreKnocker === membre.id

                    return (
                      <li key={membre.id}>
                        <Link
                          href={lien({ knocker: membre.id })}
                          aria-current={actif ? 'page' : undefined}
                          className={`flex h-11 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
                            actif
                              ? 'border-navy bg-navy text-white'
                              : 'border-grey-border bg-white text-grey-text'
                          }`}
                        >
                          {membre.nom}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </nav>
            )}

            <CartePortes portes={portes} />

            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {LEGENDE.map((entree) => (
                <li
                  key={entree.cle}
                  className="flex items-center gap-2 text-xs text-grey-text"
                >
                  <span
                    aria-hidden
                    className="size-3 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: COULEURS_STATUT[entree.cle] }}
                  />
                  {entree.libelle}
                </li>
              ))}
            </ul>

            <p className="mt-3 text-xs text-grey-text">
              {portes.length === 0
                ? 'Aucune porte géolocalisée aujourd’hui.'
                : `${portes.length} porte${portes.length > 1 ? 's' : ''} sur la carte.`}
              {sansGps > 0 &&
                ` ${sansGps} porte${sansGps > 1 ? 's' : ''} saisie${sansGps > 1 ? 's' : ''} à la main, sans GPS : non affichée${sansGps > 1 ? 's' : ''}.`}
            </p>
          </section>
        </>
      )}
    </CadrePage>
  )
}

function Chiffre({
  libelle,
  valeur,
}: {
  libelle: string
  valeur: number | string
}) {
  return (
    <li className="rounded-2xl bg-white p-4 shadow-card">
      {/* Les valeurs qui portent l'information ressortent (§6). */}
      <p className="font-display text-2xl font-bold text-navy">{valeur}</p>
      <p className="mt-0.5 text-xs text-grey-text">{libelle}</p>
    </li>
  )
}

function LigneTableau({
  stats,
  periode,
  inactif,
}: {
  stats: StatsKnocker
  periode: Periode
  inactif: boolean
}) {
  return (
    <tr className="border-b border-grey-border last:border-0">
      <td className="px-4 py-3">
        <Link
          href={`/equipe/${stats.knockerId}?periode=${periode}`}
          className="flex items-center gap-1 truncate font-medium text-navy transition-colors hover:text-brand-strong"
        >
          <span className="truncate">{stats.nom}</span>
          <ChevronRight className="size-4 shrink-0 text-grey-text" aria-hidden />
        </Link>
        {inactif && <span className="text-xs text-red-700">désactivé</span>}
      </td>
      <td className="px-4 py-3 text-right text-sm text-navy">{stats.portes}</td>
      <td className="px-4 py-3 text-right text-sm text-grey-text">
        {stats.leads}
      </td>
      <td className="px-4 py-3 text-right text-sm text-navy">{stats.contacts}</td>
      <td className="px-4 py-3 text-right font-display text-lg font-bold text-navy">
        {stats.rdv}
      </td>
      <td className="px-4 py-3 text-right text-sm text-navy">{stats.closes}</td>
      <td className="px-4 py-3 text-right text-sm text-grey-text">
        {formaterTaux(stats.tauxContact)} · {formaterTaux(stats.tauxRdv)} ·{' '}
        <span className="font-semibold text-navy">
          {formaterTaux(stats.tauxGlobal)}
        </span>
      </td>
    </tr>
  )
}
