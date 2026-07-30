'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { IndicateurFileAttente } from '@/components/indicateur-file-attente'
import type { ChargeCloseVente } from '@/lib/file-attente/executeurs'
import { cleClose } from '@/lib/file-attente/file'
import { useFileAttente } from '@/lib/file-attente/fournisseur'
import { versE164 } from '@/lib/telephone'
import {
  formaterMontant,
  LIBELLES_PRODUIT_GONANO,
  LIBELLES_TYPE_TRAVAIL,
  lireMontant,
  precisionsVente,
  PRODUITS_GONANO,
  totalExtras,
  totalVente,
  totalVolets,
  TYPES_VOLET_VENDABLES,
  validerClose,
  type ExtraSaisi,
  type ProduitGonano,
  type TypeTravail,
  type VoletSaisi,
} from '@/lib/vente'

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

const CLASSE_SECONDAIRE =
  'min-h-11 w-full rounded-lg border border-grey-border bg-white px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-grey-light'

type Props = {
  opportuniteId: string
  clientNomInitial: string
  clientTelInitial: string
  clientCourrielInitial: string
  superficieInitiale: string
  adresse: string
}

let compteur = 0
function nouvelleCle(prefixe: string): string {
  compteur += 1
  return `${prefixe}-${compteur}`
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

  function ajouterVolet(type: TypeTravail) {
    setVolets((precedent) => [
      ...precedent,
      {
        cle: nouvelleCle('volet'),
        type,
        produitGonano: type === 'traitement_gonano' ? 'fortify' : null,
        deuxiemeCoucheFortify: false,
        couleur: '',
        montant: '',
      },
    ])
  }

  function majVolet(cle: string, champs: Partial<VoletSaisi>) {
    setVolets((precedent) =>
      precedent.map((volet) => (volet.cle === cle ? { ...volet, ...champs } : volet)),
    )
  }

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

      {/* --- 2. Volets ---------------------------------------------------- */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="font-display text-base font-semibold text-navy">
          Volets de travaux
        </h2>

        {volets.length > 0 && (
          <ul className="mt-3 flex flex-col gap-3">
            {volets.map((volet, index) => (
              <li
                key={volet.cle}
                className="rounded-lg border border-grey-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-navy">
                    {LIBELLES_TYPE_TRAVAIL[volet.type]}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setVolets((p) => p.filter((v) => v.cle !== volet.cle))
                    }
                    className="min-h-11 px-2 text-sm text-grey-text underline"
                  >
                    Retirer
                  </button>
                </div>

                <div className="mt-2 flex flex-col gap-3">
                  {volet.type === 'traitement_gonano' && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor={`produit-${volet.cle}`}
                          className="text-sm font-medium text-navy"
                        >
                          Produit
                        </label>
                        <select
                          id={`produit-${volet.cle}`}
                          value={volet.produitGonano ?? ''}
                          onChange={(e) =>
                            majVolet(volet.cle, {
                              produitGonano: (e.target.value ||
                                null) as ProduitGonano | null,
                            })
                          }
                          className={CLASSE_CHAMP}
                        >
                          {PRODUITS_GONANO.map((produit) => (
                            <option key={produit} value={produit}>
                              {LIBELLES_PRODUIT_GONANO[produit]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <label className="flex min-h-11 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={volet.deuxiemeCoucheFortify}
                          onChange={(e) =>
                            majVolet(volet.cle, {
                              deuxiemeCoucheFortify: e.target.checked,
                            })
                          }
                          className="size-6 shrink-0 accent-brand"
                        />
                        <span className="text-sm text-navy">
                          2<sup>e</sup> couche de Fortify
                        </span>
                      </label>
                    </>
                  )}

                  {volet.type === 'refection_bardeaux' && (
                    <Champ
                      id={`couleur-${volet.cle}`}
                      libelle="Couleur"
                      valeur={volet.couleur}
                      onChange={(valeur) => majVolet(volet.cle, { couleur: valeur })}
                      placeholder="Charcoal, Weathered Wood…"
                    />
                  )}

                  <Champ
                    id={`montant-volet-${volet.cle}`}
                    libelle={`Montant du volet ${index + 1}`}
                    valeur={volet.montant}
                    onChange={(valeur) => majVolet(volet.cle, { montant: valeur })}
                    inputMode="decimal"
                    placeholder="0,00 $"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {TYPES_VOLET_VENDABLES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => ajouterVolet(type)}
              className={CLASSE_SECONDAIRE}
            >
              + Ajouter {LIBELLES_TYPE_TRAVAIL[type]}
            </button>
          ))}
        </div>

        {/* Une seule superficie pour tout le contrat : le schéma la porte sur
            l'opportunité, pas sur chaque volet. */}
        <div className="mt-3">
          <Champ
            id="superficie"
            libelle="Superficie totale (pi²)"
            valeur={superficie}
            onChange={setSuperficie}
            inputMode="numeric"
            placeholder="2400"
          />
        </div>
      </section>

      {/* --- 3. Extras ---------------------------------------------------- */}
      <section className="rounded-2xl bg-white p-4 shadow-card">
        <h2 className="font-display text-base font-semibold text-navy">Extras</h2>

        {extras.length > 0 && (
          <ul className="mt-3 flex flex-col gap-3">
            {extras.map((extra) => (
              <li key={extra.cle} className="rounded-lg border border-grey-border p-3">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setExtras((p) => p.filter((e) => e.cle !== extra.cle))
                    }
                    className="min-h-11 px-2 text-sm text-grey-text underline"
                  >
                    Retirer
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  <Champ
                    id={`desc-${extra.cle}`}
                    libelle="Description"
                    valeur={extra.description}
                    onChange={(valeur) =>
                      setExtras((p) =>
                        p.map((e) =>
                          e.cle === extra.cle ? { ...e, description: valeur } : e,
                        ),
                      )
                    }
                    placeholder="Gouttières, fascias…"
                  />
                  <Champ
                    id={`montant-extra-${extra.cle}`}
                    libelle="Montant"
                    valeur={extra.montant}
                    onChange={(valeur) =>
                      setExtras((p) =>
                        p.map((e) =>
                          e.cle === extra.cle ? { ...e, montant: valeur } : e,
                        ),
                      )
                    }
                    inputMode="decimal"
                    placeholder="0,00 $"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() =>
            setExtras((p) => [
              ...p,
              { cle: nouvelleCle('extra'), description: '', montant: '' },
            ])
          }
          className={`mt-3 ${CLASSE_SECONDAIRE}`}
        >
          + Ajouter un extra
        </button>
      </section>

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
      <section className="rounded-2xl bg-navy p-4 text-white shadow-card">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-white/70">Volets</span>
          <span className="font-medium">{formaterMontant(totalVolets(volets))}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-sm text-white/70">Extras</span>
          <span className="font-medium">{formaterMontant(totalExtras(extras))}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/20 pt-2">
          <span className="font-display font-semibold">Total du contrat</span>
          <span className="font-display text-2xl font-bold">
            {formaterMontant(total)}
          </span>
        </div>
      </section>

      {/* Les erreurs n'apparaissent qu'après une tentative : les afficher dès la
          première frappe rendrait le formulaire hostile. */}
      {tenteEnvoi && erreurs.length > 0 && (
        <ul
          role="alert"
          className="flex list-disc flex-col gap-1 rounded-lg border border-red-200 bg-red-50 py-2 pr-3 pl-8 text-sm text-red-800"
        >
          {erreurs.map((erreur) => (
            <li key={erreur}>{erreur}</li>
          ))}
        </ul>
      )}

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

function Champ({
  id,
  libelle,
  valeur,
  onChange,
  type = 'text',
  inputMode,
  autoComplete,
  placeholder,
}: {
  id: string
  libelle: string
  valeur: string
  onChange: (valeur: string) => void
  type?: string
  inputMode?: 'text' | 'tel' | 'email' | 'decimal' | 'numeric'
  autoComplete?: string
  placeholder?: string
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-navy">
        {libelle}
      </label>
      <input
        id={id}
        type={type}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={CLASSE_CHAMP}
      />
    </div>
  )
}
