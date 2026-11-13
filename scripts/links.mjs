/**
 * Pure helpers for the threads ("links") that connect evidence cards. No Foundry globals here.
 *
 * Threads are undirected: A–B and B–A are the same thread, and there is at most one per pair.
 *
 * @typedef {object} Link
 * @property {string} id
 * @property {string} from     Card id
 * @property {string} to       Card id
 * @property {string} color    CSS hex colour
 * @property {string|null} author
 * @property {number} created
 */

import { FLAG_LINKS } from "./constants.mjs";

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

/** @returns {Link|null}  null when the entry can't be a thread (missing or identical ends) */
export function normalizeLink(raw, id) {
  if ( !raw || (typeof raw !== "object") ) return null;
  const from = raw.from ? String(raw.from) : "";
  const to = raw.to ? String(raw.to) : "";
  if ( !from || !to || (from === to) ) return null;
  return {
    id: String(id ?? raw.id ?? ""),
    from, to,
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

/** Threads whose both ends are among the visible cards. */
export function visibleLinks(links, visibleIds) {
  const ids = new Set(visibleIds);
  return linkList(links).filter(l => ids.has(l.from) && ids.has(l.to));
}

/** Build a new thread. */
export function newLink({ id, from, to, color = DEFAULT_THREAD_COLOR, author = null, created = 0 }) {
  return normalizeLink({ id, from, to, color, author, created }, id);
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
export function sagControl(p1, p2) {
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  return { x: (p1.x + p2.x) / 2, y: ((p1.y + p2.y) / 2) + Math.min(len * 0.08, 80) };
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
