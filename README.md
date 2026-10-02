# Carnet d'entraînement

Carnet de musculation personnel pour iPhone, sous forme de PWA : **100 % local** (aucun serveur, aucun compte, aucune IA), utilisable **hors ligne**, en français.

Coach → JSON programme → **app** → séances réelles → historique → JSON d'export → coach.

- Spécification : [`SPEC.md`](SPEC.md) · Décisions techniques : [`DECISIONS.md`](DECISIONS.md)
- Fixtures contractuelles : [`examples/program-example.json`](examples/program-example.json), [`examples/history-example.json`](examples/history-example.json)

## Commandes

Prérequis : Node 22 et npm.

| Commande | Rôle |
|---|---|
| `npm install` | Installe les dépendances |
| `npm run dev` | Serveur de développement (http://localhost:5173/) |
| `npm run build` | Build de production dans `dist/` (base `/training-app/`, service worker inclus) |
| `npm run preview` | Sert le build de production (http://localhost:4173/training-app/) |
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run lint` | ESLint |
| `npm run icons` | Régénère les icônes de `public/` depuis les tokens de couleur |

## Tester sur l'iPhone en réseau local

```bash
npm run dev -- --host        # puis http://<IP-du-PC>:5173/ dans Safari
npm run build && npx vite preview --host   # build de prod : http://<IP-du-PC>:4173/training-app/
```

En **HTTP sur une IP locale**, Safari n'est pas en « contexte sécurisé ». L'app fonctionne, mais :

- pas de **service worker**, donc pas de mode hors ligne ni d'installation complète ;
- pas de **feuille de partage** : l'export passe par un téléchargement de fichier ;
- pas de **stockage persistant** : Paramètres → Informations affiche « indisponible ».

Tout cela fonctionne en HTTPS, donc une fois l'app déployée sur GitHub Pages.

**Données de démo (mode dev uniquement)** : Paramètres → Développement → « Charger les données de démo » charge `examples/history-example.json`. Le port 5173 est une autre origine que la preview (4173) : sa base de données est distincte, et tes vraies données ne sont jamais touchées. Cette section n'existe pas dans le build de production.

## Déploiement sur GitHub Pages (à faire toi-même)

Le workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) vérifie le code (typecheck, lint, tests), construit l'app et la publie sur GitHub Pages **à chaque push sur `main`**. Aucun serveur à gérer.

### 1. Créer le dépôt sur GitHub

1. Sur https://github.com/new, nomme le dépôt **exactement `training-app`**. L'app est construite pour l'adresse `/training-app/` ; pour un autre nom, voir l'étape 6.
2. Visibilité : **Public**. GitHub Pages est gratuit pour les dépôts publics ; un dépôt privé exige un abonnement payant. Le dépôt ne contient que le code : tes séances restent sur ton iPhone.
3. Ne coche rien (ni README, ni .gitignore, ni licence), puis « Create repository ».

### 2. Relier le dépôt local et envoyer le code

Dans PowerShell, depuis `C:\dev\training-app` :

```powershell
git branch -M main
git remote add origin https://github.com/<ton-utilisateur>/training-app.git
git push -u origin main
```

`git branch -M main` renomme la branche locale `master` en `main`, celle que surveille le workflow.

### 3. Activer GitHub Pages

Sur GitHub : dépôt → **Settings** → **Pages** → *Build and deployment* → *Source* : **GitHub Actions**.

### 4. Lancer le déploiement

Onglet **Actions** → workflow « Déploiement GitHub Pages ». S'il a échoué parce que Pages n'était pas encore activé au moment du push, ouvre-le et clique sur **Re-run all jobs** (ou **Run workflow**). Les deux étapes (*build*, puis *deploy*) doivent finir en vert.

### 5. Adresse de l'app

**https://\<ton-utilisateur\>.github.io/training-app/**

### 6. (Optionnel) Autre nom de dépôt

Remplace `DEFAULT_BASE` dans [`src/pwa/manifest.ts`](src/pwa/manifest.ts) par `'/<nom-du-depot>/'`, puis commit et push. Le manifest, les icônes et le service worker suivent automatiquement.

### 7. Installer sur l'iPhone, puis importer le programme

1. Ouvre l'adresse de l'app dans **Safari**.
2. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. **Ouvre l'app depuis son icône** sur l'écran d'accueil, puis **importe ton programme depuis l'app installée** (Paramètres → Importer un programme, ou « Importer un programme JSON » au premier lancement).
   > Sur iPhone, les données de l'app installée sont **séparées de celles de Safari**. Un programme importé dans Safari n'apparaît pas dans l'app de l'écran d'accueil. Installe d'abord, importe ensuite.
4. Après la première ouverture, l'app fonctionne **sans réseau** (salle de sport en sous-sol).

### 8. Mises à jour

Chaque push sur `main` redéploie l'app. Au lancement suivant, l'app propose « Nouvelle version disponible — Mettre à jour ». Cette proposition n'apparaît **jamais pendant une séance en cours**, et rien ne se recharge sans ton accord. Paramètres → Informations → *Build* indique la version en service.

### 9. Sauvegardes

Les données vivent uniquement sur l'iPhone. **Exporte-les régulièrement** (Paramètres → Exporter mes données) : l'accueil le rappelle discrètement après 14 jours sans export. Le fichier sert aussi à **restaurer** (Paramètres → Restaurer une sauvegarde) et à envoyer ton historique au coach.
