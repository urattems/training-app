/** Nom de l'application : constante unique modifiable (SPEC §7.10). */
export const APP_NAME = 'Carnet';

/** Version de l'app, injectée depuis package.json au build (vite.config.ts). */
export const APP_VERSION: string = __APP_VERSION__;

/** Nom de la base IndexedDB, unique car l'origine GitHub Pages est partagée entre dépôts. */
export const DB_NAME = 'training-app-db';
