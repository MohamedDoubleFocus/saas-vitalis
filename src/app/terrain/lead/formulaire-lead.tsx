'use client'

import { useCallback, useState } from 'react'

import { IndicateurFileAttente } from '@/components/indicateur-file-attente'
import type { Creneau } from '@/lib/creneaux'
import type { StatutOpp } from '@/lib/doublons'
import { chercherDoublon, type DoublonTrouve } from '@/lib/doublons-recherche'
import { formaterDateHeure, lireDate } from '@/lib/echeances'
import type { ChargeCreationLead } from '@/lib/file-attente/executeurs'
import { useFileAttente } from '@/lib/file-attente/fournisseur'
import type { AdresseSelectionnee } from '@/lib/google-places'
import { AIDES_STATUT_CONTACT, LIBELLES_STATUT, STATUTS_CONTACT } from '@/lib/statuts'

import { ChampAdresse } from './champ-adresse'
import { ChoixPlage } from './choix-plage'

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

type Etape = 'saisie' | 'plage' | 'confirme'

type EtatDoublon =
  | { statut: 'aucun' }
  | { statut: 'recherche' }
  | { statut: 'trouve'; doublon: DoublonTrouve; accepte: boolean }
  /** Hors ligne ou base injoignable : on laisse passer sans bloquer (§5). */
  | { statut: 'indisponible' }

type Props = {
  knockerId: string
  closerId: string | null
}

