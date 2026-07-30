import { IconeStatut } from '@/components/icones'

import { Navigation, Phone } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'

import { CadrePage } from '@/components/cadre-page'
import { exigerSession } from '@/lib/auth'
import {
  estRetourEnArriere,
  LIBELLES_TRANSITION,
  transitionsRoofer,
} from '@/lib/chantiers'
import { formaterDateHeure, lireDate } from '@/lib/echeances'
import { LIBELLES_STATUT } from '@/lib/statuts'
import { createClient } from '@/lib/supabase/server'
import { formaterTelephone, lienTelephone } from '@/lib/telephone'
import {
  formaterMontant,
  LIBELLES_PRODUIT_GONANO,
  LIBELLES_TYPE_TRAVAIL,
} from '@/lib/vente'

import { avancerStatut, supprimerPhoto } from './actions'
import { CapturePhoto } from './capture-photo'

export const metadata: Metadata = {
  title: 'Chantier — Vitalis',
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}

/** URL signées : une heure. Jamais d'URL publique (CLAUDE.md §4.12). */
const DUREE_SIGNATURE_S = 3600

const MESSAGES_ERREUR: Record<string, string> = {
  transition: 'Cette transition de statut n’est pas autorisée.',
  introuvable: 'Chantier introuvable.',
  refus: 'Modification refusée. Ce chantier ne t’est peut-être plus assigné.',
  photo: 'Suppression de la photo impossible.',
  photo_ligne:
    'Le fichier a été supprimé mais sa référence subsiste. Réessaie ou signale-le.',
}

const MESSAGES_SUCCES: Record<string, string> = {
  statut: 'Statut mis à jour.',
  photo_supprimee: 'Photo supprimée.',
}

