# Formats JSON — Carnet d'entraînement (v1.0)

Trois formats, tous en `schemaVersion: "1.0"` :

| Format | `type` | Sens | Usage |
|---|---|---|---|
| **PROGRAM_JSON** | `training_program` | coach → app | Programme de la semaine, à importer (fichier ou texte collé) |
| **HISTORY_JSON** | `training_history_export` | app → app (et coach) | Sauvegarde complète et restauration |
| **COACH_JSON** | `training_coach_export` | app → coach | Sélection de séances à envoyer au coach (V1.1). **Jamais restaurable** |

Références exécutables : [`src/schemas/program.schema.ts`](src/schemas/program.schema.ts), [`src/schemas/history.schema.ts`](src/schemas/history.schema.ts), [`src/schemas/coachExport.schema.ts`](src/schemas/coachExport.schema.ts), [`src/schemas/invariants.ts`](src/schemas/invariants.ts). Exemples valides : [`examples/program-example.json`](examples/program-example.json), [`examples/history-example.json`](examples/history-example.json), [`examples/coach-export-example.json`](examples/coach-export-example.json).

## Règles communes

- **`null` = non renseigné.** Un champ facultatif est présent avec la valeur `null`, jamais absent. Toute absence est une erreur, sauf exceptions indiquées (`preferences`, et la forme de reps non utilisée d'une série prescrite).
- **Unités** : charges en **kg** (nombres, jamais `"47 kg"`), durées en **secondes** dans l'historique (`durationSec`, `restSec`) et en **minutes** dans le programme (`estimatedDurationMin`, `targetDurationMin`).
- **Dates** : date métier `YYYY-MM-DD` ; horodatage ISO 8601 **avec offset** (`2026-10-01T18:45:00+02:00`, ou `Z`).
- **Nombres** : jamais négatifs. Répétitions et durées en secondes = entiers. Charges, vitesses et durées en minutes acceptent des décimales (`47.5`).
- **Identifiants** : texte non vide, **stable**. Un même `id` d'exercice d'une semaine à l'autre = le même exercice pour la progression.
- **Champs inconnus** : ignorés. La prévisualisation d'import les signale (« Champs ignorés : … »), sans bloquer.
- **Refus en bloc** : un fichier invalide n'est jamais importé partiellement. Le message d'erreur indique l'endroit, par exemple « la séance A contient un exercice sans identifiant ».
- **`schemaVersion`** : obligatoire.
  - Seule `"1.0"` existe aujourd'hui.
  - L'app contient une chaîne de migrations (`1.0 → 1.1 → …`) qui mettra à jour les anciens fichiers quand de nouvelles versions existeront.
  - Une version inconnue ou future est refusée avec un message clair : « version de schéma « 2.0 », non prise en charge ».

---

## PROGRAM_JSON v1.0 (`training_program`)

### Racine

| Champ | Type | Oblig. | Exemple | Règles |
|---|---|---|---|---|
| `schemaVersion` | `"1.0"` | oui | `"1.0"` | |
| `type` | `"training_program"` | oui | | Un export d'historique importé comme programme est refusé |
| `programId` | texte | oui | `"prog-2026-w40"` | **Nouveau à chaque programme.** Un `programId` déjà présent dans l'app (actif ou archivé) est **refusé** |
| `name` | texte non vide | oui | `"Programme semaine 40"` | |
| `locale` | texte | oui | `"fr-FR"` | |
| `unitSystem` | `"metric"` | oui | | Seule valeur acceptée en V1 |
| `createdAt` | ISO 8601 + offset | oui | `"2026-10-01T09:00:00+02:00"` | |
| `week` | objet | oui | voir ci-dessous | |
| `sessions` | liste (≥ 1) | oui | | `id` uniques |

**`week`** : `id` (texte, oui), `label` (texte, oui, ex. `"Semaine 40"`), `startDate` et `endDate` (`YYYY-MM-DD` ou `null`, oui).

### Séance (`sessions[]`)

| Champ | Type | Oblig. | Exemple | Règles |
|---|---|---|---|---|
| `id` | texte | oui | `"A"` | Unique dans le programme |
| `name` | texte non vide | oui | `"Séance A"` | |
| `order` | entier ≥ 1 | oui | `1` | Ordre de rotation (A → B → C → A) |
| `estimatedDurationMin` | entier ≥ 0 ou `null` | oui | `70` | |
| `exercises` | liste (≥ 1) | oui | | `id` uniques dans la séance |
| `cardio` | objet ou `null` | oui | | `{ enabled, label, targetDurationMin, notes }` |

**`cardio`** : `enabled` (booléen), `label` (texte), `targetDurationMin` (nombre ≥ 0 ou `null`), `notes` (texte ou `null`). Tous obligatoires.

### Exercice (`exercises[]`)

| Champ | Type | Oblig. | Exemple | Règles |
|---|---|---|---|---|
| `id` | texte | oui | `"chest-press-machine"` | Unique dans la séance ; **stable** d'une semaine à l'autre (clé de progression) |
| `order` | entier ≥ 1 | oui | `1` | Ordre d'affichage |
| `type` | `"strength"` | oui | | Seule valeur en V1 |
| `name` | texte non vide | oui | `"Chest Press"` | |
| `category` | texte ou `null` | oui | `"Pectoraux"` | |
| `equipment` | texte ou `null` | oui | `"Machine"` | |
| `restSec` | entier ≥ 0 ou `null` | oui | `120` | Affiché « Repos recommandé : 120 s » (pas de minuteur) |
| `notes` | texte ou `null` | oui | `"Contrôle la descente."` | **Conseil d'exécution**, affiché dans l'encart « Conseil » de l'écran exercice : 1 à 2 phrases, à l'impératif, en français, **160 caractères max**. `null` = pas d'encart |
| `sets` | liste (≥ 1) | oui | | `setNumber` uniques |

### Série prescrite (`sets[]`)

| Champ | Type | Oblig. | Exemple | Règles |
|---|---|---|---|---|
| `setNumber` | entier ≥ 1 | oui | `1` | Unique dans l'exercice |
| `targetReps` | entier ≥ 0 | **une des deux formes** | `12` | Reps exactes |
| `targetRepsMin` + `targetRepsMax` | entiers ≥ 0 | **une des deux formes** | `8`, `12` | Plage ; min ≤ max |
| `targetWeightKg` | nombre ≥ 0 ou `null` | oui | `47.5` | `null` = sans charge (poids du corps) |

- **Exclusivité** : soit `targetReps`, soit `targetRepsMin` **et** `targetRepsMax`, jamais les deux. La forme non utilisée est absente (`null` est toléré).
- **Gainage et exercices au temps** : les **secondes** se notent dans le champ des répétitions (`targetReps: 45`, `targetWeightKg: null`), et le réalisé de même.
- « Comme prévu » ne remplit que les valeurs exactes : reps exactes et charge non nulle. Il n'invente jamais une valeur à partir d'une plage.

---

## HISTORY_JSON v1.0 (`training_history_export`)

Produit par « Exporter mes données » (fichier `training-backup-AAAA-MM-JJ.json`), relu par « Restaurer une sauvegarde ». L'export est relu et vérifié par l'app avant d'être proposé : il est toujours restaurable à l'identique.

### Racine

| Champ | Type | Oblig. | Exemple | Règles |
|---|---|---|---|---|
| `schemaVersion` | `"1.0"` | oui | | |
| `type` | `"training_history_export"` | oui | | |
| `exportedAt` | ISO 8601 + offset | oui | `"2026-10-01T18:45:00+02:00"` | Instant de l'instantané des données |
| `locale` | texte | oui | `"fr-FR"` | |
| `unitSystem` | `"metric"` | oui | | |
| `activeProgramId` | texte ou `null` | oui | `"prog-2026-w40"` | Doit exister dans `programs` |
| `preferences` | objet | facultatif | `{ "unit": "kg", "theme": "light" }` | Défaut `{ kg, light }` ; `theme` ∈ `light`, `dark`, `system` (V1 : `light`) |
| `programs` | liste | oui | | Programmes complets (format PROGRAM_JSON), **archivés compris** |
| `sessions` | liste | oui | | Séances (ordre chronologique) |

### Séance réalisée (`sessions[]`)

| Champ | Type | Oblig. | Exemple | Règles |
|---|---|---|---|---|
| `id` | texte | oui | `"w-0001"` / UUID | Unique |
| `programId` | texte | oui | | Doit exister dans `programs` |
| `programSessionId` | texte | oui | `"A"` | |
| `sessionName` | texte | oui | `"Séance A"` | |
| `date` | `YYYY-MM-DD` | oui | `"2026-09-08"` | Date locale du début |
| `startedAt` | ISO + offset | oui | | |
| `completedAt` | ISO + offset ou `null` | oui | | Obligatoire si `completed`, `null` sinon |
| `durationSec` | entier ≥ 0 ou `null` | oui | `4080` | |
| `status` | `in_progress` / `completed` / `abandoned` | oui | | Voir « Statuts » |
| `executionOrder` | liste d'ids | oui | `["lat-pulldown-machine", "chest-press-machine"]` | **Ordre réel** de passage (peut différer du programme) ; sans doublon ; chaque id existe dans `exerciseRecords` |
| `exerciseRecords` | liste | oui | | Ordre du programme ; `programExerciseId` uniques |
| `cardioRecords` | liste | oui | | Peut être vide |
| `notes` | texte ou `null` | oui | | |

### Exercice réalisé (`exerciseRecords[]`)

| Champ | Type | Oblig. | Règles |
|---|---|---|---|
| `exerciseId` | texte | oui | = `programExerciseId` pour un exercice du programme |
| `exerciseName` | texte | oui | Nom au moment de la séance |
| `programExerciseId` | texte | oui | Clé de progression |
| `status` | `pending` / `completed` | oui | `completed` = validé par l'utilisateur (rien n'est verrouillé) |
| `restSec` | entier ≥ 0 ou `null` | oui | |
| `targetSets` | liste de séries prescrites | oui | **Snapshot** des objectifs au démarrage de la séance (voir ci-dessous) |
| `actualSets` | liste de séries réelles | oui | Peut être vide (exercice non commencé) |
| `sensation` | `very_easy` … `very_hard` ou `null` | oui | Voir tableau |
| `comment` | texte ou `null` | oui | Espaces de début et de fin retirés ; vide → `null` |

