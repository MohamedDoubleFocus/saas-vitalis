import { IconeStatut } from '@/components/icones'

import { Languages, Navigation, Phone } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'
import { estClose } from '@/lib/classement'
import {
  estPasse,
  formaterDateHeure,
  libelleEcheance,
  lireDate,
} from '@/lib/echeances'
import { LIBELLES_LANGUE_LONG } from '@/lib/langues'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'
import { formaterTelephone, lienTelephone } from '@/lib/telephone'
import {
  formaterMontant,
  LIBELLES_PRODUIT_GONANO,
  LIBELLES_TYPE_TRAVAIL,
  soldeDu,
} from '@/lib/vente'

import { ActionsRdv } from './actions-rdv'
import { SynchroGoogle } from './synchro-google'

export const metadata: Metadata = {
  title: 'Rendez-vous — Vitalis',
}

type Props = {
  params: Promise<{ id: string }>
}

/**
 * Détail d'un rendez-vous : tout ce que le knocker a saisi, plus le contrat
 * s'il est déjà conclu.
 *
 * La RLS fait le contrôle d'accès : un closer ne voit que ce que
 * `opportunites_select_closer` lui accorde. Une opportunité hors de son
 * périmètre revient vide → 404.
 */
export default async function PageDetailRdv({ params }: Props) {
  const { id } = await params
  await exigerSession()

  const maintenant = new Date()
  const supabase = await createClient()

  const { data: opportunite } = await supabase
    .from('opportunites')
    .select(
      'id, adresse, ville, code_postal, latitude, longitude, client_nom, client_tel, client_courriel, langue, statut, date_rdv, nb_visites, derniere_visite, knocker_id, google_event_id, rdv_transmis_le, montant_contrat, depot_recu, superficie_pi2, date_cible_debut, date_cible_fin, vendu_le',
    )
    .eq('id', id)
    .maybeSingle()

  if (!opportunite) notFound()

  const [{ data: travaux }, { data: extras }, { data: notes }, { data: knocker }] =
    await Promise.all([
      supabase
        .from('opportunite_travaux')
        .select('id, type, produit_gonano, deuxieme_couche_fortify, montant')
        .eq('opportunite_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('extras')
        .select('id, description, montant, facturable')
        .eq('opportunite_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('notes')
        .select('id, texte, auteur, created_at')
        .eq('opportunite_id', id)
        .order('created_at', { ascending: false }),
      opportunite.knocker_id
        ? supabase
            .from('annuaire_profils')
            .select('nom_complet')
            .eq('id', opportunite.knocker_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  const dateRdv = lireDate(opportunite.date_rdv)
  const vendu = estClose(opportunite.statut)
  const tel = lienTelephone(opportunite.client_tel)

  const solde = soldeDu(
    opportunite.montant_contrat,
    (extras ?? []).filter((e) => e.facturable).map((e) => ({ montant: e.montant })),
    opportunite.depot_recu,
  )

  // Lien de navigation : les coordonnées si on les a (plus fiable qu'un libellé),
  // sinon l'adresse textuelle. S'ouvre dans l'app Maps sur mobile.
  const destination =
    opportunite.latitude !== null && opportunite.longitude !== null
      ? `${opportunite.latitude},${opportunite.longitude}`
      : [opportunite.adresse, opportunite.ville, opportunite.code_postal]
          .filter(Boolean)
          .join(', ')

  const lienMaps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`

  return (
    <CadrePage titre={opportunite.client_nom || 'Rendez-vous'} largeur="terrain">
      <div className="flex flex-col gap-4">
        {/* --- Le rendez-vous --------------------------------------------- */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <div className="flex items-start justify-between gap-2">
            <p className="font-display text-base font-semibold text-navy">
              {dateRdv ? formaterDateHeure(dateRdv) : 'Date inconnue'}
            </p>
            <span
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                vendu
                  ? 'bg-navy text-white'
                  : opportunite.statut === 'perdu'
                    ? 'bg-red-50 text-red-800'
                    : 'bg-grey-light text-grey-text'
              }`}
            >
              <IconeStatut statut={opportunite.statut} className="size-4" />
          {LIBELLES_STATUT[opportunite.statut]}
            </span>
          </div>

          {dateRdv && (
            <p className="mt-0.5 text-sm text-grey-text">
              {libelleEcheance(dateRdv, maintenant)}
              {estPasse(dateRdv, maintenant) &&
                opportunite.statut === 'rdv' &&
                ' · à traiter'}
            </p>
          )}
        </section>

        {/* --- Google Agenda ----------------------------------------------- */}
        {dateRdv && (
          <SynchroGoogle
            opportuniteId={opportunite.id}
            transmis={Boolean(opportunite.rdv_transmis_le ?? opportunite.google_event_id)}
          />
        )}

        {/* --- Le client --------------------------------------------------- */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-navy">
              Client
            </h2>

            {/* La langue se lit AVANT de composer le numéro. Sur le bloc client
                plutôt qu'en bas de fiche : c'est là que le closer regarde juste
                avant d'appeler. Le français n'est pas signalé — c'est le cas
                normal, et un badge sur chaque fiche deviendrait du bruit. */}
            {opportunite.langue !== 'fr' && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-navy px-2.5 py-1 text-xs font-semibold text-white">
                <Languages className="size-4" aria-hidden />
                {LIBELLES_LANGUE_LONG[opportunite.langue]}
              </span>
            )}
          </div>

          <dl className="mt-2 flex flex-col gap-1 text-sm">
            <Ligne intitule="Nom" valeur={opportunite.client_nom} />
            <Ligne
              intitule="Adresse"
              valeur={[opportunite.adresse, opportunite.ville, opportunite.code_postal]
                .filter(Boolean)
                .join(', ')}
            />
            <Ligne intitule="Courriel" valeur={opportunite.client_courriel} />
          </dl>

          <div className="mt-3 flex flex-col gap-2">
            {tel && (
              <a
                href={tel}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-grey-border text-sm font-semibold text-navy transition-colors hover:bg-grey-light"
              >
                <Phone className="size-5" aria-hidden />
                {formaterTelephone(opportunite.client_tel)}
              </a>
            )}

            <a
              href={lienMaps}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-grey-border text-sm font-semibold text-navy transition-colors hover:bg-grey-light"
            >
              <Navigation className="size-5" aria-hidden />
              Y aller
            </a>
          </div>
        </section>

        {/* --- Ce que le knocker a vu -------------------------------------- */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-navy">
            Historique de visites
          </h2>
          <p className="mt-2 text-sm text-grey-text">
            {opportunite.nb_visites}{' '}
            {opportunite.nb_visites === 1 ? 'visite' : 'visites'}
            {lireDate(opportunite.derniere_visite) && (
              <>
                {' · dernière le '}
                {formaterDateHeure(lireDate(opportunite.derniere_visite)!)}
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-grey-text">
            Cogné par {knocker?.nom_complet || 'un knocker'}
          </p>
        </section>

        {/* --- Le contrat, si conclu --------------------------------------- */}
        {vendu && (
          <section className="rounded-2xl bg-white p-4 shadow-card">
            <h2 className="font-display text-base font-semibold text-navy">Contrat</h2>

            {(travaux ?? []).length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {(travaux ?? []).map((volet) => (
                  <li key={volet.id} className="flex justify-between gap-2">
                    <span className="min-w-0 text-grey-text">
                      {LIBELLES_TYPE_TRAVAIL[volet.type]}
                      {volet.produit_gonano &&
                        ` · ${LIBELLES_PRODUIT_GONANO[volet.produit_gonano]}`}
                      {volet.deuxieme_couche_fortify && ' · 2e couche'}
                    </span>
                    <span className="shrink-0 font-medium text-navy">
                      {formaterMontant(volet.montant)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {(extras ?? []).length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 border-t border-grey-border pt-2 text-sm">
                {(extras ?? []).map((extra) => (
                  <li key={extra.id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate text-grey-text">
                      {extra.description}
                      {!extra.facturable && ' (non facturable)'}
                    </span>
                    <span className="shrink-0 font-medium text-navy">
                      {formaterMontant(extra.montant)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <dl className="mt-3 flex flex-col gap-1 border-t border-grey-border pt-3 text-sm">
              <Ligne
                intitule="Dépôt reçu"
                valeur={formaterMontant(opportunite.depot_recu)}
              />
              {/* Le solde n'est jamais stocké (invariant §4.8) : il est recalculé
                  à chaque affichage. */}
              <div className="flex justify-between gap-2">
                <dt className="font-medium text-navy">Solde dû</dt>
                <dd className="font-display text-base font-bold text-navy">
                  {formaterMontant(solde)}
                </dd>
              </div>
            </dl>

            {(opportunite.date_cible_debut || opportunite.date_cible_fin) && (
              <p className="mt-3 text-xs text-grey-text">
                Fenêtre cible : {opportunite.date_cible_debut ?? '?'} →{' '}
                {opportunite.date_cible_fin ?? '?'} (à confirmer par
                l’administration)
              </p>
            )}
          </section>
        )}

        {/* --- Actions ----------------------------------------------------- */}
        {!vendu && opportunite.statut !== 'perdu' && (
          <>
            <Link
              href={`/terrain/agenda/${id}/close`}
              className="flex h-12 items-center justify-center rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong"
            >
              Conclure la vente
            </Link>

            <ActionsRdv opportuniteId={id} />
          </>
        )}

        {vendu && (
          <Link
            href={`/terrain/agenda/${id}/close`}
            className="flex min-h-11 items-center justify-center rounded-lg border border-grey-border text-sm font-semibold text-navy transition-colors hover:bg-grey-light"
          >
            Corriger le contrat
          </Link>
        )}

        {/* --- Le fil de notes --------------------------------------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-grey-text">
            Notes ({(notes ?? []).length})
          </h2>

          {(notes ?? []).length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
              Aucune note.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(notes ?? []).map((note) => {
                const date = lireDate(note.created_at)

                return (
                  <li key={note.id} className="rounded-2xl bg-white p-3 shadow-card">
                    <p className="text-sm whitespace-pre-line text-navy">
                      {note.texte}
                    </p>
                    <p className="mt-1 text-xs text-grey-text">
                      {note.auteur ?? 'Inconnu'}
                      {date && ` · ${formaterDateHeure(date)}`}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </CadrePage>
  )
}

function Ligne({
  intitule,
  valeur,
}: {
  intitule: string
  valeur: string | null
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-grey-text">{intitule}</dt>
      <dd className="min-w-0 truncate text-right text-navy">
        {valeur || <span className="text-grey-text">—</span>}
      </dd>
    </div>
  )
}
