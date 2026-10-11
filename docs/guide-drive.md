# Activer l'archive Google Drive (option avancée)

> **Facultatif.** L'app fonctionne entièrement sans cette option.

**Trois actions à ne pas confondre**, toutes dans Paramètres :
- **Exporter mes données** : **ta sauvegarde**, le seul fichier qui permet de tout restaurer ou de changer de téléphone ;
- **Exporter pour le coach** : l'**envoi à ton IA** (une sélection de séances) ; ce n'est **pas** une sauvegarde ;
- **Archive Google Drive** (ce guide) : une **copie automatique, facultative**, dans ton propre Google Drive.

L'archive Google Drive envoie automatiquement une **copie** de tes données dans **ton** Google Drive, dans un dossier `Muscu` :

- chaque séance terminée (un fichier par séance) ;
- chaque pesée, et toutes les pesées regroupées ;
- une **sauvegarde complète** tenue à jour, plus une copie datée chaque semaine.

Elle passe par un petit programme, le script **« Muscu Sync »**, que tu installes **toi-même** dans ton compte Google. Personne d'autre que toi n'y a accès. L'envoi est **à sens unique** : l'app écrit dans ton Drive, et le script ne renvoie jamais le contenu de tes fichiers.

**Compte 15 à 20 minutes.** L'installation du script se fait sur un **ordinateur** ; la fin se fait sur le téléphone.

---

## Avant de commencer