export function FormulaireLead({ knockerId, closerId }: Props) {
  const { envoyer, enLigne } = useFileAttente()

  const [etape, setEtape] = useState<Etape>('saisie')
  const [adresse, setAdresse] = useState<AdresseSelectionnee | null>(null)
  const [doublon, setDoublon] = useState<EtatDoublon>({ statut: 'aucun' })
  const [statut, setStatut] = useState<StatutOpp>('absent')
  const [clientNom, setClientNom] = useState('')
  const [note, setNote] = useState('')
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  /**
   * Instant du coup de porte, figé à la sélection de l'adresse.
   *
   * C'est lui qui devient `derniere_visite`, pas l'heure d'envoi : une mutation
   * partie vingt minutes plus tard ne doit pas fausser la métrique.
   */
  const [saisiLe, setSaisiLe] = useState<string | null>(null)

  const choisirAdresse = useCallback(
    async (choisie: AdresseSelectionnee | null) => {
      setAdresse(choisie)
      setErreur(null)

      if (!choisie) {
        setDoublon({ statut: 'aucun' })
        setSaisiLe(null)
        return
      }

      setSaisiLe(new Date().toISOString())
      setDoublon({ statut: 'recherche' })

      try {
        const trouve = await chercherDoublon(
          {
            adresse: choisie.adresse,
            ville: choisie.ville,
            latitude: choisie.latitude,
            longitude: choisie.longitude,
          },
          knockerId,
        )

        setDoublon(
          trouve ? { statut: 'trouve', doublon: trouve, accepte: false } : { statut: 'aucun' },
        )
      } catch {
        // Réseau absent : la vérification est un confort, pas un verrou.
        setDoublon({ statut: 'indisponible' })
      }
    },
    [knockerId],
  )

  const resumeAdresse = adresse
    ? [adresse.adresse, adresse.ville].filter(Boolean).join(', ')
    : ''

  /** Doublon détecté et pas encore tranché : on n'enregistre pas. */
  const doublonEnAttenteDeDecision =
    doublon.statut === 'trouve' && !doublon.accepte

  const peutContinuer =
    Boolean(adresse) &&
    !doublonEnAttenteDeDecision &&
    doublon.statut !== 'recherche' &&
    !enregistrement

  async function enregistrer(creneau: Creneau | null) {
    if (!adresse) return

    setEnregistrement(true)
    setErreur(null)

    // On ne met à jour l'opportunité existante que si elle est à MOI : la RLS
    // (`opportunites_update_knocker`) refuse la ligne d'un collègue. Sur la porte
    // d'un autre knocker, on enregistre sa propre opportunité.
    const opportuniteId =
      doublon.statut === 'trouve' && doublon.accepte && doublon.doublon.estLaMienne
        ? doublon.doublon.opportunite.id
        : null

    const charge: ChargeCreationLead = {
      opportuniteId,
      knockerId,
      adresse: adresse.adresse,
      ville: adresse.ville,
      codePostal: adresse.codePostal,
      latitude: adresse.latitude,
      longitude: adresse.longitude,
      clientNom: clientNom.trim() || null,
      note: note.trim() || null,
      statut,
      dateRdv: creneau ? creneau.debut.toISOString() : null,
      closerId: creneau ? closerId : null,
      saisiLe: saisiLe ?? new Date().toISOString(),
    }

    try {
      await envoyer('creation_lead', charge)
      setEtape('confirme')
    } catch {
      setErreur('Enregistrement impossible. Réessaie.')
    } finally {
      setEnregistrement(false)
    }
  }

  function reinitialiser() {
    setEtape('saisie')
    setAdresse(null)
    setDoublon({ statut: 'aucun' })
    setStatut('absent')
    setClientNom('')
    setNote('')
    setSaisiLe(null)
    setErreur(null)
  }

  // --- Confirmation --------------------------------------------------------
  if (etape === 'confirme') {
    return (
      <div className="flex flex-col gap-4">
        <IndicateurFileAttente />

        <div className="rounded-2xl bg-white p-5 text-center shadow-card">
          <p className="font-display text-lg font-semibold text-navy">
            Lead enregistré
          </p>
          <p className="mt-2 text-sm text-grey-text">
            {enLigne
              ? 'Envoyé.'
              : 'Hors ligne — il partira tout seul au retour du réseau.'}
          </p>
        </div>

        <button
          type="button"
          onClick={reinitialiser}
          className="h-12 rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong"
        >
          Cogner la porte suivante
        </button>
      </div>
    )
  }

  // --- Choix de plage ------------------------------------------------------
  if (etape === 'plage') {
    return (
      <div className="flex flex-col gap-4">
        <IndicateurFileAttente />

        {erreur && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {erreur}
          </p>
        )}

        <ChoixPlage
          closerId={closerId}
          resumeAdresse={resumeAdresse}
          enregistrement={enregistrement}
          onRetour={() => setEtape('saisie')}
          onConfirmer={(creneau) => void enregistrer(creneau)}
        />
      </div>
    )
  }

  // --- Saisie --------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      <IndicateurFileAttente />

      {erreur && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {erreur}
        </p>
      )}

      {/* 1. Adresse */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="font-display text-base font-semibold text-navy">Adresse</h2>
        <div className="mt-3">
          <ChampAdresse
            adresseChoisie={adresse}
            onChoisie={(choisie) => void choisirAdresse(choisie)}
          />
        </div>

        {doublon.statut === 'recherche' && (
          <p className="mt-3 text-sm text-grey-text">
            Vérification des portes déjà cognées…
          </p>
        )}

        {doublon.statut === 'indisponible' && (
          <p className="mt-3 text-sm text-grey-text">
            Vérification des doublons impossible hors ligne. Tu peux continuer.
          </p>
        )}

        {doublon.statut === 'trouve' && <AlerteDoublon
          doublon={doublon.doublon}
          accepte={doublon.accepte}
          onContinuer={() =>
            setDoublon({ statut: 'trouve', doublon: doublon.doublon, accepte: true })
          }
          onAnnuler={() => void choisirAdresse(null)}
        />}
      </section>

      {/* 2. Statut de contact */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <fieldset>
          <legend className="font-display text-base font-semibold text-navy">
            Résultat à la porte
          </legend>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {STATUTS_CONTACT.map((valeur) => {
              const actif = statut === valeur

              return (
                <label
                  key={valeur}
                  className={`flex min-h-14 cursor-pointer flex-col justify-center rounded-lg border px-3 py-2 transition-colors ${
                    actif
                      ? 'border-brand bg-brand/10'
                      : 'border-grey-border bg-white hover:bg-grey-light'
                  }`}
                >
                  <input
                    type="radio"
                    name="statut"
                    value={valeur}
                    checked={actif}
                    onChange={() => setStatut(valeur)}
                    className="sr-only"
                  />
                  <span
                    className={`text-base font-semibold ${
                      actif ? 'text-brand-strong' : 'text-navy'
                    }`}
                  >
                    {LIBELLES_STATUT[valeur]}
                  </span>
                  <span className="text-xs text-grey-text">
                    {AIDES_STATUT_CONTACT[valeur]}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      </section>

      {/* 3. Facultatif — replié pour ne pas allonger le formulaire. */}
      <details className="rounded-2xl bg-white shadow-card">
        <summary className="flex h-11 cursor-pointer list-none items-center px-4 font-display text-base font-semibold text-navy">
          Nom et notes (facultatif)
        </summary>

        <div className="flex flex-col gap-3 border-t border-grey-border p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="client_nom" className="text-sm font-medium text-navy">
              Nom du client
            </label>
            <input
              id="client_nom"
              value={clientNom}
              onChange={(e) => setClientNom(e.target.value)}
              autoComplete="off"
              className={CLASSE_CHAMP}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="note" className="text-sm font-medium text-navy">
              Note
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-grey-border bg-white px-3 py-2 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
        </div>
      </details>

      {/* Action principale, collée au-dessus de la barre de navigation. */}
      <div className="sticky bottom-24">
        <button
          type="button"
          onClick={() => {
            if (statut === 'rdv') {
              setEtape('plage')
              return
            }

            void enregistrer(null)
          }}
          disabled={!peutContinuer}
          className="h-12 w-full rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong disabled:opacity-50"
        >
          {!adresse
            ? 'Choisis une adresse'
            : doublonEnAttenteDeDecision
              ? 'Décide pour le doublon'
              : enregistrement
                ? 'Enregistrement…'
                : statut === 'rdv'
                  ? 'Choisir la plage'
                  : 'Enregistrer le lead'}
        </button>
      </div>
    </div>
  )
}

/**
 * Alerte douce de doublon — informe, ne bloque pas.
 *
 * Repasser un absent est un geste normal ; l'objectif est d'éviter de re-cogner
 * une porte fraîchement travaillée sans le savoir.
 */
function AlerteDoublon({
  doublon,
  accepte,
  onContinuer,
  onAnnuler,
}: {
  doublon: DoublonTrouve
  accepte: boolean
  onContinuer: () => void
  onAnnuler: () => void
}) {
  const visite = lireDate(doublon.opportunite.derniereVisite)
  const qui = doublon.estLaMienne ? 'toi' : (doublon.nomKnocker ?? 'un collègue')

  return (
    <div className="mt-3 rounded-lg border border-grey-border bg-grey-light p-3">
      <p className="text-sm text-navy">
        <strong className="font-semibold">Porte déjà cognée</strong>
        {visite ? ` le ${formaterDateHeure(visite)}` : ''} par {qui} — statut{' '}
        {LIBELLES_STATUT[doublon.opportunite.statut].toLowerCase()},{' '}
        {doublon.opportunite.nbVisites}{' '}
        {doublon.opportunite.nbVisites === 1 ? 'visite' : 'visites'}.
      </p>

      {accepte ? (
        <p className="mt-2 text-sm text-grey-text">
          {doublon.estLaMienne
            ? 'Cette visite sera ajoutée au lead existant.'
            : 'Un lead séparé sera créé à ton nom.'}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={onContinuer}
            className="min-h-11 rounded-lg border border-grey-border bg-white px-4 text-sm font-semibold text-navy transition-colors hover:bg-white/70"
          >
            {doublon.estLaMienne
              ? 'Continuer — ajouter une visite'
              : 'Continuer quand même'}
          </button>
          <button
            type="button"
            onClick={onAnnuler}
            className="min-h-11 text-sm text-grey-text underline"
          >
            Annuler et changer d’adresse
          </button>
        </div>
      )}
    </div>
  )
}
