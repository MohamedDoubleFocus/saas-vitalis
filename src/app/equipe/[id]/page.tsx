import { ArrowLeft, CalendarClock, Map, Phone } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CadrePage } from '@/components/cadre-page'
import { IconeStatut } from '@/components/icones'
import { exigerManager } from '@/lib/auth'
import {
  LIBELLES_PERIODES,
  PERIODES,
  bornesPeriode,
  type Periode,
} from '@/lib/classement'
import {
  agregerEquipe,
  formaterTaux,
  type LigneEquipe,
} from '@/lib/equipe'
import {
  estPasse,
  formaterDateHeure,
  libelleEcheance,
  lireDate,
} from '@/lib/echeances'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'
import { formaterTelephone, lienTelephone } from '@/lib/telephone'

export const metadata: Metadata = {
  title: 'Détail knocker — Vitalis',
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ periode?: string }>
}

function lirePeriode(valeur: string | undefined): Periode {
  return PERIODES.includes(valeur as Periode) ? (valeur as Periode) : 'semaine'
}

/** Combien de leads récents afficher. Au-delà, le manager ouvre le classement. */
const LIMITE_LEADS = 20

/**
 * Détail d'un knocker supervisé.
 *
 * Trois blocs, dans l'ordre de ce qu'un manager regarde : les chiffres, ce qui
 * s'en vient (rendez-vous), et ce qui vient de se passer (leads, rues).
 *
 * LECTURE SEULE — voir la note de `/equipe`. Le périmètre n'est pas décidé ici
 * mais par la RLS : si `id` n'est pas un knocker supervisé, les requêtes ne
 * renvoient simplement rien et on affiche un 404. Aucun contrôle applicatif ne
 * peut être contourné, parce qu'il n'y en a pas.
 */
