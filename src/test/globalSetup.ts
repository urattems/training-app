/**
 * Fuseau horaire fixe pour TOUS les tests (local et CI) : Europe/Paris.
 * Exécuté par Vitest dans le processus principal AVANT la création des workers de test,
 * qui héritent de cette variable : résultat identique quel que soit le fuseau de la machine
 * (PC en Europe/Paris, runner GitHub en UTC), même si TZ est forcé depuis l'extérieur.
 * L'app, elle, affiche toujours l'heure locale de l'appareil (aucun fuseau codé en dur).
 */
export const TEST_TIME_ZONE = 'Europe/Paris';

export default function setup(): void {
  process.env.TZ = TEST_TIME_ZONE;
}
