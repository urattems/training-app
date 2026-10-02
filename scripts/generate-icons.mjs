/**
 * Génère les icônes de l'app (PNG + SVG) localement, sans service externe ni dépendance :
 * haltère stylisé charbon sur fond crème, couleurs lues dans src/styles/tokens.css.
 * Usage : npm run icons (les fichiers produits sont versionnés dans public/).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const root = new URL('..', import.meta.url);
const tokens = readFileSync(new URL('src/styles/tokens.css', root), 'utf8');
const token = (name) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (!match) throw new Error(`Token --${name} introuvable`);
  return match[1];
};
const BG = token('color-bg');
const FG = token('color-text');
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Haltère dans un repère centré (unités relatives à la taille du dessin), incliné de -35°.
const ANGLE = (-35 * Math.PI) / 180;
const SHAPES = [
  { cx: 0, cy: 0, w: 0.62, h: 0.075, r: 0.0375 }, // barre
  { cx: -0.2, cy: 0, w: 0.1, h: 0.44, r: 0.045 }, // disques intérieurs
  { cx: 0.2, cy: 0, w: 0.1, h: 0.44, r: 0.045 },
  { cx: -0.32, cy: 0, w: 0.085, h: 0.28, r: 0.04 }, // disques extérieurs
  { cx: 0.32, cy: 0, w: 0.085, h: 0.28, r: 0.04 },
];

const insideRoundedRect = (x, y, { cx, cy, w, h, r }) => {
  const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(y - cy) - (h / 2 - r), 0);
  return dx * dx + dy * dy <= r * r;
};

/** Couverture du dessin en (u, v) ∈ [0,1]², pour une échelle de contenu donnée. */
function covered(u, v, scale) {
  const x0 = (u - 0.5) / scale;
  const y0 = (v - 0.5) / scale;
  const x = x0 * Math.cos(-ANGLE) - y0 * Math.sin(-ANGLE);
  const y = x0 * Math.sin(-ANGLE) + y0 * Math.cos(-ANGLE);
  return SHAPES.some((s) => insideRoundedRect(x, y, s));
}

/** Pixels RGB, anti-crénelage par suréchantillonnage 4×4. */
function render(size, scale) {
  const [br, bgG, bb] = rgb(BG);
  const [fr, fg, fb] = rgb(FG);
  const S = 4;
  const pixels = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          if (covered((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size, scale)) hits++;
        }
      }
      const a = hits / (S * S);
      const i = (py * size + px) * 3;
      pixels[i] = Math.round(br + (fr - br) * a);
      pixels[i + 1] = Math.round(bgG + (fg - bgG) * a);
      pixels[i + 2] = Math.round(bb + (fb - bb) * a);
    }
  }
  return pixels;
}

// --- Encodeur PNG minimal (RGB 8 bits, sans transparence) ---------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profondeur
  header[9] = 2; // RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filtre « None »
    pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- SVG (favicon) -------------------------------------------------------------
function svg() {
  const rects = SHAPES.map(
    ({ cx, cy, w, h, r }) =>
      `<rect x="${(cx - w / 2).toFixed(4)}" y="${(cy - h / 2).toFixed(4)}" width="${w}" height="${h}" rx="${r}"/>`,
  ).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${BG}"/>` +
    `<g fill="${FG}" transform="translate(32 32) scale(${64 * 0.78}) rotate(-35)">${rects}</g></svg>\n`
  );
}

const out = new URL('public/', root);
mkdirSync(new URL('icons/', out), { recursive: true });
const icons = [
  // Icônes standard : le système arrondit/masque lui-même ; contenu à 72 % du cadre.
  ['icons/icon-192.png', 192, 0.72],
  ['icons/icon-512.png', 512, 0.72],
  // Maskable : contenu dans la zone de sécurité (cercle de 80 %), fond plein bord à bord.
  ['icons/maskable-512.png', 512, 0.56],
  // iOS : pas de transparence, iOS arrondit les coins.
  ['icons/apple-touch-icon.png', 180, 0.72],
  ['favicon-32.png', 32, 0.86],
];
for (const [path, size, scale] of icons) {
  writeFileSync(new URL(path, out), encodePng(size, render(size, scale)));
  console.log(`✓ public/${path} (${size}×${size})`);
}
writeFileSync(new URL('favicon.svg', out), svg());
console.log('✓ public/favicon.svg');
