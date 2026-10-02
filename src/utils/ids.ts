/** Sous-ensemble de Web Crypto utilisé ici (injectable pour les tests). */
export type CryptoLike = Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>>;

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** UUID v4 (RFC 4122) à partir de 16 octets aléatoires. */
export function uuidFromBytes(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // version 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Identifiant unique (UUID v4) pour les entités créées par l'app.
 * `crypto.randomUUID` n'existe qu'en contexte sécurisé (HTTPS, localhost) : en HTTP sur
 * IP locale (tests sur iPhone), on se replie sur `crypto.getRandomValues`, disponible partout.
 */
export function createId(cryptoApi?: CryptoLike): string {
  // Typé comme facultatif : Web Crypto peut manquer sur un navigateur ancien.
  const api = cryptoApi ?? (globalThis as { crypto?: CryptoLike }).crypto;
  if (typeof api?.randomUUID === 'function') return api.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof api?.getRandomValues === 'function') {
    api.getRandomValues(bytes);
  } else {
    // Dernier recours (navigateur sans Web Crypto) : unicité suffisante pour des identifiants locaux.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return uuidFromBytes(bytes);
}
