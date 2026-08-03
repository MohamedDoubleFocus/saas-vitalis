'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  Champ,
  CLASSE_CHAMP,
  EditeurExtras,
  EditeurVolets,
  ListeErreurs,
  RecapTotaux,
} from '@/components/editeur-vente'
import { AIDES_SOURCE, LIBELLES_SOURCE, SOURCES_DIRECTES } from '@/lib/sources'
import { versE164 } from '@/lib/telephone'
import {
  formaterMontant,
  lireMontant,
  precisionsVente,
  totalVente,
  validerClose,
  type ExtraSaisi,
  type VoletSaisi,
} from '@/lib/vente'

import { creerVenteDirecte } from './actions'

type CloserOption = {
  id: string
  nom: string
}

/**
 * Vente qui n'est jamais passée par une porte : référence, appel entrant, salon.
 *
 * Client Component, comme le formulaire de close — les volets et les extras sont
 * répétables, il n'existe pas d'équivalent serveur raisonnable (CLAUDE.md §6).
 * L'éditeur de contenu est **le même composant** que celui du closer : les deux
 * écrans saisissent un contrat, et c'est la même `conclure_vente()` qui le
 * reçoit.
 *
 * Pas de file d'attente ici : on est en zone gestion, au bureau, sur un vrai
 * réseau. La server action suffit.
 */
