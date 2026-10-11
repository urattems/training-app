# Activer l'archive Google Drive (option avancée)

> **Facultatif.** L'app fonctionne entièrement sans cette option. La sauvegarde de base reste : Paramètres → **Exporter mes données**.

L'archive Google Drive envoie automatiquement une **copie** de tes données dans **ton** Google Drive, dans un dossier `Muscu` :

- chaque séance terminée (un fichier par séance) ;
- chaque pesée, et toutes les pesées regroupées ;
- une **sauvegarde complète** tenue à jour, plus une copie datée chaque semaine.

Elle passe par un petit programme, le script **« Muscu Sync »**, que tu installes **toi-même** dans ton compte Google. Personne d'autre que toi n'y a accès. L'envoi est **à sens unique** : l'app écrit dans ton Drive, elle ne le lit jamais.

**Compte 15 à 20 minutes.** L'installation du script est plus simple sur un **ordinateur** ; la fin se fait sur le téléphone.

---

## Avant de commencer

- Il te faut un **compte Google** (une adresse Gmail suffit). Pas de compte ? Crée-le sur https://accounts.google.com/signup.
- Active l'archive **seulement sur le téléphone qui te sert à noter tes séances**. Un deuxième appareil enverrait ses propres sauvegardes, moins complètes.
- **Tu viens de réinstaller l'app ou de changer de téléphone ?** Restaure d'abord ta sauvegarde (voir [Restaurer depuis ton Drive](#restaurer-depuis-ton-drive)), **puis** active l'archive.

## Étape 1 — Récupérer le code du script

> **[À COMPLÉTER — Gio]** Où récupérer le code du script « Muscu Sync » (fichier à copier, lien, version `sync-3` recommandée). Le code du script n'est pas dans ce dépôt.

## Étape 2 — Créer le projet

1. Sur l'ordinateur, ouvre **https://script.google.com** et connecte-toi avec ton compte Google.
2. Clique sur **Nouveau projet**.
3. En haut à gauche, clique sur « Projet sans titre » et renomme-le **Muscu Sync**.
4. Dans le fichier `Code.gs`, **efface tout** le contenu présent, puis **colle** le code du script récupéré à l'étape 1.
5. Clique sur l'icône **Enregistrer** (disquette) ou fais Ctrl+S (Cmd+S sur Mac).

## Étape 3 — Choisir ton code secret

Le code secret empêche quiconque d'autre d'écrire dans ton Drive via ton script, même s'il connaissait son adresse. Le **même** code doit être saisi dans le script et dans l'app.

- Choisis-en un **long et aléatoire** : au moins **8 caractères** (l'app refuse plus court) ; 20 caractères ou plus, c'est mieux. Par exemple une suite de lettres et de chiffres sans signification.
- Ne le réutilise nulle part ailleurs et ne le partage avec personne.

> **[À COMPLÉTER — Gio]** Où et comment définir ce code secret dans le script (selon le code du script « Muscu Sync »).

## Étape 4 — Déployer le script

1. En haut à droite, clique sur **Déployer** → **Nouveau déploiement**.
2. À côté de « Sélectionner le type », clique sur la roue dentée et choisis **Application Web**.
3. Remplis :
   - **Description** : par exemple « Muscu Sync » ;
   - **Exécuter en tant que** : **Moi** (ton adresse) ;
   - **Qui peut accéder** : **Tout le monde**. C'est nécessaire, car l'app appelle le script sans se connecter à ton compte Google. C'est le **code secret** qui protège l'accès.
4. Clique sur **Déployer**.

## Étape 5 — Autoriser le script

Google demande ton accord, puisque le script va écrire dans ton Drive.

1. Clique sur **Autoriser l'accès**, puis choisis ton compte Google.
2. Un écran **« Google n'a pas validé cette application »** apparaît. C'est **normal** : c'est ton propre script, il n'a jamais été soumis à Google pour vérification.
3. Clique sur **Paramètres avancés** (en bas à gauche), puis sur **Accéder à Muscu Sync (non sécurisé)**.
4. Vérifie la liste des accès demandés, puis clique sur **Autoriser**.

[capture à ajouter : écran « Google n'a pas validé cette application »]

## Étape 6 — Copier l'adresse du script

À la fin du déploiement, Google affiche l'**URL de l'application Web**. Elle ressemble à :

```text
https://script.google.com/macros/s/…/exec
```

- Clique sur **Copier**. Elle doit **finir par `/exec`**.
- Envoie-la sur ton téléphone (par exemple dans une note ou un e-mail à toi-même).
- **Garde-la pour toi** : avec le code secret, c'est la clé de ton archive. Ne la publie jamais.

Tu la retrouves plus tard dans le projet : **Déployer** → **Gérer les déploiements**.

## Étape 7 — Connecter l'app

Sur le téléphone, dans l'app installée :

1. Va dans **Paramètres** → **Archive Drive**.
2. **Adresse du script (URL)** : colle l'adresse de l'étape 6.
3. **Secret** : saisis ton code secret de l'étape 3.
4. Touche **Enregistrer**. L'app affiche « Configuration enregistrée. Fais un test avant d'activer l'envoi. ».
5. Touche **Envoyer un test**. Si tout va bien, l'app affiche par exemple « Script joint : version sync-3, réponse en 1,2 s. » et « Dossier Muscu prêt. ». La première réponse peut prendre plusieurs secondes.
6. Active l'interrupteur **Envoi automatique**, lis le message, puis touche **Activer**.

[capture à ajouter : écran Paramètres → Archive Drive après un test réussi]

L'adresse et le code secret restent **sur ce téléphone seulement** : ils ne sont jamais copiés dans une sauvegarde, un export pour le coach ou un message d'erreur (l'app n'affiche que les 4 derniers caractères du secret).

## Étape 8 — Vérifier

- Termine une séance (ou ajoute une pesée). Sur l'accueil, sous « Dernière séance », une ligne indique « Archive Drive : envoi en cours… », puis **« Archive Drive : ✓ envoyé »**.
- Dans ton Google Drive, le dossier **Muscu** apparaît :

```text
Muscu/
├── _INDEX.json                 tenu par le script (ne pas modifier)
├── LISEZMOI.txt                écrit par le script
├── Semaine 42/                 un dossier par libellé de semaine du programme
│   └── 2026-10-14_1810_Seance-A_ab12cd.json
├── Pesees/
│   ├── 2026-10-14.json         une pesée par jour
│   └── _pesees.json            toutes les pesées
└── Sauvegardes/
    ├── sauvegarde-derniere.json     sauvegarde complète, à jour
    └── 2026-10-12_hebdo.json        copie datée, une par semaine
```

Les mensurations ne créent pas de fichier à part : elles sont dans les sauvegardes.

---

## Bon à savoir

- **Sans réseau, rien n'est perdu** : les envois attendent et repartent tout seuls (retour du réseau, ouverture de l'app, ou bouton **Envoyer maintenant** dans Paramètres → Archive Drive).
- **Sur iPhone, l'app n'envoie rien quand elle est fermée** : un envoi interrompu repart à la prochaine ouverture. C'est normal.
- **Rien n'est jamais effacé de ton Drive** : une séance ou une pesée supprimée dans l'app est seulement **notée supprimée** par le script.
- **L'app ne remplace jamais une sauvegarde plus complète sans te demander** : si ton Drive contient plus de séances ou de pesées que l'app (par exemple après une réinstallation), l'app s'arrête et te laisse choisir (voir le dépannage).
- **Paramètres → Archive Drive → Renvoyer toute l'archive** remet en file toutes les séances, toutes les pesées et la sauvegarde, sans doublon. Utile après une restauration.

## Versions du script (`sync-2`, `sync-3`)

Le script a un numéro de version, affiché par **Envoyer un test** (« Script joint : version … »).

- **`sync-3`** (recommandée) : protège aussi tes **mensurations** contre un remplacement par une sauvegarde moins complète, et accepte sans fausse alerte la suppression d'une mensuration.
- **`sync-2`** : fonctionne, mais ne compte pas les mensurations ; supprimer une séance dans l'app demande en plus de confirmer « Remplacer quand même » côté Drive.

**Mettre à jour le script en gardant la même adresse :**
1. Sur https://script.google.com, ouvre le projet **Muscu Sync** et remplace le code par la nouvelle version, puis **Enregistrer**.
2. **Déployer** → **Gérer les déploiements** → l'icône **crayon** (Modifier) du déploiement existant.
3. **Version** : choisis **Nouvelle version**, puis **Déployer**. L'adresse ne change pas.
4. Dans l'app : Paramètres → Archive Drive → **Envoyer un test**, pour que l'app connaisse la nouvelle version.

Si tu as créé un **nouveau** déploiement au lieu de modifier l'existant, l'adresse a changé : colle la nouvelle dans l'app, **Enregistrer**, **Envoyer un test**, puis réactive l'**Envoi automatique** (changer l'adresse ou le secret désactive l'envoi par sécurité).

---

## Dépannage

| Ce que tu vois | Ce que ça veut dire | Que faire |
|---|---|---|
| « Adresse invalide : colle l'URL complète du script (https://…/exec). » | Ce n'est pas l'adresse de l'application Web | Recopie l'**URL de l'application Web** (étape 6), qui finit par `/exec` (pas l'adresse de l'éditeur de script) |
| « Le secret doit contenir au moins 8 caractères. » | Code secret trop court | Choisis un code plus long, dans le script et dans l'app |
| « Secret refusé par le script : vérifie le secret. » | Le code de l'app et celui du script diffèrent | Ressaisis exactement le même code des deux côtés (attention aux majuscules et aux espaces) |
| « Le script n'est pas configuré (secret ou dossier manquant). » | Le code secret n'est pas défini dans le script | Reprends l'étape 3, puis **Envoyer un test** |
| « Fais d'abord un test réussi avec cette configuration. » | L'adresse ou le secret a changé depuis le dernier test | Touche **Envoyer un test**, puis réactive l'envoi |
| « Le script a répondu par une page d'erreur (cas fréquent chez Google) » | Google renvoie parfois une page d'erreur au lieu de la réponse | Rien : l'envoi repart tout seul |
| « Réseau indisponible » ou « Pas de réponse en 90 s » | Pas de réseau, ou Google trop lent | Rien : l'envoi repart tout seul |
| Le test échoue alors que l'adresse et le secret sont bons | Déploiement mal réglé, ou autorisation non donnée | Vérifie l'étape 4 (**Qui peut accéder : Tout le monde**) et l'étape 5, puis redéploie (« Gérer les déploiements » → Nouvelle version) |
| « Le dossier Muscu n'est pas encore prêt dans ton Drive. » | Le script n'a pas encore créé son dossier | Refais **Envoyer un test** ; si le message reste, vérifie l'autorisation (étape 5) |
| « Archive Drive : N en attente » sur l'accueil | Des envois attendent depuis plus d'une heure | Touche la puce, puis **Envoyer maintenant** ; ouvre « Détails techniques » si une tâche est en erreur, puis **Réessayer** ou **Ignorer** |
| « Base vide : aucune sauvegarde envoyée (pour protéger ton archive). » | L'app n'a encore aucune donnée | Normal : l'app n'envoie jamais une sauvegarde vide, pour ne pas écraser ton archive |
| « Ton Drive contient une sauvegarde plus complète (…) que cette app (…). Rien n'a été écrasé. » | L'app a moins de séances, de pesées ou de mensurations que la sauvegarde du Drive | Voir ci-dessous |

**« Ton Drive contient une sauvegarde plus complète »** : l'app a mis la sauvegarde en pause et te propose trois choix.
- **Restaurer depuis mon Drive** : si tu viens de réinstaller l'app ou de changer de téléphone. Suis [Restaurer depuis ton Drive](#restaurer-depuis-ton-drive).
- **Remplacer quand même** : si la baisse est voulue (par exemple, tu viens de supprimer une séance). Les copies hebdomadaires et les fichiers de séances restent dans ton Drive.
- **Ignorer** : ne rien envoyer pour l'instant. La question reviendra à la prochaine modification si l'écart est toujours là.

## Restaurer depuis ton Drive

Après un téléphone perdu, une app supprimée ou des données effacées :

1. **Réinstalle l'app** et ouvre-la depuis son icône (voir [Installer l'app](installation.md)).
2. Dans **Google Drive**, dossier `Muscu/Sauvegardes`, **télécharge** `sauvegarde-derniere.json`.
   - Sur iPhone : dans l'app Google Drive, ⋯ → **Ouvrir dans** → **Enregistrer dans Fichiers**.
   - Sur Android : ⋮ → **Télécharger**.
3. Dans l'app : Paramètres → **Restaurer une sauvegarde** → choisis ce fichier, vérifie le résumé, puis confirme.
4. **Seulement ensuite**, Paramètres → Archive Drive : saisis l'adresse et le code secret, **Enregistrer**, **Envoyer un test**, puis active l'**Envoi automatique**.

Dans cet ordre, l'archive repart de ta sauvegarde complète. Si tu actives l'envoi **avant** de restaurer, rien n'est perdu non plus : l'app voit que ton Drive est plus complet et te demande quoi faire.

Une copie plus ancienne ? Les fichiers `Sauvegardes/AAAA-MM-JJ_hebdo.json` se restaurent de la même façon.

## Désactiver l'archive

- Dans l'app : Paramètres → Archive Drive → coupe **Envoi automatique**. Plus rien n'est envoyé ; ton dossier `Muscu` reste dans ton Drive.
- Pour arrêter complètement le script : sur https://script.google.com, **Déployer** → **Gérer les déploiements** → **Archiver** le déploiement (ou supprime le projet).

## Sécurité

- L'**adresse du script** et le **code secret** sont des clés : ne les envoie jamais à personne, ni à ton coach IA, et ne les publie pas.
- Ils ne sont stockés **que sur ton téléphone** : jamais dans une sauvegarde, un export ou un message d'erreur, et une restauration ne les remplace pas.
- Si tu penses qu'ils ont fuité : change le code secret (dans le script puis dans l'app), ou supprime le déploiement et crée-en un nouveau.

Retour au [README](../README.md).
