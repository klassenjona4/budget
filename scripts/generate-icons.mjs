// Generates every app icon from one geometry definition, at build time.
// The same definition produces public/icon.svg and the PNG raster files, so
// there is a single source of truth. No image library is used: the PNGs are
// encoded by hand with the built in zlib deflate.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const BACKGROUND = "#0B1940";
const BAR_LIGHT = "#F2F6FF";
const BAR_ACCENT = "#4C8DFF";

// Geometry on a 100 by 100 unit grid. Bars are wide and tall enough to stay
// legible at 48 CSS pixels. No text is used at any size.
const BARS = [
  { x: 18, y: 56, w: 16, h: 26, r: 4, fill: BAR_LIGHT },
  { x: 42, y: 38, w: 16, h: 44, r: 4, fill: BAR_LIGHT },
  { x: 66, y: 20, w: 16, h: 62, r: 4, fill: BAR_ACCENT },
];

function svgSource({ inset, cornerRadius }) {
  const scale = (100 - 2 * inset) / 100;
  const bars = BARS.map((b) => {
    const x = inset + b.x * scale;
    const y = inset + b.y * scale;
    return `  <rect x="${round(x)}" y="${round(y)}" width="${round(b.w * scale)}" height="${round(b.h * scale)}" rx="${round(b.r * scale)}" fill="${b.fill}"/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect x="0" y="0" width="100" height="100" rx="${cornerRadius}" fill="${BACKGROUND}"/>
${bars}
</svg>
`;
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Signed inside test for a rounded rectangle in unit space. */
function insideRoundedRect(px, py, { x, y, w, h, r }) {
  const radius = Math.min(r, w / 2, h / 2);
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + radius), x + w - radius);
  const cy = Math.min(Math.max(py, y + radius), y + h - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Rasterises the icon shapes with 4 by 4 supersampling.
 * inset shrinks the glyph for maskable icons, cornerRadius rounds the plate.
 */
function raster(size, { inset, cornerRadius }) {
  const scale = (100 - 2 * inset) / 100;
  const shapes = [
    {
      rect: { x: 0, y: 0, w: 100, h: 100, r: cornerRadius },
      rgb: hexToRgb(BACKGROUND),
    },
    ...BARS.map((b) => ({
      rect: {
        x: inset + b.x * scale,
        y: inset + b.y * scale,
        w: b.w * scale,
        h: b.h * scale,
        r: b.r * scale,
      },
      rgb: hexToRgb(b.fill),
    })),
  ];

  const SS = 4;
  const pixels = Buffer.alloc(size * size * 4);
  const unit = 100 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (px + (sx + 0.5) / SS) * unit;
          const uy = (py + (sy + 0.5) / SS) * unit;
          let hit = null;
          for (const shape of shapes) {
            if (insideRoundedRect(ux, uy, shape.rect)) hit = shape;
          }
          if (hit) {
            r += hit.rgb[0];
            g += hit.rgb[1];
            b += hit.rgb[2];
            a += 255;
          }
        }
      }
      const samples = SS * SS;
      const alpha = a / samples;
      const i = (py * size + px) * 4;
      // Un premultiply so partly covered edge pixels keep their colour.
      const coverage = alpha === 0 ? 1 : a / 255;
      pixels[i] = Math.round(r / coverage);
      pixels[i + 1] = Math.round(g / coverage);
      pixels[i + 2] = Math.round(b / coverage);
      pixels[i + 3] = Math.round(alpha);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encodes 8 bit RGBA pixels as a PNG, filter type 0 on every scanline. */
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const ANY = { inset: 0, cornerRadius: 22 };
const MASKABLE = { inset: 20, cornerRadius: 0 };
const APPLE = { inset: 0, cornerRadius: 0 };

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon.svg"), svgSource(ANY));
const files = [
  ["icon-192.png", 192, ANY],
  ["icon-512.png", 512, ANY],
  ["icon-maskable-512.png", 512, MASKABLE],
  ["apple-touch-icon.png", 180, APPLE],
];
for (const [name, size, options] of files) {
  writeFileSync(join(outDir, name), encodePng(size, raster(size, options)));
}
console.log(`icons: wrote icon.svg and ${files.length} png files to public`);