export function FormulaireVenteDirecte({ closers }: { closers: CloserOption[] }) {
  const router = useRouter()

  const [source, setSource] = useState<string>('reference')
  const [adresse, setAdresse] = useState('')
  const [ville, setVille] = useState('')
  const [codePostal, setCodePostal] = useState('')
  const [closerId, setCloserId] = useState('')

  const [nom, setNom] = useState('')
  const [telephone, setTelephone] = useState('')
  const [courriel, setCourriel] = useState('')
  const [superficie, setSuperficie] = useState('')

  const [volets, setVolets] = useState<VoletSaisi[]>([])
  const [extras, setExtras] = useState<ExtraSaisi[]>([])

  const [depot, setDepot] = useState('')
  const [cibleDebut, setCibleDebut] = useState('')
  const [cibleFin, setCibleFin] = useState('')
  const [notes, setNotes] = useState('')

  const [tenteEnvoi, setTenteEnvoi] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreurServeur, setErreurServeur] = useState<string | null>(null)

  // Exactement la même validation que le closer, plus ce qui lui est déjà connu
  // et qu'il faut saisir ici : l'adresse et le closer à créditer.
  const erreurs = [
    ...(adresse.trim() === '' ? ['L’adresse du chantier est obligatoire.'] : []),
    ...(closerId === ''
      ? ['Choisis le closer à créditer : sans lui, la commission est perdue.']
      : []),
    ...validerClose(
      { nom, telephone, courriel },
      volets,
      extras,
      cibleDebut,
      cibleFin,
    ),
  ]

  const total = totalVente(volets, extras)

  async function enregistrer() {
    setTenteEnvoi(true)
    setErreurServeur(null)

    if (erreurs.length > 0) return

    setEnvoi(true)

    try {
      const resultat = await creerVenteDirecte({
        source,
        adresse: adresse.trim(),
        ville: ville.trim() || null,
        codePostal: codePostal.trim() || null,
        closerId,
        clientNom: nom.trim(),
        // E.164 comme partout ailleurs ; `validerClose` a garanti la validité.
        clientTel: versE164(telephone) ?? telephone.trim(),
        clientCourriel: courriel.trim(),
        superficiePi2: superficie.trim() === '' ? null : Number(superficie.trim()),
        depotRecu: lireMontant(depot) ?? 0,
        dateCibleDebut: cibleDebut || null,
        dateCibleFin: cibleFin || null,
        volets: volets.map((volet) => ({
          type: volet.type,
          produit_gonano: volet.produitGonano,
          deuxieme_couche_fortify: volet.deuxiemeCoucheFortify,
          montant: lireMontant(volet.montant) ?? 0,
        })),
        extras: extras.map((extra) => ({
          description: extra.description.trim(),
          montant: lireMontant(extra.montant) ?? 0,
        })),
        precisions: precisionsVente(volets) || null,
        notes: notes.trim() || null,
      })

      if (resultat.statut === 'erreur') {
        setErreurServeur(resultat.message)
        return
      }

      // Le chantier apparaît aussitôt dans la liste d'assignation au-dessus :
      // un rafraîchissement suffit, inutile de changer de page.
      reinitialiser()
      router.refresh()
    } catch {
      setErreurServeur('Enregistrement impossible. Réessaie.')
    } finally {
      setEnvoi(false)
    }
  }

  function reinitialiser() {
    setAdresse('')
    setVille('')
    setCodePostal('')
    setNom('')
    setTelephone('')
    setCourriel('')
    setSuperficie('')
    setVolets([])
    setExtras([])
    setDepot('')
    setCibleDebut('')
    setCibleFin('')
    setNotes('')
    setTenteEnvoi(false)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* --- 1. Origine et adresse ---------------------------------------- */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="font-display text-base font-semibold text-navy">
          Origine et adresse
        </h2>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="source" className="text-sm font-medium text-navy">
              D’où vient cette vente&nbsp;?
            </label>
            <select
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className={CLASSE_CHAMP}
            >
              {SOURCES_DIRECTES.map((valeur) => (
                <option key={valeur} value={valeur}>
                  {LIBELLES_SOURCE[valeur]}
                </option>
              ))}
            </select>
            <p className="text-xs text-grey-text">
              {AIDES_SOURCE[source as keyof typeof AIDES_SOURCE]}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="closer" className="text-sm font-medium text-navy">
              Closer à créditer
            </label>
            <select
              id="closer"
              value={closerId}
              onChange={(e) => setCloserId(e.target.value)}
              className={CLASSE_CHAMP}
            >
              <option value="">Choisir…</option>
              {closers.map((closer) => (
                <option key={closer.id} value={closer.id}>
                  {closer.nom}
                </option>
              ))}
            </select>
            <p className="text-xs text-grey-text">
              Aucun knocker : personne n’a cogné à cette porte.
            </p>
          </div>

          <div className="lg:col-span-2">
            <Champ
              id="adresse"
              libelle="Adresse du chantier"
              valeur={adresse}
              onChange={setAdresse}
              placeholder="12 rue Principale"
              autoComplete="off"
            />
          </div>

          <Champ
            id="ville"
            libelle="Ville"
            valeur={ville}
            onChange={setVille}
            autoComplete="off"
          />
          <Champ
            id="code_postal"
            libelle="Code postal"
            valeur={codePostal}
            onChange={setCodePostal}
            autoComplete="off"
          />
        </div>
      </section>

      {/* --- 2. Client ---------------------------------------------------- */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="font-display text-base font-semibold text-navy">Client</h2>
        <p className="mt-0.5 text-xs text-grey-text">
          Les trois champs sont obligatoires — mêmes règles qu’un close sur le
          terrain.
        </p>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Champ
            id="nom"
            libelle="Nom complet"
            valeur={nom}
            onChange={setNom}
            autoComplete="off"
          />
          <Champ
            id="telephone"
            libelle="Téléphone"
            valeur={telephone}
            onChange={setTelephone}
            type="tel"
            inputMode="tel"
            placeholder="(450) 555-1234"
          />
          <Champ
            id="courriel"
            libelle="Courriel"
            valeur={courriel}
            onChange={setCourriel}
            type="email"
            inputMode="email"
          />
        </div>
      </section>

      {/* --- 3 et 4. Contenu de la vente : le MÊME éditeur que le closer --- */}
      <EditeurVolets
        volets={volets}
        setVolets={setVolets}
        superficie={superficie}
        setSuperficie={setSuperficie}
      />

      <EditeurExtras extras={extras} setExtras={setExtras} />

      {/* --- 5. Argent et planification ----------------------------------- */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="font-display text-base font-semibold text-navy">
          Dépôt et fenêtre de travaux
        </h2>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Champ
            id="depot"
            libelle="Dépôt reçu"
            valeur={depot}
            onChange={setDepot}
            inputMode="decimal"
            placeholder="0,00 $"
          />
          <Champ
            id="cible_debut"
            libelle="Cible — début"
            valeur={cibleDebut}
            onChange={setCibleDebut}
            type="date"
          />
          <Champ
            id="cible_fin"
            libelle="Cible — fin"
            valeur={cibleFin}
            onChange={setCibleFin}
            type="date"
          />
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="notes_vente" className="text-sm font-medium text-navy">
            Note (facultatif)
          </label>
          <textarea
            id="notes_vente"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Référé par M. Tremblay, 45 rue des Ormes…"
            className="w-full rounded-lg border border-grey-border bg-white px-3 py-2 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <p className="text-xs text-grey-text">
            Rejoint le fil chronologique du chantier.
          </p>
        </div>
      </section>

      {/* --- 6. Total ------------------------------------------------------ */}
      <RecapTotaux volets={volets} extras={extras} />

      {erreurServeur && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {erreurServeur}
        </p>
      )}

      {/* Les erreurs n'apparaissent qu'après une tentative : les afficher dès la
          première frappe rendrait le formulaire hostile. */}
      {tenteEnvoi && <ListeErreurs erreurs={erreurs} />}

      <button
        type="button"
        onClick={() => void enregistrer()}
        disabled={envoi || closers.length === 0}
        className="h-12 rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong disabled:opacity-50"
      >
        {envoi
          ? 'Enregistrement…'
          : `Enregistrer la vente — ${formaterMontant(total)}`}
      </button>

      {closers.length === 0 && (
        <p className="text-xs text-grey-text">
          Aucun closer actif. Crée-en un dans « Utilisateurs » avant d’enregistrer
          une vente.
        </p>
      )}
    </div>
  )
}
