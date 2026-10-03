# SPEC.md — Carnet d'entraînement (V1)

> Source de vérité du projet. Les mots **DOIT / INTERDIT** sont des règles fermes. **Recommandé** = Claude Code peut s'en écarter s'il documente pourquoi dans `DECISIONS.md`.

---

## 1. Vision

Un carnet d'entraînement numérique personnel : local, rapide, élégant, fiable, pensé pour iPhone. Il remplace le carnet papier.

L'app **enregistre, affiche, calcule, visualise**. Elle ne coache pas : la décision de progression appartient au coach externe.

```
Coach (ChatGPT) → JSON programme → APP → séance réelle → historique → JSON historique → Coach
```

**Test ultime :** à la salle, l'utilisateur ouvre l'app, voit « Séance A », appuie sur *Commencer*, voit l'exercice avec l'objectif, saisit 3 séries, choisit une sensation, valide, passe au suivant. Il ne se demande jamais comment l'app fonctionne.

---

## 2. Périmètre

### Inclus en V1
Import programme JSON · séances A/B/C · saisie réelle · cardio simple · sensations · commentaires · reprise de séance · historique · progression (graphique interactif + stats) · export/restauration JSON · thème clair · PWA hors ligne. Thème sombre : **optionnel, en dernier (J8)**, après validation de tout le reste.

### INTERDIT en V1
Backend, API externe, cloud/sync, compte/login, IA intégrée, analytics/tracking, RIR (même caché), timer de repos automatique, badges/points/streaks/confettis, notifications, social, publicités, achats, widgets inutiles.

> L'extensibilité se limite à : schéma versionné + migrations DB. **Pas de code mort « pour plus tard ».**

### Ajouts V1.1 (amendement, après validation de la V1)
- **V1.1a — Coller un programme** : en plus de « Choisir un fichier », l'import de programme (premier lancement et Paramètres) accepte un JSON **collé** dans une zone de texte. Même pipeline que le fichier (parse, migration, Zod, invariants, prévisualisation, confirmation), mêmes refus et messages. Seule tolérance : espaces/BOM autour du texte et **une** clôture Markdown (` ```json … ``` `) entourant le JSON ; rien d'autre n'est deviné ni réparé. Rien n'est écrit avant la confirmation.
- **V1.1a — Conseil d'exécution** : l'écran exercice affiche le champ `notes` de l'exercice du programme (déjà au contrat) dans un encart « Conseil » discret, replié sur 3 lignes si le texte est long. `notes` à `null` : rien n'est affiché.
- **V1.1b — Export pour le coach** : export **partiel** d'une sélection de séances, dans un nouveau type `training_coach_export` (§10.6), en fichier ou copié pour ChatGPT. Il ne remplace pas « Exporter mes données » (sauvegarde complète) et ne peut jamais être restauré.
- Les contrats `training_program` et `training_history_export` (§11) sont **inchangés**.

### Ajouts V1.2 — Suivi du poids (amendement, après validation de la V1.1)
- **Pesées** : une pesée par jour (date locale, poids en kg, au plus 2 décimales, jamais dans le futur). Ajout du jour, ajout à une date passée, correction du poids, suppression avec confirmation. Remplacer une pesée existante exige une confirmation explicite.
- **Onglet « Poids »** (V1.2b, §7.1, §7.11) : saisie, graphique, statistiques, liste. kg uniquement, **aucun objectif, aucun conseil, aucune interprétation**.
- **Données** (V1.2a) :
  - base IndexedDB en version 2 (nouveau store `weights`, aucun store existant modifié) ;
  - sauvegarde `training_history_export` en **1.1** avec `weightEntries` (§11.2) ;
  - export pour le coach `training_coach_export` en **1.1** avec les pesées d'une fenêtre de dates, désactivables (§10.6) ;
  - les fichiers 1.0 restent acceptés via une migration de schéma ;
  - le programme `training_program` reste en 1.0.
- Une pesée enregistrée après le dernier export compte comme donnée non sauvegardée pour le rappel d'export (§7.10).

---

## 3. Stack (recommandée)

React · TypeScript strict · Vite · `vite-plugin-pwa` · Dexie (IndexedDB) · Zod · React Router · Recharts · Lucide · Vitest + Testing Library · CSS avec variables (pas de framework CSS imposé) · ESLint.

Scripts obligatoires : `dev`, `build`, `preview`, `test`, `typecheck`, `lint`.

State : état local React + couche de données persistante (hooks/services). Pas de Redux.

---

## 4. Architecture

Séparation stricte : **UI / domaine / persistance / import-export / statistiques / graphiques**. Aucune logique métier lourde dans le JSX.

