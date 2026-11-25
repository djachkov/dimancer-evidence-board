/**
 * Board styles: how a board's cards, pins and threads look, and the decorations around its frame.
 * Pure (no Foundry, no DOM), so it can be tested under Node; the drawing lives in scripts/render/.
 *
 * A board stores its choice in flags.dimancer_board.board.style ({cards, pins, threads}) and
 * .decor. A board without a stored style takes its surface's theme, so boards made before styles
 * existed keep looking the way they did.
 *
 * Styles only change how things look, never where they are: a card's paper box (and so its pins,
 * hit area and threads) is the same in every style.
 */

import { getSurface } from "./surface-presets.mjs";
import { THREAD_COLORS } from "./links.mjs";
import { INK_COLORS, NOTE_COLORS } from "./stickers.mjs";

/** The styles a theme starts a board with. */
export const THEMES = Object.freeze({
  classic: Object.freeze({ cards: "classic", pins: "pushpin", threads: "yarn" }),
  medieval: Object.freeze({ cards: "parchment", pins: "nail", threads: "twine" }),
  cyberpunk: Object.freeze({ cards: "holo", pins: "node", threads: "dataline" })
});

const freezeAll = list => Object.freeze(list.map(o => Object.freeze(o)));

/** Card styles, with the paper and ink colours their notes and drawings offer. Labels: DIMANCER_BOARD.Style.Cards.<id> */
export const CARD_STYLES = freezeAll([
  { id: "classic", notes: NOTE_COLORS, ink: INK_COLORS },
  {
    id: "parchment",
    notes: freezeAll([
      { key: "vellum", color: "#f1e3c0" },
      { key: "aged", color: "#e2c98f" },
      { key: "ochre", color: "#d9a85b" },
      { key: "rose", color: "#d9a39a" },
      { key: "sage", color: "#b8c29a" },
      { key: "ash", color: "#cfc8b8" }
    ]),
    ink: freezeAll([
      { key: "irongall", color: "#2a1e14" },
      { key: "cinnabar", color: "#8e2a1e" },
      { key: "woad", color: "#2c3e6b" },
      { key: "verdigris", color: "#3b5a2a" },
      { key: "gold", color: "#b8860b" }
    ])
  },
  {
    id: "holo",
    notes: freezeAll([
      { key: "cyan", color: "#00e5ff" },
      { key: "magenta", color: "#ff2bd6" },
      { key: "lime", color: "#a6ff00" },
      { key: "amber", color: "#ffb000" },
      { key: "violet", color: "#9d6bff" },
      { key: "white", color: "#e6f1ff" }
    ]),
    ink: freezeAll([
      { key: "cyan", color: "#00e5ff" },
      { key: "magenta", color: "#ff2bd6" },
      { key: "lime", color: "#a6ff00" },
      { key: "amber", color: "#ffb000" },
      { key: "white", color: "#e6f1ff" }
    ])
  }
]);

/** Pin styles. Labels: DIMANCER_BOARD.Style.Pins.<id> */
export const PIN_STYLES = freezeAll([{ id: "pushpin" }, { id: "nail" }, { id: "node" }]);

/** Thread styles and the colours their menu offers (the first is the default). Labels: DIMANCER_BOARD.Style.Threads.<id> */
export const THREAD_STYLES = freezeAll([
  { id: "yarn", colors: THREAD_COLORS },
  {
    id: "twine",
    colors: freezeAll([
      { key: "hemp", color: "#b8955a" },
      { key: "wool", color: "#a8322a" },
      { key: "cord", color: "#2b2420" },
      { key: "moss", color: "#4f6b34" },
      { key: "woad", color: "#3d5a80" }
    ])
  },
  {
    id: "dataline",
    colors: freezeAll([
      { key: "cyan", color: "#00e5ff" },
      { key: "magenta", color: "#ff2bd6" },
      { key: "lime", color: "#a6ff00" },
      { key: "amber", color: "#ffb000" },
      { key: "red", color: "#ff3355" }
    ])
  }
]);

const byId = list => new Map(list.map(s => [s.id, s]));
const CARDS = byId(CARD_STYLES);
const PINS = byId(PIN_STYLES);
const THREADS = byId(THREAD_STYLES);

/** The theme of a surface ("classic" for none or an unknown one). */
export function themeOf(surfaceId) {
  const theme = getSurface(surfaceId)?.theme;
  return THEMES[theme] ? theme : "classic";
}

