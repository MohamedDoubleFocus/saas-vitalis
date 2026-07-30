# CLAUDE.md — Vitalis

Règles non négociables pour ce projet. À lire avant toute contribution. Ce document décrit des **décisions produit**, pas des préférences d'implémentation — ne pas les contourner sans demande explicite.

---

## 1. Contexte

**Vitalis** est un SaaS interne (non public) pour **Toitures Vitalis** : traitement nano-silice GoNano, réfection de bardeaux d'asphalte, toits métal, gouttières. Acquisition principalement en **porte-à-porte**.

Équipe et rôles : **knocker** (prospection terrain), **closer** (rendez-vous de vente et signature), **roofer** (exécution), **admin** (supervision totale). Roulement de personnel constant chez les knockers.

Contrainte terrain forte : knockers et roofers travaillent sur leur téléphone, dehors, souvent en connexion cellulaire faible (sur un toit en LTE moyen).

**Langue : français (fr-CA) partout** — UI, libellés, noms de colonnes en base, commentaires de code, devise CAD.

---

## 2. Stack

- **Next.js 16**, App Router, TypeScript strict, dossier `src/`, alias `@/*`
- Server Components par défaut ; server actions pour les mutations
- **Tailwind CSS v4**
- **Supabase** : Postgres + Auth + Storage (`@supabase/supabase-js` + `@supabase/ssr`)
- Migrations versionnées dans `supabase/migrations/` via Supabase CLI
- **Vitest** pour la logique pure
- Déploiement Vercel

Variables d'environnement attendues (`.env.local` en local, Vercel en déploiement) :

| Variable | Portée | Usage |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + serveur | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + serveur | Clé publique, soumise à la RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **serveur uniquement** | Opérations d'administration (`auth.admin.*`, lecture des courriels dans `auth.users`) |

`SUPABASE_SERVICE_ROLE_KEY` contourne toute la RLS. Ne jamais l'exposer côté client, ne jamais la préfixer `NEXT_PUBLIC_`. Elle n'est lue que par `src/lib/supabase/admin.ts`, protégé par `import 'server-only'`.

---

## 3. Architecture — deux zones

L'app est divisée en deux zones aux contraintes opposées :

- **Zone terrain** (knocker, closer) : **PWA installable, résilience réseau légère**. Interfaces client-heavy, saisie instantanée, file d'attente d'écritures sortantes. La lecture se fait en direct — pas de cache local, pas de synchronisation bidirectionnelle. Voir §5.
- **Zone gestion** (roofer, admin) : **serveur-first**. Rendu serveur, formulaires natifs, robuste au réseau faible sans logique offline complexe.

Ne pas mélanger les deux approches dans un même écran.

---

## 4. Modèle de données — invariants

Ces décisions sont verrouillées :

