/**
 * Board surfaces: the preset textures a board can be covered with, and the procedural generators
 * behind the ones that aren't images. Everything here is pure (no Foundry, no DOM) so it can be
 * tested under Node; scripts/surfaces.mjs turns it into textures on the canvas.
 *
 * Every generated tile is seamless: noise lives on a periodic lattice and every stroke, blob and
 * fibre wraps around the tile edges, so the board can repeat it with no visible seams.
 */

const ASSETS = "modules/dimancer_board/assets/surfaces";

/**
 * @typedef {object} SurfacePreset
 * @property {string} id
 * @property {string} label            i18n key under DIMANCER_BOARD.Surface
 * @property {"image"|"procedural"|"color"} kind   "color" is a plain board in a colour of the user's
 * @property {string} color            Mean colour (the default colour of a plain board)
 * @property {string} [frame]          Frame colour; a plain board's frame is a darker shade of it
 * @property {number} tile             Tile size in scene pixels
 * @property {string} [src]            Seamless tile (image presets)
 * @property {number} [size]           Tile size in pixels (procedural presets)
 * @property {(size: number, seed: number) => Uint8ClampedArray} [generate]  RGBA tile (procedural)
 */

/* -------------------------------------------- */
/*  Noise                                       */
/* -------------------------------------------- */

/** A small, fast, seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = t => t * t * (3 - (2 * t));
const mod = (n, m) => ((n % m) + m) % m;

/**
 * Fractal value noise over a size×size tile that wraps at its edges.
 * @param {number} size
 * @param {() => number} rng
 * @param {object} options
 * @param {number} options.cells        Lattice cells across the tile for the first octave
 * @param {number} [options.octaves=4]  Each doubles the cells and multiplies the amplitude by `gain`
 * @param {number} [options.gain=0.5]
 * @returns {Float32Array}              Values in roughly [-1, 1]
 */
