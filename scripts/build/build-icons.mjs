/**
 * Renders the raster icons in public/ from the two SVGs (committed output, like og-image.png):
 *   icon-small.svg (thick strokes, reads at 16px) -> favicon.ico (16/32/48), favicon-48/96.png
 *   icon.svg       (detailed)                     -> apple-touch-icon (180), icon-192/512, icon-512-maskable
 *
 *   node scripts/build-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const small = readFileSync('public/icon-small.svg');
const detailed = readFileSync('public/icon.svg', 'utf8');
const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();
const out = (name, buf) => { writeFileSync(`public/${name}`, buf); console.log('wrote', name); };

out('favicon-48.png', await png(small, 48));
out('favicon-96.png', await png(small, 96));

// favicon.ico: a directory of PNG images (16, 32, 48)
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(s => png(small, s)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  head[at] = s; head[at + 1] = s;
  head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(images[i].length, at + 8); head.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
});
out('favicon.ico', Buffer.concat([head, ...images]));

out('apple-touch-icon.png', await png(detailed, 180));
out('icon-192.png', await png(detailed, 192));
out('icon-512.png', await png(detailed, 512));

// maskable: full-bleed square, artwork inside the central 80% safe zone
const maskable = detailed
  .replace(' rx="14"', '')
  .replace(/(<rect [^>]*\/>)([\s\S]*)<\/svg>/, '$1<g transform="translate(6.4 6.4) scale(0.8)">$2</g></svg>');
out('icon-512-maskable.png', await png(maskable, 512));
