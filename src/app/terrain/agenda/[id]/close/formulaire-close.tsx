'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  Champ,
  EditeurExtras,
  EditeurVolets,
  ListeErreurs,
  RecapTotaux,
} from '@/components/editeur-vente'
import { IndicateurFileAttente } from '@/components/indicateur-file-attente'
import type { ChargeCloseVente } from '@/lib/file-attente/executeurs'
import { cleClose } from '@/lib/file-attente/file'
import { useFileAttente } from '@/lib/file-attente/fournisseur'
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

type Props = {
  opportuniteId: string
  clientNomInitial: string
  clientTelInitial: string
  clientCourrielInitial: string
  superficieInitiale: string
  adresse: string
}

export function FormulaireClose({
  opportuniteId,
  clientNomInitial,
  clientTelInitial,
  clientCourrielInitial,
  superficieInitiale,
  adresse,
}: Props) {
  const router = useRouter()
  const { envoyer, contientCle, enLigne } = useFileAttente()

  const [nom, setNom] = useState(clientNomInitial)
  const [telephone, setTelephone] = useState(clientTelInitial)
  const [courriel, setCourriel] = useState(clientCourrielInitial)
  const [superficie, setSuperficie] = useState(superficieInitiale)

  const [volets, setVolets] = useState<VoletSaisi[]>([])
  const [extras, setExtras] = useState<ExtraSaisi[]>([])

  const [depot, setDepot] = useState('')
  const [cibleDebut, setCibleDebut] = useState('')
  const [cibleFin, setCibleFin] = useState('')

  const [tenteEnvoi, setTenteEnvoi] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [conclu, setConclu] = useState(false)

  const erreurs = validerClose(
    { nom, telephone, courriel },
    volets,
    extras,
    cibleDebut,
    cibleFin,
  )

  const total = totalVente(volets, extras)

  async function conclure() {
    setTenteEnvoi(true)

    if (erreurs.length > 0) return

    setEnvoi(true)

    const charge: ChargeCloseVente = {
      opportuniteId,
      clientNom: nom.trim(),
      // E.164 comme partout ailleurs ; `validerClose` a déjà garanti la validité.
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
      // La couleur des bardeaux n'a pas de colonne : elle part dans la note.
      precisions: precisionsVente(volets) || null,
    }

    try {
      await envoyer('close_vente', charge)
      setConclu(true)
      router.refresh()
    } finally {
      setEnvoi(false)
    }
  }

  // --- Confirmation --------------------------------------------------------
  if (conclu) {
    const enAttente = contientCle(cleClose(opportuniteId))

    return (
      <div className="flex flex-col gap-4">
        <IndicateurFileAttente />

        <div className="rounded-2xl bg-white p-5 text-center shadow-card">
          <p className="font-display text-lg font-semibold text-navy">
            Vente conclue
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-navy">
            {formaterMontant(total)}
          </p>
          <p className="mt-2 text-sm text-grey-text">
            {enAttente || !enLigne
              ? 'Hors ligne — la vente partira toute seule au retour du réseau. Rien n’est perdu.'
              : 'Enregistrée.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.push(`/terrain/agenda/${opportuniteId}`)}
          className="h-12 rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong"
        >
          Revenir au rendez-vous
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <IndicateurFileAttente />

      <p className="text-sm text-grey-text">{adresse}</p>

      {/* --- 1. Client ---------------------------------------------------- */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="font-display text-base font-semibold text-navy">Client</h2>
        <p className="mt-0.5 text-xs text-grey-text">
          Les trois champs deviennent obligatoires à la signature.
        </p>

        <div className="mt-3 flex flex-col gap-3">
          <Champ
            id="nom"
            libelle="Nom complet"
            valeur={nom}
            onChange={setNom}
            autoComplete="name"
          />
          <Champ
            id="telephone"
            libelle="Téléphone"
            valeur={telephone}
            onChange={setTelephone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(450) 555-1234"
          />
          <Champ
            id="courriel"
            libelle="Courriel"
            valeur={courriel}
            onChange={setCourriel}
            type="email"
            inputMode="email"
            autoComplete="email"
          />
        </div>
      </section>

      {/* --- 2 et 3. Contenu de la vente ---------------------------------- */}
      <EditeurVolets
        volets={volets}
        setVolets={setVolets}
        superficie={superficie}
        setSuperficie={setSuperficie}
      />

      <EditeurExtras extras={extras} setExtras={setExtras} />

      {/* --- 4. Argent et planification ----------------------------------- */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="font-display text-base font-semibold text-navy">
          Dépôt et fenêtre de travaux
        </h2>

        <div className="mt-3 flex flex-col gap-3">
          <Champ
            id="depot"
            libelle="Dépôt reçu"
            valeur={depot}
            onChange={setDepot}
            inputMode="decimal"
            placeholder="0,00 $"
          />

          <div className="flex gap-2">
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

          <p className="text-xs text-grey-text">
            Fourchette approximative. La date exacte sera confirmée plus tard par
            l’administration.
          </p>
        </div>
      </section>

      {/* --- 5. Total ------------------------------------------------------ */}
      <RecapTotaux volets={volets} extras={extras} />

      {/* Les erreurs n'apparaissent qu'après une tentative : les afficher dès la
          première frappe rendrait le formulaire hostile. */}
      {tenteEnvoi && <ListeErreurs erreurs={erreurs} />}

      <div className="sticky bottom-24">
        <button
          type="button"
          onClick={() => void conclure()}
          disabled={envoi}
          className="h-12 w-full rounded-lg bg-brand text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong disabled:opacity-50"
        >
          {envoi ? 'Enregistrement…' : `Conclure — ${formaterMontant(total)}`}
        </button>
      </div>
    </div>
  )
}
