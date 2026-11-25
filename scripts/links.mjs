/**
 * Pure helpers for the threads ("links") that connect evidence cards. No Foundry globals here.
 *
 * Threads are undirected: A–B and B–A are the same thread, and there is at most one per pair.
 *
 * @typedef {object} Link
 * @property {string} id
 * @property {string} from     Card id
 * @property {string} to       Card id
 * @property {string} fromPin  Pin on the `from` card it hangs from (MAIN_PIN = the card's own pin)
 * @property {string} toPin    Pin on the `to` card
 * @property {string} color    CSS hex colour
 * @property {string|null} author
 * @property {number} created
 */

import { FLAG_CARDS, FLAG_LINKS } from "./constants.mjs";

/** Thread colours offered in the thread menu; the first is the default red yarn. */
export const THREAD_COLORS = Object.freeze([
  { key: "red", color: "#c0392b" },
  { key: "blue", color: "#2e6fd1" },
  { key: "green", color: "#2f9e44" },
  { key: "yellow", color: "#e0b000" },
  { key: "black", color: "#222222" }
]);
export const DEFAULT_THREAD_COLOR = THREAD_COLORS[0].color;

const HEX = /^#[0-9a-f]{6}$/i;

/** Every card has this pin (its push-pin, top centre unless moved); other pins exist for threads. */
export const MAIN_PIN = "main";

/** @returns {Link|null}  null when the entry can't be a thread (missing or identical ends) */
export function normalizeLink(raw, id) {
  if ( !raw || (typeof raw !== "object") ) return null;
  const from = raw.from ? String(raw.from) : "";
  const to = raw.to ? String(raw.to) : "";
  if ( !from || !to || (from === to) ) return null;
  return {
    id: String(id ?? raw.id ?? ""),
    from, to,
    fromPin: raw.fromPin ? String(raw.fromPin) : MAIN_PIN,
    toPin: raw.toPin ? String(raw.toPin) : MAIN_PIN,
    color: HEX.test(raw.color ?? "") ? raw.color : DEFAULT_THREAD_COLOR,
    author: raw.author ? String(raw.author) : null,
    created: Number.isFinite(raw.created) ? raw.created : 0
  };
}

/** All valid threads. */
export function linkList(links = {}) {
  return Object.entries(links ?? {}).map(([id, l]) => normalizeLink(l, id)).filter(Boolean)
    .sort((a, b) => a.created - b.created);
}

/** The thread joining two cards (in either direction), or null. */
export function linkBetween(links, a, b) {
  return linkList(links).find(l => ((l.from === a) && (l.to === b)) || ((l.from === b) && (l.to === a))) ?? null;
}

/** Threads touching any of the given cards. */
export function linksOf(links, cardIds) {
  const ids = new Set(cardIds);
  return linkList(links).filter(l => ids.has(l.from) || ids.has(l.to));
}

/** The card at the other end of a thread. */
export const otherEnd = (link, cardId) => (link.from === cardId ? link.to : link.from);

/** The pin a thread hangs from on one of its cards. */
export const pinOf = (link, cardId) => (link.from === cardId ? link.fromPin : link.toPin);

/** Ids of a card's pins that threads hang from (MAIN_PIN included when one does). */
export function usedPins(links, cardId) {
  return new Set(linksOf(links, [cardId]).map(l => pinOf(l, cardId)));
}

/**
 * The extra pins that removing some threads leaves without any thread, as {cardId: [pinId]}.
 * A card's main pin is never orphaned.
 */
export function orphanedPins(links, removedIds) {
  const removed = new Set(removedIds);
  const all = linkList(links);
  const kept = all.filter(l => !removed.has(l.id));
  const out = {};
  for ( const l of all.filter(l => removed.has(l.id)) ) {
    for ( const [card, pin] of [[l.from, l.fromPin], [l.to, l.toPin]] ) {
      if ( pin === MAIN_PIN ) continue;
      if ( kept.some(k => pinOf(k, card) === pin && ((k.from === card) || (k.to === card))) ) continue;
      (out[card] ??= []);
      if ( !out[card].includes(pin) ) out[card].push(pin);
    }
  }
  return out;
}

/**
 * A Scene update removing the pins that cutting these threads leaves without a thread.
 * @param {unknown} deletion  Foundry's deletion operator (the global `_del`)
 * @param {string[]} [skipCards]  Cards being deleted in the same update
 */
export function orphanPinsUpdate(links, removedIds, deletion, skipCards = []) {
  const update = {};
  for ( const [card, pins] of Object.entries(orphanedPins(links, removedIds)) ) {
    if ( skipCards.includes(card) ) continue;
    for ( const pin of pins ) update[`${FLAG_CARDS}.${card}.pins.${pin}`] = deletion;
  }
  return update;
}

/** Threads whose both ends are among the visible cards. */
export function visibleLinks(links, visibleIds) {
  const ids = new Set(visibleIds);
  return linkList(links).filter(l => ids.has(l.from) && ids.has(l.to));
}

