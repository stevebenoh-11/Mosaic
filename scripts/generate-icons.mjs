// Generates PWA PNG icons from the Mosaic mark. Run: npm run icons
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const mark = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${48 + 2 * pad} ${48 + 2 * pad}">
  <rect x="${-pad}" y="${-pad}" width="${48 + 2 * pad}" height="${48 + 2 * pad}" fill="#F5F4F0"/>
  <rect x="4" y="4" width="19" height="19" rx="5" fill="#6C5CE7"/>
  <rect x="27" y="6" width="17" height="17" rx="5" fill="#A29BFE"/>
  <rect x="6" y="27" width="17" height="17" rx="5" fill="#C7C1F8"/>
  <rect x="27" y="27" width="17" height="17" rx="5" fill="#4B3FD1"/>
</svg>`;

mkdirSync('public/icons', { recursive: true });

await sharp(Buffer.from(mark(6))).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(Buffer.from(mark(6))).resize(512, 512).png().toFile('public/icons/icon-512.png');
// Maskable: extra padding so the mark survives circular crops.
await sharp(Buffer.from(mark(14))).resize(512, 512).png().toFile('public/icons/icon-maskable-512.png');

console.log('icons written to public/icons');
