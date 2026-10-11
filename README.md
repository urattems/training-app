# Training App

Ton carnet de musculation sur téléphone, avec **le coach IA de ton choix** (ChatGPT, Claude, Gemini…).

👉 **https://urattems.github.io/training-app/**

- **Gratuit, sans compte, sans publicité.** Tes séances restent **sur ton téléphone**.
- Fonctionne **hors connexion** une fois installée, sur **iPhone** et **Android**.
- En français, conçue pour la salle : une main, gros boutons, clavier numérique.

> Sur l'écran d'accueil du téléphone, l'app s'appelle **« Carnet »**.

## Ce que fait l'app

L'app **enregistre, affiche et calcule**. Elle ne coache pas : c'est ton IA qui joue le coach. Le circuit :

1. ton coach IA te donne un **programme** (un texte JSON) ;
2. tu le colles dans l'app ;
3. à la salle, l'app t'affiche chaque exercice avec son objectif, et tu notes ce que tu as **réellement** fait ;
4. tu renvoies tes résultats au coach en un geste ;
5. il te prépare le programme suivant. Et on recommence.

Tu as aussi : l'historique de tes séances, des courbes de progression, le suivi du poids et des mensurations, un calendrier d'activité, un thème clair ou sombre.

## 1. Installer l'app

Ouvre **https://urattems.github.io/training-app/** sur ton téléphone, puis ajoute-la à l'écran d'accueil :

- **iPhone** : dans **Safari**, touche **Partager** (le carré avec une flèche vers le haut), puis **« Sur l'écran d'accueil »**, puis **Ajouter**.
- **Android** : dans **Chrome**, touche le menu **⋮** (en haut à droite), puis **« Installer l'application »** ou **« Ajouter à l'écran d'accueil »**.

[capture à ajouter : iPhone, menu Partager → « Sur l'écran d'accueil »]