export default async function PageChantier({ params, searchParams }: Props) {
  const { id } = await params
  const { error, ok } = await searchParams
  await exigerSession()

  const supabase = await createClient()

  // La RLS fait le contrôle d'accès : hors du périmètre du roofer, la lecture
  // revient vide → 404.
  const { data: job } = await supabase
    .from('opportunites')
    .select(
      'id, adresse, ville, code_postal, latitude, longitude, client_nom, client_tel, statut, superficie_pi2, date_cible_debut, date_cible_fin, date_confirmee, nb_reports',
    )
    .eq('id', id)
    .maybeSingle()

  if (!job) notFound()

  const [{ data: travaux }, { data: extras }, { data: notes }, { data: photos }] =
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
      supabase
        .from('photos')
        .select('id, photo_url, created_at')
        .eq('opportunite_id', id)
        .order('created_at', { ascending: false }),
    ])

  // Une URL signée par photo, générée à chaque rendu — elles expirent.
  const chemins = (photos ?? []).map((photo) => photo.photo_url)
  const { data: signees } = chemins.length
    ? await supabase.storage.from('photos').createSignedUrls(chemins, DUREE_SIGNATURE_S)
    : { data: null }

  const urlParChemin = new Map(
    (signees ?? [])
      .filter((s) => s.signedUrl && s.path)
      .map((s) => [s.path as string, s.signedUrl]),
  )

  const destination =
    job.latitude !== null && job.longitude !== null
      ? `${job.latitude},${job.longitude}`
      : [job.adresse, job.ville, job.code_postal].filter(Boolean).join(', ')

  const lienMaps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
  const tel = lienTelephone(job.client_tel)
  const transitions = transitionsRoofer(job.statut)

  return (
    <CadrePage titre={job.client_nom || 'Chantier'} largeur="gestion">
      <div className="flex flex-col gap-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {MESSAGES_ERREUR[error] ?? 'Une erreur est survenue.'}
          </p>
        )}

        {ok && MESSAGES_SUCCES[ok] && (
          <p
            role="status"
            className="rounded-lg border border-grey-border bg-white px-3 py-2 text-sm text-grey-text"
          >
            {MESSAGES_SUCCES[ok]}
          </p>
        )}

        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
          {/* --- Où et quand ---------------------------------------------- */}
          <section className="rounded-2xl bg-white p-4 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-navy">
                Chantier
              </h2>
              <span
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  job.statut === 'complete'
                    ? 'bg-navy text-white'
                    : job.statut === 'en_cours'
                      ? 'bg-brand/15 text-brand-strong'
                      : 'bg-grey-light text-grey-text'
                }`}
              >
                <IconeStatut statut={job.statut} className="size-4" />
          {LIBELLES_STATUT[job.statut]}
              </span>
            </div>

            <p className="mt-2 text-sm text-navy">
              {[job.adresse, job.ville, job.code_postal].filter(Boolean).join(', ')}
            </p>

            <dl className="mt-2 flex flex-col gap-1 text-sm">
              {job.date_confirmee ? (
                <Ligne intitule="Date confirmée" valeur={job.date_confirmee} />
              ) : (
                <Ligne
                  intitule="Fenêtre cible"
                  valeur={
                    job.date_cible_debut || job.date_cible_fin
                      ? `${job.date_cible_debut ?? '?'} → ${job.date_cible_fin ?? '?'}`
                      : null
                  }
                />
              )}
              {job.superficie_pi2 !== null && (
                <Ligne intitule="Superficie" valeur={`${job.superficie_pi2} pi²`} />
              )}
              {job.nb_reports > 0 && (
                <Ligne intitule="Reports" valeur={String(job.nb_reports)} />
              )}
            </dl>

            <div className="mt-3 flex flex-col gap-2">
              {tel && (
                <a
                  href={tel}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-grey-border text-sm font-semibold text-navy transition-colors hover:bg-grey-light"
                >
                  <Phone className="size-5" aria-hidden />
                  {formaterTelephone(job.client_tel)}
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

          {/* --- Quoi faire ------------------------------------------------ */}
          <section className="rounded-2xl bg-white p-4 shadow-card">
            <h2 className="font-display text-base font-semibold text-navy">
              Travaux à exécuter
            </h2>

            {(travaux ?? []).length === 0 && (extras ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-grey-text">
                Aucun détail de travaux enregistré.
              </p>
            ) : (
              <>
                {(travaux ?? []).length > 0 && (
                  <ul className="mt-2 flex flex-col gap-2">
                    {(travaux ?? []).map((volet) => (
                      <li
                        key={volet.id}
                        className="rounded-lg border border-grey-border p-2"
                      >
                        <p className="font-medium text-navy">
                          {LIBELLES_TYPE_TRAVAIL[volet.type]}
                        </p>
                        <p className="text-sm text-grey-text">
                          {volet.produit_gonano &&
                            `Produit : ${LIBELLES_PRODUIT_GONANO[volet.produit_gonano]}`}
                          {volet.deuxieme_couche_fortify && ' · 2e couche de Fortify'}
                          {!volet.produit_gonano &&
                            !volet.deuxieme_couche_fortify &&
                            formaterMontant(volet.montant)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {(extras ?? []).length > 0 && (
                  <>
                    <h3 className="mt-3 text-sm font-semibold text-grey-text">
                      Extras
                    </h3>
                    <ul className="mt-1 flex flex-col gap-1 text-sm">
                      {(extras ?? []).map((extra) => (
                        <li key={extra.id} className="text-navy">
                          {extra.description}
                          {!extra.facturable && (
                            <span className="text-grey-text"> (non facturable)</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {/* La couleur des bardeaux vit dans le fil de notes, faute de
                colonne dédiée — elle est plus bas. */}
          </section>
        </div>

        {/* --- Avancement --------------------------------------------------- */}
        {transitions.length > 0 && (
          <section className="rounded-2xl bg-white p-4 shadow-card">
            <h2 className="font-display text-base font-semibold text-navy">
              Avancement
            </h2>
            <p className="mt-0.5 text-xs text-grey-text">
              Une étape à la fois. Chaque changement est journalisé.
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {transitions.map((cible) => {
                const retour = estRetourEnArriere(job.statut, cible)

                return (
                  <form key={cible} action={avancerStatut}>
                    <input type="hidden" name="opportunite_id" value={job.id} />
                    <input type="hidden" name="statut" value={cible} />
                    <button
                      type="submit"
                      className={
                        retour
                          ? 'min-h-11 w-full rounded-lg border border-grey-border px-4 text-sm font-semibold text-grey-text transition-colors hover:bg-grey-light'
                          : 'h-12 w-full rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong'
                      }
                    >
                      {retour
                        ? `Revenir à « ${LIBELLES_STATUT[cible]} »`
                        : (LIBELLES_TRANSITION[cible] ?? LIBELLES_STATUT[cible])}
                    </button>
                  </form>
                )
              })}
            </div>
          </section>
        )}

        {/* --- Photos -------------------------------------------------------- */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-navy">
            Photos ({(photos ?? []).length})
          </h2>

          <div className="mt-3">
            <CapturePhoto opportuniteId={job.id} />
          </div>

          {(photos ?? []).length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(photos ?? []).map((photo) => {
                const url = urlParChemin.get(photo.photo_url)
                const prise = lireDate(photo.created_at)

                return (
                  <li key={photo.id} className="flex flex-col gap-1">
                    <div className="relative aspect-square overflow-hidden rounded-lg bg-grey-light">
                      {url ? (
                        // `unoptimized` : l'URL est signée et expire, la faire
                        // passer par l'optimiseur d'images la mettrait en cache
                        // au-delà de sa validité.
                        <Image
                          src={url}
                          alt={`Photo du ${prise ? formaterDateHeure(prise) : 'chantier'}`}
                          fill
                          sizes="(min-width: 1024px) 20vw, 45vw"
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        <span className="flex h-full items-center justify-center text-xs text-grey-text">
                          Indisponible
                        </span>
                      )}
                    </div>

                    <details>
                      <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs text-grey-text hover:text-navy">
                        Supprimer
                      </summary>
                      <form action={supprimerPhoto} className="mt-1">
                        <input type="hidden" name="photo_id" value={photo.id} />
                        <input type="hidden" name="opportunite_id" value={job.id} />
                        <input type="hidden" name="chemin" value={photo.photo_url} />
                        <button
                          type="submit"
                          className="min-h-11 w-full rounded-lg border border-red-200 bg-red-50 px-2 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100"
                        >
                          Confirmer
                        </button>
                      </form>
                    </details>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* --- Notes --------------------------------------------------------- */}
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

function Ligne({ intitule, valeur }: { intitule: string; valeur: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-grey-text">{intitule}</dt>
      <dd className="min-w-0 truncate text-right text-navy">
        {valeur || <span className="text-grey-text">—</span>}
      </dd>
    </div>
  )
}