1. **Une seule table centrale** (`opportunites`) porte le cycle de vie complet d'une adresse, du premier coup de porte au paiement, via un champ `statut`. Un lead, un rendez-vous et un chantier sont **le même enregistrement** à des statuts différents — jamais des tables séparées. (Raison : simplicité de la synchronisation offline — un seul objet à synchroniser par adresse.)
2. **Soft-delete des utilisateurs.** On ne supprime jamais un profil (`actif: false`). Les leads et l'historique restent rattachés au knocker qui les a créés, même après son départ. Aucun hard-delete de user.
3. **Données de commission capturées dès le jour 1**, même si le calcul vient plus tard : chaque opportunité conserve `knocker_id` (qui a cogné) et `closer_id` (qui a fermé) ; chaque volet de travail conserve son montant. Ne jamais perdre cette traçabilité.
4. **Un chantier a 1..N volets de travaux** (`opportunite_travaux`) : traitement / bardeaux / métal / gouttières, chacun avec son type et son montant. Ne pas coder un seul type de travail par chantier.
5. **Adresse structurée + GPS** (latitude/longitude via Places API) capturés dès le stade lead — débloque territoires, tri géographique et détection de doublons.
6. **Compteur de visites** (`nb_visites`, `derniere_visite`) sur l'opportunité : chaque porte cognée compte, y compris les absents. C'est la métrique de haut de funnel. Distinguer `absent` (personne n'a répondu) de `repasser` (quelqu'un a répondu, revenir).
7. **Nom du client nullable au stade lead**, obligatoire au close (validé côté serveur, pas seulement dans l'UI).
8. **Solde toujours calculé, jamais stocké** : `montant_contrat + Σ(extras facturables) − depot_recu`. Les extras non facturables sont exclus.
9. **Fenêtre cible (`date_cible_debut`/`fin`) ≠ date confirmée (`date_confirmee`)** — deux champs distincts (contrainte météo).
10. **Piste d'audit** : toute modification de date incrémente `nb_reports` et écrit une note système ; toute transition de statut écrit une note système. Les notes forment un fil chronologique, jamais écrasé.
11. **RLS d'abord** : aucune donnée visible sans session authentifiée. Toute nouvelle table active la RLS dès sa création.
12. **Photos = chemins dans un bucket privé + URL signées**, jamais d'URL publiques. Compression **côté appareil** avant l'upload.

---

## 5. Résilience réseau (zone terrain) — PWA installable

L'app est une **PWA installable** (icône sur l'écran d'accueil, mode plein écran) pour les rôles terrain. Le réseau est disponible la grande majorité du temps ; l'offline est un **filet de sécurité**, pas le mode principal. On ne construit **pas** d'architecture offline-first lourde (pas de base de données locale complète, pas de snapshots préchargés le matin, pas de synchronisation bidirectionnelle).

Exigences réelles :
- **Ne jamais perdre une saisie.** Si le réseau coupe pendant qu'un knocker enregistre un lead (ou une action terrain), la saisie est mise en **file d'attente locale** et renvoyée automatiquement dès que le réseau revient. Indicateur visuel discret de l'état (« en attente d'envoi » / « envoyé »).
- **L'app reste ouvrable sans réseau** (service worker PWA) : pas d'écran blanc si la connexion saute quelques minutes.
- **Lecture en temps réel** le reste du temps : les listes, disponibilités et vérifications (ex. détection de doublons d'adresse) se font en ligne contre la base, puisque le réseau est presque toujours là. Pas de cache local de ces données.
- Approche technique : PWA (manifest + service worker) + une petite file d'attente d'écritures (ex. IndexedDB ou équivalent léger) uniquement pour les mutations critiques. Rien de plus.

---

## 6. Design — règles UI non négociables

- **Mobile-first, sans exception.** Le style de base est celui du mobile ; le desktop s'obtient en **ajoutant** des breakpoints (`lg:`, `xl:`). Jamais l'inverse — pas de style desktop « annulé » par un `max-` sur petit écran. Layout de référence **380px** (tester à 375px). Une régression mobile n'est jamais un compromis acceptable pour gagner du desktop.
- **Largeur des conteneurs — dépend de la zone (§3)** :
  - **Zone terrain** (`/terrain/*`) : `max-w-[440px]` centré, **sans exception, aucun breakpoint**. Téléphone, dehors, une main. Élargir cette zone la casse.
  - **Zone gestion** (`/admin/*`, `/chantiers/*`) : `max-w-[440px]` puis `lg:max-w-5xl`. L'admin et le roofer travaillent aussi depuis un portable ; le seuil 1024px est le même que celui du kanban ci-dessous — une seule frontière à retenir.
  - **Écrans d'authentification** : `max-w-[440px]` quel que soit l'écran — un formulaire de connexion large ne se lit pas mieux.
  - La largeur se déclare via la prop `largeur` de `CadrePage`, **jamais en dur dans une page**.
- **Élargir n'est pas exploiter.** Un écran de la zone gestion qui affiche des listes, des tableaux ou des rapports doit **utiliser** la largeur au-delà de `lg` : tableau ou grille qui respire, plusieurs champs par rangée dans les formulaires. Une colonne centrée plus large entourée de vide est un bug de layout, pas un écran responsive. En dessous de `lg`, le même écran reste en cartes / liste verticale.
- **Pas de kanban sous 1024px** : liste verticale une colonne + onglets de filtre.
- **Pas de drag & drop.** Changement de statut par bouton.
- **Scroll horizontal interdit** sauf un rail d'onglets dédié.
- **Max 2 lignes d'info** par carte de liste ; le détail va dans la fiche.
- **Cible tactile ≥ 44px** (`h-11`).
- **Skeleton au chargement, pas de spinner.**
- Interactions **zéro-JS-client par défaut** : confirmations via un dépliant `<details>` en deux temps, pas de modale. On ne passe en Client Component que sans équivalent serveur (ex. capture/compression photo). Exception assumée : la zone terrain est client par nature (saisie instantanée, file d'attente).
- **Transitions de statut d'une seule étape** à la fois (avant ou arrière), chacune journalisée.

### Lisibilité en extérieur — non négociable

L'app se lit **dehors, au soleil, sur un téléphone tenu à bout de bras, parfois avec des gants**. C'est le cas d'usage dimensionnant, pas le confort d'un écran de bureau.

- **Plancher absolu : 14px.** Aucun texte fonctionnel ne descend en dessous, nulle part. `text-xs` **est** ce plancher — il n'existe rien sous lui dans l'échelle.
- **Corps de texte à 16px** (`text-sm`). Le `text-xs` est réservé aux métadonnées accessoires (horodatages, mentions secondaires).
- **Les valeurs qui portent l'information ressortent** : montants, dates de rendez-vous, noms de client, compteurs et scores en `text-2xl` gras. Un knocker doit lire un montant sans s'arrêter.
- **Contraste minimum AAA (7:1)** pour tout texte de la zone terrain. `grey-text` a été foncé exprès : le `#5a6b7b` d'origine ne donnait que 5,1:1 sur le fond de l'app — conforme AA, illisible sur un toit.
- Zone gestion : le même contraste s'applique, mais la densité peut être un peu plus forte (desktop, intérieur).

### Icônes

- **Une seule librairie : `lucide-react`.** Ne jamais mélanger avec des glyphes typographiques (`☏`, `➤`, `→`) : ils ne s'alignent pas, ne se colorent pas pareil et disparaissent au soleil.
- **Une notion, une icône.** Les correspondances vivent dans `src/components/icones.tsx` — statuts, rôles, champs de formulaire. Le même statut porte la même forme sur tous les écrans, sinon l'icône n'apprend rien.
- **Taille minimale 20px** (`size-5`) dans le texte, **24 à 28px** (`size-6`/`size-7`) pour la navigation et les actions principales. La cible tactile reste ≥44px, mais l'icône *visible* à l'intérieur doit être grande.
- **Jamais plus pâle que le texte voisin.** Les icônes héritent de `currentColor` : elles prennent la couleur du texte qui les entoure, donc `navy` ou `grey-text`, jamais un gris décoratif.
- **`aria-hidden` systématique** quand un libellé accompagne l'icône — sinon un lecteur d'écran annonce l'information deux fois.
- **Sobriété** : une icône qui n'aide pas à reconnaître plus vite est du bruit.

### Tokens de design
- Couleurs : `navy #111418` · `brand #54c3ea` (`brand-hover #2aa8d6`, `brand-strong #0e7ba6`) · `grey-text #3f4f60` · `grey-light #f4f6f8` · `grey-border #e2e8f0`.
- **`brand` est réservé aux actions et au statut « Confirmée »** — pas pour les statuts passifs, il perd son signal.
- Police : **Figtree** (`next/font/google`, variable `--font-figtree`), display + sans.
- Échelle typographique (définie dans `@theme`, jamais en dur dans un écran) :

| Utilitaire | Taille | Usage |
|---|---|---|
| `text-xs` | 14px | plancher — métadonnées uniquement |
| `text-sm` | 16px | corps de texte |
| `text-base` | 18px | champs de saisie, titres de carte |
| `text-lg` | 22px | titres de section |
| `text-xl` | 26px | |
| `text-2xl` | 32px | valeurs à faire ressortir |
| `text-3xl` | 40px | |

- Ombres :
  - `shadow-card` : `0 2px 4px -1px rgba(10,14,22,.06), 0 12px 28px -8px rgba(10,14,22,.16)`
  - `shadow-cta` : `0 8px 20px rgba(84,195,234,.32)`

---

## 7. Méthode de travail

- **Un module à la fois.** Ne pas anticiper les modules suivants ni créer d'écrans hors périmètre de la tâche courante.
- **Schéma et architecture validés avant de coder les écrans.** Proposer d'abord, attendre le feu vert.
- Les migrations ne sont **jamais** poussées automatiquement (`db push`) — l'utilisateur les applique manuellement après revue.
- Logique métier (solde, statuts, filtres, dates) isolée dans `src/lib` en **fonctions pures testées**, réutilisables entre les zones.
- À la fin d'une tâche : présenter les fichiers créés/modifiés et les commandes à rouler, puis **s'arrêter et attendre validation**.

---

## 8. Commandes

```
npm run dev      # serveur de développement
npm run build    # build de production
npm run lint     # linter
npm test         # tests Vitest (vitest run)
```