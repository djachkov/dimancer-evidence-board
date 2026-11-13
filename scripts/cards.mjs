/**
 * Pure helpers for the evidence cards stored in a board Scene's flags.
 * No Foundry globals here, so `node --test` can exercise them directly.
 *
 * A card's x/y is the top-left corner of its image in canvas coordinates; width/height are the
 * image's size. The paper frame drawn around it is decoration and isn't part of the stored size.
 *
 * @typedef {object} Card
 * @property {string} id
 * @property {string} src          Image path or URL
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} rotation     Degrees
 * @property {number} sort         Higher draws on top
 * @property {string} title
 * @property {string} notes        HTML
 * @property {boolean} hidden      Only GMs see hidden cards
 * @property {boolean} locked      Only GMs can change locked cards
 * @property {string|null} link    UUID of the document the card was made from
 * @property {string|null} category  Category id (see organize.mjs)
 * @property {string|null} folder    Folder id in the evidence list (null = top level)
 * @property {string|null} author  User id
 * @property {number} created      Epoch ms
 * @property {"image"|"document"|"note"|"sketch"} kind  Evidence (an image or a text document), sticky
 *   note or freehand sketch
 * @property {string[]} docPages   A text document's pages (HTML each), mirrored from its journal page
 * @property {string} text         A note's text (plain, multi-line)
 * @property {string|null} color   A note's paper colour
 * @property {{x: number, y: number, w: number, h: number}} view  Stroke space shown (see stickers.mjs)
 * @property {Record<string, object>} strokes  Freehand ink on a note or sketch
 */

import { FLAG_CARDS, NEW_CARD_SIZE } from "./constants.mjs";

export const MIN_CARD_SIZE = 40;
export const MAX_CARD_SIZE = 4000;

/** @type {Card} */
export const CARD_DEFAULTS = Object.freeze({
  id: "", src: "", x: 0, y: 0, width: NEW_CARD_SIZE, height: NEW_CARD_SIZE, rotation: 0, sort: 0,
  title: "", notes: "", hidden: false, locked: false, link: null, category: null, folder: null, author: null, created: 0,
  kind: "image", text: "", color: null, view: null, strokes: null, page: null, docPages: null
});

const KINDS = ["image", "document", "note", "sketch"];

/** Kinds of card that are evidence (in the Evidence Journal), as opposed to stickers. */
export const EVIDENCE_KINDS = Object.freeze(["image", "document"]);
export const isEvidence = card => EVIDENCE_KINDS.includes(card?.kind);

/** A text document's paper: A4, as width / height. */
export const A4 = Object.freeze({ width: 210, height: 297 });
const HEX = /^#[0-9a-f]{6}$/i;

