# Carnet d'entraînement

Carnet de musculation personnel pour iPhone, sous forme de PWA : **100 % local** (aucun serveur, aucun compte, aucune IA), utilisable **hors ligne**, en français.

> **État : V1 terminée et déployée** → **https://urattems.github.io/training-app/**

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
  - saisie réelle, avec l'objectif en gris dans le champ et le bouton « Comme prévu » ;
  - séries en plus, sensation, commentaire, cardio ;
  - reprise après fermeture, abandon (avec suppression proposée si la séance est vide).
- **Historique** : détail objectif / réalisé, modification après coup, suppression avec confirmation.
- **Progression** : graphique de charge (ou de répétitions pour les exercices sans charge) sur une vraie échelle de temps, périodes 1M · 3M · 6M · 1A · Tout, carte de détail au toucher, statistiques et records.
- **Données** : export JSON (sauvegarde + envoi au coach), restauration, rappel d'export après 14 jours.
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
  features/     écrans : home, program, workout, exercise, history, progress, settings, import
  domain/       règles métier pures et testées (séance, rotation, stats, graphique, rappel d'export)
  schemas/      contrat JSON (Zod), invariants, migrations de schéma, messages d'erreur
  db/           base IndexedDB (Dexie)
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
- **Protection principale : exporter régulièrement.** Paramètres → Exporter mes données produit `training-backup-AAAA-MM-JJ.json`, à garder dans Fichiers ou iCloud. L'accueil le rappelle discrètement après 14 jours sans export.

## Import, export, restauration

| Action | Où | Effet |
|---|---|---|
| Importer un programme | Paramètres, ou premier lancement | Fichier, ou « Coller le JSON » (un bloc ` ```json … ``` ` est accepté). Valide le JSON, prévisualise, puis le programme devient actif (l'ancien est archivé). Un `programId` déjà connu est refusé |
| Exporter mes données | Paramètres | Fichier `training_history_export` (programmes, séances, préférences), vérifié avant d'être proposé. Feuille de partage iOS ou téléchargement |
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
- **Une seule unité** (kg) et **un seul thème** (clair) en V1. Le thème sombre est prévu au J8, facultatif.
- **Un appareil** : pas de synchronisation. Pour changer d'iPhone, exporter puis restaurer.
- **Feuille de partage** : dépend de Safari. En cas d'échec, l'export bascule automatiquement sur le téléchargement.
