/**
 * Prompt de démarrage du coach (V1.8-SPEC §5.3) : SOURCE UNIQUE. Le README en contient le même
 * texte (vérifié par test, T3) ; l'interface l'utilisera en J3 (« Copier le prompt du coach »).
 */

/**
 * Adresse du guide du coach que lisent les IA : le fichier BRUT du dépôt (`text/plain; charset=utf-8`).
 * V1.8.1 : l'outil de navigation de ChatGPT refuse la copie du site (`text/markdown`), qui reste
 * publiée à `<base>coach.md` (DECISIONS V1.8.1).
 */
export const COACH_GUIDE_URL = 'https://raw.githubusercontent.com/urattems/training-app/main/public/coach.md';

/** Texte littéral ; l'URL le termine, sans ponctuation derrière. */
export const COACH_PROMPT = `Sois mon coach de musculation pour l'app Training App. Lis d'abord le guide en entier, puis confirme que tu l'as lu ; si tu ne peux pas l'ouvrir, dis-le et je te le collerai. Ensuite, commence l'accueil. Le guide : ${COACH_GUIDE_URL}`;