### Série réelle (`actualSets[]`)

| Champ | Type | Oblig. | Règles |
|---|---|---|---|
| `setNumber` | entier ≥ 1 | oui | Unique dans l'exercice |
| `actualReps` | entier ≥ 0 ou `null` | oui | `null` = non saisi |
| `actualWeightKg` | nombre ≥ 0 ou `null` | oui | `null` = non saisi ou sans charge |
| `isExtra` | booléen | oui (défaut `false`) | `true` = **série en plus**, sans objectif ; numérotation qui continue (4, 5…) |

### Cardio réel (`cardioRecords[]`)

| Champ | Type | Oblig. | Règles |
|---|---|---|---|
| `type` | `treadmill` / `bike` / `elliptical` / `rower` / `other` | oui | Tapis, Vélo, Elliptique, Rameur, Autre |
| `name` | texte | oui | Nom libre, peut être `""` (non nullable dans le format) |
| `durationSec` | entier ≥ 0 ou `null` | oui | Saisi en minutes dans l'app |
| `speedKmh` | nombre ≥ 0 ou `null` | oui | |
| `inclinePct` | nombre 0–100 ou `null` | oui | |
| `notes` | texte ou `null` | oui | |

### Sensations

| Valeur | Libellé dans l'app |
|---|---|
| `very_easy` | Très facile |
| `easy` | Facile |
| `good` | Bien |
| `hard` | Difficile |
| `very_hard` | Très difficile |
| `null` | Non renseignée |

