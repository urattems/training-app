/**
 * Presse-papiers : API absente hors contexte sécurisé (HTTP sur IP locale) et parfois
 * refusée par l'utilisateur. Toujours détecter avant d'appeler, toujours prévoir un repli.
 */
const clipboard = (): Partial<Clipboard> | undefined => (navigator as Partial<Navigator>).clipboard;

export function canReadClipboard(): boolean {
  return typeof clipboard()?.readText === 'function';
}

/** Lecture du presse-papiers ; `null` si l'API est absente, refusée ou en échec. */
export async function readClipboardText(): Promise<string | null> {
  const api = clipboard();
  if (typeof api?.readText !== 'function') return null;
  try {
    return await api.readText();
  } catch {
    return null;
  }
}

/**
 * Écriture dans le presse-papiers (V1.8.0) : `writeText` est appelé TOUT DE SUITE, dans le geste
 * de l'utilisateur (exigence de Safari iOS). `false` si l'API est absente, refusée ou en échec.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  const api = clipboard();
  if (typeof api?.writeText !== 'function') return false;
  try {
    await api.writeText(text);
    return true;
  } catch {
    return false;
  }
}
