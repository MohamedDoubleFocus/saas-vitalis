'use client'

import { useCallback, useState } from 'react'

import {
  ICONE_NOM,
  ICONE_NOTE,
  ICONE_TELEPHONE,
  IconeChamp,
  IconeStatut,
} from '@/components/icones'
import { IndicateurFileAttente } from '@/components/indicateur-file-attente'
import type { Creneau } from '@/lib/creneaux'
import type { StatutOpp } from '@/lib/doublons'
import { chercherDoublon, type DoublonTrouve } from '@/lib/doublons-recherche'
import { formaterDateHeure, lireDate } from '@/lib/echeances'
import type { ChargeCreationLead } from '@/lib/file-attente/executeurs'
import { useFileAttente } from '@/lib/file-attente/fournisseur'
import type { AdresseSelectionnee } from '@/lib/google-places'
import { AIDES_STATUT_CONTACT, LIBELLES_STATUT, STATUTS_CONTACT } from '@/lib/statuts'
import { estTelephoneValide, formaterTelephone, versE164 } from '@/lib/telephone'

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

/**
 * Une porte déjà cognée, ouverte depuis « Mes portes » pour être re-cognée.
 *
 * Chargée côté serveur et garantie appartenir au knocker courant : c'est ce qui
 * autorise à écrire dans l'opportunité existante plutôt que d'en créer une
 * seconde à la même adresse.
 */
export type PortePrechargee = {
  id: string
  adresse: AdresseSelectionnee
  clientNom: string | null
  clientTel: string | null
  statutPrecedent: StatutOpp
  nbVisites: number
  derniereVisite: string
}

type Props = {
  knockerId: string
  closerId: string | null
  porte?: PortePrechargee | null
}

