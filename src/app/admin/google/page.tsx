import type { Metadata } from 'next'
import { headers } from 'next/headers'

import { CadrePage } from '@/components/cadre-page'
import { exigerAdmin } from '@/lib/auth'
import { listerCalendriers, type CalendrierGoogle } from '@/lib/google/calendar'
import {
  configGoogleDisponible,
  etatConnexion,
  uriRedirection,
} from '@/lib/google/credentials'
import { formaterDateHeure, lireDate } from '@/lib/echeances'
import { createClient } from '@/lib/supabase/server'

import { associerCalendrier, deconnecterGoogle } from './actions'

export const metadata: Metadata = {
  title: 'Google Calendar — Vitalis',
}

type Props = {
  searchParams: Promise<{ error?: string; ok?: string; detail?: string; courriel?: string }>
}

const MESSAGES_ERREUR: Record<string, string> = {
  config_absente:
    'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET ne sont pas configurés côté serveur.',
  refus: 'Autorisation refusée dans Google.',
  code_absent: 'Google n’a pas renvoyé de code d’autorisation.',
  etat_invalide:
    'La vérification anti-CSRF a échoué. Relance la connexion depuis cette page.',
  echange: 'Échange des jetons impossible.',
  champs_manquants: 'Profil manquant.',
  pas_un_closer: 'Seul un closer peut recevoir un calendrier.',
  maj_impossible: 'La mise à jour a échoué.',
  deconnexion: 'La déconnexion a échoué.',
}

const MESSAGES_SUCCES: Record<string, string> = {
  connecte: 'Compte Google connecté.',
  deconnecte: 'Compte Google déconnecté.',
  associe: 'Calendrier associé.',
  dissocie: 'Calendrier retiré.',
}

const CLASSE_CHAMP =
  'h-11 w-full rounded-lg border border-grey-border bg-white px-3 text-base text-navy outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30'

/**
 * Réglages Google Calendar.
 *
 * Le jeton n'apparaît nulle part : `etatConnexion()` ne renvoie que le courriel
 * et la date de connexion. La table `google_credentials` est d'ailleurs
 * illisible depuis n'importe quelle session — seul le code serveur y accède.
 */
