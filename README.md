# Carnet d'entraînement

Carnet de musculation personnel pour iPhone, sous forme de PWA : **100 % local** (aucun serveur, aucun compte, aucune IA), utilisable **hors ligne**, en français.

> **État : V1.6.0 (V1 + collage du programme, export pour le coach, suivi du poids, archive Drive, remplacement d'exercice ; correctifs V1.3.2 ; suppression des séances abandonnées par balayage ; calendrier d'activité ; correctif de stabilité des tests en CI ; mensurations)** → **https://urattems.github.io/training-app/**

```
Coach (ChatGPT) → JSON programme → app → séances réelles → historique → JSON d'export → coach
```

Le fonctionnement complet est décrit dans [`SPEC.md`](SPEC.md), les choix techniques dans [`DECISIONS.md`](DECISIONS.md), et les formats d'échange dans [`JSON_SCHEMA.md`](JSON_SCHEMA.md), qui contient une section et un texte prêt à coller pour le coach.

## Fonctionnalités

- **Programme** : import d'un JSON, par fichier ou **collé** depuis la conversation avec le coach (validation stricte, prévisualisation, messages d'erreur en français). Le nouveau programme devient actif, l'ancien est archivé.
- **Conseil d'exécution** : le champ `notes` de chaque exercice s'affiche dans un encart « Conseil » sur l'écran exercice.
- **Séance** :
  - prochaine séance proposée par rotation (A → B → C) ;
  - exercices dans n'importe quel ordre ;
  - saisie réelle, avec l'objectif en gris dans le champ et le bouton « Comme prévu » (charge : 2 décimales et 999,99 kg au plus ; répétitions : 999 au plus) ;
  - séries en plus, sensation, commentaire, cardio ;
  - **remplacer un exercice pour la séance** (machine indisponible) : crayon à côté du titre, feuille « Remplacer l'exercice ». Le prévu reste visible (« Prévu : … »), le réalisé porte le nom choisi, les séries déjà saisies sont conservées, le programme du coach n'est jamais modifié et rien ne se propage aux séances futures. Le remplaçant a sa propre courbe de progression ; possible aussi en mode « Modifier » d'une séance terminée ;
  - chaque exercice s'ouvre tout en haut, clavier fermé (jamais de retour en haut pendant la saisie) ;
  - reprise après fermeture, abandon (avec suppression proposée si la séance est vide).