[capture à ajouter : Android, menu ⋮ → « Installer l'application »]

**Au premier lancement, l'app t'accueille avec un écran de démarrage en trois étapes** : installer l'app (avec le tutoriel iPhone ou Android, choisi automatiquement et modifiable), démarrer ton coach, importer ton programme. L'étape d'installation disparaît quand l'app est déjà ouverte depuis l'écran d'accueil. Tu retrouves cet écran à tout moment dans Paramètres → **Guide de démarrage**.

[capture à ajouter : écran de démarrage]

Ensuite, **ouvre toujours l'app depuis son icône** « Carnet ». Sur iPhone, c'est indispensable : l'app installée et Safari ne partagent pas leurs données.

Détails et cas particuliers : [Installer l'app (iPhone et Android)](docs/installation.md).

## 2. Démarrer ton coach

Dans l'app, l'écran de démarrage (ou Paramètres → **Guide de démarrage**) propose le bouton **Copier le prompt du coach** : il copie le texte ci-dessous. Ouvre l'IA de ton choix (ChatGPT, Claude, Gemini…), démarre une nouvelle conversation et colle-le :

```text
Sois mon coach de musculation pour l'app Training App. Lis d'abord le guide en entier, puis confirme que tu l'as lu ; si tu ne peux pas l'ouvrir, dis-le et je te le collerai. Ensuite, commence l'accueil. Le guide : https://raw.githubusercontent.com/urattems/training-app/main/public/coach.md
```

- Le coach te pose d'abord quelques questions (objectif, expérience, temps disponible, matériel, contraintes), te fait un récapitulatif, puis te propose ton **premier programme**.
- Si ton IA ne peut pas ouvrir le lien, ouvre toi-même le [guide du coach](https://raw.githubusercontent.com/urattems/training-app/main/public/coach.md), copie tout son texte et colle-le dans la conversation (ou envoie-lui le fichier).
- À la fin de l'accueil, le coach te donne une **fiche profil** : garde-la (dans tes notes ou sur ton ordinateur). Elle lui permettra de reprendre dans une nouvelle conversation sans tout redemander.
- Testé avec ChatGPT (gratuit et payant), Claude et Gemini. Chaque IA a sa façon de répondre : aucune garantie qu'elles se comportent toutes pareil.

## 3. Utiliser l'app

**Importer un programme**
- Dans la réponse du coach, copie le bloc de code du programme (bouton **Copier** du bloc).
- Dans l'app : **Coller le JSON** (au premier lancement, ou dans Paramètres), colle, touche **Vérifier**, puis **Importer**.
- Le nouveau programme devient actif ; l'ancien est archivé, ton historique est conservé.
- **Programme refusé** (« Texte refusé » ou « Fichier refusé ») : rien n'est importé. Touche **Copier l'erreur pour mon coach** et colle le texte dans la conversation : il contient la version de l'app, le format attendu et chaque erreur avec son emplacement. Ton coach te renverra un programme corrigé.

[capture à ajouter : « Copier l'erreur pour mon coach »]

**À la salle**
- L'accueil te propose la prochaine séance : **Commencer la séance**.
- Pour chaque exercice, l'objectif est affiché en gris ; tu notes ce que tu as **réellement** fait (le bouton **Comme prévu** recopie l'objectif quand tu l'as fait exactement).
- Ajoute une série en plus, ton ressenti, un commentaire, du cardio ; remplace un exercice si une machine est prise. Tout est enregistré à chaque saisie.
- Termine avec **Terminer la séance**.

**Renvoyer tes résultats au coach**
- Paramètres → **Exporter pour le coach** : choisis les séances (par défaut, celles depuis ton dernier envoi), puis **Copier pour ChatGPT** (ça marche avec toutes les IA) ou **Envoyer le fichier**.
- Colle-les dans la conversation avec ton coach : il analyse ce que tu as réellement fait et te prépare la suite.
- Nouvelle conversation ? Donne-lui ta fiche profil et un export récent.

## 4. Trois actions à ne pas confondre

| Action | Où | À quoi ça sert |
|---|---|---|
| **Exporter mes données** | Paramètres | **Ta sauvegarde.** Un fichier complet (programmes, séances, pesées, mensurations), le **seul** qui permet de tout **restaurer** (Paramètres → **Restaurer une sauvegarde**) ou de **changer de téléphone**. Range-le dans Fichiers, iCloud, Google Drive… |
| **Exporter pour le coach** | Paramètres | **L'envoi à ton IA.** Une sélection de séances à coller dans la conversation. **Ce n'est PAS une sauvegarde** : il ne peut pas être restauré. |
| **Archive Google Drive** | Paramètres → Option avancée → Archive Drive | **Une copie automatique, facultative**, dans ton propre Google Drive. L'app fonctionne très bien sans. |

Tes séances sont enregistrées dans l'app à chaque saisie, même hors connexion. Mais un téléphone se perd, et iPhone peut effacer les données d'une app web peu utilisée : **exporte régulièrement tes données**. L'accueil te le rappelle discrètement quand tu as fait des séances et que ton dernier export date de plus de 14 jours.

## 5. Options

- **Poids** (onglet Poids) : une pesée par jour, courbe et statistiques. Tu peux joindre tes pesées à l'export pour le coach.
- **Mensurations** (onglet Poids → Mensurations) : 6 zones en cm. Jointes au coach seulement si tu coches « Joindre mes mensurations ».
- **Thème** : Clair, Sombre ou Système (Paramètres → Préférences).
- **Archive Google Drive** (option avancée, **facultative**, tout en bas des Paramètres) : copie automatique de tes séances, pesées et sauvegardes dans ton Google Drive, via un petit script à installer toi-même (fourni). L'app fonctionne très bien sans. Guide pas à pas : [Activer l'archive Google Drive](docs/guide-drive.md).

## 6. Vie privée

Tes séances restent sur ton téléphone. Ce que tu envoies à ton IA (profil, exports) est traité par son fournisseur, selon ses conditions. Envoie seulement ce qui est utile.

L'app n'a ni compte, ni serveur, ni publicité, ni mesure d'audience, ni IA intégrée. En dehors du chargement de l'app et de ses mises à jour (depuis GitHub Pages), la seule connexion qu'elle établit est l'archive Google Drive, si tu l'actives, vers **ton** script.

## Bon à savoir

- **Un seul téléphone** : pas de synchronisation. Pour changer de téléphone : Exporter mes données sur l'ancien, Restaurer une sauvegarde sur le nouveau.
- **Mises à jour** : quand une nouvelle version est disponible, l'app affiche « Nouvelle version disponible » (jamais pendant une séance). Touche **Mettre à jour**.
- **kg uniquement**.

---

## Pour les développeurs

PWA React 19, TypeScript strict, Vite, Dexie (IndexedDB), Zod, Recharts. 100 % statique et locale : aucun serveur, aucune API, aucun compte, aucune IA intégrée. Publiée sur GitHub Pages.

**Documentation du projet**
- [`SPEC.md`](SPEC.md) : fonctionnement complet (source de vérité), complété par les addendums [`V1.3-SPEC.md`](V1.3-SPEC.md) (archive Drive) et [`V1.8-SPEC.md`](V1.8-SPEC.md) (ouverture à tous).
- [`JSON_SCHEMA.md`](JSON_SCHEMA.md) : formats d'échange (programme, sauvegarde, export coach, archive Drive).
- [`public/coach.md`](public/coach.md) : guide du coach. Les IA le lisent à son adresse brute (https://raw.githubusercontent.com/urattems/training-app/main/public/coach.md, `text/plain`) ; une copie est aussi servie sur le site (`/training-app/coach.md`), jamais interceptée ni précachée par le service worker. Des tests le vérifient contre le code (V1.8-SPEC §6).
- [`DECISIONS.md`](DECISIONS.md) : journal des décisions techniques.
- [`CLAUDE.md`](CLAUDE.md) : règles de travail du projet.
- [`docs/installation.md`](docs/installation.md), [`docs/guide-drive.md`](docs/guide-drive.md) : guides utilisateurs.
- [`docs/apps-script/muscu-sync.gs`](docs/apps-script/muscu-sync.gs) : script Google Apps Script « Muscu Sync » (`sync-3`) de l'archive Drive, sans secret ni adresse.

### Commandes

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

### Tester sur un téléphone en réseau local

```bash
npm run dev -- --host                        # http://<IP-du-PC>:5173/
npm run build && npx vite preview --host     # http://<IP-du-PC>:4173/training-app/
```

En **HTTP sur une IP locale**, le navigateur n'est pas en contexte sécurisé : pas de mode hors ligne, pas de feuille de partage (l'export passe par un téléchargement), pas de stockage persistant ni de presse-papiers. L'app reste utilisable. Tout fonctionne sur l'URL HTTPS de GitHub Pages.

**Données de démo (mode dev uniquement)** : Paramètres → Développement → « Charger les données de démo » (`examples/history-example.json`). Le port 5173 a sa propre base de données. Cette section n'existe pas dans le build de production.

### Structure

```
src/
  app/          App (routes HashRouter), Shell (barre basse), filet d'erreur
  components/   UI réutilisable (Button, Card, Sheet, NumberField, TextField…)
  features/     écrans : home, start (démarrage), program, workout, exercise, history, progress, weight, settings, import
  domain/       règles métier pures et testées (séance, rotation, stats, graphique, rappel d'export)
  schemas/      contrat JSON (Zod), invariants, migrations de schéma, messages d'erreur
  db/           base IndexedDB (Dexie, version 3 depuis la V1.5.0), état de connexion entre onglets
  services/     accès aux données : programme, séance, historique, export, restauration, stockage, Drive
  hooks/        lectures réactives, enregistrement automatique, export préparé
  pwa/          manifest, bannière de mise à jour
  styles/       tokens de design (couleurs, tailles…), styles de base
  theme/        thème clair, sombre ou système
  coach/        prompt de démarrage (source unique), texte « Copier l'erreur pour mon coach », garde-fous de la documentation
  i18n/         textes de l'interface
public/         icônes, guide du coach (coach.md)
examples/       fixtures contractuelles (ne pas modifier)
scripts/        génération des icônes, faux script Drive pour les tests
docs/           guides utilisateurs, script Apps Script de l'archive Drive (apps-script/)
```

### Stockage et formats

- Les données vivent **uniquement sur l'appareil**, dans IndexedDB (base `training-app-db`). Sur iPhone, les données de l'app installée sont séparées de celles de Safari.
- L'app demande un stockage persistant (statut dans Paramètres → Informations), sans garantie absolue.
- Formats : programme `training_program` 1.0 ; sauvegarde `training_history_export` 1.2 (lit 1.0 et 1.1) ; export coach `training_coach_export` 1.1, ou 1.2 avec les mensurations. Détail dans [`JSON_SCHEMA.md`](JSON_SCHEMA.md).

| Action | Où | Effet |
|---|---|---|
| Importer un programme | Paramètres, ou premier lancement | Fichier, ou « Coller le JSON » (un bloc ` ```json … ``` ` est accepté). Valide le JSON, prévisualise, puis le programme devient actif (l'ancien est archivé). Un `programId` déjà connu est refusé |
| Exporter mes données | Paramètres | **Sauvegarde complète** : fichier `training_history_export` (programmes, séances, pesées, mensurations, préférences ; format 1.2), vérifié avant d'être proposé. Feuille de partage ou téléchargement |
| Exporter pour le coach | Paramètres | **Sélection de séances** : fichier `training-coach-AAAA-MM-JJ.json` (`training_coach_export`) ou « Copier pour ChatGPT » (JSON compact). Vérifié avant remise. Ne compte pas comme sauvegarde et n'est jamais restaurable |
| Restaurer une sauvegarde | Paramètres | Résumé, puis export obligatoire des données actuelles, puis remplacement complet en une opération (copie interne de sécurité conservée) |

### Déploiement et mises à jour

Le workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (runner `ubuntu-24.04`) vérifie le code (typecheck, lint, tests), construit l'app et la publie sur GitHub Pages **à chaque push sur `main`**.

1. Vérifier en local : `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
2. `git push` sur `main`.
3. Suivre l'onglet **Actions** du dépôt : les étapes *build* et *deploy* doivent passer au vert.
4. Sur le téléphone, rouvrir l'app : la bannière « Nouvelle version disponible » apparaît (jamais pendant une séance). Toucher « Mettre à jour ». Paramètres → Informations → *Build* confirme la version.

**L'adresse de l'app et le nom du dépôt ne doivent jamais changer** : les données locales de chaque utilisateur sont liées à l'adresse `https://urattems.github.io/training-app/`. Mise en place initiale (déjà faite) : dépôt public `training-app`, branche `main`, Settings → Pages → Source « GitHub Actions ».

### Limites connues

- **Stockage iOS** : Safari peut effacer les données d'une PWA peu utilisée. Seuls des exports réguliers protègent vraiment.
- **HTTPS requis** pour le mode hors ligne, l'installation complète, la feuille de partage et le stockage persistant.
- **Thème sombre** : le manifeste de la PWA est statique (écran de lancement et couleur d'installation du thème clair) ; le choix du thème est propre à l'appareil et n'est pas repris par une restauration.
- **Archive Drive** : iOS n'exécute rien en arrière-plan (un envoi interrompu repart à la prochaine ouverture) ; à n'activer que sur le téléphone qui sert à saisir ; restaurer d'abord, activer ensuite ; les noms de fichiers gelés sont propres à l'appareil ; supprimer une séance demande une confirmation de plus côté Drive (DECISIONS V1.3.3) ; les mensurations ne sont protégées qu'avec le script `sync-3` (DECISIONS V1.6.2). Détails : [`docs/guide-drive.md`](docs/guide-drive.md).
- **Plusieurs onglets ou fenêtres de l'app** (surtout sur ordinateur) : lors d'une mise à jour qui fait évoluer la base (V1.2 : version 2 ; V1.5.0 : version 3), une ancienne version encore ouverte peut retarder la mise à jour. L'app affiche « Ferme les autres onglets de l'app », puis reprend d'elle-même, sans toucher aux données.
- **Mensurations** : une sauvegarde 1.2 ne peut pas être restaurée par une version plus ancienne de l'app.
- **Remplacer un exercice** (DECISIONS V1.3.2) : remplacer par le nom d'un autre exercice du programme crée une courbe distincte ; la ponctuation est ignorée dans la comparaison des noms ; un nom sans aucune lettre ou chiffre latin est refusé.
- **Feuille de partage** : dépend du navigateur. En cas d'échec, l'export bascule sur le téléchargement.
