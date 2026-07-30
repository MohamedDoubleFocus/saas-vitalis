import type { Mutation } from './file'

/**
 * Persistance de la file dans IndexedDB.
 *
 * Pourquoi IndexedDB et pas `localStorage` : `localStorage` est synchrone et
 * bloque le fil principal — inacceptable sur un téléphone d'entrée de gamme — et
 * certains navigateurs le purgent plus agressivement.
 *
 * La file entière est stockée sous UNE clé, en miroir du modèle de `file.ts` (un
 * tableau). Les volumes sont minuscules (quelques dizaines d'entrées au pire) et
 * ça évite toute logique de curseur. Contrepartie assumée : deux onglets ouverts
 * simultanément peuvent s'écraser l'un l'autre. La zone terrain s'utilise en PWA
 * plein écran, à un seul onglet.
 *
 * Tout échec est silencieux et non bloquant : en navigation privée ou avec le
 * stockage désactivé, la file fonctionne en mémoire seule. On perd la reprise
 * après fermeture de l'app, pas la saisie en cours.
 */

const NOM_BASE = 'vitalis-file-attente'
const VERSION_BASE = 1
const MAGASIN = 'etat'
const CLE = 'mutations'

function indexedDbDisponible(): boolean {
  return typeof indexedDB !== 'undefined'
}

function ouvrir(): Promise<IDBDatabase | null> {
  return new Promise((resoudre) => {
    if (!indexedDbDisponible()) {
      resoudre(null)
      return
    }

    let requete: IDBOpenDBRequest

    try {
      requete = indexedDB.open(NOM_BASE, VERSION_BASE)
    } catch {
      resoudre(null)
      return
    }

    requete.onupgradeneeded = () => {
      const base = requete.result

      if (!base.objectStoreNames.contains(MAGASIN)) {
        base.createObjectStore(MAGASIN)
      }
    }

    requete.onsuccess = () => resoudre(requete.result)
    requete.onerror = () => resoudre(null)
    // Une autre version de l'app détient la base : ne pas rester suspendu.
    requete.onblocked = () => resoudre(null)
  })
}

export async function chargerFile(): Promise<Mutation[]> {
  const base = await ouvrir()

  if (!base) return []

  try {
    return await new Promise<Mutation[]>((resoudre) => {
      const transaction = base.transaction(MAGASIN, 'readonly')
      const requete = transaction.objectStore(MAGASIN).get(CLE)

      requete.onsuccess = () => {
        const valeur = requete.result
        resoudre(Array.isArray(valeur) ? (valeur as Mutation[]) : [])
      }
      requete.onerror = () => resoudre([])
    })
  } catch {
    return []
  } finally {
    base.close()
  }
}

export async function sauverFile(file: Mutation[]): Promise<void> {
  const base = await ouvrir()

  if (!base) return

  try {
    await new Promise<void>((resoudre) => {
      const transaction = base.transaction(MAGASIN, 'readwrite')
      // `structuredClone` implicite d'IndexedDB : la charge doit être
      // sérialisable. Elle l'est — ce sont des objets JSON simples.
      transaction.objectStore(MAGASIN).put(file, CLE)

      transaction.oncomplete = () => resoudre()
      transaction.onerror = () => resoudre()
      transaction.onabort = () => resoudre()
    })
  } catch {
    // Quota dépassé, stockage refusé : on continue en mémoire.
  } finally {
    base.close()
  }
}