- **Activité** (accueil) : calendrier des 12 dernières semaines, une case par jour, remplie les jours avec une séance terminée. Toucher une case montre les séances du jour. Pas de score ni de série de jours.
- **Historique** : détail objectif / réalisé, modification après coup (y compris le remplacement d'un exercice), suppression avec confirmation. Une séance **abandonnée** se supprime aussi d'un balayage vers la gauche dans la liste (comme Mail sur iPhone), toujours après confirmation.
- **Progression** : graphique de charge (ou de répétitions pour les exercices sans charge) sur une vraie échelle de temps, périodes 1M · 3M · 6M · 1A · Tout, carte de détail au toucher, statistiques et records.
- **Poids** (4ᵉ onglet) :
  - une pesée par jour, avec le dernier poids en placeholder ;
  - ajout à une date passée avec « + », correction du poids avec le crayon, suppression confirmée ;
  - remplacement toujours confirmé, et « C'est bien ça ? » sur une valeur inhabituelle ;
  - courbe (ordonnée ajustée aux données), statistiques (dernier poids, min, max, variation sur la période) ;
  - kg uniquement, sans objectif ni conseil.
- **Mensurations** (sous-onglet de Poids) :
  - 6 zones (Poitrine, Ventre, Taille, Biceps, Cuisse, Mollet) en cm, saisies ensemble à une date ; une prise peut être incomplète ;
  - dernière valeur en placeholder, jamais préremplie ; « Comment mesurer ? » replié ; « C'est bien ça ? » au-delà de 10 cm d'écart ;
  - un graphique à la fois (zone ou Total des mensurations), choisi dans la carte « Dernière mensuration » ; Départ, Aujourd'hui et Variation en couleur neutre ;
  - historique avec modification et suppression confirmée ; aucun score, aucun objectif.
- **Données** :
  - sauvegarde complète en JSON, restauration, rappel d'export après 14 jours ;
  - **export pour le coach** : sélection de séances (dernière, 3 ou 6 dernières, N dernières, depuis le dernier envoi, ou à la main), envoyée en fichier ou copiée pour ChatGPT ;
  - les pesées font partie de la sauvegarde (format 1.1, anciennes sauvegardes 1.0 toujours acceptées) et peuvent être jointes à l'export pour le coach (30 jours ou plus, 90 jours, tout, ou désactivées).
- **Archive Drive** (facultative, désactivée par défaut, Paramètres → Archive Drive) :
  - copie automatique vers le Drive de l'utilisateur, via son propre script « Muscu Sync », à sens unique : chaque séance, chaque pesée, toutes les pesées regroupées, une sauvegarde complète tenue à jour et une copie hebdomadaire ;
  - file d'attente hors ligne ; garde-fous (jamais de sauvegarde d'une base vide, refus de remplacer une sauvegarde plus complète) ;
  - « Renvoyer toute l'archive ».
  - Reprise après perte : voir [`JSON_SCHEMA.md`](JSON_SCHEMA.md#archive-drive-v13).
- **PWA** : installable sur l'écran d'accueil, entièrement hors ligne après la première visite, mise à jour proposée (jamais pendant une séance).

## Développement

Prérequis : Node 22 et npm.

| Commande | Rôle |
|---|---|
| `npm install` | Installe les dépendances |
| `npm run dev` | Serveur de développement : http://localhost:5173/ |
| `npm run build` | Build de production dans `dist/` (base `/training-app/`, service worker inclus) |
| `npm run preview` | Sert le build : http://localhost:4173/training-app/ |
| `npm test` | Tests Vitest (fuseau horaire des tests fixé à Europe/Paris) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run lint` | ESLint |
| `npm run icons` | Régénère les icônes de `public/` à partir des couleurs des tokens |

### Tester sur l'iPhone en réseau local

```bash
npm run dev -- --host                        # http://<IP-du-PC>:5173/
npm run build && npx vite preview --host     # http://<IP-du-PC>:4173/training-app/
```

En **HTTP sur une IP locale**, Safari n'est pas en contexte sécurisé : pas de mode hors ligne, pas de feuille de partage (l'export passe par un téléchargement) et pas de stockage persistant. L'app reste utilisable. Tout fonctionne sur l'URL HTTPS de GitHub Pages.

**Données de démo (mode dev uniquement)** : Paramètres → Développement → « Charger les données de démo » (`examples/history-example.json`). Le port 5173 a sa propre base de données. Cette section n'existe pas dans le build de production.

## Structure

```
src/
  app/          App (routes HashRouter), Shell (barre basse), filet d'erreur
  components/   UI réutilisable (Button, Card, Sheet, NumberField, TextField…)
  features/     écrans : home, program, workout, exercise, history, progress, weight, settings, import
  domain/       règles métier pures et testées (séance, rotation, stats, graphique, rappel d'export)
  schemas/      contrat JSON (Zod), invariants, migrations de schéma, messages d'erreur
  db/           base IndexedDB (Dexie, version 2 depuis la V1.2), état de connexion entre onglets
  services/     accès aux données : programme, séance, historique, export, restauration, stockage
  hooks/        lectures réactives, enregistrement automatique, export préparé
  pwa/          manifest, bannière de mise à jour
  styles/       tokens de design (couleurs, tailles…), styles de base
  i18n/         textes de l'interface
examples/       fixtures contractuelles (ne pas modifier)
scripts/        génération des icônes
```

## Stockage et sauvegardes

- Les données vivent **uniquement sur l'appareil**, dans IndexedDB (base `training-app-db`). Rien n'est envoyé nulle part.
- Sur iPhone, **les données de l'app installée sont séparées de celles de Safari** : installe l'app d'abord, puis importe ton programme depuis l'app installée.
- L'app demande au navigateur un stockage persistant (statut dans Paramètres → Informations), sans garantie absolue : Safari peut purger les données d'un site peu utilisé.
- **Protection principale : exporter régulièrement**, ou activer l'Archive Drive : une sauvegarde automatique CONFIRMÉE compte comme un export pour le rappel. Paramètres → Exporter mes données produit `training-backup-AAAA-MM-JJ.json`, à garder dans Fichiers ou iCloud. L'accueil le rappelle discrètement après 14 jours sans export. Un envoi au coach ne remplace pas cette sauvegarde et ne fait pas disparaître le rappel.

## Import, export, restauration

| Action | Où | Effet |
|---|---|---|
| Importer un programme | Paramètres, ou premier lancement | Fichier, ou « Coller le JSON » (un bloc ` ```json … ``` ` est accepté). Valide le JSON, prévisualise, puis le programme devient actif (l'ancien est archivé). Un `programId` déjà connu est refusé |
| Exporter mes données | Paramètres | **Sauvegarde complète** : fichier `training_history_export` (programmes, séances, préférences), vérifié avant d'être proposé. Feuille de partage iOS ou téléchargement |
| Exporter pour le coach | Paramètres | **Sélection de séances** : fichier `training-coach-AAAA-MM-JJ.json` (`training_coach_export`) ou « Copier pour ChatGPT » (JSON compact). Vérifié avant remise. Ne compte pas comme sauvegarde et n'est jamais restaurable |
| Restaurer une sauvegarde | Paramètres | Résumé, puis export obligatoire des données actuelles, puis remplacement complet en une opération (copie interne de sécurité conservée) |

Les formats sont détaillés dans [`JSON_SCHEMA.md`](JSON_SCHEMA.md).

## Déploiement et mises à jour

Le workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (runner `ubuntu-24.04`) vérifie le code (typecheck, lint, tests), construit l'app et la publie sur GitHub Pages **à chaque push sur `main`**.

**Publier une nouvelle version :**

1. Vérifier en local : `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
2. `git push` sur `main`.
3. Suivre l'onglet **Actions** du dépôt : les étapes *build* et *deploy* doivent passer au vert.
4. Sur l'iPhone, rouvrir l'app : la bannière « Nouvelle version disponible » apparaît (jamais pendant une séance). Toucher « Mettre à jour ». Paramètres → Informations → *Build* confirme la version.

**Mise en place initiale (déjà faite)** : dépôt public `training-app`, branche `main`, Settings → Pages → Source « GitHub Actions ». Pour un autre nom de dépôt, adapter `DEFAULT_BASE` dans [`src/pwa/manifest.ts`](src/pwa/manifest.ts).

**Installer sur l'iPhone** : Safari → https://urattems.github.io/training-app/ → Partager → **Sur l'écran d'accueil**. Ouvrir l'app depuis son icône, puis importer le programme **depuis l'app installée**.

## Limites connues

- **Stockage iOS** : Safari peut effacer les données d'une PWA peu utilisée. Seuls des exports réguliers protègent vraiment.
- **HTTPS requis** pour le mode hors ligne, l'installation complète, la feuille de partage et le stockage persistant (OK sur GitHub Pages ; indisponibles en HTTP sur IP locale).
- **Une seule unité** (kg, charges et poids) et **un seul thème** (clair). Le thème sombre est prévu au J8, facultatif.
- **Archive Drive et iOS** : iOS n'exécute rien en arrière-plan ; un envoi interrompu repart à la prochaine ouverture de l'app. À n'activer que sur l'iPhone qui sert à saisir.
- **Archive Drive et réinstallation** :
  - restaurer d'abord `Sauvegardes/sauvegarde-derniere.json`, PUIS activer l'envoi (sinon l'app demande quoi faire, sans rien écraser) ;
  - les noms de fichiers gelés sont propres à l'appareil : une séance dont la date a été corrigée avant une réinstallation peut produire un second fichier.
- **Un appareil** : pas de synchronisation. Pour changer d'iPhone, exporter puis restaurer.
- **Plusieurs onglets ou fenêtres de l'app** (surtout sur ordinateur) : lors d'une mise à jour qui fait évoluer la base (V1.2 : version 2), une ancienne version encore ouverte peut retarder la mise à jour.
  - L'app affiche alors « Ferme les autres onglets de l'app, puis rouvre-la », puis reprend d'elle-même.
  - Aucune donnée n'est touchée.
  - Sur iPhone, l'app installée et Safari ont des données séparées : le cas ne se présente qu'entre plusieurs onglets Safari.
- **Supprimer une séance et archive Drive** : la séance n'est jamais effacée du Drive (seulement notée supprimée). La sauvegarde suivante a une séance de moins : le script la refuse et l'app demande une fois « Remplacer quand même » (DECISIONS V1.3.3).
- **Mensurations** : une sauvegarde 1.2 ne peut pas être restaurée par une version plus ancienne de l'app. Tant que le script Drive n'est pas mis à jour (`sync-3`), les mensurations ne sont pas protégées contre une réinstallation par le refus de régression (DECISIONS V1.5.0).
- **Remplacer un exercice** (limites assumées, DECISIONS V1.3.2) :
  - remplacer par le nom d'un autre exercice du programme crée une courbe distincte de la sienne ;
  - la ponctuation est ignorée dans la comparaison des noms (« Squat +10 kg » = « Squat 10 kg ») ;
  - un nom sans aucune lettre ou chiffre latin (ex. 100 % cyrillique ou japonais) est refusé.
- **Feuille de partage** : dépend de Safari. En cas d'échec, l'export bascule automatiquement sur le téléchargement.