- Il te faut un **compte Google** (une adresse Gmail suffit). Pas de compte ? Crée-le sur https://accounts.google.com/signup.
- Active l'archive **seulement sur le téléphone qui te sert à noter tes séances**. Un deuxième appareil enverrait ses propres sauvegardes, moins complètes.
- **Tu viens de réinstaller l'app ou de changer de téléphone ?** Restaure d'abord ta sauvegarde (voir [Restaurer depuis ton Drive](#restaurer-depuis-ton-drive)), **puis** active l'archive.

## Étape 1 — Copier le code du script

Le code du script est dans ce dépôt : [`docs/apps-script/muscu-sync.gs`](apps-script/muscu-sync.gs) (version `sync-3`). Il ne contient ni secret ni adresse : ton code secret se règle à part, à l'étape 3.

1. Sur l'ordinateur, ouvre le fichier : https://github.com/urattems/training-app/blob/main/docs/apps-script/muscu-sync.gs
2. Clique sur l'icône **Copier** (« Copy raw file », en haut à droite du code) pour copier **tout** le fichier.

## Étape 2 — Créer le projet Apps Script

1. Ouvre **https://script.google.com** et connecte-toi avec ton compte Google.
2. Clique sur **Nouveau projet**.
3. En haut à gauche, clique sur « Projet sans titre » et renomme-le **Muscu Sync**.
4. Dans le fichier `Code.gs`, **efface tout** le contenu présent, puis **colle** le code copié à l'étape 1.
5. Clique sur l'icône **Enregistrer** (disquette) ou fais Ctrl+S (Cmd+S sur Mac).

## Étape 3 — Régler le code secret

Le code secret empêche quiconque d'autre d'écrire dans ton Drive via ton script, même s'il connaissait son adresse. Le **même** code doit être saisi dans le script et dans l'app.

**Le script exige au moins 20 caractères.** Avec moins, il refuse tout envoi (« Le script n'est pas configuré »), même si l'app, elle, accepte un secret plus court.

**Générer un bon code secret** (au moins 20 caractères, uniquement des lettres, des chiffres et des tirets, **sans espace**) :
- **le plus simple** : le générateur de ton gestionnaire de mots de passe. Sur iPhone, l'app **Mots de passe** propose un mot de passe fort quand tu crées une entrée (par exemple « Muscu Sync ») : il fait 20 caractères, tirets compris. Bitwarden, 1Password ou Proton Pass ont aussi un générateur : règle la longueur sur 24 ou plus.
- **à défaut** : invente une suite d'au moins 24 lettres et chiffres **au hasard**, sans mot ni date (ni ton nom, ni « muscu »).

Garde-le dans ton gestionnaire de mots de passe : tu devras le saisir dans l'app (étape 7). Ne le réutilise nulle part ailleurs et ne le partage avec personne.

**Le régler dans le script :**
1. Dans le projet, menu de gauche : **Paramètres du projet** (roue dentée).
2. Vérifie le **Fuseau horaire** : choisis celui où tu vis (en France : « (GMT+01:00) Paris »). Il date les fichiers de l'archive.
3. En bas de la page, section **Propriétés du script** : clique sur **Ajouter une propriété du script**.
4. **Propriété** : `SECRET` (en majuscules, exactement). **Valeur** : ton code secret.
5. Clique sur **Enregistrer les propriétés du script**.

## Étape 4 — Vérifier l'installation (et autoriser le script)

1. Reviens à l'éditeur (menu de gauche : **Éditeur**, icône `< >`).
2. Dans la barre du haut, choisis la fonction **`verifier_installation`** dans la liste déroulante, puis clique sur **Exécuter**.
3. La première fois, Google demande ton accord, puisque le script va écrire dans ton Drive :
   1. clique sur **Examiner les autorisations**, puis choisis ton compte Google ;
   2. un écran **« Google n'a pas validé cette application »** apparaît. C'est **normal** : c'est ton propre script, il n'a jamais été soumis à Google pour vérification ;
   3. clique sur **Paramètres avancés** (en bas à gauche), puis sur **Accéder à Muscu Sync (non sécurisé)** ;
   4. vérifie les accès demandés, puis clique sur **Autoriser**.
4. Le **Journal d'exécution** s'affiche en bas. Il doit indiquer :

```text
✅ SECRET configuré (… caractères)
✅ Dossier « Muscu » prêt
✅ LISEZMOI.txt écrit
✅ Écriture, relecture et suppression de test OK
ℹ️ Fuseau du script : Europe/Paris (attendu : Europe/Paris)
```

- « ❌ Propriété SECRET absente » ou « ❌ SECRET trop court » : reprends l'étape 3, puis relance `verifier_installation`.
- « ❌ Erreur Drive » : relance une fois ; si l'erreur revient, vérifie que tu as bien autorisé le script.
- La ligne « Fuseau du script » indique simplement ton fuseau (étape 3, point 2).

Dans ton Google Drive, un dossier **Muscu** contenant `LISEZMOI.txt` est apparu.

[capture à ajouter : écran « Google n'a pas validé cette application »]

## Étape 5 — Déployer le script

1. En haut à droite, clique sur **Déployer** → **Nouveau déploiement**.
2. À côté de « Sélectionner le type », clique sur la roue dentée et choisis **Application Web**.
3. Remplis :
   - **Description** : par exemple « Muscu Sync » ;
   - **Exécuter en tant que** : **Moi** (ton adresse) ;
   - **Qui peut accéder** : **Tout le monde**. C'est nécessaire, car l'app appelle le script sans se connecter à ton compte Google. C'est le **code secret** qui protège l'accès.
4. Clique sur **Déployer** (Google peut redemander l'autorisation : accepte comme à l'étape 4).

## Étape 6 — Copier et tester l'adresse du script

À la fin du déploiement, Google affiche l'**URL de l'application Web**. Elle ressemble à :

```text
https://script.google.com/macros/s/…/exec
```

1. Clique sur **Copier**. Elle doit **finir par `/exec`**.
2. **Test rapide** : colle-la dans un nouvel onglet du navigateur. La page doit afficher `{"ok":true,"service":"muscu-sync","version":"sync-3"}`. Sinon, voir le [dépannage](#dépannage).
3. Envoie-la sur ton téléphone (par exemple dans une note ou un e-mail à toi-même).

**Garde-la pour toi** : avec le code secret, c'est la clé de ton archive. Ne la publie jamais. Tu la retrouves plus tard dans le projet : **Déployer** → **Gérer les déploiements**.

## Étape 7 — Connecter l'app

Sur le téléphone, dans l'app installée :

1. Va dans **Paramètres** → **Archive Drive**.
2. **Adresse du script (URL)** : colle l'adresse de l'étape 6.
3. **Secret** : saisis ton code secret de l'étape 3, **exactement** le même (au moins 20 caractères).
4. Touche **Enregistrer**. L'app affiche « Configuration enregistrée. Fais un test avant d'activer l'envoi. ».
5. Touche **Envoyer un test**. Si tout va bien, l'app affiche par exemple « Script joint : version sync-3, réponse en 1,2 s. » et « Dossier Muscu prêt. ». La première réponse peut prendre plusieurs secondes.
6. Active l'interrupteur **Envoi automatique**, lis le message, puis touche **Activer**.

[capture à ajouter : écran Paramètres → Archive Drive après un test réussi]

L'adresse et le code secret restent **sur ce téléphone seulement** : ils ne sont jamais copiés dans une sauvegarde, un export pour le coach ou un message d'erreur (l'app n'affiche que les 4 derniers caractères du secret).

## Étape 8 — Vérifier

- Termine une séance (ou ajoute une pesée). Sur l'accueil, sous « Dernière séance », une ligne indique « Archive Drive : envoi en cours… », puis **« Archive Drive : ✓ envoyé »**.
- Dans ton Google Drive, le dossier **Muscu** se remplit :

```text
Muscu/
├── _INDEX.json                 sommaire tenu par le script (ne pas modifier)
├── LISEZMOI.txt                explications écrites par le script
├── Semaine 42/                 un dossier par libellé de semaine du programme
│   └── 2026-10-14_1810_Seance-A_ab12cd.json
├── Pesees/
│   ├── 2026-10-14.json         une pesée par jour
│   └── _pesees.json            toutes les pesées
└── Sauvegardes/
    ├── sauvegarde-derniere.json     sauvegarde complète, à jour
    └── 2026-10-12_hebdo.json        copie datée, une par semaine
```

Les mensurations ne créent pas de fichier à part : elles sont dans les sauvegardes. Seuls les fichiers du dossier `Sauvegardes` se restaurent dans l'app ; les fichiers par séance servent d'archive lisible.

---

## Bon à savoir

- **Sans réseau, rien n'est perdu** : les envois attendent et repartent tout seuls (retour du réseau, ouverture de l'app, ou bouton **Envoyer maintenant** dans Paramètres → Archive Drive).
- **Sur iPhone, l'app n'envoie rien quand elle est fermée** : un envoi interrompu repart à la prochaine ouverture. C'est normal.
- **Rien n'est jamais effacé de ton Drive** : une séance, une pesée ou une mensuration supprimée dans l'app est seulement **notée supprimée** dans `_INDEX.json`.
- **Le script ne remplace jamais une sauvegarde plus complète sans ton accord** : si ton Drive contient plus de séances, de pesées ou de mensurations que l'app (par exemple après une réinstallation), l'app s'arrête et te laisse choisir (voir le dépannage). Une baisse due à des suppressions faites dans l'app est acceptée sans question.
- **Paramètres → Archive Drive → Renvoyer toute l'archive** remet en file toutes les séances, toutes les pesées et la sauvegarde, sans doublon. Utile après une restauration.

## Versions du script (`sync-2`, `sync-3`)

Le script a un numéro de version, affiché par **Envoyer un test** (« Script joint : version … »). Le fichier de ce dépôt est en **`sync-3`**, la version recommandée.

- **`sync-3`** : protège aussi tes **mensurations** contre un remplacement par une sauvegarde moins complète, et accepte sans fausse alerte une baisse due à des suppressions faites dans l'app.
- **`sync-2`** (ancienne version) : fonctionne, mais ne compte pas les mensurations ; supprimer une séance dans l'app demande en plus de confirmer « Remplacer quand même ».

**Mettre à jour le script en gardant la même adresse :**
1. Sur https://script.google.com, ouvre le projet **Muscu Sync**, remplace tout le code de `Code.gs` par la dernière version de [`muscu-sync.gs`](apps-script/muscu-sync.gs), puis **Enregistrer**. Ton code secret (propriété `SECRET`) est conservé.
2. **Déployer** → **Gérer les déploiements** → l'icône **crayon** (Modifier) du déploiement existant.
3. **Version** : choisis **Nouvelle version**, puis **Déployer**. L'adresse ne change pas.
4. Dans l'app : Paramètres → Archive Drive → **Envoyer un test**, pour que l'app connaisse la nouvelle version.

Si tu as créé un **nouveau** déploiement au lieu de modifier l'existant, l'adresse a changé : colle la nouvelle dans l'app, **Enregistrer**, **Envoyer un test**, puis réactive l'**Envoi automatique** (changer l'adresse ou le secret désactive l'envoi par sécurité).

---

## Dépannage

| Ce que tu vois | Ce que ça veut dire | Que faire |
|---|---|---|
| « Adresse invalide : colle l'URL complète du script (https://…/exec). » | Ce n'est pas l'adresse de l'application Web | Recopie l'**URL de l'application Web** (étape 6), qui finit par `/exec` (pas l'adresse de l'éditeur de script) |
| « Le secret doit contenir au moins 8 caractères. » | Code secret beaucoup trop court | Le script en exige **20** : génère-en un nouveau (étape 3), dans le script et dans l'app |
| « Le script n'est pas configuré (secret ou dossier manquant). » | La propriété `SECRET` est absente du script, ou fait **moins de 20 caractères** | Reprends l'étape 3, lance `verifier_installation` (étape 4), puis **Envoyer un test** |
| « Secret refusé par le script : vérifie le secret. » | Le code de l'app et celui du script diffèrent | Ressaisis exactement le même code des deux côtés (majuscules, tirets ; aucun espace) |
| « Fais d'abord un test réussi avec cette configuration. » | L'adresse ou le secret a changé depuis le dernier test | Touche **Envoyer un test**, puis réactive l'envoi |
| « Le script a répondu par une page d'erreur (cas fréquent chez Google) » | Google renvoie parfois une page d'erreur au lieu de la réponse | Rien : l'envoi repart tout seul |
| « Réseau indisponible », « Pas de réponse en 90 s » ou « Script occupé » | Pas de réseau, Google trop lent, ou deux envois en même temps | Rien : l'envoi repart tout seul |
| « Drive momentanément indisponible » | Erreur passagère de Google Drive | Rien : l'envoi repart tout seul |
| Le test rapide de l'étape 6 n'affiche pas `{"ok":true,…}` (page de connexion Google, erreur d'accès) | Déploiement mal réglé | Vérifie l'étape 5 : **Exécuter en tant que : Moi** et **Qui peut accéder : Tout le monde**. Corrige via « Gérer les déploiements » → crayon → Nouvelle version |
| Le test rapide affiche une autre version que `sync-3` | Le déploiement utilise un ancien code | Voir « Mettre à jour le script » ci-dessus |
| « Le dossier Muscu n'est pas encore prêt dans ton Drive. » | Le script n'a pas pu préparer son dossier | Lance `verifier_installation` (étape 4) et lis le journal, puis refais **Envoyer un test** |
| « Archive Drive : N en attente » sur l'accueil | Des envois attendent depuis plus d'une heure | Touche la puce, puis **Envoyer maintenant** ; ouvre « Détails techniques » si une tâche est en erreur, puis **Réessayer** ou **Ignorer** |
| « Base vide : aucune sauvegarde envoyée (pour protéger ton archive). » | L'app n'a encore aucune donnée | Normal : l'app n'envoie jamais une sauvegarde vide, pour ne pas écraser ton archive |
| « Ton Drive contient une sauvegarde plus complète (…) que cette app (…). Rien n'a été écrasé. » | L'app a moins de séances, de pesées ou de mensurations que la sauvegarde du Drive | Voir ci-dessous |

**« Ton Drive contient une sauvegarde plus complète »** : l'app a mis la sauvegarde en pause et te propose trois choix.
- **Restaurer depuis mon Drive** : si tu viens de réinstaller l'app ou de changer de téléphone. Suis [Restaurer depuis ton Drive](#restaurer-depuis-ton-drive).
- **Remplacer quand même** : si la baisse est voulue. Les copies hebdomadaires et les fichiers de séances restent dans ton Drive.
- **Ignorer** : ne rien envoyer pour l'instant. La question reviendra à la prochaine modification si l'écart est toujours là.

**L'index semble faux** (rare) : dans l'éditeur du script, lance la fonction **`reconstruire_index`** (même méthode que `verifier_installation`). Elle reconstruit `_INDEX.json` à partir des dossiers, sans toucher aux autres fichiers.

## Restaurer depuis ton Drive

Après un téléphone perdu, une app supprimée ou des données effacées :

1. **Réinstalle l'app** et ouvre-la depuis son icône (voir [Installer l'app](installation.md)).
2. Dans **Google Drive**, dossier `Muscu/Sauvegardes`, **télécharge** `sauvegarde-derniere.json`.
   - Sur iPhone : dans l'app Google Drive, ⋯ → **Ouvrir dans** → **Enregistrer dans Fichiers**.
   - Sur Android : ⋮ → **Télécharger**.
3. Dans l'app : Paramètres → **Restaurer une sauvegarde** → choisis ce fichier, vérifie le résumé, puis confirme.
4. **Seulement ensuite**, Paramètres → Archive Drive : saisis l'adresse et le code secret, **Enregistrer**, **Envoyer un test**, puis active l'**Envoi automatique**.

Dans cet ordre, l'archive repart de ta sauvegarde complète. Si tu actives l'envoi **avant** de restaurer, rien n'est perdu non plus : le script voit que ton Drive est plus complet et l'app te demande quoi faire.

Une copie plus ancienne ? Les fichiers `Sauvegardes/AAAA-MM-JJ_hebdo.json` se restaurent de la même façon. Les fichiers par séance (`Semaine XX/…`), eux, ne sont **pas** restaurables.

## Désactiver l'archive

- Dans l'app : Paramètres → Archive Drive → coupe **Envoi automatique**. Plus rien n'est envoyé ; ton dossier `Muscu` reste dans ton Drive.
- Pour arrêter complètement le script : sur https://script.google.com, **Déployer** → **Gérer les déploiements** → **Archiver** le déploiement (ou supprime le projet).

## Sécurité

- L'**adresse du script** et le **code secret** sont des clés : ne les envoie jamais à personne, ni à ton coach IA, et ne les publie pas.
- Ils ne sont stockés **que sur ton téléphone** (et le secret dans les propriétés de ton script) : jamais dans une sauvegarde, un export ou un message d'erreur, et une restauration ne les remplace pas.
- Si tu penses qu'ils ont fuité : génère un nouveau code secret, remplace la valeur de `SECRET` dans **Propriétés du script**, puis saisis-le dans l'app (**Enregistrer**, **Envoyer un test**, réactive l'envoi). Tu peux aussi archiver le déploiement et en créer un nouveau (nouvelle adresse).

Retour au [README](../README.md).
