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
