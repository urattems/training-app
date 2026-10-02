/** Textes de l'application, centralisés (SPEC §4). */
export const strings = {
  import: {
    programPrefix: 'Import impossible',
    restorePrefix: 'Restauration impossible',
    unreadableFile: 'le fichier est illisible.',
    invalidJson: "le fichier n'est pas un JSON valide.",
    notAnObject: 'le fichier ne contient pas un objet JSON.',
    missingVersion: 'le champ « schemaVersion » est manquant.',
    unsupportedVersion: (found: string, supported: string) =>
      `ce fichier utilise la version de schéma « ${found} », non prise en charge (version gérée : ${supported}).`,
    expectedProgram: (found: string) =>
      `ce fichier n'est pas un programme (type « ${found} »). Pour une sauvegarde, utilise « Restaurer une sauvegarde ».`,
    expectedHistory: (found: string) =>
      `ce fichier n'est pas une sauvegarde (type « ${found} »). Pour un programme, utilise « Importer un programme ».`,
    duplicateProgram: (programId: string) =>
      `un programme avec l'identifiant « ${programId} » existe déjà. Demande au coach un nouvel identifiant.`,
    moreErrors: (count: number) => (count === 1 ? '(et 1 autre erreur)' : `(et ${count} autres erreurs)`),
  },
  invariants: {
    severalInProgress: (ids: string) => `plusieurs séances sont en cours (${ids}) ; une seule est autorisée.`,
    unknownActiveProgram: (id: string) => `le programme actif « ${id} » ne figure pas dans la liste des programmes.`,
    unknownProgram: (workoutId: string, programId: string) =>
      `la séance « ${workoutId} » fait référence à un programme absent (« ${programId} »).`,
    duplicateWorkoutId: (id: string) => `l'identifiant de séance « ${id} » est utilisé plusieurs fois.`,
    duplicateProgramId: (id: string) => `l'identifiant de programme « ${id} » est utilisé plusieurs fois.`,
    completedWithoutEnd: (id: string) => `la séance « ${id} » est terminée mais n'a pas de date de fin (completedAt).`,
    inProgressWithEnd: (id: string) => `la séance « ${id} » est en cours mais a une date de fin (completedAt).`,
  },
  workout: {
    alreadyInProgress: 'Une séance est déjà en cours : reprends-la ou abandonne-la avant d’en commencer une autre.',
    noActiveProgram: 'Aucun programme actif : importe un programme pour commencer.',
    unknownSession: (id: string) => `La séance « ${id} » n'existe pas dans le programme actif.`,
    notFound: 'Séance introuvable.',
    notInProgress: "Cette séance n'est plus en cours.",
    unknownExercise: (id: string) => `L'exercice « ${id} » n'existe pas dans cette séance.`,
    unknownSet: (n: number) => `La série ${n} n'existe pas pour cet exercice.`,
    unknownCardio: 'Entrée cardio introuvable.',
    invalidValue: (label: string) => `Valeur invalide : ${label}.`,
  },
  values: {
    reps: 'répétitions (nombre entier positif ou nul)',
    weight: 'charge (nombre positif ou nul)',
    duration: 'durée (nombre positif ou nul)',
    speed: 'vitesse (nombre positif ou nul)',
    incline: 'inclinaison (entre 0 et 100 %)',
    date: 'date (format AAAA-MM-JJ)',
  },
  progress: {
    sameLoad: 'charge identique vs séance précédente',
    loadDelta: (signedKg: string) => `${signedKg} vs séance précédente`,
  },
} as const;