/**
 * Normalise a stored style flag: each part a known style, else the surface theme's.
 * @param {unknown} raw          flags.dimancer_board.board.style
 * @param {string|null} surfaceId
 * @returns {{cards: string, pins: string, threads: string}}
 */
export function normalizeStyle(raw, surfaceId) {
  const theme = THEMES[themeOf(surfaceId)];
  return {
    cards: CARDS.has(raw?.cards) ? raw.cards : theme.cards,
    pins: PINS.has(raw?.pins) ? raw.pins : theme.pins,
    threads: THREADS.has(raw?.threads) ? raw.threads : theme.threads
  };
}

/** Decorations each frame style can have, in the order the forms show them. */
export const DECORATIONS = Object.freeze({
  bevel: Object.freeze([]),
  timber: Object.freeze(["sign", "roof", "lanterns"]),
  neon: Object.freeze(["hud", "brackets"])
});

/** Every decoration is on until someone turns it off; animation is off until turned on. */
const DECOR_DEFAULTS = Object.freeze({ sign: true, roof: true, lanterns: true, hud: true, brackets: true, animate: false });

/** Longest sign text kept. */
export const SIGN_MAX = 40;

/**
 * Normalise a stored decorations flag.
 * @param {unknown} raw   flags.dimancer_board.board.decor
 * @returns {{sign: boolean, roof: boolean, lanterns: boolean, hud: boolean, brackets: boolean, animate: boolean, signText: string}}
 *   signText "" means the board's name
 */
export function normalizeDecor(raw) {
  const out = {};
  for ( const [key, value] of Object.entries(DECOR_DEFAULTS) ) out[key] = (typeof raw?.[key] === "boolean") ? raw[key] : value;
  out.signText = (typeof raw?.signText === "string") ? raw.signText.trim().slice(0, SIGN_MAX) : "";
  return out;
}

/** The decorations a frame style offers. */
export const decorationsOf = frameStyle => DECORATIONS[frameStyle] ?? DECORATIONS.bevel;

/** Colours offered for new threads of a thread style. */
export const threadColors = id => (THREADS.get(id) ?? THREADS.get("yarn")).colors;

/** Paper colours offered for notes, and ink colours for drawing, in a card style. */
export const noteColors = id => (CARDS.get(id) ?? CARDS.get("classic")).notes;
export const inkColors = id => (CARDS.get(id) ?? CARDS.get("classic")).ink;

/* -------------------------------------------- */
/*  Shapes                                      */
/* -------------------------------------------- */

/** A stable 32-bit seed for a string (FNV-1a), never 0. */
export function hashString(str) {
  let h = 0x811C9DC5;
  for ( let i = 0; i < str.length; i++ ) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 1;
}

/** mulberry32, kept local so this module needs nothing but the registries. */
function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The outline of a torn sheet: points around the unit square, each pulled a little way in from its
 * side, with the odd deeper tear and a chance of a torn-off corner. Fractions of the paper, so the
 * same card keeps the same edge at any size.
 * @param {number} seed
 * @param {number} [perSide=12]   Points along each side
 * @returns {number[]}            Flat [x0, y0, x1, y1, …], clockwise from the top-left
 */
export function tornEdge(seed, perSide = 12) {
  const rng = rand(seed);
  const depth = () => {
    const tear = rng() < 0.08 ? 0.025 : 0;
    return 0.004 + (rng() * 0.014) + tear;
  };
  const pts = [];
  const corner = () => (rng() < 0.25 ? 0.03 + (rng() * 0.03) : 0);
  const corners = [corner(), corner(), corner(), corner()];
  // Each side runs from (just past) one corner to the next; a torn-off corner starts it further in.
  const side = (k, map) => {
    const start = corners[k];
    const end = 1 - corners[(k + 1) % 4];
    for ( let i = 0; i < perSide; i++ ) {
      const t = start + (((end - start) * i) / perSide);
      pts.push(...map(t, i === 0 && !start ? 0 : depth()));
    }
  };
  side(0, (t, d) => [t, d]);
  side(1, (t, d) => [1 - d, t]);
  side(2, (t, d) => [1 - t, 1 - d]);
  side(3, (t, d) => [d, 1 - t]);
  return pts.map(v => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000);
}