### Statuts

- **`in_progress`** : séance en cours (une seule à la fois). Elle n'entre dans aucune statistique.
- **`completed`** : terminée par l'utilisateur, même si des exercices sont restés `pending` (la réalité prime).
- **`abandoned`** : arrêtée. **Ses données sont réelles et conservées** : elles comptent pour les charges, le volume et les records, mais pas dans le « nombre de séances ».

### Snapshot des objectifs

Au démarrage d'une séance, l'app **copie** les objectifs du programme dans `targetSets`, ainsi que `restSec`, le nom de l'exercice, `programId` et `programExerciseId`. Importer un nouveau programme ne modifie jamais les séances passées : chaque séance garde les objectifs du jour où elle a été faite. Objectif et réalisé ne sont jamais mélangés.

### Invariants (refus en bloc à la restauration)

En plus des types ci-dessus, une sauvegarde est refusée si :

1. plusieurs séances sont `in_progress` ;
2. `activeProgramId` n'est pas `null` et ne correspond à aucun `programId` de `programs` ;
3. une séance référence un `programId` absent de `programs` ;
4. des `id` de séance ou des `programId` sont en double ;
5. une séance `completed` n'a pas de `completedAt`, ou une séance `in_progress` en a un.

---

## COACH_JSON v1.0 (`training_coach_export`)

Export **partiel** : les séances choisies par l'utilisateur (Paramètres → Exporter pour le coach), en fichier `training-coach-AAAA-MM-JJ.json` ou copiées en JSON compact pour ChatGPT. Ce n'est **pas** une sauvegarde :

