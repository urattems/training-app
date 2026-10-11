/**
 * Encodage du guide du coach (V1.8.0). GitHub Pages sert `coach.md` en `text/markdown` SANS
 * charset : un navigateur le lit alors en Windows-1252 et casse les accents (« â€” »). Un BOM
 * UTF-8 en tête du fichier suffit à imposer l'UTF-8, sans dépendre du serveur.
 */
export const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((byte, i) => bytes[i] === byte);
}
