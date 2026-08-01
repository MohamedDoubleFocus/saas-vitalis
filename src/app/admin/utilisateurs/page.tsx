import type { Metadata } from 'next'

import { CadrePage } from '@/components/cadre-page'
import { exigerAdmin } from '@/lib/auth'
import { LIBELLES_ROLES, ROLES, type RoleUser } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

import { formaterTelephone } from '@/lib/telephone'

import {
  basculerActif,
  creerUtilisateur,
  modifierCloser,
  modifierNumeroOpenPhone,
} from './actions'

export const metadata: Metadata = {
  title: 'Utilisateurs — Vitalis',
}

type Props = {
  searchParams: Promise<{ error?: string; ok?: string }>
}

type ProfilListe = {
  id: string
  nom_complet: string | null
  role: RoleUser
  actif: boolean
  closer_id: string | null
  openphone_number: string | null
}

/** Option de rattachement : un closer proposable dans les `<select>`. */
type OptionCloser = {
  id: string
  libelle: string
}

const MESSAGES_ERREUR: Record<string, string> = {
  champs_manquants: 'Tous les champs sont requis.',
  role_invalide: 'Rôle invalide.',
  mot_de_passe_court: 'Le mot de passe temporaire doit faire au moins 8 caractères.',
  creation_auth:
    'Impossible de créer le compte. Ce courriel est peut-être déjà utilisé.',
  creation_profil:
    'Le compte a été créé mais son profil a échoué : il ne peut pas encore se connecter. Ajoute sa ligne dans « profiles » avant de réessayer.',
  auto_desactivation: 'Tu ne peux pas désactiver ton propre compte.',
  maj_impossible: 'La mise à jour a échoué. Réessaie.',
  closer_invalide: 'Closer invalide. Choisis un closer actif dans la liste.',
  pas_un_knocker: 'Seul un knocker peut être rattaché à un closer.',
  pas_un_closer: 'Seul un closer peut avoir un numéro OpenPhone.',
  numero_invalide: 'Numéro invalide. Attendu : 10 chiffres nord-américains.',
  auth_non_synchronisee:
    'Le profil est à jour et l’accès aux données est déjà coupé, mais la session ouverte n’a pas pu être révoquée. Elle expirera d’elle-même dans l’heure.',
}

const MESSAGES_SUCCES: Record<string, string> = {
  cree: 'Utilisateur créé.',
  desactive: 'Utilisateur désactivé. Son historique est conservé.',
  reactive: 'Utilisateur réactivé.',
  closer_change: 'Closer rattaché.',
  closer_retire: 'Rattachement au closer retiré.',
  numero_enregistre: 'Numéro OpenPhone enregistré.',
  numero_retire: 'Numéro OpenPhone retiré. Ce closer n’enverra plus de SMS.',
}

const CLASSE_CHAMP =
  'h-11 rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

const CLASSE_BOUTON_SECONDAIRE =
  'min-h-11 rounded-lg border border-grey-border px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-grey-light'

/* -------------------------------------------------------------------------- */
/* Fragments partagés par la carte (mobile) et le tableau (desktop).          */
/* Les deux présentations diffèrent trop pour un balisage unique ; ce qui est  */
/* commun est isolé ici pour qu'il n'existe qu'en un seul endroit.             */
/* -------------------------------------------------------------------------- */

function BadgeRole({ role }: { role: RoleUser }) {
  // `brand` est réservé aux actions (CLAUDE.md §6) : un rôle est une info
  // passive, il reste en gris.
  return (
    <span className="inline-block shrink-0 rounded-full bg-grey-light px-2 py-0.5 text-xs font-medium text-grey-text">
      {LIBELLES_ROLES[role]}
    </span>
  )
}

function EtatCompte({ actif }: { actif: boolean }) {
  return actif ? (
    <span className="text-sm text-grey-text">Actif</span>
  ) : (
    <span className="text-sm font-medium text-red-700">Désactivé</span>
  )
}

/**
 * Rattachement d'un knocker à son closer, modifiable sur place.
 *
 * `options` contient les closers actifs, plus le closer actuel s'il a été
 * désactivé depuis : sans lui, le `<select>` retomberait sur « Aucun » et
 * l'enregistrement délierait le knocker sans que personne ne l'ait demandé.
 */