```
src/
  app/            routes, providers, shell
  components/     composants UI réutilisables
  pages/ ou features/
  domain/         types + règles métier pures
  schemas/        schémas Zod (JSON externe) + migrations de schéma
  db/             Dexie, versions, migrations DB
  services/       Program, Workout, History, Export, Import, Statistics, Settings
  hooks/  utils/  styles/  i18n/
```

Pipeline de données (une seule voie, aucun format parallèle) :

```
JSON externe → validation Zod → modèle domaine → IndexedDB
IndexedDB → modèle domaine → modèle export → JSON externe
```

Les textes UI sont centralisés (fichier de chaînes simple), sans système i18n lourd.

---

## 5. Modèle de données

### 5.1 Règles
- Identifiants **stables** (jamais le nom comme clé). Les `id` du JSON programme sont conservés ; les entités créées par l'app utilisent des UUID.
- Poids en **kg, nombres** (jamais `"47 kg"`). Durées en **secondes**. Dates persistées en **ISO 8601** avec offset ; dates métier en `YYYY-MM-DD`.
- Types forts : `TrainingProgram`, `ProgramSession`, `ProgramExercise`, `ProgramSet`, `WorkoutSession`, `WorkoutExercise`, `ActualSet`, `CardioEntry`, `Sensation`, `UserPreferences`.

### 5.2 Tables Dexie (indicatif)
`programs` · `workouts` (séance + exercices + cardio, document-oriented) · `settings` · `metadata`. `DB_VERSION = 1` avec mécanisme de migration. Ne pas sur-normaliser.

### 5.3 Snapshot d'objectifs (essentiel)
Au démarrage d'une séance, l'app **copie** dans le workout les objectifs de chaque exercice (`targetSets`, `restSec`, nom, `programId`, `programExerciseId`). L'historique ne dépend jamais du programme courant.

### 5.4 Programme actif
Un seul programme actif. Importer un nouveau programme : **le nouveau devient actif, l'ancien est archivé** (conservé, non supprimé). Les anciennes séances restent liées à leur programme/snapshot.

---

## 6. Règles métier