const num = (v, d) => (Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Fill in defaults and coerce types, so rendering code never sees a half-written card.
 * @param {Partial<Card>} raw
 * @param {string} [id]     The key the card is stored under, which wins over raw.id
 * @returns {Card}
 */
export function normalizeCard(raw = {}, id) {
  const c = { ...CARD_DEFAULTS, ...(raw ?? {}) };
  const card = {
    id: String(id ?? c.id ?? ""),
    src: String(c.src ?? ""),
    x: Math.round(num(c.x, 0)),
    y: Math.round(num(c.y, 0)),
    width: Math.round(clamp(num(c.width, NEW_CARD_SIZE), MIN_CARD_SIZE, MAX_CARD_SIZE)),
    height: Math.round(clamp(num(c.height, NEW_CARD_SIZE), MIN_CARD_SIZE, MAX_CARD_SIZE)),
    rotation: num(c.rotation, 0),
    sort: num(c.sort, 0),
    title: String(c.title ?? ""),
    notes: String(c.notes ?? ""),
    hidden: !!c.hidden,
    locked: !!c.locked,
    link: c.link ? String(c.link) : null,
    category: c.category ? String(c.category) : null,
    folder: c.folder ? String(c.folder) : null,
    author: c.author ? String(c.author) : null,
    created: num(c.created, 0)
  };
  card.kind = KINDS.includes(c.kind) ? c.kind : "image";
  card.text = String(c.text ?? "");
  card.color = HEX.test(c.color ?? "") ? c.color : null;
  card.view = normalizeView(c.view, card);
  card.strokes = normalizeStrokes(c.strokes);
  // The Evidence Journal page this card shows (its UUID), when it's linked to one.
  card.page = isEvidence(card) && (typeof c.page === "string") && c.page ? c.page : null;
  card.docPages = (card.kind === "document") ? normalizeDocPages(c.docPages) : [];
  return card;
}

/** A text document's pages: HTML strings (anything else dropped). */
export function normalizeDocPages(raw) {
  return Array.isArray(raw) ? raw.filter(p => typeof p === "string") : [];
}

/** A valid stroke, or null. */
export function normalizeStroke(raw) {
  if ( !raw || (typeof raw !== "object") || !Array.isArray(raw.points) ) return null;
  const points = raw.points.filter(Number.isFinite);
  if ( points.length < 2 ) return null;
  if ( points.length % 2 ) points.pop();
  return {
    color: HEX.test(raw.color ?? "") ? raw.color : "#222222",
    width: (Number.isFinite(raw.width) && (raw.width > 0)) ? raw.width : 4,
    points,
    sort: Number.isFinite(raw.sort) ? raw.sort : 0,
    author: raw.author ? String(raw.author) : null
  };
}

/** Strokes by id, invalid ones dropped. */
export function normalizeStrokes(raw) {
  const out = {};
  if ( !raw || (typeof raw !== "object") ) return out;
  for ( const [id, s] of Object.entries(raw) ) {
    const stroke = normalizeStroke(s);
    if ( stroke ) out[id] = stroke;
  }
  return out;
}

/** A card's view box; defaults to its own size. */
export function normalizeView(raw, card) {
  const ok = raw && ["x", "y", "w", "h"].every(k => Number.isFinite(raw[k])) && (raw.w > 0) && (raw.h > 0);
  return ok ? { x: raw.x, y: raw.y, w: raw.w, h: raw.h } : { x: 0, y: 0, w: card.width, h: card.height };
}

/**
 * Scale an image's natural size so its long side is `longSide`, keeping the aspect ratio.
 * Unknown or broken sizes fall back to a 4:3 landscape.
 * @returns {{width: number, height: number}}
 */
export function fitSize(naturalWidth, naturalHeight, longSide = NEW_CARD_SIZE) {
  let w = num(naturalWidth, 0);
  let h = num(naturalHeight, 0);
  if ( (w <= 0) || (h <= 0) ) { w = 4; h = 3; }
  const k = longSide / Math.max(w, h);
  return {
    width: Math.round(clamp(w * k, MIN_CARD_SIZE, MAX_CARD_SIZE)),
    height: Math.round(clamp(h * k, MIN_CARD_SIZE, MAX_CARD_SIZE))
  };
}

/**
 * Build a new card centred on (x, y).
 * @param {object} args
 * @param {string} args.id
 * @param {string} args.src
 * @param {number} args.x                 Centre x
 * @param {number} args.y                 Centre y
 * @param {number} [args.naturalWidth]
 * @param {number} [args.naturalHeight]
 * @param {Record<string, Card>} [args.cards]  Existing cards, so the new one lands on top
 * @param {number} [args.rotation]
 * @returns {Card}
 */
export function newCard({ id, src, x, y, naturalWidth, naturalHeight, cards = {}, rotation = 0, ...rest }) {
  const { width, height } = fitSize(naturalWidth, naturalHeight);
  return normalizeCard({
    ...rest, id, src, width, height, rotation,
    x: x - (width / 2),
    y: y - (height / 2),
    sort: topSort(cards)
  }, id);
}

/** Normalized cards, bottom to top. */
export function cardList(cards = {}) {
  return Object.entries(cards ?? {})
    .filter(([, c]) => c && (typeof c === "object"))
    .map(([id, c]) => normalizeCard(c, id))
    .sort((a, b) => (a.sort - b.sort) || (a.created - b.created));
}

/** A sort value that puts a card above every other card. */
export function topSort(cards = {}) {
  const list = cardList(cards);
  return list.length ? Math.max(...list.map(c => c.sort)) + 1 : 0;
}

/** A sort value that puts a card below every other card. */
export function bottomSort(cards = {}) {
  const list = cardList(cards);
  return list.length ? Math.min(...list.map(c => c.sort)) - 1 : 0;
}

/** Is this card already the topmost one? */
export function isTop(cards, id) {
  const list = cardList(cards);
  return !!list.length && (list.at(-1).id === id);
}

/**
 * Cards in reading order (rows of `band` px top to bottom, then left to right inside a row),
 * which is how evidence reads on a board.
 * @param {Record<string, Card>} cards
 * @param {{includeHidden?: boolean, evidenceOnly?: boolean, band?: number}} [options]
 *   evidenceOnly leaves out stickers (notes and sketches).
 * @returns {Card[]}
 */
export function orderedCards(cards, { includeHidden = true, evidenceOnly = false, band = 250 } = {}) {
  const centre = c => ({ cx: c.x + (c.width / 2), cy: c.y + (c.height / 2) });
  return cardList(cards)
    .filter(c => (includeHidden || !c.hidden) && (!evidenceOnly || isEvidence(c)))
    .map(c => ({ c, ...centre(c) }))
    .sort((a, b) => (Math.floor(a.cy / band) - Math.floor(b.cy / band)) || (a.cx - b.cx) || (a.c.sort - b.c.sort))
    .map(e => e.c);
}

/**
 * Where a card sits in reading order, and its neighbours (wrapping around).
 * @returns {{index: number, total: number, prev: Card|null, next: Card|null}}
 */
export function neighbours(cards, id, options) {
  const list = orderedCards(cards, options);
  const index = list.findIndex(c => c.id === id);
  const total = list.length;
  if ( (index < 0) || (total < 2) ) return { index, total, prev: null, next: null };
  return { index, total, prev: list[(index - 1 + total) % total], next: list[(index + 1) % total] };
}

/**
 * Keep a card's top-left inside a rectangle (the scene rect), allowing it to overhang by up to
 * half its size so cards can sit on the edge of the board.
 * @param {{x: number, y: number, width: number, height: number}} card
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @returns {{x: number, y: number}}
 */
export function clampToRect(card, rect) {
  const hw = card.width / 2;
  const hh = card.height / 2;
  return {
    x: Math.round(clamp(card.x, rect.x - hw, rect.x + rect.width - hw)),
    y: Math.round(clamp(card.y, rect.y - hh, rect.y + rect.height - hh))
  };
}

/**
 * A Scene update that creates or patches one card. Each field gets its own dotted key, so two
 * users editing different fields (or different cards) never overwrite each other.
 * @param {string} id
 * @param {Partial<Card>} patch
 * @returns {Record<string, unknown>}
 */
export function cardUpdate(id, patch) {
  const update = {};
  for ( const [k, v] of Object.entries(patch) ) {
    if ( k === "id" ) continue;
    update[`${FLAG_CARDS}.${id}.${k}`] = v;
  }
  return update;
}

/** A Scene update that creates a whole card. */
export function cardCreate(card) {
  return { [`${FLAG_CARDS}.${card.id}`]: { ...card } };
}

/**
 * A Scene update that removes cards.
 * @param {string[]} ids
 * @param {unknown} deletion   Foundry's deletion operator (the global `_del`)
 */
export function cardDelete(ids, deletion) {
  return Object.fromEntries(ids.map(id => [`${FLAG_CARDS}.${id}`, deletion]));
}