export function fbm(size, rng, { cells, octaves = 4, gain = 0.5 }) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for ( let o = 0; o < octaves; o++ ) {
    const p = Math.max(1, Math.min(size, cells << o));
    const lattice = new Float32Array(p * p);
    for ( let i = 0; i < lattice.length; i++ ) lattice[i] = (rng() * 2) - 1;
    const scale = p / size;
    for ( let y = 0; y < size; y++ ) {
      const v = y * scale;
      const y0 = Math.floor(v);
      const fy = smooth(v - y0);
      const r0 = (y0 % p) * p;
      const r1 = ((y0 + 1) % p) * p;
      for ( let x = 0; x < size; x++ ) {
        const u = x * scale;
        const x0 = Math.floor(u);
        const fx = smooth(u - x0);
        const c0 = x0 % p;
        const c1 = (x0 + 1) % p;
        const top = lattice[r0 + c0] + ((lattice[r0 + c1] - lattice[r0 + c0]) * fx);
        const bottom = lattice[r1 + c0] + ((lattice[r1 + c1] - lattice[r1 + c0]) * fx);
        out[(y * size) + x] += (top + ((bottom - top) * fy)) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for ( let i = 0; i < out.length; i++ ) out[i] /= total;
  return out;
}

/* -------------------------------------------- */
/*  Masks: soft marks that wrap                 */
/* -------------------------------------------- */

/** Raise a mask to at least a soft round blob's coverage, wrapping around the tile. */
function blob(mask, size, cx, cy, radius, strength = 1) {
  const r = Math.ceil(radius * 2);
  const inv = 1 / (2 * radius * radius);
  for ( let dy = -r; dy <= r; dy++ ) {
    const row = mod(Math.round(cy) + dy, size) * size;
    for ( let dx = -r; dx <= r; dx++ ) {
      const ox = (Math.round(cx) + dx) - cx;
      const oy = (Math.round(cy) + dy) - cy;
      const w = strength * Math.exp(-((ox * ox) + (oy * oy)) * inv);
      if ( w < 0.004 ) continue;
      const i = row + mod(Math.round(cx) + dx, size);
      if ( w > mask[i] ) mask[i] = w;
    }
  }
}

/**
 * A wandering soft stroke: blobs along a gently curving path.
 * @param {Float32Array} mask
 * @param {number} size
 * @param {() => number} rng
 * @param {object} o
 * @param {number} o.length     Path length, px
 * @param {number} o.width      Stroke width, px
 * @param {number} [o.curl=0.6] How much the direction drifts, radians over the whole stroke
 */
function stroke(mask, size, rng, { length, width, curl = 0.6, strength = 1 }) {
  let x = rng() * size;
  let y = rng() * size;
  let angle = rng() * Math.PI * 2;
  const turn = ((rng() * 2) - 1) * curl / Math.max(1, length);
  const step = Math.max(1, width / 4);
  const radius = width / 2.6;
  for ( let d = 0; d < length; d += step ) {
    // Taper both ends so a stroke doesn't stop like a cut ribbon.
    const t = d / length;
    const taper = Math.min(1, t * 6, (1 - t) * 6);
    blob(mask, size, x, y, radius * (0.6 + (0.4 * taper)), strength * taper);
    angle += turn * step;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
  }
}

/** A thin straight line (a scratch or a fibre), one pixel wide, anti-aliased by splatting. */
function line(mask, size, x, y, angle, length, strength) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for ( let d = 0; d < length; d += 0.5 ) {
    const px = x + (dx * d);
    const py = y + (dy * d);
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const t = d / length;
    const s = strength * Math.min(1, t * 4, (1 - t) * 4);
    const put = (cx, cy, w) => {
      const i = (mod(cy, size) * size) + mod(cx, size);
      const v = s * w;
      if ( v > mask[i] ) mask[i] = v;
    };
    put(ix, iy, (1 - fx) * (1 - fy));
    put(ix + 1, iy, fx * (1 - fy));
    put(ix, iy + 1, (1 - fx) * fy);
    put(ix + 1, iy + 1, fx * fy);
  }
}

/* -------------------------------------------- */
/*  Compositing                                 */
/* -------------------------------------------- */

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/** A float RGB canvas filled with one colour. */
function paper(size, hex) {
  const [r, g, b] = rgb(hex);
  const px = new Float32Array(size * size * 3);
  for ( let i = 0; i < px.length; i += 3 ) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
  return px;
}

/** Brighten/darken every pixel by field × amount (in 0–255 units). */
function shade(px, field, amount) {
  for ( let i = 0, j = 0; i < field.length; i++, j += 3 ) {
    const v = field[i] * amount;
    px[j] += v;
    px[j + 1] += v;
    px[j + 2] += v;
  }
}

/** Composite a colour over the canvas, with mask × alpha as coverage. */
function paint(px, mask, hex, alpha) {
  const [r, g, b] = rgb(hex);
  for ( let i = 0, j = 0; i < mask.length; i++, j += 3 ) {
    const a = mask[i] * alpha;
    if ( !a ) continue;
    px[j] += (r - px[j]) * a;
    px[j + 1] += (g - px[j + 1]) * a;
    px[j + 2] += (b - px[j + 2]) * a;
  }
}

/** Per-pixel grain, which is seamless by construction. */
function grain(px, rng, amount) {
  for ( let j = 0; j < px.length; j += 3 ) {
    const v = ((rng() * 2) - 1) * amount;
    px[j] += v;
    px[j + 1] += v;
    px[j + 2] += v;
  }
}

/** Float RGB → opaque RGBA bytes. */
function toRGBA(px) {
  const out = new Uint8ClampedArray((px.length / 3) * 4);
  for ( let i = 0, j = 0; j < px.length; i += 4, j += 3 ) {
    out[i] = px[j];
    out[i + 1] = px[j + 1];
    out[i + 2] = px[j + 2];
    out[i + 3] = 255;
  }
  return out;
}

/* -------------------------------------------- */
/*  Generators                                  */
/* -------------------------------------------- */
// Feature sizes are fractions of the tile, so a small tile (a thumbnail) is a zoomed-out view of
// the full one rather than a different-looking surface.

/** Glossy white melamine: faint ghosts of erased marker, hairline scratches, a little unevenness. */
function whiteboard(size, seed) {
  const rng = mulberry32(seed);
  const px = paper(size, "#f4f5f2");
  shade(px, fbm(size, rng, { cells: 2, octaves: 3 }), 3);
  shade(px, fbm(size, rng, { cells: 32, octaves: 2 }), 1.2);

  // Ghosts of erased marker: a few short, broad, slightly curved smears, barely there.
  const ghosts = new Float32Array(size * size);
  for ( let i = 0; i < 6; i++ ) {
    stroke(ghosts, size, rng, {
      length: size * (0.06 + (rng() * 0.16)),
      width: size * (0.012 + (rng() * 0.02)),
      curl: 0.9,
      strength: 0.4 + (rng() * 0.6)
    });
  }
  paint(px, ghosts, "#8a96a3", 0.03);

  // Broad haze left by the eraser.
  const wipes = new Float32Array(size * size);
  for ( let i = 0; i < 5; i++ ) {
    stroke(wipes, size, rng, { length: size * (0.3 + (rng() * 0.3)), width: size * (0.08 + (rng() * 0.08)), curl: 0.8 });
  }
  paint(px, wipes, "#d3d8dc", 0.07);

  const scratches = new Float32Array(size * size);
  for ( let i = 0; i < 60; i++ ) {
    line(scratches, size, rng() * size, rng() * size, rng() * Math.PI, size * (0.02 + (rng() * 0.1)), 0.5 + (rng() * 0.5));
  }
  paint(px, scratches, "#ffffff", 0.35);
  grain(px, rng, 1.5);
  return toRGBA(px);
}

/** Slate chalkboard: mottled dark green, chalk dust clouds and eraser swipes. */
function chalkboard(size, seed) {
  const rng = mulberry32(seed);
  const px = paper(size, "#2e3b35");
  shade(px, fbm(size, rng, { cells: 6, octaves: 5 }), 4);

  // Dust settles in clouds: the bright parts of low-frequency noise.
  const dustField = fbm(size, rng, { cells: 4, octaves: 5, gain: 0.6 });
  const dust = new Float32Array(size * size);
  for ( let i = 0; i < dust.length; i++ ) dust[i] = Math.max(0, dustField[i] - 0.1) * 2;
  paint(px, dust, "#e8ece6", 0.045);

  const swipes = new Float32Array(size * size);
  for ( let i = 0; i < 6; i++ ) {
    stroke(swipes, size, rng, {
      length: size * (0.25 + (rng() * 0.4)),
      width: size * (0.09 + (rng() * 0.08)),
      curl: 1.4,
      strength: 0.5 + (rng() * 0.5)
    });
  }
  paint(px, swipes, "#dfe5dd", 0.06);

  const flecks = new Float32Array(size * size);
  for ( let i = 0; i < 400; i++ ) {
    line(flecks, size, rng() * size, rng() * size, rng() * Math.PI, 1 + (rng() * size * 0.006), rng());
  }
  paint(px, flecks, "#f2f4ef", 0.35);
  grain(px, rng, 3);
  return toRGBA(px);
}

/** Billiard-table felt: fine fuzz, soft unevenness and stray fibres, lighter and darker. */
function felt(base) {
  return (size, seed) => {
    const rng = mulberry32(seed);
    const px = paper(size, base);
    shade(px, fbm(size, rng, { cells: 3, octaves: 3 }), 6);
    shade(px, fbm(size, rng, { cells: 48, octaves: 2 }), 6);
    const light = new Float32Array(size * size);
    const dark = new Float32Array(size * size);
    const count = Math.round(size * size * 0.012);
    for ( let i = 0; i < count; i++ ) {
      const mask = rng() < 0.5 ? light : dark;
      line(mask, size, rng() * size, rng() * size, rng() * Math.PI * 2, size * (0.004 + (rng() * 0.016)), 0.4 + (rng() * 0.6));
    }
    paint(px, light, "#ffffff", 0.12);
    paint(px, dark, "#000000", 0.16);
    grain(px, rng, 5);
    return toRGBA(px);
  };
}

/* -------------------------------------------- */
/*  Registry                                    */
/* -------------------------------------------- */

/** @type {ReadonlyArray<SurfacePreset>} In the order the pickers show them. */
export const SURFACES = Object.freeze([
  { id: "cork-002", label: "CorkFine", kind: "image", color: "#af8265", frame: "#7a5230", src: `${ASSETS}/cork-002.webp` },
  { id: "cork-004", label: "CorkClassic", kind: "image", color: "#aa703d", frame: "#6e4526", src: `${ASSETS}/cork-004.webp` },
  { id: "cork-001", label: "CorkRose", kind: "image", color: "#c08168", frame: "#7a5230", src: `${ASSETS}/cork-001.webp` },
  { id: "whiteboard", label: "Whiteboard", kind: "procedural", color: "#f2f3f0", frame: "#c5cad0", size: 1024, generate: whiteboard },
  { id: "chalkboard", label: "Chalkboard", kind: "procedural", color: "#33403a", frame: "#8a6440", size: 1024, generate: chalkboard },
  { id: "felt-green", label: "FeltGreen", kind: "procedural", color: "#2f5a3a", frame: "#4a3020", size: 512, generate: felt("#2f5a3a") },
  { id: "felt-burgundy", label: "FeltBurgundy", kind: "procedural", color: "#5a2430", frame: "#4a3020", size: 512, generate: felt("#5a2430") },
  { id: "kraft", label: "Kraft", kind: "image", color: "#a58768", frame: "#6b4a2b", src: `${ASSETS}/kraft.webp` },
  { id: "plain", label: "Plain", kind: "color", color: "#9c7650" }
].map(p => Object.freeze({ tile: p.size ?? 1024, ...p })));

const BY_ID = new Map(SURFACES.map(p => [p.id, p]));

/** The preset with this id, or null. */
export const getSurface = id => BY_ID.get(id) ?? null;

/** The surface a new board gets before anyone has picked one. */
export const DEFAULT_SURFACE = "cork-002";

/** A fresh seed for a procedural surface. */
export const randomSeed = () => Math.floor(Math.random() * 0x7FFFFFFF) + 1;

const HEX = /^#[0-9a-f]{6}$/i;

/** A valid #rrggbb colour, or the fallback. */
export const validColor = (value, fallback) => (typeof value === "string") && HEX.test(value) ? value.toLowerCase() : fallback;

/** Mix a #rrggbb colour towards black (amount < 0) or white (amount > 0). */
export function shadeColor(hex, amount) {
  const target = amount < 0 ? 0 : 255;
  const a = Math.abs(amount);
  return `#${rgb(hex).map(c => Math.round(c + ((target - c) * a)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Normalise a stored surface flag. Unknown ids (and boards made before surfaces existed) mean no
 * surface; a procedural surface without a seed gets a fixed one so every client agrees.
 * @param {unknown} raw   flags.dimancer_board.board.surface
 * @returns {{id: string|null, seed: number, color: string|null, frame: string|null}}
 *   color is the plain board's colour; frame is a chosen border colour (null: the surface's own)
 */
export function normalizeSurface(raw) {
  const preset = getSurface(raw?.id);
  if ( !preset ) return { id: null, seed: 1, color: null, frame: null };
  const seed = Number.isInteger(raw.seed) && (raw.seed > 0) ? raw.seed : 1;
  return { id: preset.id, seed, color: validColor(raw.color, preset.color), frame: validColor(raw.frame, null) };
}

/** The surface's own frame colour, ignoring any chosen border colour. */
export function defaultFrameColor(surface) {
  const preset = getSurface(surface?.id);
  if ( !preset ) return null;
  return preset.frame ?? shadeColor(validColor(surface.color, preset.color), -0.45);
}

/** The frame colour around a board with this surface: the chosen border colour, or its own. */
export function frameColor(surface) {
  if ( !getSurface(surface?.id) ) return null;
  return validColor(surface.frame, null) ?? defaultFrameColor(surface);
}

/**
 * The flag value for a newly chosen surface (null or "" for none).
 * @param {string|null} id
 * @param {object} [options]
 * @param {string} [options.color]   The board colour of a plain surface
 * @param {string} [options.frame]   A border colour (omitted: the surface's own)
 */
export function surfaceFlag(id, { color, frame } = {}) {
  const preset = getSurface(id);
  if ( !preset ) return { id: null };
  const flag = { id: preset.id };
  if ( preset.kind === "procedural" ) flag.seed = randomSeed();
  if ( preset.kind === "color" ) flag.color = validColor(color, preset.color);
  const border = validColor(frame, null);
  if ( border ) flag.frame = border;
  return flag;
}

/* -------------------------------------------- */
/*  Board geometry                              */
/* -------------------------------------------- */

/** Board sizes offered when creating a board, in scene pixels. */
export const BOARD_SIZES = Object.freeze([
  { id: "small", width: 2400, height: 1800 },
  { id: "medium", width: 4000, height: 3000 },
  { id: "large", width: 6000, height: 4500 },
  { id: "huge", width: 8000, height: 6000 }
].map(s => Object.freeze(s)));

export const DEFAULT_SIZE = "medium";

/** Limits for a custom board size. */
export const SIZE_LIMITS = Object.freeze({ min: 1000, max: 16000 });

/** Width and height for a size id, or the clamped custom size. */
export function boardSize(id, width, height) {
  const preset = BOARD_SIZES.find(s => s.id === id);
  if ( preset ) return { width: preset.width, height: preset.height };
  const clamp = v => Math.min(SIZE_LIMITS.max, Math.max(SIZE_LIMITS.min, Math.round(Number(v) || 0)));
  return { width: clamp(width), height: clamp(height) };
}

/** Frame thickness for a board, in scene pixels: about 1% of the short side. */
export const frameWidth = (width, height) => Math.round(Math.min(64, Math.max(16, Math.min(width, height) * 0.012)));