function RattachementCloser({
  profil,
  options,
}: {
  profil: ProfilListe
  options: OptionCloser[]
}) {
  const actuel = profil.closer_id
    ? options.find((o) => o.id === profil.closer_id)
    : undefined

  return (
    <details>
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm text-grey-text transition-colors hover:text-navy">
        <span>
          Closer :{' '}
          <span className="font-medium text-navy">
            {actuel?.libelle ?? 'non assigné'}
          </span>
        </span>
      </summary>

      <form action={modifierCloser} className="mt-1 flex flex-col gap-2">
        <input type="hidden" name="profil_id" value={profil.id} />
        <label className="sr-only" htmlFor={`closer-${profil.id}`}>
          Closer rattaché
        </label>
        <select
          id={`closer-${profil.id}`}
          name="closer_id"
          defaultValue={profil.closer_id ?? ''}
          className={CLASSE_CHAMP}
        >
          <option value="">— Aucun —</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.libelle}
            </option>
          ))}
        </select>
        <button type="submit" className={CLASSE_BOUTON_SECONDAIRE}>
          Enregistrer le closer
        </button>
      </form>
    </details>
  )
}

/**
 * Numéro OpenPhone d'un closer — l'expéditeur de ses SMS au client.
 *
 * Champ libre : la server action normalise en E.164 et refuse ce qui n'est pas
 * un numéro nord-américain. Vider le champ suspend les SMS de ce closer, sans
 * rien casser d'autre.
 */
function NumeroOpenPhone({ profil }: { profil: ProfilListe }) {
  return (
    <details>
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm text-grey-text transition-colors hover:text-navy">
        <span>
          SMS :{' '}
          <span className="font-medium text-navy">
            {profil.openphone_number
              ? formaterTelephone(profil.openphone_number)
              : 'aucun numéro'}
          </span>
        </span>
      </summary>

      <form action={modifierNumeroOpenPhone} className="mt-1 flex flex-col gap-2">
        <input type="hidden" name="profil_id" value={profil.id} />
        <label className="sr-only" htmlFor={`openphone-${profil.id}`}>
          Numéro OpenPhone
        </label>
        <input
          id={`openphone-${profil.id}`}
          name="openphone_number"
          type="tel"
          inputMode="tel"
          defaultValue={
            profil.openphone_number ? formaterTelephone(profil.openphone_number) : ''
          }
          placeholder="(514) 555-1234"
          autoComplete="off"
          className={CLASSE_CHAMP}
        />
        <p className="text-xs text-grey-text">
          Numéro OpenPhone du closer. Sans lui, aucun SMS ne part pour ses
          rendez-vous.
        </p>
        <button type="submit" className={CLASSE_BOUTON_SECONDAIRE}>
          Enregistrer le numéro
        </button>
      </form>
    </details>
  )
}

/** Bascule actif/inactif, en deux temps et sans modale (CLAUDE.md §6). */
function ActionActif({ profil }: { profil: ProfilListe }) {
  return (
    <details>
      <summary className="flex h-11 cursor-pointer list-none items-center text-sm font-medium text-grey-text transition-colors hover:text-navy">
        {profil.actif ? 'Désactiver l’accès' : 'Réactiver l’accès'}
      </summary>

      <form action={basculerActif} className="mt-1">
        <input type="hidden" name="profil_id" value={profil.id} />
        <input
          type="hidden"
          name="actif"
          value={profil.actif ? 'false' : 'true'}
        />
        <p className="text-sm text-grey-text">
          {profil.actif
            ? 'L’accès est coupé et la session en cours révoquée. Ses leads et son historique restent à son nom.'
            : 'L’accès à sa zone est rétabli immédiatement.'}
        </p>
        {/* `min-h-11` et non `h-11` : le libellé passe sur deux lignes dans la
            colonne étroite du tableau, la cible tactile doit rester ≥ 44px. */}
        <button
          type="submit"
          className={`mt-2 w-full ${CLASSE_BOUTON_SECONDAIRE}`}
        >
          {profil.actif
            ? 'Confirmer la désactivation'
            : 'Confirmer la réactivation'}
        </button>
      </form>
    </details>
  )
}

/* -------------------------------------------------------------------------- */

