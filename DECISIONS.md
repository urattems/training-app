# DECISIONS.md — Carnet d'entraînement

Journal des décisions techniques. Ordre de priorité en cas de conflit : `SPEC.md` > `CLAUDE.md` > ce fichier.
Chaque entrée indique le jalon où elle a été prise.

---

## J0 — Environnement constaté

- Windows 11, PowerShell. Node v22.23.1, npm 10.9.8, git 2.55.0.
- Dépôt git initialisé (branche `master`, aucun commit avant le J0).
- Contenu initial : `CLAUDE.md`, `SPEC.md`, `START_PROMPT.md`, `examples/` (2 fixtures contractuelles), `.claude/settings.json`.

---

## J0 — Stack

| Domaine | Choix | Raison |
|---|---|---|
| UI | React 19 + TypeScript strict (`strict`, `noUncheckedIndexedAccess`) | Stack recommandée (SPEC §3) |
| Build | Vite | Rapide, PWA via plugin officiel |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`, precache) | Hors ligne complet (SPEC §9) |
| Persistance | Dexie 4 + `dexie-react-hooks` (`useLiveQuery`) | IndexedDB typé, transactions, versions, UI réactive |
| Validation | Zod 4 | Validation de tout JSON entrant (SPEC §10) |
| Routage | React Router 7 en **HashRouter** | Voir « Hébergement » |
| Graphiques | Recharts | Recommandé ; carte de détail contrôlée (pas de tooltip natif) |
| Icônes | Lucide | Recommandé |
| Styles | CSS Modules + variables CSS centralisées (`src/styles/tokens.css`) | Natif Vite, pas de framework CSS, thème sombre = second jeu de tokens (J8) |
| Tests | Vitest + jsdom + Testing Library + `fake-indexeddb` | Services testés sur une vraie base Dexie en mémoire |
| Lint | ESLint 9 (flat config), `typescript-eslint` strict, `react-hooks` | |

Scripts npm : `dev`, `build`, `preview`, `test`, `typecheck`, `lint`, tous compatibles Windows.
State : état local React + hooks/services sur Dexie. Pas de Redux.

**À vérifier au J1** : compatibilité Recharts / React 19 et API exacte de Zod 4 (`error` / `errorMap`, unions discriminées). Tout écart sera documenté ici.

---

## J0 — Architecture

```
src/
  app/        App, routes, providers (DB, settings), Shell + TabBar, ErrorBoundary
  components/ composants UI réutilisables (Button, Card, NumberField, SensationPicker, Dialog, EmptyState…)
  features/   home/ program/ workout/ exercise/ history/ progress/ settings/ import/
  domain/     types + règles pures (snapshot, prochaine séance, « Comme prévu », volume,
              records, séries de graphiques, texte de progression, validation de valeurs)
  schemas/    schémas Zod, invariants §10.5, chaîne de migrations schemaVersion, messages d'erreur FR
  db/         Dexie, DB_VERSION, migrations DB
  services/   program, workout, history, export, import, statistics, settings
  hooks/  utils/  styles/  i18n/ (strings.ts)
```

- Le JSX n'appelle que des hooks et des services. Toute la logique métier est en fonctions pures testées.
- Pipeline unique : JSON externe → Zod → modèle domaine → IndexedDB → modèle domaine → export.
- Le modèle domaine est aligné sur le contrat JSON §11 : pas de format parallèle. Les seuls champs internes (`importedAt`, `archivedAt`) sont retirés à l'export.

### Types : une seule source de vérité (validé par l'utilisateur)
- Tout ce qui appartient au contrat JSON (§11) a ses types TypeScript **dérivés des schémas Zod** via `z.infer`. Il n'y a aucune interface écrite à la main en double.
- Les champs internes (`importedAt`, `archivedAt`) **étendent** ces types dérivés (ex. `type StoredProgram = TrainingProgram & { importedAt: string; archivedAt: string | null }`).
- `domain/types.ts` réexporte les types dérivés sous leurs noms métier (`TrainingProgram`, `WorkoutSession`, `ActualSet`…) et y ajoute les types purement internes.

---

## J0 — Base IndexedDB (Dexie)

- **Nom de base unique : `training-app-db`.** L'origine GitHub Pages (`<user>.github.io`) est partagée entre tous les dépôts de l'utilisateur, donc un nom générique risquerait une collision.
- `DB_VERSION = 1`. Les évolutions futures passent par `db.version(n).stores(...).upgrade(...)`.
- Stores :
  - `programs: '&programId'` : programme complet validé + `importedAt` + `archivedAt|null`. **Aucun index sur `archivedAt`**, parce que `null` n'est pas indexable dans IndexedDB.
  - `workouts: '&id, status, date, programId'` : un document par séance (exercices + cardio), dans la forme du contrat d'export.
  - `settings: '&key'` : `activeProgramId`, `preferences`, `lastExportAt`.
  - `metadata: '&key'` : métadonnées techniques, dont `preRestoreBackup`.
- **Programme actif = `settings.activeProgramId`** : c'est la seule source de vérité. `archivedAt` n'est qu'informatif.
- Invariants tenus en transaction `rw` :
  - une seule séance `in_progress`, vérifiée dans la transaction de démarrage ;
  - import de programme : archivage de l'ancien + insertion + activation du nouveau, en une transaction ;
  - restauration : voir « Restauration ».
- Autosave : chaque modification met à jour le document workout (debounce d'environ 300 ms), avec un flush au `blur`, sur `visibilitychange` (hidden) et sur `pagehide`.
- `navigator.storage.persist()` est appelé au démarrage (J5), en silence s'il est refusé.

---

## J0 — Validation, import, export, restauration

- Les schémas Zod reproduisent exactement SPEC §11 :
  - exclusivité `targetReps` / `targetRepsMin + targetRepsMax` ;
  - `setNumber` unique par exercice ;
  - champs nullables obligatoires (`.nullable()`, pas `.optional()`) ;
  - seul `preferences` est optionnel, avec des valeurs par défaut.
- Pipeline d'entrée :
  1. lecture du fichier ;
  2. `JSON.parse` ;
  3. lecture de `schemaVersion` et de `type` ;
  4. migration, ou refus d'une version future ou inconnue ;
  5. `safeParse` ;
  6. invariants §10.5 ;
  7. prévisualisation ;
  8. écriture.

  Tout échec refuse le fichier **en bloc**, et rien n'est écrit.
- Messages d'erreur humains en français, à partir du chemin Zod (« la séance A contient un exercice sans identifiant »). Le détail technique est derrière « Afficher les détails ».
- **Migrations de schéma** : registre `{ from, to, migrate }` + runner générique. En V1, le registre est vide (seule la `1.0` existe). Le runner est testé avec une migration factice définie dans les tests, sans code mort dans `src`.
- **Import d'un `programId` déjà présent** (actif ou archivé) : **refusé**, avec le message « Un programme avec l'identifiant "…" existe déjà. Demande au coach un nouvel identifiant. » (décision utilisateur, J0).
- **Export** : `training-backup-YYYY-MM-DD.json`. On tente `navigator.canShare({ files })` puis `navigator.share`, avec un repli par téléchargement (`<a download>`). `lastExportAt` est mémorisé.

### Restauration : écart assumé vs SPEC §10.3 (validé par l'utilisateur)
- SPEC §10.3 demande un « export automatique des données actuelles avant remplacement ». Sur iOS, la feuille de partage (`navigator.share`) exige un **geste utilisateur direct**. Un partage déclenché automatiquement après des opérations asynchrones (lecture du fichier, validation) n'est pas fiable, et peut être refusé.
- Le mécanisme retenu remplace l'export automatique et protège au moins autant :
  1. **Bouton obligatoire « Exporter mes données actuelles »** dans l'écran de confirmation. Le bouton « Restaurer » reste inactif tant que cet export n'a pas été déclenché.
  2. **`preRestoreBackup`** : une copie interne complète des données actuelles (au format `training_history_export`) est écrite dans `metadata`.
- Tout se fait dans **une seule transaction `rw`** sur toutes les tables, dans cet ordre :
  1. lecture des données actuelles ;
  2. `clear` ;
  3. écriture de `preRestoreBackup` **après** le clear, pour qu'elle y survive ;
  4. `bulkPut` des données restaurées.

  Un échec annule tout.

---

## J0 — Hébergement : GitHub Pages (décision utilisateur)

- Le service worker exige HTTPS. GitHub Pages ne sert que les fichiers statiques : les données restent sur l'iPhone.
- Vite `base: '/training-app/'`, surchargeable par `VITE_BASE` (dev local à `/`).
- **HashRouter** : sur GitHub Pages, une route profonde rechargée renvoie une 404. Les routes de la SPEC deviennent `/#/workout/:id`, etc., ce qui reste fiable hors ligne et en standalone, sans hack `404.html`.
- `start_url` et `scope` du manifest sont réglés sur la base.
- Le déploiement est préparé au J6. Le push est fait par l'utilisateur (`git push` interdit à Claude par les réglages).
- **iOS : le stockage de la PWA installée (écran d'accueil) est séparé de celui de Safari.** Il faut donc installer l'app d'abord, puis importer le programme depuis l'app installée. Des données saisies dans Safari ne sont pas visibles dans la PWA. Cette consigne sera mise dans le README.

---

## J0 — Interprétations métier

1. **Clé de progression = `programExerciseId`**, agrégée sur tous les programmes (le même `chest-press-machine` existe en semaines 37 et 40). Si le coach change d'id, l'historique de l'exercice se scinde : c'est un risque assumé, à documenter dans `JSON_SCHEMA.md`.
2. `exerciseId` et `programExerciseId` sont tous deux stockés. Pour un exercice issu du programme, `exerciseId = programExerciseId` (comme dans les fixtures).
3. **Exercice sans aucune charge réelle** (ex. gainage) : le graphique de Progression bascule sur `getExerciseRepHistory` (meilleure série en reps par séance), avec le libellé « Répétitions max » (décision utilisateur). Dès qu'une charge réelle existe, c'est le graphique de charge.
4. **Statistiques** :
   - les charges, le volume, les records et les points de graphique utilisent **toutes les données réelles**, séances `abandoned` incluses ;
   - le « nombre de séances » ne compte que les séances `completed` ;
   - les séances `in_progress` sont exclues partout ;
   - les séries extra comptent ;
   - les séries dont les reps ou la charge sont `null` sont ignorées.
5. **Cardio** :
   - `cardioRecords[]` accepte plusieurs entrées ;
   - la durée est saisie en minutes et stockée en secondes ;
   - l'objectif cardio du programme est affiché mais **pas snapshotté**, car le contrat §11.2 n'a pas de champ pour cela et `SPEC.md` n'est pas modifié.
6. **Dates** :
   - `date` = date **locale** `YYYY-MM-DD` du démarrage ;
   - les horodatages sont en ISO 8601 avec l'offset local, via un utilitaire dédié (`toISOString()` produit du `Z`) ;
   - `durationSec = completedAt − startedAt`.
7. **Statut d'exercice** : `pending` passe à `completed` à la validation. Une modification ultérieure le laisse `completed` (rien n'est verrouillé).
8. **Prochaine séance** : rotation après la dernière séance `completed` du programme actif. Les séances abandonnées ne font pas avancer la rotation.
9. **Séries** : une série prescrite non faite est stockée avec `null`. `actualSets` peut être vide pour un exercice `pending` (fixture `w-0003`).
10. **Mise à jour de l'app (service worker)** : `registerType: 'prompt'`. La bannière « Nouvelle version » n'est **jamais affichée pendant une séance `in_progress`** : aucun rechargement ne doit interrompre une saisie (à vérifier au J6).

---

## J0 — Risques suivis

- Saisie décimale iOS (virgule selon la locale) : le parseur accepte `,` et `.`. À vérifier sur un appareil réel.
- Autofocus / passage au champ suivant : non fiable en PWA iOS, donc non implémenté par défaut (SPEC §7.5).
- Recharts au toucher : la carte de détail est pilotée par l'état React, sans animation, avec des séries mémoïsées. La fluidité sur plusieurs années de données sera vérifiée au J4.
- Purge d'IndexedDB par Safari : atténuée par `persist()` et le rappel d'export, sans garantie absolue.
- Web Share de fichiers en standalone : le repli par téléchargement est obligatoire et testé.

---

## J1 — Versions réelles des bibliothèques (écarts vs plan J0)

Versions vérifiées sur npm le 2026-10-01 :

| Lib | Prévu J0 | Retenu | Raison |
|---|---|---|---|
| TypeScript | « strict » (non versionné) | **6.0.3** (`~6.0.3`) | La dernière est la 7.0.2, mais `typescript-eslint` 8.71 exige `typescript <6.1.0`. On reste sur 6.0.x jusqu'à son support. |
| Vite | Vite | 8.3.2 | Dernière ; `@vitejs/plugin-react` 6 exige Vite 8. |
| Vitest | Vitest | 5.0.3 | Compatible Vite 8. |
| ESLint | 9 (flat config) | **10.11** | Dernière ; flat config via `defineConfig` de `eslint/config`. |
| React Router | 7 | **8.4** (installé au J2) | Dernière majeure ; exige React ≥ 19.2.7 (on a 19.3). HashRouter toujours disponible, à vérifier au J2. |
| Zod | 4 | 4.6.5 | API utilisée : `z.iso.datetime({ offset: true })`, `z.iso.date()`, `z.int()`, `superRefine`, `.default(() => …)`. Issues lues via `z.core.$ZodIssue` (`invalid_type`, `too_small`, `invalid_value`, `invalid_format`, `custom`). |
| Dexie | 4 | 4.4.6 | — |
| Recharts | 3 | 3.10.1 (installé au J4) | `peerDependencies` : React `^19.0.0` OK. Vérification fonctionnelle au J4. |

Dépendances installées **au jalon qui les utilise** (pas de dépendance morte) : React Router, `dexie-react-hooks`, Lucide, Testing Library et jsdom pour les tests UI (J2/J3), Recharts (J4), `vite-plugin-pwa` (J6). `jsdom` est déjà installé en dev (Vitest l'utilisera par fichier avec `// @vitest-environment jsdom`). Les tests J1 tournent en environnement `node`, avec `fake-indexeddb`.

`src/main.tsx` est un point d'entrée minimal (nom de l'app seulement), nécessaire pour que `vite build` fonctionne. Le shell arrive au J2.

## J1 — Contrat JSON : précisions d'implémentation

- **Clés inconnues** : ignorées (comportement par défaut de Zod), donc retirées à la relecture. Le contrat reste ouvert aux ajouts du coach sans casser l'import.
- **Forme des reps** : `targetReps` OU `targetRepsMin + targetRepsMax`. Un `null` sur la forme non utilisée est toléré et traité comme absent ; la série est normalisée à la forme du contrat. Une plage inversée (min > max) est refusée.
- **Unicité vérifiée par le schéma** :
  - `setNumber` dans un exercice (objectifs et séries réalisées) ;
  - `id` d'exercice dans une séance ;
  - `id` de séance dans un programme ;
  - `programExerciseId` dans une séance réalisée.
  Un même `id` d'exercice dans deux séances différentes reste autorisé (même exercice, même progression).
