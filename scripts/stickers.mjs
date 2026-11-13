/**
 * Pure helpers for stickers: sticky notes (text on coloured paper) and sketches (freehand ink on
 * the board). Both are cards with a `kind`, so moving, resizing, threads, hiding, locking,
 * categories and folders work for them exactly as for evidence images. No Foundry globals here.
 *
 * Ink is stored as vector strokes in the card's own "view box" (`view`), not in board
 * coordinates, so a sketch can be moved and resized without rewriting its strokes:
 *
 *   card.view    = {x, y, w, h}       the region of stroke space the card shows
 *   card.strokes = {<id>: {color, width, points: [x0, y0, x1, y1, …], sort, author}}
 *
 * The card's width/height scale that region (aspect ratio is kept on resize). Strokes are keyed
 * by id so two people drawing on one sketch at once add strokes side by side instead of
 * overwriting each other.
 */

import { FLAG_CARDS } from "./constants.mjs";
import { MIN_CARD_SIZE, MAX_CARD_SIZE, isEvidence, normalizeCard, topSort } from "./cards.mjs";
export { normalizeStroke, normalizeStrokes, normalizeView } from "./cards.mjs";

export const STICKER_KINDS = Object.freeze(["note", "sketch"]);

export const isSticker = card => STICKER_KINDS.includes(card?.kind);

/** Paper colours for sticky notes. */
export const NOTE_COLORS = Object.freeze([
  { key: "yellow", color: "#fff17a" },
  { key: "pink", color: "#ffb7cd" },
  { key: "blue", color: "#a9dcf7" },
  { key: "green", color: "#c6e9a2" },
  { key: "orange", color: "#ffc98c" },
  { key: "white", color: "#f6f3ea" }
]);

/** Ink colours and pen widths (in board pixels at the size the stroke was drawn). */
export const INK_COLORS = Object.freeze([
  { key: "black", color: "#222222" },
  { key: "red", color: "#c0392b" },
  { key: "blue", color: "#2e6fd1" },
  { key: "green", color: "#2e8b57" },
  { key: "white", color: "#ffffff" }
]);

export const PEN_WIDTHS = Object.freeze([
  { key: "fine", width: 3 },
  { key: "medium", width: 6 },
  { key: "bold", width: 12 }
]);

export const NOTE_SIZE = 220;

/** Longest text a note takes (a pasted wall of text is cut here). */
export const NOTE_MAX_TEXT = 4000;

/**
 * A note's side length for some text: the standard size for a few lines, growing with longer text
 * (by area, so the font stays readable) up to twice the size.
 */
export function noteSizeFor(text) {
  const length = String(text ?? "").length;
  const lines = String(text ?? "").split("\n").length;
  const weight = Math.max(length, lines * 24);
  if ( weight <= 140 ) return NOTE_SIZE;
  return Math.round(Math.min(NOTE_SIZE * Math.sqrt(weight / 140), NOTE_SIZE * 2));
}

/** Room left around a sketch's ink, so the outline and threads don't sit right on the strokes. */
export const SKETCH_MARGIN = 10;

const HEX = /^#[0-9a-f]{6}$/i;
const round1 = v => Math.round(v * 10) / 10;

/**
 * Drop points closer than `tolerance` to the line through their neighbours
 * (Ramer–Douglas–Peucker), and round to 0.1 px. Keeps stored strokes small.
 * @param {number[]} points  Flat [x0, y0, x1, y1, …]
 */
export function simplifyPoints(points, tolerance = 0.75) {
  const n = Math.floor(points.length / 2);
  if ( n <= 2 ) return points.slice(0, n * 2).map(round1);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while ( stack.length ) {
    const [a, b] = stack.pop();
    const ax = points[2 * a]; const ay = points[(2 * a) + 1];
    const bx = points[2 * b]; const by = points[(2 * b) + 1];
    const dx = bx - ax; const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1; let index = -1;
    for ( let i = a + 1; i < b; i++ ) {
      const px = points[2 * i]; const py = points[(2 * i) + 1];
      const d = len ? Math.abs((dy * (px - ax)) - (dx * (py - ay))) / len : Math.hypot(px - ax, py - ay);
      if ( d > worst ) { worst = d; index = i; }
    }
    if ( worst > tolerance ) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out = [];
  for ( let i = 0; i < n; i++ ) if ( keep[i] ) out.push(round1(points[2 * i]), round1(points[(2 * i) + 1]));
  return out;
}

/** The box around a stroke's points, grown by half the pen width. */
export function strokeBounds(points, width = 0) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for ( let i = 0; i + 1 < points.length; i += 2 ) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
  }
  const r = width / 2;
  return { x: minX - r, y: minY - r, w: (maxX - minX) + width, h: (maxY - minY) + width };
}

/** Grow a box by `m` on every side and to at least `min` square, around its centre. */
function padBox(box, m, min) {
  let { x, y, w, h } = { x: box.x - m, y: box.y - m, w: box.w + (2 * m), h: box.h + (2 * m) };
  if ( w < min ) { x -= (min - w) / 2; w = min; }
  if ( h < min ) { y -= (min - h) / 2; h = min; }
  return { x, y, w, h };
}