- la restauration le refuse : « ce fichier est un export pour le coach, pas une sauvegarde » ;
- l'import de programme le refuse aussi ;
- il ne met pas à jour la date du dernier export (rappel de sauvegarde).

### Racine

| Champ | Type | Oblig. | Règles |
|---|---|---|---|
| `schemaVersion` | `"1.0"` | oui | |
| `type` | `"training_coach_export"` | oui | |
| `exportedAt` | horodatage ISO | oui | Instant où le contenu a été figé |
| `locale` | texte | oui | `"fr-FR"` |
| `unitSystem` | `"metric"` | oui | |
| `activeProgramId` | texte ou `null` | oui | Programme actif au moment de l'export, présent dans `programs` |
| `selection` | objet | oui | Voir ci-dessous |
| `programs` | liste de programmes | oui | Le programme actif **et** ceux des séances jointes, objets PROGRAM_JSON complets |
| `sessions` | liste (≥ 1) | oui | Même forme que `sessions[]` de HISTORY_JSON, **ordre chronologique croissant** |

Pas de `preferences`.

### `selection`

| Champ | Type | Règles |
|---|---|---|
| `mode` | `"last_n"`, `"since_last_export"` ou `"manual"` | Façon dont la sélection a été faite : « N dernières », « depuis mon dernier envoi », cases cochées à la main |
| `sessionCount` | entier ≥ 1 | = nombre d'éléments de `sessions` |
| `totalExportableSessions` | entier ≥ 0 | Séances exportables dans l'app à ce moment (≥ `sessionCount`) |
| `firstSessionDate` | `YYYY-MM-DD` | `date` de la première séance de `sessions` |
| `lastSessionDate` | `YYYY-MM-DD` | `date` de la dernière séance de `sessions` |

**Séances exportables** : `completed`, ou `abandoned`, avec au moins une donnée saisie (série, cardio, sensation, commentaire ou note). Jamais une séance vide, jamais une séance `in_progress`.

### Invariants (sinon l'autotest échoue et le fichier n'est jamais livré)

1. `activeProgramId` non `null` présent dans `programs` ;
2. chaque `programId` de séance présent dans `programs` ;
3. `id` de séance et `programId` uniques ;
4. aucune séance `in_progress` ; une séance `completed` a un `completedAt` ;
5. `selection.sessionCount` = nombre de séances ; dates extrêmes et ordre chronologique cohérents.

### Exemple (abrégé)

```json
{
  "schemaVersion": "1.0",
  "type": "training_coach_export",
  "exportedAt": "2026-10-01T18:50:00+02:00",
  "locale": "fr-FR",
  "unitSystem": "metric",
  "activeProgramId": "prog-demo-w37",
  "selection": {
    "mode": "last_n",
    "sessionCount": 2,
    "totalExportableSessions": 3,
    "firstSessionDate": "2026-09-15",
    "lastSessionDate": "2026-09-22"
  },
  "programs": [{ "programId": "prog-demo-w37", "…": "programme complet" }],
  "sessions": [{ "id": "w-0002", "…": "séance complète" }, { "id": "w-0003", "…": "séance complète" }]
}
```

Fichier complet, validé par les tests : [`examples/coach-export-example.json`](examples/coach-export-example.json).

---

## Pour le coach (ChatGPT)

### Produire un programme valide — pièges à éviter

- [ ] `"schemaVersion": "1.0"` et `"type": "training_program"`.
- [ ] **`programId` nouveau à chaque programme** (ex. `"prog-2026-w41"`). L'app refuse un `programId` déjà importé.
- [ ] **Tous les champs nullables sont présents** : `category`, `equipment`, `restSec`, `notes`, `estimatedDurationMin`, `cardio`, `week.startDate`, `week.endDate`, `targetWeightKg`. Valeur `null` si non pertinent, **jamais absents**.
- [ ] Série : **soit** `targetReps`, **soit** `targetRepsMin` + `targetRepsMax`, **jamais les deux**. Min ≤ max.
- [ ] `setNumber` commence à 1 et est **unique** dans chaque exercice.
- [ ] **`id` d'exercice stables** d'une semaine à l'autre (même machine = même `id`, ex. `"chest-press-machine"`) : c'est la clé de la courbe de progression. Un nouvel `id` crée une nouvelle courbe.
- [ ] `id` de séance uniques (`"A"`, `"B"`, `"C"`) ; `id` d'exercice uniques dans une séance.
- [ ] Charges en **nombres** en kg (`47.5`, pas `"47,5 kg"`). Sans charge : `null`.
- [ ] Gainage et exercices au temps : secondes dans `targetReps`, `targetWeightKg: null`.
- [ ] Aucun texte de style ni commentaire hors des champs prévus : seulement des données.
- [ ] **`notes` de chaque exercice = conseil d'exécution court** : 1 à 2 phrases, à l'impératif, en français, **160 caractères max** (ex. « Contrôle la descente sur 2 secondes. Garde les omoplates serrées. »). `null` si rien d'utile. Pas de charges ni de répétitions dedans : elles sont dans `sets`.
- [ ] Réponds avec le JSON seul. Un bloc ` ```json … ``` ` est accepté (l'utilisateur le colle directement dans l'app), mais aucun texte autour.