- **`executionOrder`** : sans doublon, et chaque id doit correspondre à un exercice de la séance.
- `targetDurationMin` (cardio programmé) : nombre ≥ 0 ou `null`.
- **Messages d'erreur** :
  - champ manquant dans un élément de liste → « la séance A contient un exercice sans identifiant » ;
  - autres cas → « la série 1 de l'exercice « Chest Press » de la séance A : charge cible invalide (nombre attendu) » ;
  - seule la première erreur est détaillée, avec « (et N autres erreurs) » ; les détails techniques sont dans `details`.
- Les types TypeScript du contrat sont tous `z.infer` (`src/schemas/*.schema.ts`), réexportés par `src/domain/types.ts`. Seul `StoredProgram` étend `TrainingProgram` (`importedAt`, `archivedAt`).

## J1 — Règles métier : précisions d'implémentation

- **Séries réalisées** : `actualSets` démarre **vide**. Une série n'est créée qu'à la première saisie de l'utilisateur sur cette ligne (ou via « Comme prévu » / « + Série »). L'UI affiche les lignes à partir des `targetSets`.
- **Ordre réel** : un exercice entre dans `executionOrder` à la première action de l'utilisateur sur lui (saisie, Comme prévu, + Série, sensation, commentaire, validation). Le cardio n'y figure pas (contrat : liste de `programExerciseId`).
- **Série « réalisée »** (stats, graphiques, records) : `actualReps` renseigné et > 0. Une charge sans reps n'est pas une charge utilisée.
- **Records** :
  - meilleure charge = charge max réelle ;
  - meilleure série à charge donnée = reps max pour chaque charge ;
  - meilleure série globale = la plus lourde, puis la plus longue à égalité ;
  - volume max par séance.
- **« Nombre de séances » d'un exercice** : séances `completed` où il a au moins une série réalisée.
- **Abandon** : `completedAt` et `durationSec` restent `null`.
- **Persistance des modifications** : toute modification passe par `updateWorkout(id, fonctionPure)`, une transaction qui **revalide la séance avec le schéma du contrat** avant écriture. Aucune donnée invalide n'atteint la base, et une séance terminée ou abandonnée ne peut pas repasser `in_progress`.
- **Restauration** :
  - `lastExportAt` de l'appareil est conservé ;
  - le programme actif de la sauvegarde a `archivedAt: null`, les autres reçoivent la date de restauration.
- **Ordre des programmes à l'export** : par date d'import. Après une restauration, tous ont la même date d'import, donc l'ordre de `programs[]` n'est pas garanti (sans incidence : c'est un ensemble).

## J1 — Outillage

- `.gitattributes` : `* text=auto eol=lf`, pour des fins de ligne stables sous Windows.
- Les fixtures `examples/` sont protégées par un test d'empreinte SHA-256 (`src/test/fixtures.ts`) : toute modification fait échouer la suite.

---

## J2 — Routage : HashRouter avec React Router 8

- React Router 8.4 exporte toujours `HashRouter` (ainsi que `createHashRouter`). On garde le **mode déclaratif** : `<HashRouter>` + `<Routes>`. Les data routers (loaders/actions) n'apportent rien ici, les données venant de Dexie via `useLiveQuery`.
- Vérifié :
  - en tests jsdom : `window.location.hash` vaut `#/program`, `#/progress`, etc. après navigation ; une route inconnue mène à « Page introuvable » ;
  - dans un vrai navigateur : build de production servi sous `/training-app/` par `vite preview`, Edge headless ; les URL `#/…` fonctionnent et le rechargement conserve l'état.
- `vite.config.ts` : la base `/training-app/` s'applique au build **et** à `vite preview` (`isPreview`), qui sinon servait la base `/`.

## J2 — Design system

- Pas de dossier `design/` : la référence visuelle est SPEC §8.
- **Tous les styles passent par `src/styles/tokens.css`** :
  - couleurs, surfaces, texte, accent pastel bleu-gris, couleurs fonctionnelles douces ;
  - rayons, ombres, espacements, typographie, tailles tactiles, transitions, safe areas, plans.
  - Vérifié par recherche : aucune couleur hexadécimale ni `rgb()` hors de `tokens.css`. Seule exception : la balise `<meta name="theme-color">` de `index.html`, qui exige une valeur littérale (elle sera aussi dans le manifest au J6).
- **Action principale = bouton plein charbon**, plus premium et plus lisible au soleil qu'un pastel. L'accent pastel sert à la sélection (onglet actif) et aux liens/actions secondaires.
- **Styles** : CSS Modules (`*.module.css`, noms en camelCase), plus `styles/base.css` pour le reset et les éléments globaux.
- **Barre basse** : flottante, décollée du bas (`safe-area-inset-bottom` + marge), arrondie, 3 onglets. La roue crantée Paramètres est en haut de l'accueil. La barre est masquée sur `/workout/:id/exercise/:id`, règle déjà en place pour le J3.
- **Feuilles modales** : composant `Sheet` maison (`role="dialog"`, `aria-modal`, focus, Échap, défilement du fond bloqué), plutôt que `<dialog>`, dont `showModal()` n'est pas géré par jsdom.
- **Mouvement** : `prefers-reduced-motion` ramène les durées à 0 et coupe les animations d'entrée.
- **Cibles tactiles** : `--tap-min: 44px`. Vérifié à 390 × 844 px : aucun bouton ni lien sous 44 px, aucun défilement horizontal, sur tous les écrans du J2.

## J2 — Import de programme (UI)

- L'état du flux d'import vit dans `ImportProgramProvider`, au niveau de l'app. À l'import, l'accueil passe de « Bienvenue » au programme actif : une feuille rattachée à l'écran de bienvenue serait démontée et la confirmation perdue.
- **Prévisualisation** : nom, semaine, nombre de séances, nombre d'exercices. Si un programme est déjà actif : « Le programme actuel « X » sera archivé ». Puis Annuler / Importer. Rien n'est écrit avant « Importer ».
- **Champs ignorés** : ligne discrète « Champs ignorés : … » avec les noms des clés du JSON absentes du contrat (`findIgnoredFields`, différence entre JSON brut et résultat validé). Une clé à `null` n'est pas signalée : aucune information n'est perdue.
- **Erreur** : feuille titrée « Fichier refusé ». Le message suit le format de la SPEC (« Import impossible : … ») ; « Afficher les détails » dévoile les détails techniques. Le titre initialement prévu, « Import impossible », doublait le début du message et a été remplacé.
- **Premier lancement** : rappel discret qu'il faut installer l'app sur l'écran d'accueil avant d'importer (stockage de la PWA séparé de Safari).

## J2 — Contenu provisoire des écrans (sans fonctionnalité factice)

- **Accueil** : carte « Programme actif » (nom, semaine, nb de séances, lien vers Programme). La carte « Prochaine séance » et « Commencer » arrivent au J3 : on n'affiche pas de bouton qui ne fait rien.
- **Programme** : séances et exercices numérotés en lecture seule. Le détail tappable et le lancement arrivent au J3.
- **Progression** : état vide explicatif. Le graphique arrive au J4.
- **Paramètres** : Importer un programme, nom de l'app, version (lue depuis `package.json` au build via `__APP_VERSION__`). Export, restauration et préférences arrivent au J5.
- **Tests** : `jsdom` par fichier (`// @vitest-environment jsdom`) ; `@testing-library/react`, `user-event` et `jest-dom`. Le chemin des fixtures est résolu depuis la racine du projet, car `import.meta.url` n'est pas un chemin disque sous jsdom.
- **Taille du bundle** : 479 kB, soit 151 kB gzip (React, React Router, Dexie, Zod). Acceptable pour une PWA mise en cache ; à revoir au J7 si besoin (découpage par route).

---

## J3a — Ajustements UI demandés après le J2

- **Roue crantée** sur la même ligne que le titre « Aujourd'hui ». Le gabarit `Page` place l'action (`trailing`) à droite du titre. La ligne de retour n'existe que sur les écrans qui ont un lien de retour.
- **Dégagement bas des pages** : un seul token `--tabbar-clearance` (hauteur de la barre + décalage `--tabbar-offset` + safe area). Le Shell l'expose via `--page-bottom-clearance` quand la barre est visible, et `Page` l'ajoute à son padding bas (+ `--space-6`).
- Vérifié à 390 × 844 : une fois défilé tout en bas, le dernier élément se termine 24 px au-dessus de la barre sur tous les écrans.

## J3a — Accueil, programme, séance

- **Accueil** (SPEC §7.2) :
  - séance en cours → carte prioritaire « Séance X en cours » (heure de début, progression, Reprendre, Abandonner). La carte « Prochaine séance » est alors masquée : on ne peut pas en démarrer une autre ;
  - sinon → « Prochaine séance » (rotation), nombre d'exercices, durée estimée, gros bouton « Commencer la séance », lien « Choisir une autre séance » vers Programme ;
  - « Dernière séance » : nom, date, durée, statut (Terminée / Abandonnée). Pas encore de lien : le détail historique arrive au J4 ;
  - « Progression récente » : variations de charge factuelles (« +2,5 kg »), masquée s'il n'y en a pas.
  - La carte provisoire « Programme actif » du J2 disparaît. Le test UI J2 qui la vérifiait a été adapté au nouvel accueil (prochaine séance « Séance A ») : changement de comportement voulu, pas d'affaiblissement.
- **Démarrage** : `StartWorkoutButton` (accueil, liste et détail du programme). Si une séance est déjà en cours, une feuille propose Reprendre / Abandonner au lieu de démarrer (SPEC §6).
- **Programme** :
  - chaque séance a un en-tête tappable vers `/program/:sessionId` et un bouton « Commencer » ;
  - chaque exercice est tappable vers `/program/:sessionId?exercise=<id>` : le détail défile jusqu'à l'exercice et le met en évidence.
- **Détail** (`/program/:sessionId`) : pour chaque exercice, OBJECTIF (une ligne par série), repos, « Dernière fois » (dernière performance réelle, séances abandonnées incluses, séance en cours exclue), notes ; puis le cardio prévu. La SPEC ne définit pas de route par exercice : le détail est groupé par séance.
- **Bloc OBJECTIF** (`TargetSets`) : fond grisé, bordure pointillée, texte secondaire, icône cible, jamais de champ. Le RÉALISÉ (J3b) aura des champs pleins sur fond blanc : les deux ne peuvent pas être confondus.
- **Formats** :
  - objectif « 12 × 47 kg » / « 8–12 × 55 kg » / « 45 reps » (sans charge) ;
  - performance « 45 kg · 10 / 10 / 9 » (charge unique), « 45 / 40 reps » (sans charge), « 12 × 45 kg · 10 × 47 kg » (charges différentes).
- **Écran séance** (`/workout/:id`, SPEC §7.3b) :
  - progression « 2 / 6 » avec barre, exercices dans l'ordre du programme avec statut (À faire / Validé) et « n / N séries saisies », chaque ligne menant à l'écran exercice (route du J3b) ;
  - section Cardio (objectif du programme, entrées saisies ; la saisie arrive au J3b) ;
  - pied collant toujours visible au-dessus de la barre : « Terminer la séance » et « Abandonner ».