| Sujet | Règle |
|---|---|
| Objectif vs réalisé | Stockés séparément. Aucun écrasement. Réalisé < ou > objectif = donnée normale, pas une erreur. |
| Préremplissage | Les champs « réalisé » démarrent **vides**. L'objectif est visible en **placeholder grisé** dans le champ. Un bouton **« Comme prévu »** par série remplit la ligne en un tap (action explicite de l'utilisateur, donc valeur réelle). **Règle :** le bouton remplit chaque champ qui possède une valeur cible **exacte** (`targetReps` exact → reps ; `targetWeightKg` non `null` → charge). Il **n'invente jamais** une valeur : une plage de reps (`targetRepsMin/Max`) ne remplit pas les reps, une charge `null` ne remplit pas la charge. Si rien n'est remplissable (plage + charge `null`), le bouton est **masqué** ; si la ligne n'est que partiellement remplie, le focus passe au champ restant. |
| Nombre de séries | Vient du programme. Jamais codé en dur. |
| Série en plus | Bouton « + Série » **uniquement en bas de la liste** : `isExtra: true`, `setNumber` continue la numérotation (4, 5…), sans objectif associé. Pour les séries normales, `setNumber` identifie la série prescrite ; une série extra n'a aucune série prescrite correspondante. |
| Série non faite | Peut rester vide : `actualReps/actualWeightKg = null`. Pas comptée dans les stats. |
| Ordre des exercices | L'ordre du programme est conservé. L'utilisateur peut faire dans n'importe quel ordre ; l'ordre réel est stocké dans `executionOrder`. |
| Décimales | Saisie `47,5` ou `47.5` acceptée, normalisée en nombre. Affichage français (`47,5 kg`). |
| Prochaine séance | Rotation : séance suivante (par `order`) après la dernière séance **terminée** du programme actif, avec retour à la première. L'utilisateur peut choisir une autre séance. Premier lancement : séance d'`order` le plus bas. |
| Séance en cours | Une seule séance `in_progress` à la fois. Si elle existe : l'accueil propose **Reprendre / Abandonner** ; impossible d'en démarrer une autre avant de choisir. |
| Abandon | Passe en `abandoned`, **les données saisies sont conservées** et visibles dans l'historique. Jamais de suppression silencieuse. |
| Fin de séance | Bouton « Terminer la séance » : `completed`, `completedAt`, `durationSec`. Autorisé même si des exercices sont incomplets (la réalité prime). **Valider un exercice ≠ terminer la séance** : valider le dernier exercice ne termine jamais la séance automatiquement. |
| Édition rétroactive | Autorisée sur une séance passée (date, séries, sensation, commentaire) avec feedback clair. Les objectifs snapshot ne sont **pas** modifiables. |
| Suppression de séance | Autorisée depuis le détail historique, **avec confirmation explicite**. |
| Validation d'exercice | Sauvegarde + `completed`. Ne verrouille rien : l'exercice reste modifiable. |
| Validation des valeurs | Refuser négatifs (reps, kg, durées, vitesse). Inclinaison : 0 à 100. Ne pas être restrictif sur les valeurs hautes (l'utilisateur peut faire un record). Poids = `null` autorisé (exercices au poids du corps). |
| Convention graphique | 1 point = 1 exercice dans 1 séance = **charge maximale réellement utilisée** sur les séries réalisées. Le détail des séries s'affiche au toucher. Le graphique principal ne représente ni la charge moyenne, ni le volume, ni la meilleure série en reps (ces métriques sont dans les stats). |
| Volume | Série = reps × kg ; exercice = somme des séries ; séance = somme des exercices. Séries sans poids ou sans reps ignorées. Pas de volume pour le cardio. |
| Records | Calculés uniquement sur le réel : meilleure charge, meilleure série (reps à charge donnée), volume max par séance. |
| Texte de progression | Factuel uniquement (« +2,5 kg vs séance précédente »). **INTERDIT** : conseils (« augmente la charge »). |
| Repos | Affiché (`Repos recommandé : 120 s`) si présent. Pas de timer. |

---

## 7. Écrans et UX

### 7.1 Navigation
Barre basse à 3 onglets : **Accueil · Programme · Progression**. Roue crantée (Paramètres) en haut de l'accueil, jamais un 4e onglet. La barre est **masquée systématiquement sur l'écran exercice** (mode saisie) ; on en sort via le bouton Liste du header ou en terminant la séance.

Routes : `/`, `/program`, `/program/:sessionId`, `/workout/:workoutId`, `/workout/:workoutId/exercise/:exerciseId`, `/progress`, `/progress/:exerciseId`, `/history`, `/history/:workoutId`, `/settings`.

### 7.2 Accueil
Répond à : « Qu'est-ce que je dois faire aujourd'hui ? »
- **Prochaine séance** : nom, nombre d'exercices, durée estimée, **gros bouton « Commencer la séance »**.
- Si séance en cours : carte **« Séance X en cours — Reprendre / Abandonner »** prioritaire.
- **Dernière séance** : nom, date, durée, statut (lien vers l'historique).
- **Progression récente** : 2-3 variations factuelles (ex. « Chest Press +2,5 kg »).
- États vides : voir §7.9.

### 7.3 Programme
Séances A/B/C (extensible à D sans refonte), chacune avec sa liste d'exercices numérotés et le cardio. Chaque ligne est tappable → détail (nom, objectif, repos, dernière performance, notes). Un bouton permet de lancer la séance directement.

### 7.3b Écran séance (`/workout/:workoutId`)
Liste des exercices de la séance en cours avec leur statut (à faire / validé), progression « 2 / 6 », accès libre à n'importe quel exercice, section Cardio, et bouton **« Terminer la séance »** toujours visible. S'il reste des exercices non validés : confirmation (« 3 exercices non validés — terminer quand même ? »). Terminer enregistre la séance telle quelle, rien n'est supprimé. Bouton secondaire « Abandonner ».

### 7.4 Écran exercice (le plus important)
Ordre vertical :
1. Header : `←` précédent · « Exercice 2 sur 6 » · `→` suivant · bouton **Liste** (retour à l'écran séance, §7.3b) ; barre de progression discrète de la séance (« 2 / 6 »).
2. Nom, catégorie/équipement.
3. **Dernière fois** : charge + reps de la dernière perf réelle (« 45 kg · 10 / 10 / 9 ») ou « Aucune séance précédente. »
4. **OBJECTIF** (lecture seule) : une ligne par série. Style visuel distinct du réalisé.
5. **RÉALISÉ** : une ligne par série `[reps] [kg]` + « Comme prévu », puis « + Série ».
6. **Sensation** : 5 boutons larges (Très facile / Facile / Bien / Difficile / Très difficile), un seul choix.
7. **Commentaire** facultatif (clavier texte).
8. **Repos recommandé** si défini.
9. Bouton principal en bas : **« Valider l'exercice »**, puis passage au suivant sans repasser par la liste.

Objectif et réalisé ne doivent **jamais** pouvoir être confondus visuellement.

### 7.5 Saisie
- Reps : `inputmode="numeric"`. Poids/vitesse/inclinaison : `inputmode="decimal"`. Durée : numérique.
- Champs ≥ 48 px de haut, saisie à une main, sélection du contenu au focus.
- Autofocus/passage au champ suivant : seulement si **fiable sur iOS PWA**, sinon s'abstenir.
- Sauvegarde **à chaque modification** (debounce court + sauvegarde au blur et à `visibilitychange`).

### 7.6 Cardio
Section en fin de séance, simple et flexible. Champs : type (`treadmill`, `bike`, `elliptical`, `rower`, `other`), nom libre, durée (min), vitesse (km/h), inclinaison (%), notes. Tous optionnels sauf le type ; aucune supposition vitesse + inclinaison systématique.

### 7.7 Historique
Liste chronologique inverse : date · nom de séance · statut · durée. Détail : pour chaque exercice, **OBJECTIF puis RÉALISÉ séparés**, sensation, commentaire, cardio, ordre d'exécution. Édition et suppression (§6).

### 7.8 Progression
Sélecteur d'exercice → graphique de charge → sélecteur de période (**1M · 3M · 6M · 1A · Tout**, recalcule le domaine) → stats hiérarchisées : dernière charge, meilleure charge (record), volume, nombre de séances → historique récent de l'exercice.

Graphique : points + ligne, minimaliste, tactile. Toucher un point affiche une **carte lisible au doigt** (date, exercice, charge max, reps par série). Pas de mini-tooltip illisible. Reste fluide avec plusieurs années de données.

### 7.9 États vides et erreurs
- Premier lancement : « Bienvenue — Importe ton premier programme pour commencer » + bouton **Importer un programme JSON**. **Aucune donnée de démo** affichée comme réelle.
- Progression sans historique : message explicatif, pas de graphique vide.
- Erreurs prévues avec messages clairs : JSON invalide, fichier illisible, schéma incompatible, DB indisponible, export impossible, erreur inattendue (error boundary).
- Toute opération asynchrone a un état de chargement visible.

### 7.10 Paramètres
**Données** : Importer un programme · Exporter mes données · Restaurer une sauvegarde.
**Préférences** : unité (kg) · thème (clair en V1 ; sombre/système ajoutés au J8).
**Informations** : version, nom de l'app (constante unique modifiable).
Rappel d'export : bandeau discret si dernier export > 14 jours **et** ≥ 1 séance terminée depuis.

**Complément V1.1 :**
- **Données** : « Coller le JSON » à côté de l'import de programme par fichier (V1.1a).
- **Données** : « Exporter pour le coach » (§10.6), à côté de « Exporter mes données », qui reste inchangé (sauvegarde complète).
- Une ligne d'aide sous chacun distingue la sauvegarde (restaurable) de l'envoi au coach (sélection, non restaurable).
- Un envoi au coach ne compte pas comme sauvegarde : il ne modifie pas le rappel d'export.

---

## 8. Design system

**Direction :** application iOS moderne, claire, minimaliste, premium. **Pas** un dashboard SaaS, ni gamer, ni « IA », ni néon, ni template Tailwind.

- **Fond** crème/beige très clair ; **surfaces** blanc cassé chaud ; **texte** charbon ; **secondaire** gris doux ; **accent** pastel discret (sélection/interactif).
- **Fonctionnel** : vert doux = validation, orange doux = attention, rouge doux = erreur.
- **Typo** : pile système iOS (`-apple-system`, SF), chiffres tabulaires (`font-variant-numeric: tabular-nums`), poids modérés, hiérarchie claire.
- **Formes** : coins légèrement arrondis, pas de capsules partout, ombres très légères, beaucoup d'espace blanc.
- **Animations** : transitions courtes, feedback d'état ; respect de `prefers-reduced-motion`. Pas de confettis, rebonds ni effets 3D.
- **Thème sombre (optionnel, jalon J8)** : à faire seulement quand tout le reste est validé. Dès J2, **tous les styles passent par les tokens CSS** pour que le sombre soit un simple jeu de variables alternatif, sans refonte. Vrai thème conçu (pas d'inversion). Le clair reste la référence.
- **Tokens** : toutes les couleurs, surfaces, rayons, ombres, espacements, tailles et transitions en variables CSS centralisées. Pas de hex dispersés.
- **Accessibilité** : labels, `aria-label` sur icônes, focus visible, contraste correct, cibles ≥ 44 px.

---

## 9. PWA et iOS

- Manifest (nom, icônes, `display: standalone`, couleurs), `apple-touch-icon`, service worker (precache des assets), balises meta iOS.
- Safe areas : `env(safe-area-inset-top/bottom)`, `viewport-fit=cover`. Barre basse non collée à la zone du bas.
- Fonctionnement **100 % hors ligne** après première visite : consulter, démarrer, saisir, modifier, terminer, historique, graphiques.
- **Stockage iOS :** appeler `navigator.storage.persist()` au démarrage (silencieux si refusé). Safari peut purger les données d'un site peu utilisé : le **rappel d'export** (§7.10) est la protection principale.
- Portrait prioritaire ; tablette et desktop restent utilisables (mobile conçu d'abord).
- Icône simple et cohérente avec la palette, sans y passer de temps.

---

## 10. Import / export / restauration

Trois opérations **distinctes**, jamais confondues.

### 10.1 Importer un programme
`input type="file" accept=".json,application/json"` → lecture → parse → validation Zod → vérification `schemaVersion` → **prévisualisation** (nom, semaine, nb de séances, nb d'exercices) → Annuler / Importer → le nouveau programme devient actif, l'ancien est archivé. **Jamais d'import partiel ou silencieux** : tout fichier invalide est refusé en bloc.

Erreurs lisibles, ex. : « Import impossible : la séance A contient un exercice sans identifiant. » Les détails techniques sont en option (« Afficher les détails »).

### 10.2 Exporter mes données
JSON `training_history_export`. **Ce format unique sert à la fois d'export pour le coach et de sauvegarde/restauration V1** (pas de second schéma). Il contient les programmes (y compris archivés), les séances, `activeProgramId` et `preferences`. Fichier : `training-backup-YYYY-MM-DD.json`. **Sur iOS : Web Share API en priorité** (feuille de partage → Fichiers/AirDrop/Messages), **fallback téléchargement**. Ne pas dépendre de Web Share. Mémoriser la date du dernier export.

### 10.3 Restaurer une sauvegarde
Sélection du fichier → validation → résumé (date d'export, version du schéma, nb de programmes, nb de séances) → confirmation explicite → **export automatique des données actuelles avant remplacement** → restauration. Jamais de suppression silencieuse.

### 10.4 Versionnage
`schemaVersion: "1.0"` obligatoire dans tout fichier. Le code contient une chaîne de migrations (`1.0 → 1.1 → 2.0`) ; une version future non supportée est refusée proprement avec un message clair.

### 10.5 Invariants vérifiés à l'import et à la restauration
En plus de la validation Zod, le fichier est **refusé en bloc** (message clair, rien d'écrit) si :
- plusieurs séances sont `in_progress` ;
- `activeProgramId` est non-null mais ne correspond à aucun `programId` de `programs[]` ;
- une séance référence un `programId` absent de `programs[]` ;
- des `id` de séance ou de programme sont en doublon ;
- une séance `completed` n'a pas de `completedAt` (ou une `in_progress` en a un).

### 10.6 Export pour le coach (amendement V1.1b)
Export **partiel**, distinct de la sauvegarde (§10.2) : il sert uniquement à envoyer une sélection de séances au coach.

**Écran de sélection** (Paramètres → Données → « Exporter pour le coach ») :
- liste des séances exportables, de la plus récente à la plus ancienne, avec case à cocher (cible ≥ 44 px), date, nom, statut et durée ;
- sont exportables les séances `completed` et `abandoned` **ayant au moins une donnée saisie** ; jamais une séance vide ni `in_progress` ;
- raccourcis qui cochent la liste :
  - « Dernière séance », « 3 dernières », « 6 dernières » ;
  - un champ « N dernières » (clavier numérique) ;
  - « Depuis mon dernier envoi au coach » : sans envoi précédent, tout est coché et le texte le dit.
- tout reste ajustable à la main ;
- résumé en direct (« 3 séances · 28 sept. au 2 oct. ») ;
- aucune séance exportable : état vide clair, boutons désactivés.

**Format** `training_coach_export`, `schemaVersion: "1.0"`. Racine :
- `exportedAt`, `locale`, `unitSystem`, `activeProgramId` (string|null) ;
- `selection` : `mode` (`last_n | since_last_export | manual`), `sessionCount`, `totalExportableSessions`, `firstSessionDate`, `lastSessionDate` ;
- `programs[]` : le programme actif et ceux référencés par les séances choisies, en objets complets ;
- `sessions[]` : même forme qu'au §11.2, en ordre chronologique croissant ;
- pas de `preferences`.

**Invariants**, en plus de Zod. Le fichier est refusé si l'un d'eux n'est pas respecté :
- `activeProgramId`, s'il n'est pas null, est présent dans `programs[]` ;
- le `programId` de chaque séance est présent dans `programs[]` ;
- les identifiants sont uniques ;
- aucune séance n'est `in_progress` ;
- `selection.sessionCount` = `sessions.length` ;
- les dates de `selection` correspondent à la première et à la dernière séance.

**Autotest avant remise** : le texte livré est relu avec ce schéma et ces invariants ; s'il échoue, il n'est jamais livré.

**Sécurité** :
- la restauration et l'import de programme **refusent** ce type avec un message français explicite (« Ce fichier est un export pour le coach, pas une sauvegarde. Pour restaurer, utilise un fichier « Exporter mes données ». ») ;
- un export partiel ne peut jamais remplacer les données.

**Date du dernier envoi** :
- l'export pour le coach n'écrit **jamais** `lastExportAt` ;
- il écrit son propre réglage `lastCoachExportAt` (table `settings`, sans migration de base), uniquement si l'envoi a réellement eu lieu (partage abouti, téléchargement déclenché, copie réussie) ;
- la valeur écrite est l'instant où le contenu a été figé.

**Remise** :
- partage natif si disponible, sinon téléchargement, sous le nom `training-coach-YYYY-MM-DD.json` ;
- le fichier est préparé à l'avance, après un léger délai à chaque changement de sélection : le partage part directement dans le geste, et les boutons restent désactivés tant que le fichier n'est pas prêt.

**« Copier pour ChatGPT »** :
- `navigator.clipboard.writeText` est appelé dans le geste avec le texte déjà préparé ;
- le texte est le JSON **compact** seul, sans aucun texte ajouté ;
- presse-papiers indisponible ou refusé : repli clair vers le téléchargement du fichier ;
- une copie réussie affiche une confirmation discrète « Copié ».

**Complément V1.2 — pesées dans l'export pour le coach** (`schemaVersion: "1.1"`) :
- `weightEntries` : pesées compactes `{ date, weightKg }` (sans `recordedAt`), triées par date croissante ;
- `weightWindow` : `{ mode, from, to, count }`, ou `null` quand les pesées sont désactivées (alors `weightEntries` est vide) ;
- `mode` :
  - `auto_30d` (par défaut) : `from` = la plus ancienne entre la date de la plus ancienne séance sélectionnée et aujourd'hui − 30 jours ; `to` = aujourd'hui ;
  - `days_90` : les 90 derniers jours ;
  - `all` : tout l'historique.
- **Invariants ajoutés** :
  - dates uniques et strictement croissantes, comprises dans `[from, to]` ;
  - `count` = `weightEntries.length` ;
  - `weightWindow` null ⇒ `weightEntries` vide.
- Un fichier 1.0 est migré (`weightEntries: []`, `weightWindow: null`) ; l'autotest avant remise s'applique au format 1.1 ;
- la restauration et l'import de programme refusent toujours ce type, en 1.0 comme en 1.1.

---

## 11. Contrats JSON (v1.0)

Les exemples complets sont dans `examples/`. Le JSON décrit des **données métier**, jamais de l'apparence (aucune couleur, aucun style).

### 11.1 Programme (`type: "training_program"`)

| Champ | Type | Oblig. | Notes |
|---|---|---|---|
| `schemaVersion` | `"1.0"` | oui | |
| `type` | `"training_program"` | oui | |
| `programId` | string | oui | stable |
| `name` | string | oui | |
| `locale` | string | oui | `fr-FR` |
| `unitSystem` | `"metric"` | oui | seul supporté en V1 |
| `createdAt` | ISO datetime | oui | |
| `week` | `{id, label, startDate|null, endDate|null}` | oui | |
| `sessions[]` | liste | oui | ≥ 1 |

**Session :** `id` (string, oblig.), `name`, `order` (int ≥ 1), `estimatedDurationMin` (int|null), `exercises[]` (≥ 1), `cardio` (objet|null).

**Exercice :** `id` (stable, oblig.), `order`, `type` (`"strength"`), `name`, `category` (string|null), `equipment` (string|null), `restSec` (int|null), `notes` (string|null), `sets[]` (≥ 1).

**Série prescrite :** `setNumber` (int ≥ 1, unique dans l'exercice), puis **soit** `targetReps` (int ≥ 0) **soit** `targetRepsMin` + `targetRepsMax` (jamais les deux), et `targetWeightKg` (nombre ≥ 0 | `null`).

**Cardio programmé :** `{ enabled, label, targetDurationMin|null, notes|null }`.

### 11.2 Historique (`type: "training_history_export"`)

Racine : `schemaVersion`, `type`, `exportedAt`, `locale`, `unitSystem`, `activeProgramId` (string|null), `preferences` (`{ unit: "kg", theme: "light|dark|system" }`, optionnel à l'import avec valeurs par défaut ; le schéma accepte `dark` et `system` pour la compatibilité future, mais **en V1 l'UI ne propose et n'utilise que `light`**), `programs[]` (objets programme complets, y compris archivés), `sessions[]`.

**Séance :** `id`, `programId`, `programSessionId`, `sessionName`, `date` (`YYYY-MM-DD`), `startedAt`, `completedAt|null`, `durationSec|null`, `status` (`in_progress | completed | abandoned`), `executionOrder[]` (liste de `programExerciseId`), `exerciseRecords[]`, `cardioRecords[]`, `notes|null`.

**Exercice réalisé :** `exerciseId`, `exerciseName`, `programExerciseId`, `status` (`pending | completed`), `restSec|null`, `targetSets[]` (**snapshot**), `actualSets[]`, `sensation` (`very_easy | easy | good | hard | very_hard | null`), `comment|null`.

**Série réelle :** `setNumber`, `actualReps` (int ≥ 0 | null), `actualWeightKg` (nombre ≥ 0 | null), `isExtra` (bool, défaut `false`).

**Cardio réel :** `type` (`treadmill | bike | elliptical | rower | other`), `name`, `durationSec|null`, `speedKmh|null`, `inclinePct|null`, `notes|null`.

Les champs non pertinents sont `null`, jamais absents.

**Complément V1.2 — `training_history_export` en `schemaVersion: "1.1"`** :
- racine : **`weightEntries[]`** (obligatoire, peut être vide), trié par date croissante à l'export ;
- **Pesée** :
  - `date` (`YYYY-MM-DD`, date locale de la mesure, unique : une pesée par jour) ;
  - `weightKg` (nombre fini > 0, au plus 2 décimales, jamais arrondi silencieusement) ;
  - `recordedAt` (ISO avec offset local, instant de la dernière écriture : saisie ou correction).
- **Invariants ajoutés** (refus en bloc) : dates uniques, date réelle, poids valide, `recordedAt` ISO valide, aucune date dans le futur (par rapport à la date locale de l'appareil) ;
- **Migration de schéma 1.0 → 1.1** : ajoute `weightEntries: []`. Les fichiers 1.0, dont les sauvegardes faites avant la V1.2, restent acceptés ; l'app n'exporte plus qu'en 1.1.
- **Restauration** :
  - les pesées sont remplacées dans la même transaction unique ; la copie interne (`preRestoreBackup`) et l'export de sécurité les contiennent ;
  - le résumé indique le nombre de pesées du fichier ;
  - si le fichier n'en contient aucune alors que l'app en a, un avertissement visible le signale.

---

## 12. Tests

**Métier (obligatoires, prioritaires)** : objectif ≠ réalisation · volume · records · stats sur réel uniquement · séries de graphiques (`getExerciseLoadHistory`, `getExerciseVolumeHistory`, `getExerciseRepHistory`) · snapshot conservé après nouvel import · reprise/abandon · export puis restauration (aller-retour sans perte) · migrations.

**Validation JSON (10 cas)** : minimal valide · complet valide · champ manquant · mauvais type · mauvais `schemaVersion` · exercice sans id · série sans numéro · charge négative · reps négatives · séance sans id.

**UI (bonus, ciblés)** : démarrer une séance · remplir une série · valider un exercice · naviguer entre exercices (hors ordre) · reprendre une séance · importer un programme · afficher la progression.

Les deux fichiers `examples/` doivent passer la validation et alimenter les tests.

---

## 13. Jalons (validation entre chaque)

| # | Contenu | Critère de sortie |
|---|---|---|
| **J0** | Inspection repo, Node/npm, plan d'architecture, `DECISIONS.md` initial | Plan validé |
| **J1** | Types, schémas Zod, Dexie, migrations, services, import/export (sans UI) | Tests métier + 10 cas JSON verts ; aller-retour export/restauration OK |
| **J2** | Design tokens, shell, navigation, premier lancement, import programme avec prévisualisation | Import réel d'`examples/program-example.json` |
| **J3** | Accueil, Programme, séance, écran exercice, saisie réelle, sensation, commentaire, cardio, reprise/abandon | Scénarios 2, 3, 4 passent, données persistées après refresh |
| **J4** | Historique, détail, édition, suppression, stats, records, graphique interactif, périodes | Scénario 6 passe avec `history-example.json` |
| **J5** | Paramètres, export (Web Share + fallback), restauration + export de sécurité, rappel d'export, `storage.persist` | Scénario 5 passe |
| **J6** | PWA (manifest, SW, offline, safe areas), états vides/erreurs | Build prod testé en offline |
| **J7** | Polish, régression complète, README, `JSON_SCHEMA.md`, `DECISIONS.md` | Definition of Done |
| **J8** (optionnel) | Thème sombre complet (écrans, graphiques, états) | Aucun écran cassé en sombre ; le clair est inchangé |
| **V1.1a** | Coller un programme (zone de texte, presse-papiers, même pipeline que le fichier) · encart « Conseil » (`notes` de l'exercice) | Collage valide (avec/sans clôture Markdown), JSON invalide, `programId` existant, champs ignorés, rien d'écrit avant confirmation, presse-papiers indisponible ; Conseil affiché/absent/replié ; vérifié en navigateur réel à 390 px |
| **V1.1b** | Export pour le coach (§10.6) : sélection de séances, fichier `training_coach_export`, « Copier pour ChatGPT » · `JSON_SCHEMA.md`, exemple validé | Raccourcis de sélection, contenu exact, autotest, refus par la restauration et l'import, `lastExportAt` intact, `lastCoachExportAt` seulement en cas de succès ; régression complète (390 px, production, hors ligne) |
| **V1.2a** | Pesées sans interface : modèle et domaine (validation, avertissements doux, périodes, stats), base v2 (`weights`), sauvegarde 1.1 + migration 1.0 → 1.1, restauration atomique, export coach 1.1 (fenêtre), rappel d'export, `weightService`, `JSON_SCHEMA.md` | Base v1 remplie rouverte en v2 intacte ; aller-retour avec pesées ; fichiers 1.0 acceptés ; refus des fichiers invalides ; fenêtres coach ; fuseaux horaires (UTC, Paris, Los Angeles, UTC+14) ; fixtures existantes intactes |
| **V1.2b** | Onglet « Poids » (§7.11) : saisie du jour, ajout daté, remplacement confirmé, graphique et stats, liste, crayon et poubelle ; section « Pesées » de l'export pour le coach ; pesées dans le résumé de restauration | Navigation 4 onglets à 390 et 360 px ; tous les parcours de saisie ; stats et graphique recalculés ; accessibilité ; régression complète en navigateur réel (base v1 rouverte, S1–S7, hors ligne) |

### Compte rendu de fin de jalon (obligatoire)
1. Ce qui a été fait · 2. Fichiers créés/modifiés · 3. Tests exécutés · 4. Résultats (typecheck, lint, test, build) · 5. Décisions prises (aussi dans `DECISIONS.md`) · 6. Ce qui reste.
**Aucune modification de `SPEC.md` sans prévenir et attendre l'accord.** Puis arrêt et attente de validation.

### Scénarios de test manuel
1. Premier lancement → import programme → affichage correct.
2. Séance A, 3 séries, sensation, commentaire, validation → fermer/rouvrir → données identiques.
3. Quitter en cours de séance → rouvrir → reprendre.
4. Faire l'exercice 3 avant le 1 → tout fonctionne (stats, ordre réel).
5. Exporter → réinitialiser → restaurer → données revenues.
6. Progression → changer de période → toucher un point → carte lisible.
7. Importer un JSON invalide → refus propre, rien d'écrit.

---

## 14. Definition of Done

Le projet n'est **pas** terminé si l'un de ces points échoue : build prod · typecheck · lint · tests · import/export/restauration fonctionnels · données persistées au refresh · objectifs jamais écrasés · séances interrompues reprenables · JSON validé avec erreurs lisibles · graphique interactif · clavier numérique correct sur iPhone · PWA installable et utilisable hors ligne.

Une fonctionnalité est terminée quand : le bouton fonctionne, la donnée est persistée, l'UI reflète l'état, l'état survit au refresh, les erreurs sont gérées, le mobile est confortable.

---

## 14b. Definition of Done — J8 (thème sombre, optionnel)
La V1 est considérée terminée à J7 **sans** thème sombre. Si J8 est réalisé : thème sombre fonctionnel · aucun écran cassé · graphiques, états vides/erreurs et formulaires adaptés · thème clair strictement inchangé · sélecteur de thème (clair / sombre / système) dans Paramètres.

---

## 15. Décisions tranchées (par rapport au premier cahier des charges)

| Point flou | Décision |
|---|---|
| Virgule vs point décimal | Les deux acceptés, normalisés en nombre |
| Préremplissage du réalisé | Champs vides + objectif en placeholder + bouton « Comme prévu » |
| Charge du graphique | Charge max réelle par exercice et par séance ; séries au toucher |
| Import vs remplacement | Nouveau programme actif, ancien archivé |
| Séance en cours + nouvelle séance | Interdit : Reprendre ou Abandonner d'abord |
| Choix de la prochaine séance | Rotation après la dernière terminée, modifiable |
| Export sur iOS | Web Share en priorité, téléchargement en secours |
| Purge possible d'IndexedDB sur iOS | `storage.persist()` + rappel d'export |
| Séries en plus / en moins | Autorisées (`isExtra`, valeurs `null`) |
| Statut `not_started` | Supprimé du contrat (aucun usage) |
| Import/restauration incohérents | Refus en bloc via invariants §10.5 |
| Édition/suppression rétroactive | Autorisées, suppression avec confirmation |
| Extensibilité | Schéma versionné + migrations uniquement, pas de code spéculatif |
| Imposition de la stack | Recommandée ; écart autorisé s'il est documenté |
| Thème sombre | Optionnel, jalon J8 final ; tokens CSS dès J2 pour le permettre sans refonte |
| Export vs sauvegarde | Un seul format `training_history_export` (+ `activeProgramId`, `preferences`) |
| Barre basse sur l'écran exercice | Masquée systématiquement ; bouton Liste dans le header |
| Fin de séance | Écran séance avec « Terminer » explicite ; valider un exercice ne termine rien |
| « Comme prévu » | Remplit uniquement les valeurs cibles exactes ; jamais de valeur inventée (plage de reps ou charge `null` = champ laissé vide, bouton masqué si rien à remplir) |
| `+ Série` | Uniquement en bas de liste, numérotation continue |
