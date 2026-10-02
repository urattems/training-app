# CLAUDE.md — Carnet d'entraînement (PWA iPhone)

Claude Code lit ce fichier automatiquement à chaque session.

## Mission
Construire une V1 réellement utilisable d'une app perso de suivi de musculation : PWA installable sur iPhone, 100 % locale (aucun backend, aucune API, aucun compte, aucune IA intégrée), en français.

Flux : JSON programme → app → séance réelle → historique local → JSON historique → coach externe.

## Source de vérité
`SPEC.md` (à la racine) : à lire en entier avant d'écrire du code. Fixtures contractuelles : `examples/program-example.json` et `examples/history-example.json`. Le code doit les accepter tels quels ; ne les modifie jamais sans que le jalon l'exige, que ce soit documenté dans `DECISIONS.md` et signalé dans le compte rendu.
En cas de contradiction : `SPEC.md` > ce fichier > tes préférences techniques.

## Les 6 règles absolues
1. **Objectif ≠ Réalisation.** Prescrit et réalisé sont stockés séparément. Le réel n'écrase jamais l'objectif ni ne modifie le programme. Jamais de préremplissage silencieux du réalisé.
2. **Stats et graphiques = valeurs réelles uniquement.**
3. **Aucune donnée perdue.** Sauvegarde à chaque saisie significative, aucune suppression silencieuse, opération destructive = confirmation + export de sécurité.
4. **Snapshot d'objectifs** : une séance garde les objectifs du jour où elle a été faite.
5. **iPhone d'abord** : une main, clavier numérique, grandes zones tactiles.
6. **Simplicité** : n'ajoute aucune fonctionnalité absente de `SPEC.md`.

Priorités en cas de conflit : intégrité des données > UX mobile > simplicité > lisibilité > maintenabilité > esthétique > secondaire.

## Méthode : jalons J0 → J8 (voir SPEC.md §13)
- Un jalon à la fois. À la fin : `npm run typecheck`, `lint`, `test`, `build` verts, fonctionnalités branchées sur la vraie base IndexedDB.
- Compte rendu structuré (SPEC.md §13) : fait, fichiers créés/modifiés, tests + résultats, décisions, reste à faire.
- Puis **commit git** du jalon (`jalon-N : résumé`), puis **STOP** et attente de ma validation.
- Ne modifie jamais `SPEC.md` sans me prévenir et attendre mon accord.
- Décisions techniques équivalentes : tu tranches seul et tu documentes dans `DECISIONS.md`.

## Qualité
TypeScript strict, pas de `any` injustifié, logique métier hors des composants, fonctions pures testées (volume, records, graphes, stats), validation Zod de tout JSON entrant avec messages d'erreur humains en français. Rendu visuel : « app iPhone propre et premium », jamais « projet React généré par IA ».

## Environnement
Windows 11, PowerShell. Commandes compatibles Windows (pas de syntaxe bash-only dans les scripts npm).