export default async function PageGoogle({ searchParams }: Props) {
  const { error, ok, detail, courriel } = await searchParams
  await exigerAdmin()

  const etat = await etatConnexion()

  /**
   * L'URI de redirection RÉELLE, telle que Google la recevra.
   *
   * Elle est dérivée de l'origine de la requête (`uriRedirection`), donc elle
   * change avec le port de développement, le domaine de prévisualisation Vercel,
   * le domaine de production. Une seule qui manque dans la console Google et
   * c'est `redirect_uri_mismatch` — une erreur qu'on ne peut pas diagnostiquer
   * sans savoir ce qui a été envoyé. On l'affiche donc, à copier-coller.
   */
  const entetes = await headers()
  const hote = entetes.get('x-forwarded-host') ?? entetes.get('host') ?? ''
  const protocole = entetes.get('x-forwarded-proto') ?? 'http'
  const uriACopier = hote ? uriRedirection(`${protocole}://${hote}`) : null

  // Les calendriers ne sont interrogeables qu'une fois le compte connecté.
  let calendriers: CalendrierGoogle[] = []
  let erreurCalendriers: string | null = null

  if (etat.connecte) {
    try {
      calendriers = await listerCalendriers()
    } catch (e) {
      erreurCalendriers =
        e instanceof Error ? e.message : 'Liste des calendriers indisponible.'
    }
  }

  const supabase = await createClient()

  const { data: closers } = await supabase
    .from('profiles')
    .select('id, nom_complet, google_calendar_id, actif')
    .eq('role', 'closer')
    .order('nom_complet', { ascending: true })

  const connecteLe = lireDate(etat.connecteLe)

  return (
    <CadrePage titre="Google Calendar" largeur="gestion">
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {MESSAGES_ERREUR[error] ?? 'Une erreur est survenue.'}
          {detail && <span className="mt-1 block text-xs opacity-80">{detail}</span>}
        </p>
      )}

      {ok && MESSAGES_SUCCES[ok] && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-grey-border bg-white px-3 py-2 text-sm text-grey-text"
        >
          {MESSAGES_SUCCES[ok]}
          {courriel && ` (${courriel})`}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {/* --- Connexion du compte --------------------------------------- */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-navy">
            Compte connecté
          </h2>

          {!configGoogleDisponible() ? (
            <p className="mt-2 text-sm text-red-800">
              `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` sont absents de la
              configuration serveur. Ajoute-les avant de connecter le compte.
            </p>
          ) : etat.connecte ? (
            <>
              <p className="mt-2 flex items-center gap-2 text-sm text-navy">
                <span aria-hidden className="inline-block size-2 rounded-full bg-brand" />
                {etat.courriel ?? 'Compte Google connecté'}
              </p>
              {connecteLe && (
                <p className="mt-0.5 text-xs text-grey-text">
                  Connecté le {formaterDateHeure(connecteLe)}
                </p>
              )}

              <div className="mt-3 flex flex-col gap-2 lg:flex-row">
                {/* Reconnecter écrase le jeton : utile si le compte change ou si
                    l'autorisation a été révoquée côté Google. */}
                <a
                  href="/api/auth/google"
                  className="flex min-h-11 flex-1 items-center justify-center rounded-lg border border-grey-border text-sm font-semibold text-navy transition-colors hover:bg-grey-light"
                >
                  Reconnecter
                </a>

                <details className="flex-1">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center text-sm text-grey-text hover:text-navy">
                    Déconnecter
                  </summary>
                  <form action={deconnecterGoogle} className="mt-2">
                    <p className="text-xs text-grey-text">
                      Les rendez-vous déjà créés restent dans Google. Les
                      prochains créneaux retomberont sur les horaires standards.
                    </p>
                    <button
                      type="submit"
                      className="mt-2 min-h-11 w-full rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 transition-colors hover:bg-red-100"
                    >
                      Confirmer la déconnexion
                    </button>
                  </form>
                </details>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-grey-text">
                Aucun compte connecté. Les créneaux proposés aux knockers sont
                les horaires standards, sans consultation des agendas.
              </p>
              <a
                href="/api/auth/google"
                className="mt-3 flex h-11 items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-hover active:bg-brand-strong"
              >
                Connecter Google Calendar
              </a>
              {/* Pas de courriel en dur : le compte à utiliser dépend de
                  l'organisation propriétaire du projet Google Cloud, pas du
                  code. Nommer le mauvais enverrait droit dans un 403. */}
              <p className="mt-2 text-xs text-grey-text">
                Connecte-toi avec le compte qui porte les agendas de tous les
                closers. Il doit appartenir à l’organisation propriétaire du
                projet Google Cloud, sinon Google refuse avec «&nbsp;Accès
                bloqué&nbsp;».
              </p>
            </>
          )}

          {/* Affichée dans les DEUX cas, connecté ou non : un domaine de
              production ajouté plus tard casserait la reconnexion, et l'erreur
              `redirect_uri_mismatch` ne dit jamais ce qui a été envoyé. */}
          {uriACopier && (
            <div className="mt-4 border-t border-grey-border pt-3">
              <p className="text-sm font-semibold text-navy">
                URI de redirection de cet environnement
              </p>
              <p className="mt-1 text-xs text-grey-text">
                À déclarer telle quelle dans Google Cloud Console →
                Identifiants → ton ID client OAuth → «&nbsp;URI de redirection
                autorisés&nbsp;». Correspondance exacte : ni barre oblique
                finale, ni port différent.
              </p>
              <code className="mt-2 block overflow-x-auto rounded-lg bg-grey-light px-3 py-2 text-xs break-all text-navy">
                {uriACopier}
              </code>
              <p className="mt-1 text-xs text-grey-text">
                Chaque environnement a la sienne : local, prévisualisation,
                production. Ouvre cette page depuis chacun pour relever la
                bonne. Laisse «&nbsp;Origines JavaScript autorisées&nbsp;» vide
                — le flux est entièrement serveur.
              </p>
            </div>
          )}
        </section>

        {/* --- Association calendrier ↔ closer ---------------------------- */}
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-display text-base font-semibold text-navy">
            Calendrier de chaque closer
          </h2>
          <p className="mt-0.5 text-xs text-grey-text">
            Un closer sans calendrier reçoit les horaires standards : ses
            rendez-vous ne seront pas créés dans Google.
          </p>

          {erreurCalendriers && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {erreurCalendriers}
            </p>
          )}

          {(closers ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-grey-text">
              Aucun closer. Crée-en un dans « Utilisateurs ».
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
              {(closers ?? []).map((closer) => {
                // Le calendrier associé n'est plus dans la liste (droits
                // retirés, calendrier supprimé) : on l'ajoute quand même en
                // option, sinon l'enregistrement le retirerait en silence.
                const options = closer.google_calendar_id &&
                  !calendriers.some((c) => c.id === closer.google_calendar_id)
                  ? [
                      {
                        id: closer.google_calendar_id,
                        nom: `${closer.google_calendar_id} (inaccessible)`,
                        principal: false,
                      },
                      ...calendriers,
                    ]
                  : calendriers

                return (
                  <li
                    key={closer.id}
                    className="rounded-lg border border-grey-border p-3"
                  >
                    <p className="font-medium text-navy">
                      {closer.nom_complet || 'Sans nom'}
                      {!closer.actif && (
                        <span className="ml-2 text-xs font-normal text-grey-text">
                          (désactivé)
                        </span>
                      )}
                    </p>

                    <form
                      action={associerCalendrier}
                      className="mt-2 flex flex-col gap-2"
                    >
                      <input type="hidden" name="profil_id" value={closer.id} />

                      <label className="sr-only" htmlFor={`cal-${closer.id}`}>
                        Calendrier de {closer.nom_complet ?? 'ce closer'}
                      </label>

                      {etat.connecte && calendriers.length > 0 ? (
                        <select
                          id={`cal-${closer.id}`}
                          name="google_calendar_id"
                          defaultValue={closer.google_calendar_id ?? ''}
                          className={CLASSE_CHAMP}
                        >
                          <option value="">— Aucun —</option>
                          {options.map((calendrier) => (
                            <option key={calendrier.id} value={calendrier.id}>
                              {calendrier.nom}
                              {calendrier.principal ? ' (principal)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        // Repli : sans liste disponible, on garde la saisie
                        // manuelle plutôt que de bloquer la configuration.
                        <input
                          id={`cal-${closer.id}`}
                          name="google_calendar_id"
                          type="text"
                          defaultValue={closer.google_calendar_id ?? ''}
                          placeholder="identifiant@group.calendar.google.com"
                          autoComplete="off"
                          spellCheck={false}
                          className={CLASSE_CHAMP}
                        />
                      )}

                      <button
                        type="submit"
                        className="min-h-11 rounded-lg border border-grey-border px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-grey-light"
                      >
                        Enregistrer
                      </button>
                    </form>
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
