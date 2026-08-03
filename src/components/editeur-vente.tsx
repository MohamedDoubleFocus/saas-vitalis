'use client'

import {
  formaterMontant,
  LIBELLES_PRODUIT_GONANO,
  LIBELLES_TYPE_TRAVAIL,
  PRODUITS_GONANO,
  totalExtras,
  totalVente,
  totalVolets,
  TYPES_VOLET_VENDABLES,
  type ExtraSaisi,
  type ProduitGonano,
  type TypeTravail,
  type VoletSaisi,
} from '@/lib/vente'

/**
 * L'éditeur de contenu d'une vente : volets, extras, totaux.
 *
 * Extrait du formulaire de close pour être partagé avec la vente directe de
 * l'administration. Les deux écrans saisissent exactement la même chose — un
 * contrat — et doivent rester identiques champ pour champ : c'est la même
 * fonction `conclure_vente()` qui les reçoit, et la même validation
 * (`validerClose`) qui les juge.
 *
 * Composant CONTRÔLÉ : il ne détient aucun état, tout remonte à l'appelant. Ce
 * qui permet aux deux écrans de garder leur propre logique d'envoi — file
 * d'attente hors ligne d'un côté, server action de l'autre.
 */

export const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

export const CLASSE_SECONDAIRE =
  'min-h-11 w-full rounded-lg border border-grey-border bg-white px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-grey-light'

/**
 * Clé de rendu locale.
 *
 * Un compteur de module et non l'index du tableau : retirer le volet du milieu
 * décalerait tous les index suivants, et React réutiliserait les mauvais champs
 * — le montant du volet 3 se retrouverait sur le volet 2.
 */
let compteur = 0

export function nouvelleCle(prefixe: string): string {
  compteur += 1

  return `${prefixe}-${compteur}`
}

export function voletVide(type: TypeTravail): VoletSaisi {
  return {
    cle: nouvelleCle('volet'),
    type,
    produitGonano: type === 'traitement_gonano' ? 'fortify' : null,
    deuxiemeCoucheFortify: false,
    couleur: '',
    montant: '',
  }
}

export function extraVide(): ExtraSaisi {
  return { cle: nouvelleCle('extra'), description: '', montant: '' }
}

export function Champ({
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

export function EditeurVolets({
  volets,
  setVolets,
  superficie,
  setSuperficie,
}: {
  volets: VoletSaisi[]
  setVolets: React.Dispatch<React.SetStateAction<VoletSaisi[]>>
  superficie: string
  setSuperficie: (valeur: string) => void
}) {
  function majVolet(cle: string, champs: Partial<VoletSaisi>) {
    setVolets((precedent) =>
      precedent.map((volet) => (volet.cle === cle ? { ...volet, ...champs } : volet)),
    )
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-card">
      <h2 className="font-display text-base font-semibold text-navy">
        Volets de travaux
      </h2>

      {volets.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {volets.map((volet, index) => (
            <li key={volet.cle} className="rounded-lg border border-grey-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-navy">
                  {LIBELLES_TYPE_TRAVAIL[volet.type]}
                </p>
                <button
                  type="button"
                  onClick={() => setVolets((p) => p.filter((v) => v.cle !== volet.cle))}
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
            onClick={() => setVolets((p) => [...p, voletVide(type)])}
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
  )
}

export function EditeurExtras({
  extras,
  setExtras,
}: {
  extras: ExtraSaisi[]
  setExtras: React.Dispatch<React.SetStateAction<ExtraSaisi[]>>
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-card">
      <h2 className="font-display text-base font-semibold text-navy">Extras</h2>

      {extras.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {extras.map((extra) => (
            <li key={extra.cle} className="rounded-lg border border-grey-border p-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setExtras((p) => p.filter((e) => e.cle !== extra.cle))}
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
                      p.map((e) => (e.cle === extra.cle ? { ...e, montant: valeur } : e)),
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
        onClick={() => setExtras((p) => [...p, extraVide()])}
        className={`mt-3 ${CLASSE_SECONDAIRE}`}
      >
        + Ajouter un extra
      </button>
    </section>
  )
}

/** Le récapitulatif : la valeur que le client signe, impossible à manquer. */
export function RecapTotaux({
  volets,
  extras,
}: {
  volets: readonly VoletSaisi[]
  extras: readonly ExtraSaisi[]
}) {
  return (
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
          {formaterMontant(totalVente(volets, extras))}
        </span>
      </div>
    </section>
  )
}

/** Les erreurs de validation, affichées seulement après une tentative d'envoi. */
export function ListeErreurs({ erreurs }: { erreurs: readonly string[] }) {
  if (erreurs.length === 0) return null

  return (
    <ul
      role="alert"
      className="flex list-disc flex-col gap-1 rounded-lg border border-red-200 bg-red-50 py-2 pr-3 pl-8 text-sm text-red-800"
    >
      {erreurs.map((erreur) => (
        <li key={erreur}>{erreur}</li>
      ))}
    </ul>
  )
}