export default async function PageUtilisateurs({ searchParams }: Props) {
  const { error, ok } = await searchParams
  const session = await exigerAdmin()

  const supabase = await createClient()
  const { data: profils } = await supabase
    .from('profiles')
    .select('id, nom_complet, role, actif, closer_id, openphone_number')
    .order('actif', { ascending: false })
    .order('nom_complet', { ascending: true })

  // Les courriels vivent dans `auth.users`, hors de portée du client de
  // session : seule la clé `service_role` peut les lire.
  const admin = createAdminClient()
  const { data: comptes } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  const courrielParId = new Map(
    (comptes?.users ?? []).map((u) => [u.id, u.email ?? null]),
  )

  const messageErreur = error
    ? (MESSAGES_ERREUR[error] ?? 'Une erreur est survenue.')
    : null
  const messageSucces = ok ? (MESSAGES_SUCCES[ok] ?? null) : null

  const liste: ProfilListe[] = profils ?? []

  // Closers proposables. Un closer désactivé n'est pas proposé, mais reste
  // affiché s'il est déjà rattaché (voir `optionsPour`).
  const closersActifs: OptionCloser[] = liste
    .filter((p) => p.role === 'closer' && p.actif)
    .map((p) => ({ id: p.id, libelle: p.nom_complet || 'Sans nom' }))

  const profilParId = new Map(liste.map((p) => [p.id, p]))

  function optionsPour(profil: ProfilListe): OptionCloser[] {
    if (!profil.closer_id) return closersActifs
    if (closersActifs.some((o) => o.id === profil.closer_id)) return closersActifs

    const orphelin = profilParId.get(profil.closer_id)

    return [
      {
        id: profil.closer_id,
        libelle: `${orphelin?.nom_complet || 'Sans nom'} (désactivé)`,
      },
      ...closersActifs,
    ]
  }

  return (
    <CadrePage titre="Utilisateurs" largeur="gestion">
      {messageErreur && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {messageErreur}
        </p>
      )}

      {messageSucces && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-grey-border bg-white px-3 py-2 text-sm text-grey-text"
        >
          {messageSucces}
        </p>
      )}

      {/* --- Création ------------------------------------------------------ */}
      <details className="mb-5 rounded-2xl bg-white shadow-card">
        <summary className="flex h-11 cursor-pointer list-none items-center px-4 font-display text-base font-semibold text-navy">
          Ajouter un utilisateur
        </summary>

        {/* Une colonne sur mobile, deux champs par rangée dès `lg`. */}
        <form
          action={creerUtilisateur}
          className="grid gap-4 border-t border-grey-border p-4 lg:grid-cols-2"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nom_complet" className="text-sm font-medium text-navy">
              Nom complet
            </label>
            <input
              id="nom_complet"
              name="nom_complet"
              type="text"
              required
              autoComplete="off"
              className={CLASSE_CHAMP}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="courriel" className="text-sm font-medium text-navy">
              Courriel
            </label>
            <input
              id="courriel"
              name="courriel"
              type="email"
              required
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={CLASSE_CHAMP}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="mot_de_passe" className="text-sm font-medium text-navy">
              Mot de passe temporaire
            </label>
            <input
              id="mot_de_passe"
              name="mot_de_passe"
              type="text"
              required
              minLength={8}
              autoComplete="off"
              className={CLASSE_CHAMP}
            />
            <p className="text-xs text-grey-text">
              8 caractères minimum. À transmettre à l’employé, qui pourra le
              changer plus tard.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="role" className="text-sm font-medium text-navy">
              Rôle
            </label>
            <select
              id="role"
              name="role"
              required
              defaultValue="knocker"
              className={CLASSE_CHAMP}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {LIBELLES_ROLES[role]}
                </option>
              ))}
            </select>
          </div>

          {/* Champ affiché en permanence : les interactions sont zéro-JS par
              défaut (CLAUDE.md §6), donc pas d'affichage conditionnel au rôle.
              La server action ignore la valeur si le rôle n'est pas knocker. */}
          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <label htmlFor="closer_id" className="text-sm font-medium text-navy">
              Closer rattaché
            </label>
            <select
              id="closer_id"
              name="closer_id"
              defaultValue=""
              className={CLASSE_CHAMP}
            >
              <option value="">— Aucun —</option>
              {closersActifs.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.libelle}
                </option>
              ))}
            </select>
            <p className="text-xs text-grey-text">
              Ne s’applique qu’aux knockers : c’est le closer à qui ses
              rendez-vous seront envoyés. Ignoré pour les autres rôles.
            </p>
          </div>

          <button
            type="submit"
            className="h-11 rounded-lg bg-brand px-4 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong lg:col-span-2 lg:w-fit lg:px-8"
          >
            Créer l’utilisateur
          </button>
        </form>
      </details>

      {/* --- Liste -------------------------------------------------------- */}
      {liste.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-grey-text shadow-card">
          Aucun profil pour l’instant.
        </p>
      ) : (
        <>
          {/* Mobile : cartes, 2 lignes d'info max (CLAUDE.md §6). Le
              rattachement au closer est porté par le dépliant, pour rester à
              deux lignes tout en restant modifiable en un geste. */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {liste.map((profil) => {
              const estMoi = profil.id === session.userId
              const courriel = courrielParId.get(profil.id)

              return (
                <li key={profil.id} className="rounded-2xl bg-white p-4 shadow-card">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-display text-base font-semibold text-navy">
                      {profil.nom_complet || 'Sans nom'}
                      {estMoi && (
                        <span className="ml-2 text-xs font-normal text-grey-text">
                          (toi)
                        </span>
                      )}
                    </p>
                    <BadgeRole role={profil.role} />
                  </div>

                  <p className="mt-0.5 flex items-center gap-2 text-sm text-grey-text">
                    <span className="truncate">{courriel ?? '—'}</span>
                    <span className="shrink-0" aria-hidden>
                      ·
                    </span>
                    <span className="shrink-0">
                      <EtatCompte actif={profil.actif} />
                    </span>
                  </p>

                  {profil.role === 'knocker' && (
                    <div className="mt-2 border-t border-grey-border pt-1">
                      <RattachementCloser
                        profil={profil}
                        options={optionsPour(profil)}
                      />
                    </div>
                  )}

                  {profil.role === 'closer' && (
                    <div className="mt-2 border-t border-grey-border pt-1">
                      <NumeroOpenPhone profil={profil} />
                    </div>
                  )}

                  {!estMoi && (
                    <div className="mt-1">
                      <ActionActif profil={profil} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {/* Desktop : tableau qui occupe la largeur. `table-fixed` + `truncate`
              garantissent qu'aucune colonne ne déborde — le scroll horizontal
              est interdit (CLAUDE.md §6). */}
          <div className="hidden overflow-hidden rounded-2xl bg-white shadow-card lg:block">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-grey-border text-left text-xs font-semibold tracking-wide text-grey-text uppercase">
                  <th scope="col" className="w-[19%] px-4 py-3">
                    Nom
                  </th>
                  <th scope="col" className="w-[23%] px-4 py-3">
                    Courriel
                  </th>
                  <th scope="col" className="w-[12%] px-4 py-3">
                    Rôle
                  </th>
                  <th scope="col" className="w-[20%] px-4 py-3">
                    Closer / SMS
                  </th>
                  <th scope="col" className="w-[10%] px-4 py-3">
                    État
                  </th>
                  <th scope="col" className="w-[16%] px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {liste.map((profil) => {
                  const estMoi = profil.id === session.userId
                  const courriel = courrielParId.get(profil.id)

                  return (
                    <tr
                      key={profil.id}
                      className="border-b border-grey-border align-top last:border-0"
                    >
                      <td className="px-4 py-3">
                        <span className="block truncate font-medium text-navy">
                          {profil.nom_complet || 'Sans nom'}
                        </span>
                        {estMoi && (
                          <span className="text-xs text-grey-text">(toi)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="block truncate text-sm text-grey-text">
                          {courriel ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <BadgeRole role={profil.role} />
                      </td>
                      <td className="px-4 py-3">
                        {profil.role === 'knocker' ? (
                          <RattachementCloser
                            profil={profil}
                            options={optionsPour(profil)}
                          />
                        ) : profil.role === 'closer' ? (
                          <NumeroOpenPhone profil={profil} />
                        ) : (
                          // Ni rattachement ni SMS pour un roofer ou un admin.
                          <span className="text-sm text-grey-text">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <EtatCompte actif={profil.actif} />
                      </td>
                      <td className="px-4 py-3">
                        {!estMoi && <ActionActif profil={profil} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-grey-text">
        Un utilisateur n’est jamais supprimé : la désactivation coupe l’accès,
        révoque la session en cours et préserve la traçabilité des leads et des
        commissions.
      </p>
    </CadrePage>
  )
}