const union = (a, b) => {
  const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * A new sticky note centred on (x, y).
 * @returns {import("./cards.mjs").Card}
 */
export function newNote({ id, x, y, color, cards = {}, size = NOTE_SIZE, ...rest }) {
  return normalizeCard({
    ...rest, id, kind: "note", text: rest.text ?? "",
    color: HEX.test(color ?? "") ? color : NOTE_COLORS[0].color,
    x: Math.round(x - (size / 2)), y: Math.round(y - (size / 2)), width: size, height: size,
    view: { x: 0, y: 0, w: size, h: size },
    sort: topSort(cards)
  }, id);
}

/**
 * A new sketch holding one stroke drawn on the board (points in board coordinates). Its view box
 * is the stroke's own board area, so the card sits exactly where the ink was drawn.
 * @returns {import("./cards.mjs").Card}
 */
export function newSketch({ id, strokeId, stroke, cards = {}, ...rest }) {
  const box = padBox(strokeBounds(stroke.points, stroke.width), SKETCH_MARGIN, MIN_CARD_SIZE);
  const view = { x: round1(box.x), y: round1(box.y), w: round1(box.w), h: round1(box.h) };
  return normalizeCard({
    ...rest, id, kind: "sketch", rotation: 0,
    x: view.x, y: view.y, width: view.w, height: view.h, view,
    strokes: { [strokeId]: { ...stroke, sort: 0 } },
    sort: topSort(cards)
  }, id);
}

/**
 * Convert a point in the card's unrotated local frame (origin at the card's top-left corner, in
 * board pixels) into its view box.
 */
export function localToView(card, lx, ly) {
  const view = card.view ?? { x: 0, y: 0, w: card.width, h: card.height };
  return { x: view.x + (lx * view.w / card.width), y: view.y + (ly * view.h / card.height) };
}

/** Board-pixel length → view-box length, for pen widths. */
export function viewScale(card) {
  const view = card.view ?? { w: card.width };
  return view.w / card.width;
}

/**
 * The Scene update that adds a stroke (already in view-box coordinates) to a card. A sketch grows
 * to take in ink drawn past its edges, keeping everything already drawn where it is on the board;
 * a note or a piece of evidence keeps its size and clips the ink to its paper.
 *
 * Evidence only gets a stored view box with its first ink: until then its view is just its current
 * size, so the first stroke pins it down and later resizes scale the drawing along with the card.
 */
export function strokeAddUpdate(card, strokeId, stroke) {
  const base = `${FLAG_CARDS}.${card.id}`;
  const existing = Object.values(card.strokes ?? {});
  const sort = Math.max(-1, ...existing.map(s => s.sort)) + 1;
  const update = { [`${base}.strokes.${strokeId}`]: { ...stroke, sort } };
  if ( card.kind !== "sketch" ) {
    if ( isEvidence(card) && !existing.length ) {
      const v = card.view ?? { x: 0, y: 0, w: card.width, h: card.height };
      update[`${base}.view`] = { x: v.x, y: v.y, w: v.w, h: v.h };
    }
    return update;
  }
  const view = card.view;
  const k = card.width / view.w;   // board px per view unit
  const margin = SKETCH_MARGIN / k;
  const ink = padBox(strokeBounds(stroke.points, stroke.width), margin, 0);
  const grown = union(view, ink);
  if ( (grown.w === view.w) && (grown.h === view.h) ) return update;
  // Cap the growth so the card stays within the size limits.
  const maxView = MAX_CARD_SIZE / k;
  if ( (grown.w > maxView) || (grown.h > maxView) ) return update;
  const next = { x: round1(grown.x), y: round1(grown.y), w: round1(grown.w), h: round1(grown.h) };
  update[`${base}.view`] = next;
  update[`${base}.x`] = Math.round(card.x + ((next.x - view.x) * k));
  update[`${base}.y`] = Math.round(card.y + ((next.y - view.y) * k));
  update[`${base}.width`] = Math.round(next.w * k);
  update[`${base}.height`] = Math.round(next.h * k);
  return update;
}

/** The Scene update that removes strokes from a sticker. */
export function strokeDeleteUpdate(cardId, strokeIds, deletion) {
  return Object.fromEntries(strokeIds.map(id => [`${FLAG_CARDS}.${cardId}.strokes.${id}`, deletion]));
}

/** A short name for a sticker in lists: its title, or the first line of its text. */
export function stickerName(card, max = 48) {
  if ( card.title ) return card.title;
  const line = String(card.text ?? "").split("\n").map(l => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Distance from (px, py) to the segment a–b. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const len2 = (dx * dx) + (dy * dy);
  const k = len2 ? Math.min(Math.max((((px - ax) * dx) + ((py - ay) * dy)) / len2, 0), 1) : 0;
  return Math.hypot(px - (ax + (k * dx)), py - (ay + (k * dy)));
}

/**
 * Is a view-box point on (or within `tolerance` of) any stroke? Lets a sketch be grabbed by its
 * ink without its empty corners covering the evidence underneath.
 */
export function inkHit(strokes, x, y, tolerance = 0) {
  for ( const s of Object.values(strokes ?? {}) ) {
    const p = s.points;
    const r = (s.width / 2) + tolerance;
    if ( p.length === 2 ) {
      if ( Math.hypot(x - p[0], y - p[1]) <= r ) return true;
      continue;
    }
    for ( let i = 0; i + 3 < p.length; i += 2 ) {
      if ( segmentDistance(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r ) return true;
    }
  }
  return false;
}

/** What to call any card in menus and lists (localized; not for use in tests). */
export function cardLabel(card) {
  const i18n = key => globalThis.game?.i18n?.localize(`DIMANCER_BOARD.${key}`) ?? key;
  if ( card.kind === "note" ) return stickerName(card) || i18n("Sticker.Note");
  if ( card.kind === "sketch" ) return card.title || i18n("Sticker.Sketch");
  if ( card.kind === "document" ) return card.title || i18n("Document.Untitled");
  return card.title || i18n("Card.Untitled");
}