export default async function PageDetailKnocker({ params, searchParams }: Props) {
  const { id } = await params
  const { periode: periodeBrute } = await searchParams

  await exigerManager()

  const periode = lirePeriode(periodeBrute)
  const maintenant = new Date()

  const supabase = await createClient()

  // La RLS (`profiles_select_manager`) ne renvoie cette ligne que si le knocker
  // est bien dans l'équipe de l'appelant.
  const { data: knocker } = await supabase
    .from('profiles')
    .select('id, nom_complet, role, actif')
    .eq('id', id)
    .maybeSingle()

  if (!knocker || knocker.role !== 'knocker') notFound()

  const nom = knocker.nom_complet || 'Sans nom'
  const { debut, fin } = bornesPeriode(periode, maintenant)

  const [stats, leads, rdvAVenir, rues] = await Promise.all([
    // 1. Les chiffres de la période.
    supabase
      .from('opportunites')
      .select('knocker_id, statut, derniere_visite, nb_visites, date_rdv')
      .eq('knocker_id', id)
      .gte('derniere_visite', debut.toISOString())
      .lt('derniere_visite', fin.toISOString()),

    // 2. Ses leads récents — indépendants de la période : « ce qu'il vient de
    //    faire » reste la question, même en consultant le mois.
    supabase
      .from('opportunites')
      .select('id, adresse, ville, statut, nb_visites, derniere_visite')
      .eq('knocker_id', id)
      .order('derniere_visite', { ascending: false })
      .limit(LIMITE_LEADS),

    // 3. Ses rendez-vous à venir.
    supabase
      .from('opportunites')
      .select('id, adresse, ville, client_nom, client_tel, statut, date_rdv')
      .eq('knocker_id', id)
      .not('date_rdv', 'is', null)
      .gte('date_rdv', maintenant.toISOString())
      .order('date_rdv', { ascending: true })
      .limit(10),

    // 4. Ses rues en cours (`territoires_select_manager`).
    supabase
      .from('territoires')
      .select('id, nom_rue, ville, complete, secteurs(nom)')
      .eq('knocker_id', id)
      .eq('complete', false)
      .order('nom_rue', { ascending: true })
      .limit(30),
  ])

  const lignes: LigneEquipe[] = (stats.data ?? []).map((ligne) => ({
    knockerId: ligne.knocker_id,
    statut: ligne.statut,
    derniereVisite: ligne.derniere_visite,
    nbVisites: ligne.nb_visites,
    dateRdv: ligne.date_rdv,
  }))

  const chiffres = agregerEquipe(lignes, [{ id, nom }], periode, maintenant)[0]

  return (
    <CadrePage titre={nom} largeur="gestion">
      <Link
        href={`/equipe?periode=${periode}`}
        className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-strong"
      >
        <ArrowLeft className="size-5" aria-hidden />
        Retour à l’équipe
      </Link>

      {!knocker.actif && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Ce compte est désactivé. Son historique reste consultable.
        </p>
      )}

      {/* Rail de périodes — n'affecte que les chiffres. */}
      <nav aria-label="Période" className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {PERIODES.map((valeur) => {
            const actif = valeur === periode

            return (
              <li key={valeur}>
                <Link
                  href={`/equipe/${id}?periode=${valeur}`}
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

      <section className="mb-6">
        <h2 className="sr-only">Chiffres de la période</h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Chiffre libelle="Portes cognées" valeur={chiffres.portes} />
          <Chiffre libelle="Contacts" valeur={chiffres.contacts} />
          <Chiffre libelle="Rendez-vous" valeur={chiffres.rdv} />
          <Chiffre libelle="Ventes" valeur={chiffres.closes} />
          <Chiffre
            libelle="Portes → RDV"
            valeur={formaterTaux(chiffres.tauxGlobal)}
          />
        </ul>
        <p className="mt-2 text-xs text-grey-text">
          Contacts sur portes : {formaterTaux(chiffres.tauxContact)} · Rendez-vous
          sur contacts : {formaterTaux(chiffres.tauxRdv)}
        </p>
      </section>

      {/* --- Deux colonnes sur desktop, empilées sur mobile ----------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* --- Rendez-vous à venir ---------------------------------------- */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-navy">
            <CalendarClock className="size-5 text-grey-text" aria-hidden />
            Rendez-vous à venir
          </h2>

          {(rdvAVenir.data ?? []).length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
              Aucun rendez-vous à venir.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(rdvAVenir.data ?? []).map((rdv) => {
                const date = lireDate(rdv.date_rdv)
                const tel = lienTelephone(rdv.client_tel)

                return (
                  <li key={rdv.id} className="rounded-2xl bg-white p-4 shadow-card">
                    <p className="truncate font-display text-base font-semibold text-navy">
                      {rdv.client_nom || rdv.adresse}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-grey-text">
                      {date ? formaterDateHeure(date) : 'Date inconnue'}
                      {date && !estPasse(date, maintenant) && (
                        <>
                          {' · '}
                          <span className="font-medium text-navy">
                            {libelleEcheance(date, maintenant)}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-grey-text">
                      {[rdv.adresse, rdv.ville].filter(Boolean).join(', ')}
                    </p>
                    {tel && (
                      <a
                        href={tel}
                        className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-strong"
                      >
                        <Phone className="size-5" aria-hidden />
                        {formaterTelephone(rdv.client_tel)}
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* --- Rues en cours ---------------------------------------------- */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-navy">
            <Map className="size-5 text-grey-text" aria-hidden />
            Rues en cours
          </h2>

          {(rues.data ?? []).length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
              Aucune rue en cours. Un administrateur lui en assigne depuis
              « Secteurs ».
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(rues.data ?? []).map((rue) => (
                <li
                  key={rue.id}
                  className="rounded-2xl bg-white px-4 py-3 shadow-card"
                >
                  <p className="truncate font-medium text-navy">{rue.nom_rue}</p>
                  <p className="truncate text-xs text-grey-text">
                    {rue.secteurs?.nom ?? rue.ville ?? 'Sans secteur'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* --- Leads récents ------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-2 font-display text-lg font-semibold text-navy">
          Leads récents
        </h2>

        {(leads.data ?? []).length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
            Aucun lead enregistré.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(leads.data ?? []).map((lead) => {
              const visite = lireDate(lead.derniere_visite)

              return (
                <li
                  key={lead.id}
                  className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-navy">
                      {lead.adresse}
                    </span>
                    <span className="block truncate text-xs text-grey-text">
                      {[lead.ville, `${lead.nb_visites} visite${lead.nb_visites > 1 ? 's' : ''}`]
                        .filter(Boolean)
                        .join(' · ')}
                      {visite && ` · ${libelleEcheance(visite, maintenant)}`}
                    </span>
                  </span>

                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-grey-light px-2.5 py-1 text-xs font-semibold text-grey-text">
                    <IconeStatut statut={lead.statut} className="size-4" />
                    {LIBELLES_STATUT[lead.statut]}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-2 text-xs text-grey-text">
          Les {LIMITE_LEADS} portes les plus récemment travaillées, toutes périodes
          confondues.
        </p>
      </section>
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
      <p className="font-display text-2xl font-bold text-navy">{valeur}</p>
      <p className="mt-0.5 text-xs text-grey-text">{libelle}</p>
    </li>
  )
}
