/**
 * Prompt de démarrage du coach (V1.8-SPEC §5.3) : SOURCE UNIQUE. Le README en contient le même
 * texte (vérifié par test, T3) ; l'interface l'utilisera en J3 (« Copier le prompt du coach »).
 */

/** Adresse publique du guide du coach (`public/coach.md`, servi par GitHub Pages). */
export const COACH_GUIDE_URL = 'https://urattems.github.io/training-app/coach.md';

/** Texte littéral ; l'URL le termine, sans ponctuation derrière. */
export const COACH_PROMPT = `Sois mon coach de musculation pour l'app Training App. Lis d'abord le guide en entier, puis confirme que tu l'as lu ; si tu ne peux pas l'ouvrir, dis-le et je te le collerai. Ensuite, commence l'accueil. Le guide : ${COACH_GUIDE_URL}`;