/** Build a new thread. */
export function newLink({ id, from, to, fromPin = MAIN_PIN, toPin = MAIN_PIN, color = DEFAULT_THREAD_COLOR, author = null, created = 0 }) {
  return normalizeLink({ id, from, to, fromPin, toPin, color, author, created }, id);
}

/* -------------------------------------------- */
/*  Scene update payloads                       */
/* -------------------------------------------- */

export function linkCreate(link) {
  return { [`${FLAG_LINKS}.${link.id}`]: { ...link } };
}

export function linkUpdate(id, patch) {
  const update = {};
  for ( const [k, v] of Object.entries(patch) ) if ( k !== "id" ) update[`${FLAG_LINKS}.${id}.${k}`] = v;
  return update;
}

/** @param {unknown} deletion  Foundry's deletion operator (the global `_del`) */
export function linkDelete(ids, deletion) {
  return Object.fromEntries(ids.map(id => [`${FLAG_LINKS}.${id}`, deletion]));
}

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

/**
 * A thread hangs between two pins: a quadratic curve whose control point sits below the
 * midpoint, sagging more on longer threads.
 * @returns {{x: number, y: number}}  The control point
 */
export function sagControl(p1, p2, { amount = 0.08, max = 80 } = {}) {
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  return { x: (p1.x + p2.x) / 2, y: ((p1.y + p2.y) / 2) + Math.min(len * amount, max) };
}

/**
 * A data line between two pins, routed like a circuit trace: straight along the longer axis, one
 * 45° run to make up the other, then straight again. No sag.
 * @returns {{x: number, y: number}[]}  The corners, from p1 to p2 (2 to 4 points)
 */
export function circuitPath(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if ( (ax < 0.5) || (ay < 0.5) || (Math.abs(ax - ay) < 0.5) ) return [{ ...p1 }, { ...p2 }];
  const pts = [{ ...p1 }];
  if ( ax > ay ) {
    const run = (ax - ay) / 2;
    pts.push({ x: p1.x + (sx * run), y: p1.y }, { x: p1.x + (sx * (run + ay)), y: p2.y });
  } else {
    const run = (ay - ax) / 2;
    pts.push({ x: p1.x, y: p1.y + (sy * run) }, { x: p2.x, y: p1.y + (sy * (run + ax)) });
  }
  pts.push({ ...p2 });
  return pts;
}

/**
 * Evenly spaced points along a polyline (its corners always included), for hit areas and for
 * things that travel along it.
 * @param {{x: number, y: number}[]} corners
 * @param {number} [segments=24]  Roughly how many pieces to cut it into
 */
export function densify(corners, segments = 24) {
  const total = polylineLength(corners);
  if ( !total ) return corners.map(p => ({ ...p }));
  const step = total / segments;
  const out = [{ ...corners[0] }];
  for ( let i = 1; i < corners.length; i++ ) {
    const a = corners[i - 1];
    const b = corners[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / step));
    for ( let k = 1; k <= n; k++ ) out.push({ x: a.x + (((b.x - a.x) * k) / n), y: a.y + (((b.y - a.y) * k) / n) });
  }
  return out;
}

/** Length of a polyline. */
export function polylineLength(points) {
  let total = 0;
  for ( let i = 1; i < points.length; i++ ) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

/** The point a fraction t (0–1) of the way along a polyline. */
export function pointAlong(points, t) {
  const total = polylineLength(points);
  let left = Math.min(1, Math.max(0, t)) * total;
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if ( (left <= len) && len ) return { x: a.x + (((b.x - a.x) * left) / len), y: a.y + (((b.y - a.y) * left) / len) };
    left -= len;
  }
  return { ...points[points.length - 1] };
}

/** Points along the quadratic curve p1 → c → p2. */
export function sampleCurve(p1, c, p2, segments = 16) {
  const pts = [];
  for ( let i = 0; i <= segments; i++ ) {
    const t = i / segments;
    const u = 1 - t;
    pts.push({ x: (u * u * p1.x) + (2 * u * t * c.x) + (t * t * p2.x), y: (u * u * p1.y) + (2 * u * t * c.y) + (t * t * p2.y) });
  }
  return pts;
}

/**
 * A closed polygon (flat [x0, y0, x1, y1, …]) covering a polyline with the given half-width,
 * used as the thread's hit area.
 */
export function strokePolygon(points, halfWidth) {
  if ( points.length < 2 ) return [];
  const left = [];
  const right = [];
  for ( let i = 0; i < points.length; i++ ) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * halfWidth;
    const ny = (dx / len) * halfWidth;
    left.push(points[i].x + nx, points[i].y + ny);
    right.push(points[i].x - nx, points[i].y - ny);
  }
  const back = [];
  for ( let i = right.length - 2; i >= 0; i -= 2 ) back.push(right[i], right[i + 1]);
  return [...left, ...back];
}