- **Terminer** : confirmation « N exercices non validés — Terminer quand même ? » s'il en reste, sinon fin directe ; retour à l'accueil.
- **Abandonner** : toujours confirmé, données conservées.
- Une séance terminée ou abandonnée ouverte par son URL `/workout/:id` affiche son statut, sans action (consultation au J4 via `/history/:id`).
- **La barre basse reste visible sur l'écran séance** : la SPEC ne la masque que sur l'écran exercice.
- **Tests** : `scrollIntoView` est simulé dans le setup (jsdom ne l'implémente pas). Les lectures réactives (`useLiveQuery`) se mettent à jour à des moments légèrement différents : les tests UI attendent l'état final (`findBy…`, `waitFor`).

---

## J3b — Écran exercice (SPEC §7.4)

- **Route** `/workout/:workoutId/exercise/:exerciseId`, sans barre basse (règle du Shell).
- **Header** : ← précédent · « Exercice 2 sur 6 » · → suivant · bouton « Liste » (retour à l'écran séance), puis une barre de progression discrète (exercices validés / total).
- **Ordre vertical** : nom, catégorie · équipement, « Dernière fois », OBJECTIF, RÉALISÉ, sensation, commentaire, repos recommandé, « Valider l'exercice ».
  - Catégorie et équipement ne font pas partie du snapshot du contrat (§11.2) : ils sont lus dans le programme d'origine de la séance, toujours conservé (archivé).
- **Valider l'exercice** :
  - écrit les saisies en attente, passe l'exercice en `completed`, puis ouvre directement l'exercice suivant (ordre du programme) ;
  - après le dernier, retour à l'écran séance (cardio, Terminer) ;
  - rien n'est verrouillé : un exercice validé reste modifiable.
- **Écran exercice d'une séance qui n'est plus en cours** : message et retour. L'édition rétroactive passera par l'historique (J4). Les écrans d'erreur ont leur propre titre principal (`h1`).

## J3b — RÉALISÉ et fiabilité de la saisie

- **Une ligne par série** (prescrites, puis extra) :
  - en-tête « Série n » (+ badge « en plus ») et bouton « Comme prévu » ;
  - deux champs [reps] [kg] dessous, sur toute la largeur : saisie à une main, champs de 48 px.
- **« + Série »** : uniquement en bas de liste.
- **Champs vides au départ**, objectif en placeholder gris (« 12 », « 8–12 », « 47 »). Charge `null` → pas de placeholder.
- **« Comme prévu »** :
  - remplit uniquement les cibles exactes ;
  - masqué si rien n'est remplissable ;
  - ligne partiellement remplissable (plage de reps) → le focus passe au champ restant, dans le geste de l'utilisateur, donc fiable sur iOS.
- **Brouillon local par champ** (`NumberField`, `TextField`) :
  - le texte tapé n'est jamais réécrit pendant la saisie (« 47, » et « 47. » restent affichés tels quels) ;
  - chaque valeur valide est persistée après un court délai (350 ms), et tout de suite au blur ;
  - au blur, « 47, » devient 47 (affiché « 47 ») ;
  - une saisie invalide (« 4,7,5 ») n'est jamais écrite : le champ la garde avec un message, et l'écriture en attente d'une valeur intermédiaire (« 4,7 ») est annulée ;
  - un champ en erreur ne se resynchronise jamais sur la base ;
  - un champ suit les changements de valeur venant de la base (ex. « Comme prévu ») uniquement hors saisie, et jamais l'écart avec son propre brouillon (sinon il clignoterait vers l'ancienne valeur juste après un blur).
- **Effacer un champ** → `null`, la série reste (une valeur `null` = série non faite).
- **Un simple passage dans un champ vide n'écrit rien** : pas de série vide créée, et l'exercice n'entre pas dans `executionOrder`.
- **Enregistrement** (`useWorkoutAutosave`) :
  - chaque champ planifie une mise à jour fonctionnelle de la séance, appliquée sur l'état le plus récent en base dans une transaction : deux champs modifiés coup sur coup ne s'écrasent pas ;
  - écriture immédiate au blur, à `visibilitychange` (hidden), à `pagehide` et au démontage. Le démontage passe par un effet de layout, synchrone, pour que l'écriture parte avant toute autre chose ;
  - une erreur d'écriture s'affiche (bandeau), sans perdre la saisie à l'écran.
- **Démarrer une séance** : l'état « séance en cours » est lu au moment du tap. Avant, le bouton restait désactivé pendant le chargement, et un tap précoce était ignoré sans retour.

## J3b — Sensation, commentaire, cardio

- **Sensation** : 5 boutons à bascule (`aria-pressed`). Retoucher le choix actif le désélectionne (`null`). Pas de `radiogroup`, qui ne permet pas de tout désélectionner.
- **Commentaire** : zone de texte à brouillon local ; vide ou espaces → `null`.
- **Cardio réel** (écran séance) :
  - « Ajouter du cardio » → choix explicite du type (Tapis, Vélo, Elliptique, Rameur, Autre) : aucun type par défaut supposé ;
  - puis nom, durée en minutes (décimales acceptées, stockée en secondes arrondies), vitesse (km/h), inclinaison (refusée au-delà de 100 %), notes. Tous optionnels sauf le type ;
  - **suppression d'une entrée cardio** (`removeCardioEntry`), toujours confirmée : sans elle, une entrée ajoutée par erreur resterait dans l'historique. Ajout minimal, justifié par la règle « aucune donnée parasite, aucune suppression silencieuse ».
- **Écran séance** : « n / N séries saisies » ne compte que les séries prescrites ; les séries en plus sont affichées à part (« · +1 en plus »).

## J3b — Pièges iOS

- **Zoom au focus** : `--font-size-input: 17px` pour tous les champs (≥ 16 px). Vérifié dans le navigateur : 17 px calculés.
- **Clavier** : à la prise de focus, le champ est recentré (`scrollIntoView`, après 300 ms pour laisser le clavier s'ouvrir). Aucun bouton fixe sur l'écran exercice : « Valider l'exercice » est dans le flux de la page (vérifié : `position: static`) et reste atteignable en défilant, clavier ouvert.
- **Double-tap** : `touch-action: manipulation` sur boutons, liens et champs (`base.css`).
- **Pas d'autofocus** à l'ouverture d'un écran. Le seul focus programmatique est celui de « Comme prévu », déclenché par un tap.
- **Claviers** : `inputmode="numeric"` (+ `pattern="[0-9]*"`) pour les reps, `inputmode="decimal"` pour charge, durée, vitesse et inclinaison. Toujours `type="text"`, car `type="number"` gère mal la virgule sur iOS.

## J3b — Tests

- Scénarios 2, 3 et 4 de la SPEC en tests UI, avec fermeture et réouverture de la base IndexedDB.
- **Scénario 3** : la « fermeture de l'app » est simulée comme sur iPhone, par `pagehide`. Le test vérifie que l'écriture part tout de suite (moins de 150 ms, avant le délai de 350 ms), puis ferme et rouvre la base. La première version fermait la connexion IndexedDB par programme au milieu d'une écriture, ce qui ne peut pas arriver dans l'app : la simulation a été corrigée.
- **Deux attentes de tests écrits pendant ce jalon ont été ajustées**, et le code a été durci pour les deux :
  - pendant la frappe de « 47, », la valeur valide précédente (47) est persistée, conformément à la règle « persistance dès qu'une valeur est valide » ;
  - pour « 4,7,5 », l'assertion stricte d'origine (rien d'écrit) a été rétablie après correction du code (annulation de l'écriture intermédiaire).
- Les shims jsdom `scrollIntoView` et `matchMedia` sont dans le setup de test.

---

## fix-3b — Contexte non sécurisé (HTTP sur IP locale)

- **Bug constaté sur iPhone** (Safari, `http://192.168.1.169:4173`) : « Commencer la séance » → erreur inattendue.
  - Cause confirmée : `crypto.randomUUID` n'existe qu'en contexte sécurisé (HTTPS ou `localhost`). Sur une IP locale en HTTP, l'appel lève une `TypeError`.
  - Les tests (Node) et `localhost` exposent `randomUUID` : le cas n'était pas couvert.
- **Règle** : l'app DOIT fonctionner en HTTP local, pour les tests sur iPhone. Les API réservées aux contextes sécurisés ne s'utilisent qu'avec une détection de fonctionnalité et un repli silencieux.
- **Inventaire au fix-3b** :
  - `crypto.randomUUID` (identifiants de séance) → `createId()` (`src/utils/ids.ts`) : `randomUUID` s'il existe, sinon UUID v4 via `crypto.getRandomValues` (disponible partout), sinon `Math.random` en dernier recours ;
  - `navigator.share` / `canShare` (export) → détection, `canShare` protégé contre les exceptions, repli par téléchargement ;
  - `navigator.storage.persist` (J5), `navigator.serviceWorker` (J6) : pas encore utilisés, ils suivront la même règle ;
  - `navigator.clipboard` : non utilisé.
- **Débogage sur iPhone** : chaque feuille ou bandeau d'erreur propose « Afficher les détails » avec le nom et le message techniques de l'erreur (et sa cause). Concerne le démarrage, l'abandon, la fin de séance (qui n'avait pas de `catch`) et l'enregistrement automatique. L'erreur est aussi écrite dans la console.
- **Tests** :
  - absence de `randomUUID` simulée (`vi.stubGlobal`) : création d'identifiants, démarrage par le service et par l'interface ;
  - Web Share absent, et `canShare` qui lève une exception ;
  - détails techniques dans la feuille d'erreur ;
  - les tests de démarrage échouent sur l'ancien code (vérifié), donc ils couvrent bien la régression.

---

## J4a — Historique (SPEC §7.7)

- **`/history`** : toutes les séances en ordre chronologique inverse (date, puis heure de début) — nom, date, durée, statut (badge).
  - Une séance en cours y figure (« En cours ») et mène à l'écran séance pour la reprendre.
  - État vide explicite.
- **Accès sans 4e onglet** :
  - carte « Dernière séance » de l'accueil, désormais cliquable (vers son détail), avec un lien « Voir l'historique » ;
  - icône Historique à droite du titre des onglets Programme et Progression (même place que la roue crantée de l'accueil).
- **`/history/:workoutId`** :
  - date, heure de début, durée, statut, ordre d'exécution réel ;
  - puis, pour chaque exercice (ordre du programme) : OBJECTIF (snapshot, bloc pointillé grisé), RÉALISÉ (bloc à liseré d'accent ; séries extra marquées « en plus », séries vides « non faite »), sensation, commentaire ;
  - puis cardio et notes de séance.
- **Édition rétroactive** :
  - **lecture seule par défaut**, mode « Modifier » explicite : pas de modification accidentelle en consultant l'historique ;
  - en mode édition, mêmes éditeurs que l'écran exercice (`ActualSets`, `SensationPicker`, `TextField`), donc mêmes règles (brouillon par champ, « 47, » jamais perdu, persistance dès qu'une valeur est valide, flush au blur / arrière-plan / démontage) ;
  - date éditable par le sélecteur natif ; date invalide refusée avec message ;
  - les objectifs snapshot restent en lecture seule (aucune fonction du domaine n'y écrit) ;
  - retour clair : « Mode édition : chaque modification est enregistrée automatiquement », puis « Enregistré à HH:MM » après chaque écriture réussie (`savedAt` du hook d'enregistrement) ;
  - le cardio d'une séance passée reste en lecture seule (hors du périmètre d'édition de la SPEC : date, séries, sensation, commentaire) ;
  - une séance en cours ne s'édite pas depuis l'historique : bouton « Reprendre la séance ».
- **Suppression** : bouton « Supprimer la séance » en bas du détail, puis confirmation explicite (« … sera définitivement supprimée … Les statistiques seront recalculées »). Les saisies en attente sont écrites avant la suppression. Retour à l'historique.
- **Statistiques** : recalculées à la lecture (`useLiveQuery`), donc immédiatement à jour après édition ou suppression (testé).
- **Progression récente de l'accueil** : variations factuelles de charge (« Chest Press +0,5 kg »), mise en place au J3a, vérifiée ici sur `history-example.json`.
- **Accessibilité** : `ActualSets` et `SensationPicker` utilisent des identifiants uniques (`useId`), car ils sont affichés plusieurs fois sur une même page de détail.

## fix-4a — Changement de date et horodatages

- **Écart trouvé** : `setWorkoutDate` ne modifiait que `date`. `startedAt` et `completedAt` restaient sur l'ancien jour, d'où une séance incohérente (et un tri de l'historique faussé, qui utilise l'heure de début en second critère).
- **Règle** : changer la date décale `startedAt` et `completedAt` du même nombre de jours calendaires. L'heure murale reste telle qu'écrite (18:10 reste 18:10), avec l'offset local du nouveau jour (heure d'été / d'hiver).
  - Une séance à cheval sur minuit garde sa fin le lendemain de son début.
  - `completedAt: null` reste `null` (séance abandonnée).
  - `durationSec`, durée réellement mesurée, n'est pas modifiée.
- Tests : domaine (offset du nouveau jour, passage de minuit, séance abandonnée) et écran historique (de bout en bout).

---

## J4b — Progression (SPEC §7.8)

- **Écran** : sélecteur d'exercice (`<select>` natif, roue iOS, 17 px), puis sélecteur de période, graphique, carte de détail, stats, historique récent.
  - Routes `/progress` (exercice le plus récemment travaillé) et `/progress/:exerciseId`.
  - La période est dans l'URL (`?periode=1M|3M|6M|1A|all`, défaut 3M) : elle se conserve en changeant d'exercice.
- **Graphique** (Recharts) :
  - points + ligne, minimaliste, sans animation (`isAnimationActive={false}`), sans tooltip Recharts ;
  - **axe X en vraie échelle temporelle** : `type="number"`, `scale="time"`, une date = un timestamp. Domaine = [début de période, aujourd'hui] pour 1M à 1A, [premier, dernier point] pour « Tout » (± 7 jours autour d'un point unique). 4 graduations régulières ;
  - marge de 14 px de chaque côté, et pas d'`allowDataOverflow` (il masquait à moitié les points en bord de domaine) ;
  - axe Y à pas « rond » (1, 2, 2,5, 5 × 10ⁿ), domaine aligné sur le pas, graduations régulières, jamais négatif ;
  - couleurs par classes CSS et tokens (pas d'attribut de couleur codé en dur) ;
  - largeur mesurée par `ResizeObserver` (`useElementWidth`), plutôt que `ResponsiveContainer` qui ne rend rien tant que la taille est inconnue (et jamais sous jsdom).
- **Point tactile → carte de détail** :
  - chaque point est un bouton SVG (`role="button"`, zone tactile de 44 px, focus clavier, `aria-label` « mardi 22 septembre : 47,5 kg ») ;
  - le toucher sélectionne la séance ; la **carte** (date, exercice, charge max, chaque série, lien « Voir la séance ») est rendue hors du graphique, pilotée par l'état React ;
  - retoucher le point ou « Fermer » la masque ;
  - vérifié dans un vrai navigateur avec un toucher (`tap`), pas seulement un clic.
- **Exercice sans charge réelle** : graphique des répétitions max, titre « Répétitions max par séance » et mention « Aucune charge enregistrée… le graphique suit les répétitions ». Stats adaptées (dernières reps max, record de reps, pas de volume).
- **États vides** :
  - aucune séance → message, pas de graphique ;
  - période sans séance → « Aucune séance réalisée sur cette période. », pas de graphique vide ;
  - un seul point → graphique affiché normalement.
- **Stats hiérarchisées** :
  - dernière charge (+ variation factuelle « +0,5 kg vs séance précédente ») ;
  - record (meilleure charge, avec sa date) ;
  - volume de la dernière séance (+ max) ;
  - nombre de séances terminées ;
  - meilleure série.
  - Les stats portent sur **tout l'historique réel** ; la période ne change que le graphique.
- **Règles de calcul** (rappel J0, inchangées) : charge, volume et records sur toutes les données réelles, séances abandonnées incluses ; « nombre de séances » = `completed` uniquement ; `in_progress` exclues partout.
- **Historique récent** : les 5 dernières séances où l'exercice a des séries réalisées (date, performance, badge « Abandonnée »), vers le détail historique.
- **Performance** :
  - séries mémoïsées (`useMemo` sur séances et exercice, puis sur la période), composant graphique mémoïsé ;
  - testé avec 3 ans de données générées (468 séances) : calcul des séries < 250 ms, onglet affiché avec tous les points sur « Tout ».

## J4b — Recharts et React 19

- Recharts 3.10.1 déclare `react`, `react-dom` et `react-is` (`^16.8 … ^19`) en peer dependencies : React 19 est supporté officiellement.
- **Piège trouvé** : npm avait résolu `react-is` en 17.0.2 (version tirée par Testing Library). `react-is` 17 ne reconnaît pas les éléments React 19. **`react-is@^19.3.0` est installé explicitement** ; Recharts utilise bien la 19.3.0 (`npm ls react-is`).
- **Code splitting** : `ProgressPage` est chargée par `React.lazy` (+ `Suspense`). Recharts n'est que dans ce chunk : `ProgressPage-*.js` ≈ 318 kB (95 kB gzip), le bundle initial n'en contient rien. Vérifié dans le navigateur : le chunk n'est téléchargé qu'à l'ouverture de l'onglet Progression.

## J4b — Données de démo (mode dev uniquement)

- Section « Développement » dans Paramètres, présente seulement si `import.meta.env.DEV` : bouton « Charger les données de démo », avec confirmation.
- Elle charge `examples/history-example.json` (lecture seule, import `?raw`) via le **vrai pipeline de restauration** : validation, invariants, `preRestoreBackup`.
- **Absente du build de production** : l'import dynamique est conditionné à `import.meta.env.DEV` (remplacé par `false` au build, donc supprimé). Ses libellés vivent dans le module dev lui-même. Vérifié : aucune occurrence du module, des libellés ni des données dans `dist/`.
- **Commande pour tester sur iPhone** : `npm run dev -- --host`, puis ouvrir `http://<IP-du-PC>:5173/` dans Safari → roue crantée → Développement → « Charger les données de démo ». Port différent de la preview (4173) : autre origine, donc **autre base IndexedDB**, et les données de preview ne sont pas touchées.

## J4b — Tests

- Domaine : série temporelle (positions réelles), périodes, point unique, série vide, métrique reps, graduations X, axe Y à pas rond.
- UI :
  - états vides (aucune séance, période vide) ;
  - exercice par défaut ;
  - périodes (points recalculés, période dans l'URL) ;
  - point tactile → carte (contenu, sélection, autre point, fermeture) ;
  - stats (séances terminées seulement) ;
  - changement d'exercice ;
  - édition puis suppression → graphique et stats recalculés ;
  - exercice sans charge ;
  - 3 ans de données ;
  - chargeur de démo.
- Seul `Date` est simulé (`vi.useFakeTimers({ toFake: ['Date'] })`, « aujourd'hui » = 20/10/2026) pour des périodes déterministes.
- Le module différé est préchauffé une fois (`beforeAll`) : sous jsdom, la première compilation de Recharts prend plusieurs secondes et faisait expirer la première attente du fichier. Aucune assertion n'a été modifiée.

---

## J5 — Paramètres (SPEC §7.10)

- **Données** : Exporter mes données · Restaurer une sauvegarde · Importer un programme.
- **Préférences** : unité « Kilogrammes (kg) » et thème « Clair », en lecture seule. Pas de sélecteur avant le J8.
- **Informations** : application, version, « Stockage persistant : oui / non / indisponible ».

## J5 — Export (SPEC §10.2)

- **Préparé à l'avance** :
  - le JSON `training_history_export` et le `File` sont construits dès l'ouverture des Paramètres (`usePreparedExport`) et reconstruits automatiquement si les données changent (lecture réactive) ;
  - au toucher, `deliverPreparedExport` appelle `navigator.share` **de façon synchrone dans le geste** (aucune attente avant), comme l'exige Safari iOS. Vérifié par un test (`share` déjà appelé avant toute attente).
- **Autotest d'intégrité** (`verifyExportIntegrity`) : le JSON généré est relu avec les **mêmes** schémas et invariants que la restauration, puis comparé aux données d'origine (sérialisation canonique, clés triées). En cas d'échec, l'export est bloqué avec un message et des détails : jamais de fichier non restaurable.
- **Remise** : Web Share si `canShare({ files })` (protégé contre les exceptions), sinon téléchargement par `<a download>` avec une URL blob révoquée après 10 s. Une annulation du partage n'écrit rien ; un autre refus du partage bascule sur le téléchargement.
- **`lastExportAt`** : écrit **uniquement** si le partage ou le téléchargement a été déclenché sans erreur. Valeur = `exportedAt` du fichier, l'instant de l'instantané des données : une séance terminée après lui n'est pas dans le fichier, ce qui est la référence juste pour le rappel. Rien n'est écrit en cas d'annulation, d'échec du téléchargement ou d'échec de l'autotest (testé).
- **Nom du fichier** : `training-backup-AAAA-MM-JJ.json`. `exportedAt` = moment de la préparation.
- **Contexte non sécurisé** (HTTP sur IP locale, tests iPhone) : `navigator.share` y est **absent**, donc le **téléchargement est le chemin réellement utilisé et testé**.
  - Tests unitaires : partage absent, `canShare` qui plante, échec du téléchargement.
  - Navigateur réel servi sur l'IP locale (`isSecureContext: false`, ni `share` ni `storage` ni `randomUUID`) : fichier téléchargé, valide et restaurable.
  - Le vrai Web Share ne sera testable qu'en HTTPS (GitHub Pages, J6).

## J5 — Restauration (SPEC §10.3, §10.5)

- **Flux** : choix du fichier → lecture → validation Zod + invariants §10.5 → résumé (date d'export, version du schéma, nombre de programmes, nombre de séances) → avertissement « Toutes les données actuelles… seront remplacées ».
  - **Étape 1 — « Exporter mes données actuelles »**, obligatoire : « Restaurer » reste désactivé, avec la raison affichée, tant que cet export n'a pas été déclenché sans erreur (une annulation ne compte pas).
  - **Étape 2 — « Restaurer »** : une seule transaction (vidage, puis `preRestoreBackup` écrit après le vidage, puis données restaurées) ; tout échec annule l'ensemble.
- **Écart assumé (J0, validé)** : bouton d'export obligatoire au lieu d'un « export automatique », car la feuille de partage iOS exige un geste.
- **Précision** : si la base actuelle est **vide** (aucun programme, aucune séance, ex. nouvel iPhone), il n'y a rien à perdre. Le message « Aucune donnée actuelle : rien à sauvegarder » s'affiche et « Restaurer » est actif directement. La copie interne est faite dans tous les cas.
- **Refus en bloc**, messages français, rien n'est écrit : JSON illisible, programme à la place d'une sauvegarde, version de schéma non prise en charge, plusieurs séances en cours, `activeProgramId` inconnu, identifiants de séance ou de programme en double. Les détails techniques sont disponibles (« Afficher les détails »).
- **Échec pendant la restauration** : feuille « Restauration impossible — Aucune donnée n'a été modifiée » + détails techniques.

## J5 — Rappel d'export (SPEC §7.10)

- **Règle pure** `getExportReminder(workouts, lastExportAt, now)` :
  - au moins une séance `completed` terminée après le dernier export (ou jamais exporté) ;
  - ET dernier export il y a plus de 14 jours (15 jours et plus) ;
  - jamais si une séance est `in_progress`.
- **Bandeau discret** sur l'accueil, ton neutre (« Tes séances ne sont enregistrées que sur cet appareil… », « Dernier export il y a N jours… »), lien « Exporter » vers les Paramètres. Aucun message alarmiste.

## J5 — Stockage persistant (SPEC §9)

- `navigator.storage.persist()` est demandé **une fois au démarrage** (`ensurePersistentStorage`, promesse partagée) :
  - détection de fonctionnalité ; API absente (contexte non sécurisé) → « indisponible » ;
  - déjà persistant → pas de nouvelle demande ;
  - toute erreur est absorbée (→ « indisponible »).
- Aucun message à l'utilisateur, aucune promesse de garantie. Le statut est affiché discrètement dans Informations, après la fin de la demande.

---

## J6 — PWA (SPEC §9)

- **vite-plugin-pwa 1.3.0** (Workbox 7.4.1), mode `generateSW`.
- **Manifest** (`src/pwa/manifest.ts`, partagé par `vite.config.ts` et les tests) :
  - nom « Carnet d'entraînement », nom court « Carnet », `display: standalone`, `orientation: portrait`, `lang: fr` ;
  - `id`, `start_url` et `scope` = la base `/training-app/` ;
  - `background_color` et `theme_color` **lus dans `tokens.css`** (`--color-bg`), jamais recopiés ;
  - `<meta name="theme-color">` d'`index.html` : valeur littérale obligatoire, dont l'égalité avec le token est vérifiée par test.
- **Icônes** : `npm run icons` (`scripts/generate-icons.mjs`) les génère **localement, sans service ni dépendance externe** : rasterisation JS avec suréchantillonnage 4×4 et encodeur PNG maison (`zlib`), couleurs lues dans les tokens. Haltère stylisé charbon sur crème.
  - Produits : `icon-192`, `icon-512`, `maskable-512` (contenu dans la zone de sécurité), `apple-touch-icon` 180 (sans transparence), `favicon.svg`, `favicon-32.png`.
  - Fichiers versionnés dans `public/`. Plus aucune erreur 404 de favicon.
- **Balises iOS** (`index.html`) : `apple-touch-icon`, `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style: default`, `viewport-fit=cover`. Les liens passent par `%BASE_URL%` (réécrits en `/training-app/…` au build).
- **Service worker** :
  - `registerType: 'prompt'`, enregistré par l'app (`useRegisterSW`, `injectRegister: false`) ;
  - precache de **tous** les assets du build (`globPatterns` js, css, html, svg, png, webmanifest), **chunk Progression/Recharts compris** : 20 entrées, environ 915 Kio ;
  - `navigateFallback: index.html` (HashRouter : seule `index.html` est demandée en navigation) ;
  - `cleanupOutdatedCaches`.
- **Le service worker ne touche jamais à IndexedDB** : aucun `runtimeCaching`, donc pas de plugin d'expiration (le seul composant Workbox qui utilise IndexedDB). Il n'utilise que Cache Storage. Vérifié : aucune occurrence d'`indexedDB` dans `sw.js` ni dans `workbox-*.js`.
- **Contexte non sécurisé** (HTTP sur IP locale) : pas de service worker, donc ni hors ligne ni mise à jour proposée. L'enregistrement est simplement ignoré (`useRegisterSW` teste la présence de `serviceWorker`).
- **Plugin PWA désactivé sous Vitest** : inutile en test, et coûteux en transformations. Le module virtuel `virtual:pwa-register/react` est remplacé par un **stub pilotable** (`src/test/pwaRegisterStub.ts`).

## J6 — Mise à jour (bannière)

- Règle pure `shouldShowUpdateBanner` : version en attente ET aucune séance `in_progress` (état chargé) ET pas « Plus tard ». Pendant une séance, la bannière **attend la fin de la séance**.
- **Jamais de rechargement automatique** : seul « Mettre à jour » appelle `updateServiceWorker(true)` (activation puis rechargement). « Plus tard » masque la bannière jusqu'au prochain lancement.
- **Vérification périodique** (toutes les heures, si en ligne) pour une PWA iOS qui reste ouverte longtemps.
- **Build affiché** dans Informations (`__APP_BUILD__`, date du build, surchargeable par `APP_BUILD_ID`) : permet de savoir quelle version est en cache sur l'iPhone. Chaque build produit un nouveau service worker.

## J6 — Vérification réelle (Edge headless, build de production sur localhost = contexte sécurisé)

- Service worker actif, scope `/training-app/`, precache rempli (chunk Progression compris), 0 erreur console.
- **Réseau coupé** (`setOfflineMode`), puis rechargement :
  - l'app s'affiche (page contrôlée par le service worker) et les **données sont toujours là** ;
  - rechargement hors ligne sur une **route profonde** `#/history/<id>` : détail affiché ;
  - onglet Progression (chunk différé) : graphique affiché ;
  - **séance démarrée, saisie et terminée hors ligne** ;
  - **export** hors ligne : fichier téléchargé ;
  - nouveau rechargement hors ligne : les données sont toujours là.
- **Mise à jour** : build B publié pendant une séance en cours → service worker B en attente, **bannière masquée** ; séance terminée → bannière affichée ; « Mettre à jour » → le build B est bien en service.

## J6 — États d'erreur (SPEC §7.9)

- **Base locale indisponible** : `isDatabaseError` reconnaît les erreurs Dexie et IndexedDB, y compris emballées (`inner`, `cause`) : `OpenFailedError`, `MissingAPIError`, `QuotaExceededError`, etc. Écran dédié « Base de données locale indisponible » (mention de la navigation privée) + rechargement + détails.
- **Erreur inattendue** : filet de sécurité global, message rassurant (« Tes données enregistrées ne sont pas perdues »), « Recharger l'app », et désormais **« Afficher les détails »** (nom et message techniques).
- **Déjà couverts aux jalons précédents** : JSON invalide, fichier illisible, schéma incompatible (import et restauration), export impossible (J5), états de chargement visibles.

## J6 — Déploiement

- `.github/workflows/deploy.yml` : à chaque push sur `main` (ou manuellement), `npm ci`, typecheck, lint, tests, build (base par défaut `/training-app/`), puis publication via les actions officielles.
  - Versions majeures vérifiées le 2026-10-02 : `checkout@v7`, `setup-node@v7`, `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`.
  - **Aucun push effectué** : la procédure pas à pas est dans le README (renommer `master` en `main`, remote, push, Pages en source « GitHub Actions », installation sur l'iPhone puis import).
- **Dépôt public** recommandé : GitHub Pages gratuit, et le dépôt ne contient que le code, pas les données.

## J6 — Taille du bundle (build de production)

| Fichier | Brut | gzip |
|---|---|---|
| `index-*.js` (app : React, React Router, Dexie, Zod, écrans) | 556,7 kB | 172,5 kB |
| `ProgressPage-*.js` (différé : Progression + Recharts) | 317,8 kB | 94,7 kB |
| `workbox-window` | 5,7 kB | 2,2 kB |
| CSS app + Progression | 36,8 + 5,4 kB | 6,2 + 1,4 kB |
| **Precache total du service worker** | **≈ 915 Kio (20 entrées)** | — |

- Le chargement initial (environ 179 kB gzip) n'inclut pas Recharts.
- Vite signale que `index` dépasse 500 kB brut. Acceptable pour une PWA mise en cache après la première visite ; à revoir au J7 (découpage par route) si utile.

## J6 — Tests

- Manifest (champs, base, couleurs des tokens, icônes présentes aux bonnes dimensions), balises iOS et liens d'`index.html`, workflow de déploiement.
- Bannière : règle (5 cas) + comportement (affichée, « Plus tard », jamais pendant une séance, mise à jour seulement au toucher).
- Filet d'erreur : erreur inattendue avec détails, base indisponible (y compris emballée), lecture IndexedDB en échec dans l'app.
- **Stabilité** : la page Progression (différée) est préchauffée une fois par fichier de tests jsdom dans le setup commun. Sa compilation à froid faisait expirer, de façon intermittente, les deux anciens tests qui ouvrent l'onglet. Aucune assertion n'a été modifiée.

---

## fix-6 — Fuseau horaire des tests, CI épinglée

- **Échec en CI** : `Settings.test.tsx` attendait « jeudi 1 octobre à 18:45 », le runner (UTC) affichait « 16:45 ». L'app est correcte : elle affiche l'heure locale de l'appareil. C'est le test qui supposait Europe/Paris.
- **Reproduction et inventaire**, en lançant Vitest depuis Node avec chaque fuseau. Sous Git Bash, une valeur `TZ=America/Los_Angeles` est convertie comme un chemin et ignorée : seul `UTC` y était réellement testé.
  - UTC et America/Los_Angeles : 1 échec (heure d'export dans le résumé de restauration) ;
  - Pacific/Kiritimati (UTC+14) : 2 échecs (+ rappel « il y a 40 jours », qui bascule d'un jour).
- **Correctif** : `src/test/globalSetup.ts` (Vitest `globalSetup`) pose `TZ=Europe/Paris` dans le processus principal **avant** la création des workers, qui en héritent. Un garde-fou dans `setup.ts` fait échouer la suite si le fuseau effectif n'est pas Europe/Paris.
  - Vérifié : 250/250 sans `TZ`, avec `TZ=UTC` forcé (Bash et PowerShell `$env:TZ="UTC"`), avec `TZ=America/Los_Angeles` et avec `TZ=Pacific/Kiritimati` forcés.
  - **Aucune assertion ni valeur attendue modifiée.**
- **Code de production** : aucun fuseau codé en dur.
  - Les dates métier `YYYY-MM-DD` sont traitées en calendrier pur (`Date.UTC`, formateurs `timeZone: 'UTC'` sur des dates construites en UTC), donc correctes dans tout fuseau.
  - Les heures sont affichées dans le fuseau de l'appareil, et les horodatages écrits avec son offset local.
- **Incohérence trouvée par la revue et corrigée** : pour la date d'un export (Paramètres, résumé de restauration), le **jour** était lu tel qu'écrit dans le fichier et l'**heure** convertie au fuseau de l'appareil. Près de minuit, avec un appareil dans un autre fuseau que l'export, le jour affiché pouvait être faux (« 1 octobre à 01:30 » au lieu de « 2 octobre à 01:30 »). `formatDateTime(iso)` tire désormais jour et heure du même instant local (testé).
- **Fichiers en CRLF dans la copie de travail locale** : après la réécriture de l'historique par rebase (2026-10-02 17:02), les 7 fichiers du commit jalon-0 (dont les fixtures) avaient été extraits en CRLF (`core.autocrlf=true`, commits antérieurs au `.gitattributes`). Les tests d'empreinte SHA-256 échouaient en local, pas en CI (clone Linux neuf en LF). Ils ont été ré-extraits depuis l'index : contenu versionné inchangé, LF conforme à `.gitattributes`, empreintes d'origine retrouvées. Aucune modification versionnée.
- **CI** : `runs-on: ubuntu-24.04` au lieu de `ubuntu-latest` (qui migre vers Ubuntu 26 le 19/10/2026 ; vérifié par test). Versions d'actions revérifiées le 2026-10-02 et toujours à jour : `checkout@v7`, `setup-node@v7`, `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`.

---

## J7 — Finitions (aucun changement du format JSON)

### Nettoyage des saisies
- **Règle** : à **chaque enregistrement** (`updateWorkout` → `sanitizeWorkoutTexts`, puis revalidation du contrat), les espaces de début et de fin sont retirés et une chaîne vide devient `null`. Concerne les commentaires d'exercice, les notes de séance et les notes de cardio.
- **Nom de cardio** : trimé, mais une chaîne vide reste `""`. Ce champ est `string` **non nullable** dans le contrat (§11.2) ; le passer à `null` changerait le format, ce qui est exclu.
- Pendant la frappe, le brouillon du champ n'est pas réécrit : la valeur trimée s'affiche après le blur. Les comparaisons de l'enregistrement automatique portent sur la valeur trimée, donc un espace final ne déclenche pas d'écriture.
- Les données **importées ou restaurées** ne sont pas retouchées : la règle s'applique à l'enregistrement par l'app.

### Avertissement à « Valider l'exercice »
- **Règle pure** `findIncompleteSets` : série **prescrite** avec une charge sans répétitions, ou des répétitions sans charge **alors qu'une charge est prévue**.
  - Une série au poids du corps (charge prévue `null`) avec des reps seules est complète.
  - Les séries entièrement vides (non faites) et les séries en plus ne déclenchent rien.
- **Non bloquant** : feuille « N série(s) sans répétitions (et/ou sans charge). Valider quand même ? » avec « Compléter » et « Valider quand même ». Rien n'est jamais inventé : les valeurs manquantes restent `null`.
- **« Compléter »** place le curseur sur le premier champ manquant, de façon synchrone dans le geste (le clavier s'ouvre sur iOS). La feuille ne reprend pas le focus si l'utilisateur l'a placé ailleurs.
- La vérification relit la séance en base après l'écriture des saisies en attente : elle porte toujours sur l'état réellement enregistré.

### Abandon d'une séance vide
- **Séance vide** (`isWorkoutEmpty`) : aucune valeur de série, aucun cardio, ni sensation, ni commentaire, ni note. Définition volontairement stricte : toute saisie protège la séance.
- La feuille d'abandon propose en plus « Supprimer cette séance », puis une **seconde confirmation explicite** (« Supprimer cette séance vide ? » → « Supprimer définitivement »).
- **Garde-fou côté service** (`deleteEmptyWorkout`) : la suppression revérifie en transaction que la séance est `in_progress` et vide. Sinon, refus (`DomainError`) et séance conservée.
- Une séance abandonnée avec des données est conservée, comme avant.

### Accessibilité (SPEC §8)
- **Feuilles modales** (`Sheet`, `ConfirmSheet`) :
  - `role="dialog"`, `aria-modal`, libellé par le titre ;
  - focus déplacé dans la feuille puis **piégé** (Tab / Maj+Tab) ;
  - **pile** de feuilles ouvertes : Échap et Tab ne concernent que la feuille du dessus (avant, Échap fermait aussi la feuille en dessous) ;
  - application d'arrière-plan rendue **`inert`** ;
  - focus rendu au déclencheur à la fermeture, sauf si l'utilisateur l'a placé ailleurs.
- **Noms accessibles** : test automatique (`dom-accessibility-api`, calcul normatif) sur tous les boutons, liens et champs de l'accueil, du programme, de son détail, de l'historique, de son détail, de la progression, des paramètres, de l'écran séance et de l'écran exercice. Aucun élément sans nom.
- **Contraste** : test WCAG AA (≥ 4,5:1) sur 19 couples texte/fond réellement utilisés. **8 couples échouaient** et ont été corrigés en assombrissant les tokens, même teinte, valeur minimale suffisante :

| Token | Avant | Après | Contraste le plus faible après |
|---|---|---|---|
| `--color-text-secondary` | `#6e6a63` | `#6b6761` | 4,65:1 (sur fond pressé) |
| `--color-text-tertiary` | `#8f8a81` (3,05:1) | `#706c65` | 4,63:1 (sur fond crème) |
| `--color-success` | `#4f8a62` (3,45:1) | `#427452` | 4,61:1 (badge) |
| `--color-warning` | `#b9772f` (3,08:1) | `#925e25` | 4,60:1 (badge) |
| `--color-danger` | `#b5534c` (3,95:1) | `#a44b45` | 4,63:1 (badge) |

- **Mouvement réduit** : test sur toutes les feuilles de style. Chaque animation a son équivalent `prefers-reduced-motion`, et chaque transition utilise les durées des tokens (ramenées à 0 sous mouvement réduit, aucune durée codée en dur).
- **Focus visible** : `:focus-visible` global (anneau d'accent) ; chaque `outline: none` a un indicateur de remplacement (testé).

### Finitions UI
- **Historique récent (Progression)** : date et badge « Abandonnée » sur la première ligne, performance dessous, flèche centrée verticalement sur la ligne entière (mesuré : 0 px d'écart).
- **Format des séries uniformisé** :
  - **résumé** d'une séance (Dernière fois, historique récent) : séries regroupées par charge consécutive, toujours sous la forme « charge · reps / reps », groupes séparés par « ; ». Exemples : « 45 kg · 10 / 10 / 9 », « 45 kg · 12 / 12 ; 47 kg · 10 », « 45 / 40 reps » (poids du corps) ;
  - **détail** série par série (historique, carte du graphique, meilleure série) : « 12 × 47,5 kg », inchangé.
  - L'ancienne forme « 12 × 45 kg · 10 × 47 kg » est remplacée ; l'unique assertion qui la vérifiait (`display.test.ts`) a été mise à jour, conformément à la demande.
- **Carte du graphique** : au toucher d'un point, la carte défile pour être entièrement visible, lien « Voir la séance » compris, au-dessus de la barre basse (`scroll-margin-bottom` = dégagement de la barre). Mesuré en navigateur : bas du lien à 743 px, haut de la barre à 780 px.
- **Rappel de règle (inchangée)** : les séances **abandonnées** comptent dans « Dernière charge », le record, le volume et le graphique, car leurs données sont réelles. Seul le « nombre de séances » ne compte que les séances terminées.

### Découpage du bundle
- Vite 8 (Rolldown) : `build.rolldownOptions.output.codeSplitting.groups` (`manualChunks` est déprécié) → chunks `react` (react, react-dom, scheduler), `dexie` (dexie, dexie-react-hooks), `zod`.
- **Conservé**, car les deux conditions sont remplies :
  - le service worker précache tout (24 entrées, environ 919 Kio, dont les nouveaux chunks et la Progression) ;
  - le hors-ligne reste intact, revérifié en navigateur réel (rechargement, route profonde, graphique, séance, export, mise à jour).

| Fichier (brut / gzip) | Avant (J6) | Après (J7) |
|---|---|---|
| `index` (app) | 560,8 / 173,8 kB | 158,7 / 49,6 kB |
| `react` | — | 218,8 / 68,3 kB |
| `dexie` | — | 96,5 / 31,8 kB |
| `zod` | — | 85,1 / 24,2 kB |
| `ProgressPage` (différé, Recharts) | 318,1 / 94,8 kB | 318,2 / 94,9 kB |
| Chargement initial (gzip, hors Progression) | ≈ 182 kB | ≈ 179 kB |
| Precache | 20 entrées, ≈ 920 Kio | 24 entrées, ≈ 919 Kio |

- Le poids total est inchangé. Le gain est le **cache** : une mise à jour de l'app ne retélécharge plus React, Dexie ni Zod. L'avertissement « chunk > 500 kB » a disparu.

### Tests
- **Stabilité** :
  - délai d'attente de Testing Library (`findBy`/`waitFor`) porté à 3 s dans le setup, pour les runners CI plus lents ;
  - dans le test des sections des Paramètres (J5), lecture asynchrone de la date du dernier export via `findByText` au lieu de `getByText` (course de lecture) ;
  - aucune valeur attendue modifiée.

### Régression complète (J7)
Build de production servi en localhost (contexte sécurisé), Edge headless, 390 × 844, interactions tactiles :

- S1 premier lancement → import → affichage : OK
- S2 séance A, 3 séries (« 47,5 » et « 47.5 »), sensation, commentaire, validation → fermer/rouvrir → identique (commentaire trimé, objectifs intacts) : OK
- S3 quitter en cours de séance → rouvrir → reprendre : OK
- S4 exercice 3 avant le 1 → `executionOrder` réel, graphique correct : OK
- S5 export → effacement de la base IndexedDB → restauration → données identiques : OK
- S6 période 1M → point touché → carte lisible, lien visible au-dessus de la barre : OK
- S7 import JSON invalide → refus, base inchangée : OK
- Hors ligne : rechargement, route profonde, graphique, saisie persistée après rechargement : OK
- 0 erreur console.

---

## V1.1a — Coller un programme, encart « Conseil » (aucun changement du format JSON)

### Amendement de SPEC.md (autorisé, par ajout uniquement)
- §2 : nouvelle sous-section « Ajouts V1.1 (amendement, après validation de la V1) ».
- §13 : deux lignes de tableau, V1.1a et V1.1b.
- Le §7.10 et le nouveau §10.6 (export pour le coach) seront ajoutés avec la V1.1b. Aucune ligne existante n'est modifiée (`git diff` : 8 ajouts, 0 suppression).

### Coller un programme
- **Où** : bouton « Coller le JSON » à côté de « Importer un programme JSON » sur le premier lancement, dans Paramètres → Données, et sur l'écran Programme vide (même état vide que l'accueil, par cohérence).
- **Pipeline** : `previewPastedProgram` = `unwrapPastedJson` puis **exactement** `previewProgram` (parse, migration, Zod, invariants, champs ignorés). La confirmation passe par le même `importProgram` (refus d'un `programId` déjà existant, en transaction).
- **Tolérance stricte** (`src/schemas/pasted.ts`) :
  - espaces, retours à la ligne et BOM autour du texte (`trim`, qui retire aussi U+FEFF) ;
  - **une** clôture Markdown entourant tout le texte : ` ```json ` (casse indifférente) ou ` ``` ` nu, fermée par ` ``` `.
  - Tout le reste est refusé tel quel : texte avant ou après la clôture, deux blocs, autre langage (` ```python `), clôture non fermée, virgule finale, guillemets typographiques.
  - Choix : la clôture ` ``` ` sans langage est acceptée, car ChatGPT l'emploie aussi ; ce n'est pas une réparation du JSON.
- **Message** : un texte non analysable donne « Import impossible : le texte collé n'est pas du JSON valide. », détails techniques (`SyntaxError`) derrière « Afficher les détails ». Les autres erreurs gardent exactement les messages du fichier.
- **Correction** : la feuille d'erreur d'un texte collé s'intitule « Texte refusé » et propose « Modifier le texte », qui rouvre la zone **avec le texte conservé**. Valable aussi pour un refus à la confirmation (`programId` existant).
- **Aucune écriture avant confirmation** : le texte vit seulement dans l'état React (ni IndexedDB, ni localStorage). Annuler ou fermer le perd.
- **Presse-papiers** (`src/utils/clipboard.ts`) :
  - le bouton « Coller depuis le presse-papiers » n'apparaît que si `navigator.clipboard.readText` existe (absent en HTTP sur IP locale) ;
  - refus, échec ou presse-papiers vide : aucune alerte, simple ligne d'aide « Touche la zone de texte puis « Coller » … » et focus dans la zone ;
  - sans API, la même ligne d'aide est affichée d'emblée.
- **Zone de texte** : police 17 px (`--font-size-input`, pas de zoom iOS), monospace, lignes non recoupées ; `autocapitalize`, `autocorrect`, `autocomplete` désactivés, `spellcheck=false`. « Vérifier » est désactivé tant que la zone est vide.

### Encart « Conseil »
- L'écran exercice n'affichait pas `notes`. Ce champ n'est pas copié dans le snapshot de la séance (contrat §11.2) : il est lu dans le **programme d'origine** de la séance, toujours conservé même archivé, comme la catégorie et l'équipement (`useProgramExercise`).
- **Position** : entre « Dernière fois » et OBJECTIF.
- **Style** : fond chaud plein (`--color-warning-soft`), sans bordure, icône ampoule et libellé « CONSEIL ». Il se distingue ainsi d'OBJECTIF (cadre pointillé) et de RÉALISÉ (champs blancs à bordure franche). Contrastes déjà couverts par le test AA (`color-text` et `color-warning` sur `color-warning-soft`).
- **Repli** : 3 lignes (`line-clamp`). « Voir plus / Voir moins » (`aria-expanded`, `aria-controls`) n'apparaît que si le texte dépasse réellement, mesuré par `scrollHeight` et recalculé au redimensionnement. Un texte court n'a pas de bouton.
- `notes` à `null`, vide ou fait d'espaces : rien n'est affiché.

### Vérification en navigateur réel (production, 390 × 844, tactile)
14/14 OK, 0 erreur console :
- collage depuis le presse-papiers d'un bloc ` ```json ` ;
- prévisualisation, base vide jusqu'à la confirmation, puis import ;
- JSON invalide : message, détails, texte conservé ;
- `programId` existant refusé, base inchangée ;
- conseil long replié sur 3 lignes : le premier champ RÉALISÉ reste visible à 653 px sur 844 ; il se déplie sur 4 lignes ;
- conseil court sans bouton, `notes` null sans encart ;
- aucun défilement horizontal.

---

## V1.1b — Export pour le coach (nouveau type `training_coach_export`)

### Amendement de SPEC.md (autorisé, par ajout uniquement)
- §7.10 : bloc « Complément V1.1 » sous le texte existant (entrées Coller le JSON et Exporter pour le coach, aides distinctes, envoi ≠ sauvegarde).
- §10.6 : nouvelle section « Export pour le coach (amendement V1.1b) ».
- Aucune ligne existante modifiée (`git diff` : 56 ajouts, 0 suppression). Les contrats `training_program` et `training_history_export` sont inchangés, comme les deux fixtures.

### Séances exportables
- `completed` ou `abandoned`, et **non vide** au sens de `isWorkoutEmpty` (J7) : au moins une valeur de série, un cardio, une sensation, un commentaire ou une note.
- La règle « non vide » s'applique aussi aux séances terminées : une séance terminée sans aucune saisie n'apporte rien au coach. Jamais `in_progress`.
- Le service filtre à nouveau au moment de construire le fichier : un identifiant de séance en cours ou vide passé par erreur est ignoré.

### Sélection
- Raccourcis :
  - « Dernière séance », « 3 dernières », « 6 dernières », « N dernières » : `mode: "last_n"` ;
  - « Depuis mon dernier envoi au coach » : `mode: "since_last_export"` ;
  - toute case cochée ou décochée à la main : `mode: "manual"`.
- Le raccourci actif est signalé par `aria-pressed` et un style accent.
- **« Depuis mon dernier envoi »** :
  - une séance est retenue si sa fin est postérieure à `lastCoachExportAt` ;
  - la fin vaut `completedAt`, sinon `startedAt` pour une séance abandonnée, qui n'a pas de date de fin au contrat ;
  - limite assumée : une séance commencée avant un envoi puis abandonnée après ne sera pas reprise par ce raccourci. Elle reste cochable à la main ;
  - une séance modifiée après un envoi n'est pas renvoyée automatiquement.
- **Sélection par défaut** à l'ouverture : « Depuis mon dernier envoi ». Sans envoi précédent, tout est coché et le texte l'annonce (« Aucun envoi précédent : toutes les séances sont cochées. »). S'il n'y a rien de nouveau, rien n'est coché et les boutons sont désactivés.
- **Champ N** : `inputmode="numeric"`, chiffres seulement (3 au maximum), appliqué dès la saisie, borné au nombre de séances exportables.
- **Résumé en direct** : « 3 séances · 8 sept. au 22 sept. », « sur 3 exportables » (`aria-live="polite"`).

### Format et contrôles
- Schéma Zod dédié (`src/schemas/coachExport.schema.ts`) :
  - `sessions` contient au moins 1 séance ;
  - `sessionCount` est un entier ≥ 1 ;
  - les dates de `selection` sont au format `YYYY-MM-DD`.
- `programs` contient le programme actif et ceux des séances choisies, en objets complets sans champs internes, triés par date d'import (comme la sauvegarde). Un programme archivé non référencé n'est jamais inclus.
- `sessions` sont triées par `startedAt` croissant.
- Invariants dédiés (`checkCoachExportInvariants`) :
  - ceux demandés : programme actif présent, programmes des séances présents, identifiants uniques, aucune séance en cours, `sessionCount` = nombre de séances ;
  - ajoutés :
    - `totalExportableSessions` ≥ `sessionCount` ;
    - dates de `selection` = première et dernière séance ;
    - ordre chronologique ;
    - séance `completed` avec un `completedAt`.
- **Autotest** : le fichier indenté **et** le texte compact sont relus avec ce schéma et ces invariants, puis comparés aux données (`canonicalJson`). Sinon `ExportIntegrityError`, et rien n'est livré ni écrit.
- Nouveau `DocumentKind` `coach` (préfixe « Export pour le coach invalide », libellés de champs français pour `selection`). Pas de migration : seule la version 1.0 existe.

### Sécurité
- `readDocument` reconnaît `type: "training_coach_export"` avant tout autre contrôle :
  - **restauration** : « Restauration impossible : ce fichier est un export pour le coach, pas une sauvegarde. Pour restaurer, utilise un fichier « Exporter mes données ». » ;
  - **import de programme**, par fichier ou collé : « Import impossible : ce fichier est un export pour le coach, pas un programme. … ».
- Le texte demandé est repris mot pour mot après le préfixe habituel des refus (« Restauration impossible : »), avec la minuscule initiale propre à cette convention.
- Rien n'est écrit : vérifié par les tests (`dumpDatabase` identique) et en navigateur réel.

### Dates d'envoi
- `lastCoachExportAt` est un nouveau réglage de la table `settings`. C'est seulement un nouveau type de clé dans `SettingRecord`, sans index : **aucune migration de base**, `DB_VERSION` reste à 1.
- Il est écrit seulement après un envoi réel : partage abouti, téléchargement déclenché sans erreur, copie réussie, ou téléchargement de repli. Il n'est jamais écrit après une annulation, un refus ou une erreur.
- Sa valeur est `exportedAt`, l'instant où le contenu a été figé, comme `lastExportAt`.
- L'envoi au coach n'écrit **jamais** `lastExportAt` : il ne fait pas disparaître le rappel de sauvegarde.
- **Restauration** : `lastCoachExportAt`, propre à l'appareil, est conservé, comme `lastExportAt`. Il n'est réécrit que s'il existait, pour que les sauvegardes sans envoi restent identiques à avant.

### Remise
- Le fichier est préparé à l'avance par `usePreparedCoachExport`, 250 ms après le dernier changement de sélection. Les deux boutons restent désactivés pendant la préparation, et une préparation dépassée n'est jamais utilisée.
- **« Envoyer le fichier »** : même chemin que la sauvegarde (`deliverFile` : Web Share, sinon téléchargement), nom `training-coach-AAAA-MM-JJ.json`, JSON indenté.
- **« Copier pour ChatGPT »** :
  - `writeText` est appelé tout de suite, sans attente préalable, dans le geste, avec le JSON **compact** seul ;
  - en cas de succès, un « Copié » discret s'affiche (`role="status"`) ;
  - si le presse-papiers est absent (HTTP local) ou refuse : message « Copie impossible sur cet appareil. Télécharge plutôt le fichier… » et bouton « Télécharger le fichier », qui télécharge directement, sans feuille de partage.
- L'aide sous « Exporter mes données » devient « … sauvegarde complète, la seule qui permet de restaurer ou de changer d'iPhone ». Elle disait avant « (sauvegarde et envoi au coach) ». Sous « Exporter pour le coach » : « Une sélection de séances à envoyer au coach (fichier ou copie pour ChatGPT). Ne remplace pas la sauvegarde. ».
- Écran : route `#/settings/coach`, barre basse visible, retour vers Paramètres. Sur toute leur largeur, les lignes font au moins 60 px de haut et les raccourcis au moins 52 px.

### Documentation
- `JSON_SCHEMA.md` :
  - COACH_JSON : champs, `selection`, invariants, exemple ;
  - `notes` décrit comme le conseil d'exécution (1 à 2 phrases, impératif, français, 160 caractères max) ;
  - section coach : lecture d'un export partiel, nouveaux points de la checklist, texte à coller mis à jour pour `training_coach_export`.
  - Le bloc du texte à coller passe à quatre backticks, car il contient lui-même ` ```json `.
- `examples/coach-export-example.json` (nouveau) :
  - construit à partir de `history-example.json` (2 dernières séances, `last_n`) ;
  - un test vérifie qu'il est valide **et** que `toCoachExport` le reconstruit à l'identique depuis la fixture.

### Tests
- 3 nouveaux fichiers :
  - `domain/coachExport.test.ts` ;
  - `services/coachExport.test.ts` ;
  - `features/settings/CoachExport.test.tsx`.
- Dans `services/coachExport.test.ts`, la mise en place fixe la date d'import du programme de démo : la restauration la date de l'instant réel. Ce test est nouveau et la correction ne touche aucune attente.

### Vérification en navigateur réel (production, 390 × 844, tactile)
- **Régression S1–S7 et hors ligne : 9/9, 0 erreur console.**
  - Une attente manquante a été ajoutée dans le script, après le toucher sur « Liste » : c'était une course du script, pas de l'app.
- **Export pour le coach : 12/12, 0 erreur console.**
  - Les données sont injectées directement dans IndexedDB, hors de Dexie, puis la page est rechargée (même méthode qu'au J7).
  - Vérifié :
    - aides distinctes ;
    - tout coché par défaut ;
    - cibles d'au moins 44 px, champ N en police d'au moins 16 px, aucun défilement horizontal ;
    - raccourcis puis ajustement manuel ;
    - fichier téléchargé exact ;
    - `lastCoachExportAt` écrit et `lastExportAt` intact ;
    - copie en JSON compact seul et « Copié » ;
    - « depuis le dernier envoi » sans nouveauté : boutons désactivés ;
    - refus par la restauration et par l'import de programme, base inchangée ;
    - écran rechargé hors ligne, copie fonctionnelle.

---

## V1.2a — Pesées : données, migration, sauvegarde, export coach (sans interface)

### Amendement de SPEC.md (autorisé, par ajout uniquement)
- §2 : sous-section « Ajouts V1.2 — Suivi du poids ».
- §10.6 : bloc « Complément V1.2 — pesées dans l'export pour le coach ».
- §11.2 : bloc « Complément V1.2 — `training_history_export` en 1.1 ».
- §13 : lignes V1.2a et V1.2b.
- Le §7.1 et le §7.11 (onglet Poids) seront ajoutés avec l'interface, en V1.2b.
- `git diff` : 40 ajouts, 0 suppression.

### Modèle et règles (`src/domain/weight.ts`, `src/schemas/weight.schema.ts`)
- **Pesée** : `{ date, weightKg, recordedAt }`.
  - `date` : date locale de la mesure, **clé unique**, donc une pesée par jour.
  - `recordedAt` : instant de la dernière écriture (saisie ou correction), en ISO avec offset local.
- **Poids** : fini, > 0, **au plus 2 décimales**. Au-delà, refus avec message (« Au plus 2 décimales (ex. 78,45). »), jamais d'arrondi.
  - La comparaison tolère l'erreur de représentation binaire (80.15 × 100 = 8014,999…) sans accepter une vraie 3ᵉ décimale.
  - Saisie via `parseDecimalInput` : virgule ou point.
- **Date** : réelle (`2026-02-30` refusé) et jamais après la date locale de l'appareil.
- **Avertissements doux** (`weightSanity`) : écart de plus de 5 kg avec la pesée précédente, valeur < 20 ou > 300 kg. Jamais bloquants ; l'interface demandera « C'est bien ça ? ».
- **Historique et stats** : mêmes périodes que la progression (`filterByPeriod`).
  - `weightStats` :
    - dernier poids : la dernière pesée de **tout** l'historique, avec son écart ;
    - min, max et variation (dernière − première) : **sur la période** ;
    - variation `null` sous 2 pesées dans la période ;
    - à égalité, le min ou le max retenu est la pesée la plus récente.
  - L'écart d'une pesée se calcule toujours avec la précédente de **tout** l'historique (`weightDelta`), même hors de la période affichée.
  - Les écarts sont arrondis au centième pour l'affichage seulement.

### Base IndexedDB : version 2 (première vraie migration)
- `DB_VERSION = 2`.
  - La version 1 reste déclarée telle quelle (`STORES_V1`, figée).
  - La version 2 ajoute **seulement** `weights: '&date'`, sans `upgrade()` : aucune donnée existante n'est lue ni réécrite.
- **Test** (`src/db/migration.test.ts`) :
  - le code V1 est recopié à la main : on crée une vraie base v1 remplie avec la fixture, une séance saisie dans l'app (série en plus, décimales, commentaire avec guillemets), les 4 réglages et une copie interne 1.0 ;
  - la base rouverte par le code v2 : toutes les tables sont identiques, les index des séances inchangés, `weights` vide ;
  - 4 réouvertures successives ne changent rien, et une pesée ajoutée entre-temps est conservée ;
  - une base neuve est directement en v2.

### Formats 1.1 et migrations de schéma
- **Une version par type de document** (`common.ts`) :
  - programme : `SCHEMA_VERSION = "1.0"`, inchangé ;
  - sauvegarde : `HISTORY_SCHEMA_VERSION = "1.1"` ;
  - coach : `COACH_SCHEMA_VERSION = "1.1"`.
  - Le format programme ne change pas : un programme 1.1 n'existe pas et serait refusé.
- **Chaînes de migrations par type** (`migrations.ts`) :
  - `SCHEMA_MIGRATIONS` désigne la chaîne du **programme**, toujours vide. Le test existant qui l'affirme reste donc vrai et n'est pas modifié.
  - `HISTORY_MIGRATIONS` : 1.0 → 1.1, ajoute `weightEntries: []`.
  - `COACH_MIGRATIONS` : 1.0 → 1.1, ajoute `weightEntries: []` et `weightWindow: null`.
  - `readDocument` choisit la chaîne et la version cible selon le type ; le message « version non prise en charge » cite la version du type concerné.
- **Sauvegarde** : `weightEntries` obligatoire en 1.1, export trié par date croissante.
- **Invariants ajoutés** (`checkWeightEntries`) : dates uniques, aucune date future. Le format, le poids et `recordedAt` sont vérifiés par Zod. La date du jour est un paramètre, par défaut celle de l'appareil.
- **Résumé de restauration** :
  - `schemaVersion` affiche la version **écrite dans le fichier** (avant migration), donc « 1.0 » pour une ancienne sauvegarde : c'est l'information utile ;
  - `weightCount` est ajouté ;
  - `weightsLostByRestore` donne le nombre de pesées actuelles qui seraient remplacées par un fichier sans pesée (affichage en V1.2b).

### Restauration
- Les pesées sont vidées puis réécrites **dans la transaction unique**.
- La copie interne (`preRestoreBackup`) et l'export de sécurité, lus par `toHistoryExport`, contiennent les pesées.
- Testé : un échec simulé sur l'écriture des pesées ne change rien.
- Une copie interne écrite avant la V1.2 reste en 1.0 (documenté sur le type) ; elle n'est jamais relue par l'app.

### Export pour le coach 1.1
- `weightEntries` contient seulement `{ date, weightKg }`, par date croissante.
- `weightWindow` vaut `{ mode, from, to, count }`, ou `null` si les pesées sont désactivées.
- `to` = la date locale de l'export, lue dans `exportedAt`, qui est un horodatage local.
- **Fenêtres** (`weightWindowBounds`, domaine pur) :
  - `auto_30d` : le plus ancien entre la première séance choisie et aujourd'hui − 30 jours ;
  - `days_90` : aujourd'hui − 90 jours ;
  - `all` : la première pesée, ou aujourd'hui s'il n'y en a aucune.
- Sans pesée en base, la fenêtre est annoncée avec `count: 0`. Le choix « n'ajoute rien » de la V1.2b sera tranché à l'interface.
- Dans le service, le champ `weights` de la requête est facultatif : absent, il vaut `auto_30d` (le défaut demandé), et l'écran V1.1b actuel l'utilise déjà.
- **Invariants ajoutés** :
  - dates strictement croissantes, donc uniques ;
  - toutes dans `[from, to]` ;
  - `count` exact ;
  - fenêtre `null` ⇒ aucune pesée ;
  - `from` ≤ `to`.
- La restauration et l'import de programme refusent toujours ce type, en 1.0 et en 1.1 : testé sur les deux exemples.

### Rappel d'export
- `getExportReminder(workouts, lastExportAt, now, weights = [])` : une pesée dont `recordedAt` est postérieur au dernier export compte comme donnée non sauvegardée, ce qui inclut une correction ultérieure.
- Règles inchangées : jamais pendant une séance en cours, et un export pour le coach ne touche pas `lastExportAt`.
- La forme du résultat ne change pas, donc les tests existants restent valides.
- L'accueil transmet les pesées (`useWeights`) : ce n'est pas un nouvel écran, seulement une donnée de plus pour le bandeau existant.

### Service (`src/services/weightService.ts`)
- `listWeights` (croissant), `getWeight`, `addWeight`, `updateWeight`, `deleteWeight`.
- `addWeight` renvoie `exists`, **sans écrire**, si la date existe déjà, sauf `replace: true` explicite. La lecture et l'écriture sont dans la même transaction.
- `updateWeight` change le poids seulement ; la date ne change jamais. `recordedAt` prend l'instant de la correction.
- Chaque écriture est revalidée : date, poids et schéma Zod du contrat.

### Fixtures V1.2 (nouvelles ; les 3 fixtures existantes sont intactes)
- `examples/history-weights-example.json` : fixture d'historique en 1.1 avec 10 pesées (2 sept. → 1er oct., dont 2 valeurs à 2 décimales).
- `examples/coach-export-weights-example.json` : même sélection que l'exemple V1.1, fenêtre `auto_30d` du 1er sept. au 1er oct., 10 pesées. Un test vérifie que l'app le **reproduit à l'identique** depuis la fixture d'historique.
- Les empreintes SHA-256 des trois exemples non contractuels (`coach-export-example.json` compris) sont figées dans `weights.test.ts`.

### Tests existants adaptés (conséquence directe du passage en 1.1)
1. `services/coachExport.test.ts`, « séances choisies… » : `schemaVersion` attendu `'1.0'` → `'1.1'` (fichier produit par l'app).
2. `services/coachExport.test.ts`, « fichier indenté, copie compacte… » : préfixe `{"schemaVersion":"1.0",…` → `"1.1"`.
3. `services/coachExport.test.ts`, « se reconstruit à l'identique… » (**adaptation autorisée**) : comparé à la fixture **passée par la migration**, avec les pesées désactivées puisque ce fichier 1.0 n'en a pas, et `weights: []` dans les données construites à la main.
4. `features/settings/CoachExport.test.tsx`, « Copier pour ChatGPT » : préfixe `"1.0"` → `"1.1"`.
5. `services/services.test.ts`, « aller-retour depuis des données saisies dans l'app » : version d'un export produit par l'app, `'1.0'` → `'1.1'`.
- Les tests 1, 2 et 4 sont de la V1.1b. Le test 5 n'était pas dans la liste autorisée, mais il affirme la version d'un fichier **produit par l'app**, que l'amendement fait passer en 1.1.
- **Le test d'aller-retour sur `history-example.json` n'a PAS eu besoin d'être modifié** : il compare déjà à la fixture analysée, donc migrée.
- Le test du résumé de restauration (« Version du schéma : 1.0 ») reste valide sans changement, puisque le résumé affiche la version du fichier.

### Tests ajoutés
- `domain/weight.test.ts` (21) : 10 cas de validation de saisie, refus des 3 décimales, dates, avertissements doux, 5 périodes, stats, écart sur tout l'historique, états vides, rappel d'export, avertissement de restauration.
- `db/migration.test.ts` (3).
- `services/weights.test.ts` (40) :
  - service : doublon sans écriture, remplacement explicite, date passée, date future, valeurs invalides, correction, suppression ;
  - **fuseaux horaires** : même instant physique sous UTC, Europe/Paris, America/Los_Angeles et Pacific/Kiritimati (UTC+14), avec date locale et offset de `recordedAt` exacts, et le lendemain local refusé ;
  - sauvegarde 1.1 et aller-retour avec pesées ;
  - fichiers 1.0 acceptés ;
  - 9 fichiers invalides refusés sans écriture ;
  - restauration atomique et copie interne ;
  - export coach : 4 fenêtres, aucune pesée, 7 invariants, 1.0 migré, refus des deux versions par la restauration et l'import ;
  - fixtures et empreintes.

---

## V1.2b — Onglet Poids, pesées dans l'export coach et la restauration, onglets multiples

### Amendement de SPEC.md (autorisé, par ajout uniquement)
- §7.1 : bloc « Amendement V1.2 » sous le texte d'origine, conservé intact (4 onglets, routes `/weight` et `/settings/coach`).
- §7.11 (nouvelle) : « Onglet Poids ».
- `git diff` : 40 ajouts, 0 suppression.

### Décision validée : `weightWindow` quand il n'y a aucune pesée
- Pesées **activées** mais aucune dans la fenêtre, ou aucune en base : `weightWindow` reste renseigné avec `count: 0` et `weightEntries: []`. Cela veut dire « aucune pesée sur la période ».
- `weightWindow: null` est **réservé** aux pesées désactivées par l'utilisateur pour cet envoi.
- Écrit aussi dans `JSON_SCHEMA.md`. Testé dans l'interface : sans pesée en base, la section l'indique et le fichier porte `count: 0`.

### Navigation
- 4ᵉ onglet « Poids » (Lucide `Scale`) après Progression. La grille passe à 4 colonnes, avec des libellés sur une ligne.
- **Mesuré en navigateur à 390 px et à 360 px** : chaque onglet fait au moins 44 px dans les deux sens, aucun libellé n'est tronqué, rien ne déborde.
- `WeightPage` est chargé à la demande (`lazy`), comme Progression.
  - Le build partage le module de graphique (Recharts + `ProgressChart`) entre les deux écrans, dans un chunk commun que Rolldown nomme automatiquement « ProgressPage.module ». Ce chunk n'est **pas** préchargé au démarrage.
  - Une tentative de le nommer `chart` par un groupe `codeSplitting` y faisait entrer un module aussi utilisé au démarrage, ce qui le préchargeait dès l'ouverture : elle a été abandonnée.

### Écran Poids
- **Saisie du jour** :
  - champ décimal (17 px, au moins 48 px de haut, `inputmode="decimal"`, `enterkeyhint="done"`), unité « kg » affichée ;
  - le dernier poids est un **placeholder**, jamais une valeur ;
  - la date et l'heure sont celles de l'appareil ; la date du jour est rappelée sous le champ.
- **Enchaînement commun** aux trois saisies (jour, « + », crayon) :
  1. validation (message en français, champ marqué `aria-invalid`) ;
  2. avertissement doux s'il y a lieu (« C'est bien ça ? », boutons « Corriger » / « Oui, enregistrer ») ;
  3. confirmation de remplacement si la date a déjà une pesée ;
  4. écriture.
  - Le service garde son garde-fou : une pesée apparue entre-temps n'est jamais écrasée sans confirmation.
- **« + »** : date (`max` = aujourd'hui, une date future saisie malgré tout est refusée avec un message) et poids.
- **Crayon** : il corrige le poids seulement. La feuille rappelle que, pour changer de jour, il faut supprimer la pesée puis l'ajouter avec « + ». Ici, le champ est prérempli : on corrige une valeur existante.
- **Graphique** : même composant que la progression, avec deux options ajoutées sans changer son comportement par défaut :
  - `axis` : ordonnée resserrée pour le poids, marge de 15 % de l'écart et d'au moins 0,5 kg, **sans** la marge de 5 % de la valeur utilisée par la progression ;
  - `pointLabel` : libellé accessible « Pesée du … : … kg ».
- **Toucher le point le plus proche** (correction ergonomique trouvée en navigateur réel, qui profite aussi à la progression) :
  - avec des pesées rapprochées, les zones tactiles de 44 px se chevauchaient et le point dessiné au-dessus captait le toucher (on visait le 25 sept., on obtenait le 1er oct.) ;
  - désormais, le toucher choisit le point dont la position dessinée est la plus proche du doigt (au plus 32 px horizontalement), y compris entre deux zones tactiles ;
  - sans coordonnées (clavier, lecteur d'écran, tests jsdom), le point activé reste celui de l'élément : les tests de Progression existants passent sans modification.
- **Carte de détail** : date, poids, écart avec la pesée précédente de tout l'historique (« −0,25 kg depuis le 22 sept. » ou « Première pesée »), bouton crayon. Elle défile pour rester entièrement au-dessus de la barre (mesuré).
- **Statistiques** :
  - dernier poids (avec son écart) ;
  - min, max avec leurs dates ;
  - variation sur la période, avec « sur N jours » mesuré entre la première et la dernière pesée de la période ;
  - nombre de pesées de la période.
  - Aucun conseil ni objectif.
- **Liste** : récente d'abord, crayon et poubelle de 44 px, noms accessibles qui incluent la date.
- **États vides** : sans pesée, un message clair s'affiche sous la carte de saisie, qui reste utilisable ; avec un seul point, le graphique s'affiche.

### Export pour le coach : section « Pesées »
- Interrupteur natif (`role="switch"`, activé par défaut), dessiné comme un interrupteur iOS.
- Trois fenêtres en boutons radio (« 30 derniers jours (ou plus si tes séances sont plus anciennes) » par défaut, « 90 jours », « Tout l'historique ») ; lignes d'au moins 44 px.
- **Aperçu** calculé avec les **mêmes fonctions** que le fichier (`weightWindowBounds`, `weightsInWindow`), par exemple « 10 pesées · 4 sept. au 4 oct. ».
- La fenêtre fait partie de la demande préparée à l'avance. L'autotest et les règles de remise sont inchangés.

### Restauration
- Le résumé affiche « Pesées : N ».
- Si le fichier n'a aucune pesée alors que l'app en contient, un avertissement visible (`role="alert"`) s'affiche, avec le texte demandé et l'accord au singulier (« ta pesée actuelle sera remplacée »).
- **Correction découverte en route** : l'export de sécurité n'était exigé que s'il y avait au moins un programme ou une séance. Une base contenant **seulement des pesées** aurait pu être remplacée sans cet export. Les pesées comptent désormais (`PreparedExport.weightCount`).
- L'aide de « Exporter mes données » mentionne les pesées quand il y en a (« 1 programme, 3 séances et 10 pesées : … »). Sans pesée, le texte est inchangé.

### Onglets multiples pendant la montée en version 2 (vérifié et testé)
- **Comportement de Dexie 4.4.6** (lu dans le code source) :
  - une connexion qui reçoit `versionchange` **se ferme d'elle-même** pour laisser passer la mise à jour, avec un simple avertissement console. L'ancienne version (V1.1), qui utilise la même bibliothèque, ne bloque donc normalement **pas** la montée en v2 ;
  - `blocked` n'arrive que si une connexion ne se ferme pas.
- **Constaté en vrai navigateur**, ancienne version V1.1b (build de production) et nouvelle version sur la même origine :
  - ancien onglet ouvert, en pleine séance, sur une base v1 remplie : la nouvelle version s'ouvre **sans attente ni message**. Base v2, `weights` vide, toutes les données identiques octet pour octet ;
  - l'ancien onglet, rechargé, **continue de fonctionner** sur la base v2 (Dexie 4 l'ouvre avec son ancien schéma ; il ignore simplement les pesées). Aucune donnée perdue.
- **Ajouts** (`src/db/connectionStatus.ts`, branché dans le constructeur de la base) :
  - `blocked` (montée de version empêchée par un autre onglet) : message plein écran **« Ferme les autres onglets de l'app »**.
    - Texte : « … une ancienne version est encore ouverte dans un autre onglet ou une autre fenêtre. Ferme les autres onglets de l'app, puis rouvre-la. La mise à jour reprendra d'elle-même. » et « Tes données ne sont pas perdues. »
    - Bouton « Réessayer ».
    - Le message **disparaît seul** dès que l'ouverture aboutit (événement `ready`).
  - `versionchange` reçu (une version **plus récente** s'ouvre ailleurs ; Dexie ferme notre connexion) : message **« Nouvelle version ouverte ailleurs »** : « Recharge cette page pour continuer avec la nouvelle version. », avec l'assurance que les données sont conservées et un bouton « Recharger la page ».
  - Suppression de base (`newVersion` nul, outils de développement) : aucun message.
  - Le message est rendu **hors de `#root`** (portail), parce qu'une feuille ouverte rend `#root` inerte. Il passe au-dessus de tout (nouveau token `--z-connection`) et bloque toute saisie tant que la situation n'est pas réglée.
- **Tests** (`src/db/connection.test.tsx`, vraie base fake-indexeddb) :
  - connexion v1 « têtue » : message affiché, ouverture en attente ; fermeture de la connexion : reprise seule, message retiré, données intactes ;
  - ancien Dexie : aucune attente ;
  - version plus récente (IDB 30) : message, connexion fermée, pesée conservée ;
  - suppression : aucun message.
- **Navigateur réel** (3 scénarios : ancienne version normale, connexion bloquante, version plus récente) : 8/8.

### Tests existants adaptés (autorisés : nombre d'onglets)
1. `app/App.test.tsx`, « … la navigation à 3 onglets » → « à 4 onglets » : liste attendue `['Accueil', 'Programme', 'Progression', 'Poids']`.
2. `features/history/History.test.tsx`, « … (sans 4e onglet) … » → « (jamais un onglet) » : l'attente `toHaveLength(3)` devient la liste exacte des 4 onglets, ce qui garde l'intention (l'Historique n'est jamais un onglet).
- Aucun autre test existant modifié.
- Le test « ordonnée ajustée », écrit pendant cette étape, n'a jamais été vert : il lisait des graduations que jsdom ne rend pas. Il a été remplacé par une mesure de l'écart vertical réel de la courbe, plus un test de domaine. Ce n'est pas une adaptation d'un test existant.

### Tests ajoutés (V1.2b)
- `features/weight/Weight.test.tsx` (17) :
  - onglet et navigation, état vide, première pesée (date locale, un seul point) ;
  - saisies invalides ;
  - placeholder ;
  - remplacement (Annuler puis Remplacer), avertissement doux (Corriger puis Oui) ;
  - « + » avec date passée, date future refusée et date existante ;
  - crayon (poids seul), poubelle (Annuler puis Supprimer) avec stats et graphique recalculés ;
  - stats, périodes, point et carte, point le plus proche sur des points serrés, ordonnée ajustée ;
  - accessibilité (écran, carte, feuille) ;
  - fuseaux UTC+14 et Los Angeles.
- `features/settings/WeightsInExports.test.tsx` (7) : section Pesées (défaut, aperçu, fenêtres, désactivée), aucune pesée (`count: 0`), restauration (nombre, avertissement, export de sécurité avec pesées, pesées seules).
- `domain/weight.test.ts` (+2) : série du graphique, ordonnée resserrée par rapport à la progression.
- `db/connection.test.tsx` (4).

### Délai par test (Vitest)
- `testTimeout: 15_000` dans `vite.config.ts`. Le défaut était de 5 s.
- Avec 40 fichiers en parallèle, sur une machine chargée, le scénario 2 complet de l'écran exercice a dépassé 5 s (5,2 s) lors d'une passe.
- Seul, il dure 1,9 s, **identique avec et sans les changements V1.2b** (mesuré en remettant le code précédent de côté).
- Aucun test ni aucune assertion modifiés ; même logique qu'au J7 pour `asyncUtilTimeout`.

---

## fix-v1.2c — Échelle du graphique de poids (aucun changement de données ni de format)

- **Règle** (onglet Poids uniquement, fonction pure `weightAxis` dans `src/domain/weight.ts`) :
  - amplitude visible = max(`MIN_WEIGHT_SPAN_KG` = 10 kg, amplitude des données visibles × 1,25) ;
  - centrée sur le milieu des données visibles ;
  - bornes arrondies au kg entier **vers l'extérieur** ;
  - marge d'au moins 10 % de l'amplitude affichée de chaque côté, **vérifiée après l'arrondi** ;
  - graduations : multiples d'un pas propre (1, 2, 5, 10, 20… kg), de 4 à 6 lignes.
- **Si la marge ou les graduations ne conviennent pas** après l'arrondi, l'axe est élargi d'1 kg de chaque côté, toujours centré, jusqu'à ce que tout convienne. Sans ce contrôle, pour 40 kg de données, l'arrondi pouvait ramener la marge à 9,6 %.
- **Jamais sous 0 kg** : dans le seul cas extrême (plus de 100 kg d'écart dans la période, par exemple 18 → 126 kg), la fenêtre est décalée vers le haut à amplitude égale au lieu d'être centrée. Ce cas a été trouvé par le test de balayage.
- **Progression des exercices inchangée** : `valueAxis` a retrouvé sa signature d'origine. Les options de marge ajoutées en V1.2b (`WEIGHT_AXIS`) sont supprimées. Le graphique commun reçoit une fonction d'axe facultative (`valueAxisFor`) ; par défaut, c'est l'axe de la progression.
- **Grille alignée sur les graduations** (`horizontalValues`) : avec la nouvelle règle, les bornes ne sont plus forcément des graduations, et Recharts traçait une ligne sans libellé à la borne haute. En Progression, les bornes sont toujours des graduations : rendu identique, vérifié par la régression S6.
- Les statistiques (dernier poids, min, max, variation) ne changent pas.
- **Tests adaptés** : deux tests écrits en V1.2b, qui vérifiaient l'**ancienne** règle de bornes :
  1. `domain/weight.test.ts`, « ordonnée AJUSTÉE à la plage… » : remplacé par les tests de la nouvelle règle (une pesée, pesées identiques, amplitudes de 3, 8 et 20 kg, trois périodes, balayage de 0 à 120 kg, plancher à 0, constante).
  2. `features/weight/Weight.test.tsx`, « ordonnée ajustée… occupe plus de la moitié de la hauteur » : la courbe 80,6 → 82,4 kg occupe maintenant environ 1,8 / 11 de la hauteur de tracé, et aucun point n'est à moins de 10 % d'un bord.
- **Navigateur réel (390 px)** :
  - onglet Poids : 14/14 (carte au-dessus de la barre, point le plus proche, axe 76 → 86) ;
  - états vides et pesée unique : 4/4 (pas de graphique sans pesée ; une pesée : axe 76 → 86, point au milieu) ;
  - régression S1–S7 et hors ligne : 9/9.

---

## V1.3a — Archive Drive : configuration, client, file d'attente, séances

Référence : `V1.3-SPEC.md` (commité avec cette étape).

### Amendement de SPEC.md (autorisé, par ajout uniquement)
- §2 : sous-section « Ajouts V1.3 : archive Drive » (4 puces).
- §7.10 : bloc « Complément V1.3 » (entrée Archive Drive, ligne d'état après une séance, puce de l'accueil).
- §10.7 (nouvelle) : reprise **textuelle** des §1 à §9 de `V1.3-SPEC.md`, avec les titres rétrogradés en 10.7.1 à 10.7.9 et une phrase d'introduction : « §n » y désigne 10.7.n.
- §13 : lignes V1.3a et V1.3b.
- Le §11 (types `weight_entry` et `weight_log`) sera ajouté avec la V1.3b, qui les implémente.
- `git diff` : 109 ajouts, 0 suppression.

### Configuration (`settings.driveSync`, par appareil)
- `{ url, secret, enabled, testedAt }`. Aucune nouvelle version de base.
- **URL acceptée** : `https://…`, ou `http://localhost` / `127.0.0.1` pour le serveur factice des tests.
- **Secret** : 8 caractères au minimum, sans quoi il ne pourrait pas être masqué sans risque.
- Changer l'URL ou le secret **désactive** l'envoi et efface le test réussi. Un champ secret laissé vide garde le secret enregistré, affiché masqué (« ••••1234 »).
- **Activation** : refusée par le service sans test réussi pour la configuration **actuelle** (`testedAt`), puis confirmée par une feuille au texte de la spec, en version V1.3a : sans la phrase sur la sauvegarde, qui arrive en V1.3b.
- **Restauration** : les réglages propres à l'appareil (`DEVICE_SETTING_KEYS` : `lastExportAt`, `lastCoachExportAt`, `driveSync`, `driveOutbox`, `driveNames`) sont relus avant le vidage et réécrits tels quels.
  - Cela remplace l'ancien traitement au cas par cas, avec le même comportement pour les deux dates d'export (aucun test existant modifié).
  - `preRestoreBackup` et tous les exports sont produits par `toHistoryExport` ou `toCoachExport`, qui ne lisent jamais `settings` : la configuration n'y entre pas.
- **Masquage** :
  - `maskUrl` affiche l'URL sous la forme `/s/[…]/` ;
  - `maskSecret` n'affiche que les 4 derniers caractères ;
  - `redact` s'applique à tout détail technique conservé ou affiché. Même si la réponse du serveur ou le message d'erreur du navigateur répète le secret ou l'URL, ils sont retirés.
  - Un test dédié (`driveSecret.test.ts`) fait subir 8 modes d'échec, chacun répétant le secret, puis parcourt la file, les noms, les contenus envoyés, la sauvegarde, l'export coach, la copie interne et la console : ni le secret ni l'identifiant du script n'y figurent.

### Client (`services/driveClient.ts`)
- Requête :
  - POST, corps `JSON.stringify(…)`, donc `text/plain;charset=UTF-8` ;
  - **aucun** en-tête, `redirect: 'follow'` ;
  - délai de 90 s par `AbortController` ;
  - `fetch` injectable ; ne lève jamais d'exception, même si `fetch` lève de façon synchrone.
- **Classement** :
  - `confirmed` : seulement un JSON objet avec `ok: true` ;
  - `rejected` : JSON avec `ok: false`. `retryable` est repris de la réponse, sinon déduit du code (`integrity`, `busy`, `drive_error`) ;
  - `unconfirmed` : réseau, délai, page HTML (statut 200 ou autre), JSON invalide ou sans `ok`, HTTP anormal.
- `chars = content.length` est toujours envoyé ; `requestId` est un nouvel identifiant (`createId`) à chaque tentative.

### File (`settings.driveOutbox`) et envoi
- **Domaine pur** (`domain/driveOutbox.ts`) :
  - intentions dédupliquées par `type:clé`, avec une **révision** incrémentée à chaque nouvelle intention ;
  - une confirmation ou un échec ne touche que la révision envoyée : une correction arrivée pendant l'envoi n'est jamais perdue (testé).
- **Transactions** : toute lecture-modification-écriture de la file se fait dans une transaction `settings`. 20 mises en file simultanées : aucune perdue (testé).
- **Ordre** : séances, puis suppressions, puis ancienneté.
- **Un seul envoi à la fois** : les passes concurrentes sont regroupées (testé, 1 requête au plus en vol).
- **Une passe tente chaque tâche une seule fois** : une intention renouvelée pendant l'envoi attend la passe suivante (2 s). Ce choix est venu d'une boucle infinie trouvée par un test.
- **Un envoi non confirmé arrête la passe**, pour ne pas enchaîner des requêtes vouées à l'échec. Les autres tâches attendent la reprise.
- **Reprises** :
  - échecs réessayables (non confirmés, ou rejetés réessayables) : 30 s, 2 min, 10 min, 1 h, puis plus de minuteur ;
  - à chaque ouverture, au retour au premier plan, au retour du réseau (`online`) et sur « Envoyer maintenant », **toutes** les tâches en attente sont tentées, quelle que soit leur heure de reprise ;
  - le minuteur ne prend que les tâches échues.
- **Erreurs non réessayables** : la tâche passe « en erreur » (Réessayer / Ignorer).
  - `regression` est traitée comme non réessayable en V1.3a, faute de sauvegarde envoyée (le §8 arrive en V1.3b).
  - Un contenu refusé par son propre schéma donne `invalid_content` : rien n'est envoyé, l'erreur est visible.
- **Jamais bloquant** : la mise en file se fait **après** l'écriture de la séance, sans être attendue (`void`), et ne lève jamais. Sans envoi actif : aucune écriture dans la file, **zéro requête** (testé).
- **Planificateur** (`driveScheduler`, monté par `DriveSyncAgent`) : démarrage, `visibilitychange`, `online`, 2 s après une mise en file, minuteur de reprise.

### Séances
- **Contenu** :
  - un `training_coach_export` 1.1 d'**une** séance, avec `weightEntries: []`, `weightWindow: null`, sélection `manual` et `sessionCount: 1` ;
  - **seulement le programme de la séance** ;
  - `activeProgramId` vaut le programme de la séance s'il est actif, sinon `null`. La spec ne le précise pas, et l'invariant exige qu'il figure dans `programs`.
  - Il est validé par `verifyCoachExportIntegrity` avant tout envoi.
- **Exportabilité** : celle de l'export coach. Séance en cours, vide ou disparue : tâche abandonnée sans erreur.
- **Déclencheurs** :
  - tout enregistrement d'une séance qui n'est pas en cours, c'est-à-dire fin, abandon et correction dans l'historique, qui passent tous par `updateWorkout` ;
  - la suppression (`deleteWorkout`).
  - `session_deleted` est mise en file à chaque suppression (si l'envoi est actif), puis **abandonnée à l'envoi** si la séance n'a jamais été envoyée : aucun nom gelé.
  - `not_in_index` vaut succès.
- **Noms gelés** (`settings.driveNames`) : enregistrés **avant** le premier `put`. Une correction de date réécrit donc le **même** fichier (testé, et en navigateur).
- **Heure `HHmm`** : lue telle qu'écrite dans `startedAt` (l'heure locale au moment de la séance), et non convertie dans le fuseau de l'appareil au moment de l'envoi. Le nom est donc identique sous tous les fuseaux (testé sous UTC, Paris, Los Angeles et UTC+14). La date vient de `date`.
- **Suffixe de libellé en double** : appliqué **à la lettre** (« 4 premiers caractères alphanumériques du `programId` »).
  - ⚠ **Point à trancher** : avec des identifiants du type `prog-2026-w40`, tous les doublons reçoivent `(prog)`, donc le **même** dossier.
  - Ce n'est pas une perte de données (les noms de fichiers restent distincts), mais le suffixe ne distingue plus rien.
  - Variantes possibles : les 4 derniers caractères alphanumériques, ou les 4 premiers après le premier tiret. À décider avant la V1.3b.

### Interface
- **Page `#/settings/drive`** :
  - champs URL et secret (17 px, 48 px, sans majuscule, correction ni vérification orthographique) ;
  - « Enregistrer », « Envoyer un test » (version, latence, « Dossier Muscu prêt » ou erreur en français, détails à la demande) ;
  - interrupteur iOS (composant `Switch`, `role="switch"`) ;
  - état (dernier envoi confirmé, en attente, en erreur, « Envoi en cours… »), « Envoyer maintenant » ;
  - liste des tâches (Réessayer / Ignorer, détails techniques expurgés).
- **« Écran de fin de séance »** : l'app n'en a pas. « Terminer » ramène à l'accueil. La ligne d'état discrète est donc placée **sous la carte « Dernière séance »** de l'accueil.
- **Puce de l'accueil** : envoi actif **et** au moins une tâche, en attente ou en erreur, mise en file depuis plus d'une heure. Elle mène à la page de réglages.
- **Alerte d'import** : si un programme existant partage le libellé de semaine (sans casse ni espaces autour), une note douce affiche le dossier calculé par la même règle. Non bloquante.
- **Chargeur de démo** (mode développement) : désactive l'envoi avant de restaurer la démo.

### Serveur factice (`scripts/fake-muscu-sync.mjs`, tests seulement)
- Il imite le vrai script :
  - POST → **302** vers `/macros/echo?user_content_key=…`, suivie en GET ;
  - en-tête CORS sur la redirection **et** sur la réponse finale, indispensable pour qu'un `fetch` en mode CORS suive la redirection ;
  - environ 18 % de **404 HTML**, la requête ayant pu être traitée ;
  - latence de 0,2 à 3 s, `busy` et `drive_error` ;
  - secret, `ping`, `put`, `mark_deleted`, refus de `_INDEX.json` et `LISEZMOI.txt`, `integrity` si `chars` ne correspond pas ;
  - préflight `OPTIONS` refusé, comme Apps Script.
- Pilotage : `/__state`, `/__config`, `/__reset` ; graine reproductible. Types : `fake-muscu-sync.d.mts`.
- Utilisé par un test d'intégration HTTP réel (Vitest) et par le scénario navigateur. Le vrai script n'est **jamais** contacté.

### Vérification
- **Tests** : 6 nouveaux fichiers, 73 tests.
  - Domaine : noms, file.
  - Client : classement, forme des requêtes, intégration HTTP.
  - File : désactivé, configuration, séances, suppression, ordre, reprises, réseau, erreurs, contenu invalide, persistance, transactions, course.
  - Secret.
  - Interface : réglages, test, activation, état, file, accessibilité, accueil, alerte d'import, démo.
- **Aucun test existant modifié.**
- **Navigateur réel** (production, 390 px, tactile, serveur factice sur une autre origine, CORS réel) : **10/10**.
  - Champs 17 px ; test (« version sync-2, réponse en 0,3 s, dossier prêt ») ; activation confirmée.
  - Séance terminée → `Semaine 37/2026-10-04_1931_Seance-A_683e1d.json`, « ✓ envoyé ».
  - 404 HTML → « en attente », puis reprise : même fichier réécrit.
  - Réseau coupé : correction en attente ; réseau rétabli : envoi **automatique** (événement `online`) sous le même nom, date corrigée.
  - Suppression → `mark_deleted`.
  - Requêtes toutes en `text/plain`.
  - Aucune erreur console, hors 404 attendues du script et réseau coupé volontairement.
- **Régression** S1–S7 et hors ligne : 9/9.
- **Reste à faire par l'utilisateur** (critère de sortie de la spec) : le test réel sur iPhone avec le vrai script.
