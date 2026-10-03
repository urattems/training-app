/**
 * Texte collé (SPEC §10.1, V1.1a) : tolérance STRICTEMENT limitée à ce que ChatGPT produit
 * en pratique, puis même pipeline que le fichier.
 * - espaces, retours à la ligne et BOM autour du texte ;
 * - UNE clôture Markdown entourant tout le texte : « ```json » (ou « ``` ») … « ``` ».
 * Rien d'autre n'est deviné ni réparé : texte autour de la clôture, plusieurs blocs,
 * guillemets typographiques, virgules finales… restent des erreurs.
 */
const FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```$/i;

/** `String.prototype.trim` retire aussi le BOM (U+FEFF, espace au sens ECMAScript). */
const trimText = (text: string): string => text.trim();

export function unwrapPastedJson(text: string): string {
  const trimmed = trimText(text);
  const fenced = FENCE.exec(trimmed);
  const inner = fenced?.[1];
  // Clôture unique : un second bloc ``` à l'intérieur n'est pas déballé.
  if (inner === undefined || inner.includes('```')) return trimmed;
  return trimText(inner);
}