### Lire un export pour le coach (partiel)

- **C'est une sélection, pas tout l'historique** : `selection` indique combien de séances sont jointes (`sessionCount`), sur combien d'exportables (`totalExportableSessions`), et sur quelle période (`firstSessionDate` → `lastSessionDate`).
- **`mode`** :
  - `"since_last_export"` : les séances depuis le dernier envoi, c'est-à-dire la suite de la conversation précédente ;
  - `"last_n"` : les N dernières ;
  - `"manual"` : choisies à la main.
- **Historique incomplet** : une séance absente du fichier n'est pas une séance manquée. Si la décision demande plus de recul (records, tendance), demande un export plus large plutôt que de conclure.
- **`programs`** : le programme actif et ceux des séances jointes, pour retrouver les objectifs et les conseils. Le programme à faire évoluer est celui de `activeProgramId`.
- Les séances se lisent exactement comme dans un export d'historique (ci-dessous).

### Lire un export d'historique

- **Objectif ≠ réalisé** : `targetSets` = ce qui était prévu ce jour-là (snapshot) ; `actualSets` = ce qui a réellement été fait. Ne déduis jamais le réalisé de l'objectif.
- **`null` = non saisi** : une série sans `actualReps` ni `actualWeightKg` n'a pas été faite. Une charge sans reps (ou l'inverse) est une saisie incomplète, laissée telle quelle.
- **Séries en plus** (`isExtra: true`) : faites en plus du programme, sans objectif.
- **Séances abandonnées** (`abandoned`) : arrêtées en cours de route, mais leurs séries sont réelles. Le `comment` donne souvent la raison.
- **`executionOrder`** : ordre réel des exercices (machine occupée, etc.).
- **Sensations** : ressenti de l'utilisateur, de `very_easy` à `very_hard`.
- **L'app ne prend aucune décision** : elle enregistre et calcule. La progression des charges et des volumes est **ta** décision, et le programme suivant est un nouveau PROGRAM_JSON.

### Texte prêt à coller dans ChatGPT

````text
Tu es mon coach de musculation. Je te joins l'export JSON de mon carnet (type "training_coach_export", schemaVersion "1.0") : une SÉLECTION de séances, pas tout l'historique.
"selection" indique combien de séances sont jointes, sur combien au total, et la période. "programs" contient mon programme actif ("activeProgramId") et ceux des séances jointes.
Lecture : "targetSets" = objectifs prévus ce jour-là ; "actualSets" = réalisé réel. null = non saisi. "isExtra": true = série en plus.
Les séances "abandoned" sont réelles mais interrompues ; "comment" et "sensation" (very_easy → very_hard) donnent le ressenti. Le gainage est noté en secondes dans les répétitions.
Analyse ma progression puis produis le programme de la semaine suivante, en JSON uniquement, au format "training_program" schemaVersion "1.0" :
- nouveau "programId" (jamais déjà utilisé), mêmes "id" d'exercices qu'avant pour les mêmes exercices ;
- séances "A", "B", "C" avec "order" 1, 2, 3 ; tous les champs nullables présents (null si non pertinent) ;
- chaque série : "setNumber" unique à partir de 1, SOIT "targetReps", SOIT "targetRepsMin" + "targetRepsMax", jamais les deux ; "targetWeightKg" en nombre (kg) ou null ;
- "restSec" en secondes, "estimatedDurationMin" en minutes, "cardio" = { enabled, label, targetDurationMin, notes } ou null ;
- "notes" de chaque exercice = conseil d'exécution court : 1 à 2 phrases, à l'impératif, en français, 160 caractères maximum (null si rien d'utile), sans charges ni répétitions.
S'il te faut plus de recul que les séances jointes, dis-le avant de produire le programme.
Réponds avec le JSON complet et valide, seul (un bloc ```json est accepté), sans commentaire à l'intérieur.
````