export function FormulaireLead({ knockerId, closerId, porte = null }: Props) {
  const { envoyer, enLigne } = useFileAttente()

  const [etape, setEtape] = useState<Etape>('saisie')
  const [adresse, setAdresse] = useState<AdresseSelectionnee | null>(
    porte?.adresse ?? null,
  )
  const [doublon, setDoublon] = useState<EtatDoublon>({ statut: 'aucun' })
  const [statut, setStatut] = useState<StatutOpp>('absent')
  const [clientNom, setClientNom] = useState(porte?.clientNom ?? '')
  // Affiché en format lisible : le knocker doit pouvoir relire le numéro à voix
  // haute pour le confirmer, pas déchiffrer un E.164.
  const [clientTel, setClientTel] = useState(
    porte?.clientTel ? formaterTelephone(porte.clientTel) : '',
  )
  const [note, setNote] = useState('')
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  /**
   * Porte existante sur laquelle on écrit, tant que l'adresse n'a pas changé.
   *
   * Dès que le knocker choisit une autre adresse, ce lien tombe : on ne veut
   * surtout pas écraser l'adresse d'une opportunité voisine.
   */
  const [porteEnCours, setPorteEnCours] = useState<PortePrechargee | null>(porte)

  /**
   * Instant du coup de porte, figé à la sélection de l'adresse.
   *
   * C'est lui qui devient `derniere_visite`, pas l'heure d'envoi : une mutation
   * partie vingt minutes plus tard ne doit pas fausser la métrique.
   *
   * Sur un re-cognage l'adresse est déjà connue : l'instant est celui de
   * l'ouverture de l'écran, c'est-à-dire du moment où le knocker est à la porte.
   */
  const [saisiLe, setSaisiLe] = useState<string | null>(
    porte ? new Date().toISOString() : null,
  )

  const choisirAdresse = useCallback(
    async (choisie: AdresseSelectionnee | null) => {
      setAdresse(choisie)
      setErreur(null)
      // Changer d'adresse, c'est changer de porte.
      setPorteEnCours(null)

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

  /**
   * On ne fusionne que sur MA porte.
   *
   * Un doublon désigne désormais forcément la MÊME adresse — la détection ne
   * compare plus que le texte normalisé. Ajouter une visite écrit donc bien sur
   * la bonne fiche. La RLS (`opportunites_update_terrain`) refuserait de toute
   * façon la ligne d'un collègue.
   */
  const doublonFusionnable =
    doublon.statut === 'trouve' && doublon.doublon.estLaMienne

  const rdv = statut === 'rdv'
  const telSaisi = clientTel.trim()
  const telInvalide = telSaisi !== '' && !estTelephoneValide(telSaisi)

  /**
   * Un rendez-vous sans nom ni numéro est inexploitable : le closer doit pouvoir
   * confirmer avant de se déplacer. Ailleurs, ces champs restent facultatifs —
   * on n'a ni nom ni numéro d'une porte où personne n'a répondu.
   */
  const coordonneesCompletes =
    clientNom.trim() !== '' && estTelephoneValide(telSaisi)

  const peutContinuer =
    Boolean(adresse) &&
    !doublonEnAttenteDeDecision &&
    doublon.statut !== 'recherche' &&
    !enregistrement &&
    (!rdv || coordonneesCompletes)

  async function enregistrer(creneau: Creneau | null) {
    if (!adresse) return

    setEnregistrement(true)
    setErreur(null)

    // On ne met à jour l'opportunité existante que si elle est à MOI — la RLS
    // (`opportunites_update_terrain`) refuse la ligne d'un collègue — ET si elle
    // porte la même adresse. Sur la porte d'un autre knocker, ou sur la maison
    // voisine, on enregistre une opportunité distincte.
    const opportuniteId =
      porteEnCours?.id ??
      (doublon.statut === 'trouve' && doublon.accepte && doublonFusionnable
        ? doublon.doublon.opportunite.id
        : null)

    const charge: ChargeCreationLead = {
      opportuniteId,
      knockerId,
      adresse: adresse.adresse,
      ville: adresse.ville,
      codePostal: adresse.codePostal,
      latitude: adresse.latitude,
      longitude: adresse.longitude,
      clientNom: clientNom.trim() || null,
      // E.164 si le numéro est lisible ; sinon on conserve la saisie brute
      // plutôt que de la jeter — « ne jamais perdre une saisie » (§5).
      clientTel: telSaisi === '' ? null : (versE164(telSaisi) ?? telSaisi),
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
    setPorteEnCours(null)
    setStatut('absent')
    setClientNom('')
    setClientTel('')
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

        {porteEnCours && <RappelPorte porte={porteEnCours} />}

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
          fusionnable={doublonFusionnable}
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
                    className={`flex items-center gap-2 text-base font-semibold ${
                      actif ? 'text-brand-strong' : 'text-navy'
                    }`}
                  >
                    {/* L'icône permet de reconnaître le geste avant de lire —
                        c'est le sélecteur le plus utilisé de l'app. */}
                    <IconeStatut statut={valeur} className="size-6" />
                    {LIBELLES_STATUT[valeur]}
                  </span>
                  <span className="mt-0.5 text-xs text-grey-text">
                    {AIDES_STATUT_CONTACT[valeur]}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      </section>

      {/* 3. Coordonnées du client.
          Dépliées et obligatoires dès qu'il y a rendez-vous ; repliées sinon,
          pour qu'une porte sans réponse reste une saisie de quelques secondes. */}
      {rdv ? (
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-navy">
            Coordonnées du client
          </h2>
          <p className="mt-0.5 text-xs text-grey-text">
            Obligatoires pour un rendez-vous : le closer doit pouvoir confirmer
            avant de se déplacer.
          </p>

          <div className="mt-3 flex flex-col gap-3">
            <ChampsClient
              clientNom={clientNom}
              setClientNom={setClientNom}
              clientTel={clientTel}
              setClientTel={setClientTel}
              note={note}
              setNote={setNote}
              telInvalide={telInvalide}
              requis
            />
          </div>
        </section>
      ) : (
        <details className="rounded-2xl bg-white shadow-card">
          <summary className="flex h-11 cursor-pointer list-none items-center px-4 font-display text-base font-semibold text-navy">
            Nom, téléphone et note (facultatif)
          </summary>

          <div className="flex flex-col gap-3 border-t border-grey-border p-4">
            <ChampsClient
              clientNom={clientNom}
              setClientNom={setClientNom}
              clientTel={clientTel}
              setClientTel={setClientTel}
              note={note}
              setNote={setNote}
              telInvalide={telInvalide}
              requis={false}
            />
          </div>
        </details>
      )}

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
              : rdv && !coordonneesCompletes
                ? 'Nom et téléphone requis'
                : enregistrement
                  ? 'Enregistrement…'
                  : rdv
                    ? 'Choisir la plage'
                    : 'Enregistrer le lead'}
        </button>
      </div>
    </div>
  )
}

/**
 * Nom, téléphone et note du client.
 *
 * Mêmes champs dans les deux présentations (section dépliée pour un rendez-vous,
 * dépliant ailleurs) : la saisie déjà faite survit au changement de statut.
 */
function ChampsClient({
  clientNom,
  setClientNom,
  clientTel,
  setClientTel,
  note,
  setNote,
  telInvalide,
  requis,
}: {
  clientNom: string
  setClientNom: (valeur: string) => void
  clientTel: string
  setClientTel: (valeur: string) => void
  note: string
  setNote: (valeur: string) => void
  telInvalide: boolean
  requis: boolean
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="client_nom"
          className="flex items-center gap-2 text-sm font-semibold text-navy"
        >
          <IconeChamp icone={ICONE_NOM} />
          Nom complet{requis && <span aria-hidden> *</span>}
        </label>
        <input
          id="client_nom"
          value={clientNom}
          onChange={(e) => setClientNom(e.target.value)}
          required={requis}
          autoComplete="name"
          autoCapitalize="words"
          className={CLASSE_CHAMP}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="client_tel"
          className="flex items-center gap-2 text-sm font-semibold text-navy"
        >
          <IconeChamp icone={ICONE_TELEPHONE} />
          Téléphone{requis && <span aria-hidden> *</span>}
        </label>
        {/* `type="tel"` + `inputMode="tel"` : clavier numérique au premier tap. */}
        <input
          id="client_tel"
          type="tel"
          inputMode="tel"
          value={clientTel}
          onChange={(e) => setClientTel(e.target.value)}
          required={requis}
          autoComplete="tel"
          placeholder="(450) 555-1234"
          aria-invalid={telInvalide || undefined}
          aria-describedby={telInvalide ? 'erreur_tel' : undefined}
          className={CLASSE_CHAMP}
        />
        {telInvalide && (
          <p id="erreur_tel" className="text-xs text-red-800">
            Numéro à 10 chiffres attendu.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="note"
          className="flex items-center gap-2 text-sm font-semibold text-navy"
        >
          <IconeChamp icone={ICONE_NOTE} />
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
    </>
  )
}

/**
 * Rappel de ce qu'on sait déjà de la porte qu'on re-cogne.
 *
 * Ce n'est pas une alerte : ici le knocker a choisi cette porte exprès. Le bloc
 * lui redonne le contexte (dernier résultat, ancienneté, nombre de visites) juste
 * avant qu'il ne saisisse le résultat du jour.
 */
function RappelPorte({ porte }: { porte: PortePrechargee }) {
  const visite = lireDate(porte.derniereVisite)

  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-grey-border bg-grey-light p-3">
      <IconeStatut statut={porte.statutPrecedent} className="mt-0.5 size-5 text-grey-text" />
      <p className="text-sm text-navy">
        <strong className="font-semibold">
          {LIBELLES_STATUT[porte.statutPrecedent]}
        </strong>
        {visite ? ` le ${formaterDateHeure(visite)}` : ''} — {porte.nbVisites}{' '}
        {porte.nbVisites === 1 ? 'visite' : 'visites'}. Cette visite s’ajoutera à
        la porte existante.
      </p>
    </div>
  )
}

/**
 * Alerte douce de doublon — informe, ne bloque pas.
 *
 * Repasser un absent est un geste normal ; l'objectif est d'éviter de re-cogner
 * une porte fraîchement travaillée sans le savoir.
 *
 * `fusionnable` est CALCULÉ PAR LE PARENT et passé ici : c'est la même valeur
 * qui décide du texte affiché et de l'écriture réelle. La recalculer localement
 * laisserait l'écran promettre une chose et la base en faire une autre.
 */
function AlerteDoublon({
  doublon,
  fusionnable,
  accepte,
  onContinuer,
  onAnnuler,
}: {
  doublon: DoublonTrouve
  fusionnable: boolean
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

      {/* L'adresse trouvée reste affichée : le knocker voit exactement de quelle
          porte on lui parle, sans avoir à le déduire. */}
      <p className="mt-1 text-sm font-medium text-navy">
        {doublon.opportunite.adresse}
        {doublon.opportunite.ville ? `, ${doublon.opportunite.ville}` : ''}
      </p>

      {/* Le libellé suit `fusionnable`, PAS `estLaMienne` : sur la porte voisine,
          même si elle est à moi, un lead séparé est créé. Promettre « ajouter une
          visite » puis créer autre chose serait pire que l'alerte elle-même. */}
      {accepte ? (
        <p className="mt-2 text-sm text-grey-text">
          {fusionnable
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
            {fusionnable
              ? 'Continuer — ajouter une visite'
              : 'Continuer — créer un lead séparé'}
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
