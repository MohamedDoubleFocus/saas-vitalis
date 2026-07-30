'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { executer } from './executeurs'
import {
  ajouter,
  classerErreur,
  contientCle as fileContientCle,
  creerMutation,
  echouees as fileEchouees,
  enAttente as fileEnAttente,
  marquerEchec,
  messageErreur,
  prochaine,
  reinitialiser,
  retirer,
  type Mutation,
  type TypeMutation,
} from './file'
import { chargerFile, sauverFile } from './stockage'

type ContexteFile = {
  /** La file persistée a fini d'être relue. */
  pret: boolean
  enLigne: boolean
  enAttente: Mutation[]
  echouees: Mutation[]
  /** Met une écriture en file et tente immédiatement de l'envoyer. */
  envoyer: (type: TypeMutation, charge: unknown) => Promise<void>
  /** Relance l'envoi de la file (retour du réseau, retour dans l'app). */
  drainer: () => Promise<void>
  /** Remet une mutation abandonnée dans le circuit. */
  reessayer: (id: string) => Promise<void>
  /** Vrai si une écriture concernant cette clé de fusion attend encore. */
  contientCle: (cle: string) => boolean
}

const Contexte = createContext<ContexteFile | null>(null)

function nouvelId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function estEnLigne(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

/**
 * File d'attente d'écritures sortantes (CLAUDE.md §5).
 *
 * À placer au-dessus des écrans terrain (`src/app/terrain/layout.tsx`). Les
 * composants clients descendants consomment `useFileAttente()`.
 *
 * Ce n'est **pas** un cache de lecture ni une synchronisation : rien ne descend
 * du serveur, les listes se lisent en direct.
 */
export function FournisseurFileAttente({
  children,
}: {
  children: React.ReactNode
}) {
  const [file, setFile] = useState<Mutation[]>([])
  const [pret, setPret] = useState(false)
  const [enLigne, setEnLigne] = useState(true)

  // La boucle de vidage lit la file via une ref : elle doit voir l'état à
  // l'instant présent, pas celui capturé à la création de la closure.
  const refFile = useRef<Mutation[]>([])
  const refDrainageEnCours = useRef(false)

  const majFile = useCallback((suivante: Mutation[]) => {
    refFile.current = suivante
    setFile(suivante)
    // Persistance en tâche de fond : ne jamais faire attendre l'interface.
    void sauverFile(suivante)
  }, [])

  const drainer = useCallback(async () => {
    // Un seul vidage à la fois, sinon deux déclencheurs concurrents (retour du
    // réseau + nouvel envoi) enverraient la même mutation deux fois.
    if (refDrainageEnCours.current) return
    if (!estEnLigne()) return

    refDrainageEnCours.current = true

    try {
      for (;;) {
        const mutation = prochaine(refFile.current)

        if (!mutation) break

        try {
          await executer(mutation)
          majFile(retirer(refFile.current, mutation.id))
        } catch (erreur) {
          if (classerErreur(erreur, estEnLigne()) === 'reseau') {
            // Rien n'est parti : on garde la mutation intacte, sans consommer de
            // tentative, et on s'arrête. L'événement `online` relancera.
            break
          }

          majFile(marquerEchec(refFile.current, mutation.id, messageErreur(erreur)))
        }
      }
    } finally {
      refDrainageEnCours.current = false
    }
  }, [majFile])

  const envoyer = useCallback(
    async (type: TypeMutation, charge: unknown) => {
      const mutation = creerMutation(type, charge, nouvelId(), Date.now())

      majFile(ajouter(refFile.current, mutation))
      await drainer()
    },
    [drainer, majFile],
  )

  const reessayer = useCallback(
    async (id: string) => {
      majFile(reinitialiser(refFile.current, id))
      await drainer()
    },
    [drainer, majFile],
  )

  // Relecture de la file persistée, puis première tentative d'envoi : une
  // saisie faite avant la fermeture de l'app repart d'elle-même.
  useEffect(() => {
    let annule = false

    void (async () => {
      const stockee = await chargerFile()

      if (annule) return

      refFile.current = stockee
      setFile(stockee)
      setEnLigne(estEnLigne())
      setPret(true)

      void drainer()
    })()

    return () => {
      annule = true
    }
  }, [drainer])

  useEffect(() => {
    const auRetour = () => {
      setEnLigne(true)
      void drainer()
    }

    const auDepart = () => setEnLigne(false)

    // `navigator.onLine` peut mentir (portail captif, wifi sans Internet) :
    // c'est pourquoi `drainer` traite aussi l'échec de `fetch`. Ces événements
    // ne sont qu'un déclencheur opportuniste.
    const auRetourVisible = () => {
      if (document.visibilityState === 'visible') {
        setEnLigne(estEnLigne())
        void drainer()
      }
    }

    window.addEventListener('online', auRetour)
    window.addEventListener('offline', auDepart)
    document.addEventListener('visibilitychange', auRetourVisible)

    return () => {
      window.removeEventListener('online', auRetour)
      window.removeEventListener('offline', auDepart)
      document.removeEventListener('visibilitychange', auRetourVisible)
    }
  }, [drainer])

  const valeur = useMemo<ContexteFile>(
    () => ({
      pret,
      enLigne,
      enAttente: fileEnAttente(file),
      echouees: fileEchouees(file),
      envoyer,
      drainer,
      reessayer,
      contientCle: (cle: string) => fileContientCle(file, cle),
    }),
    [pret, enLigne, file, envoyer, drainer, reessayer],
  )

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

export function useFileAttente(): ContexteFile {
  const contexte = useContext(Contexte)

  if (!contexte) {
    throw new Error(
      'useFileAttente doit être utilisé sous <FournisseurFileAttente> (voir src/app/terrain/layout.tsx).',
    )
  }

  return contexte
}
