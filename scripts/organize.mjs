/**
 * Pure helpers for organising a board's evidence: categories (a property of each card, shown on the
 * board) and folders (a nestable filing tree in the evidence list). No Foundry globals here.
 *
 * Both live in the board Scene's flags next to the cards:
 *   flags.dimancer_board.categories.<id> = {id, name, color, icon, sort}
 *   flags.dimancer_board.folders.<id>    = {id, name, color, parent, sort}
 * and a card refers to them by `category` / `folder` id (null = none, or the root).
 *
 * @typedef {{id: string, name: string, color: string, icon: string, sort: number}} Category
 * @typedef {{id: string, name: string, color: string, parent: string|null, sort: number}} Folder
 */

import { FLAG_CATEGORIES, FLAG_FOLDERS, FLAG_CARDS } from "./constants.mjs";
import { cardList, orderedCards } from "./cards.mjs";

const HEX = /^#[0-9a-f]{6}$/i;

/** Icons offered when customising a category (Font Awesome solid names). */
export const CATEGORY_ICONS = Object.freeze([
  "fa-user", "fa-user-secret", "fa-users", "fa-location-dot", "fa-house", "fa-key", "fa-gem", "fa-skull",
  "fa-file-lines", "fa-envelope", "fa-camera", "fa-calendar-day", "fa-clock", "fa-fingerprint", "fa-flask",
  "fa-scroll", "fa-dagger", "fa-question", "fa-star", "fa-tag"
]);

/** A readable name for an icon class: "fa-location-dot" → "Location dot". */
export function iconLabel(icon) {
  const words = String(icon).replace(/^fa-/, "").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Categories a board starts with until someone customises them. */
export const DEFAULT_CATEGORIES = Object.freeze([
  { id: "person", name: "Person", color: "#c0392b", icon: "fa-user", sort: 0 },
  { id: "place", name: "Place", color: "#2e6fd1", icon: "fa-location-dot", sort: 1 },
  { id: "object", name: "Object", color: "#d4a017", icon: "fa-key", sort: 2 },
  { id: "document", name: "Document", color: "#6b7280", icon: "fa-file-lines", sort: 3 },
  { id: "event", name: "Event", color: "#8e44ad", icon: "fa-calendar-day", sort: 4 }
]);

export function normalizeCategory(raw, id) {
  if ( !raw || (typeof raw !== "object") ) return null;
  const name = String(raw.name ?? "").trim();
  return {
    id: String(id ?? raw.id ?? ""),
    name: name || "?",
    color: HEX.test(raw.color ?? "") ? raw.color : "#6b7280",
    icon: CATEGORY_ICONS.includes(raw.icon) ? raw.icon : "fa-tag",
    sort: Number.isFinite(raw.sort) ? raw.sort : 0
  };
}

/**
 * The board's categories in order. A board that never customised them (no map stored) gets the
 * defaults; an explicitly emptied map means "no categories".
 * @param {Record<string, object>|undefined} map
 * @returns {Category[]}
 */
export function categoryList(map) {
  if ( map === undefined || map === null ) return DEFAULT_CATEGORIES.map(c => ({ ...c }));
  return Object.entries(map).map(([id, c]) => normalizeCategory(c, id)).filter(Boolean)
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
}

export function normalizeFolder(raw, id) {
  if ( !raw || (typeof raw !== "object") ) return null;
  const name = String(raw.name ?? "").trim();
  return {
    id: String(id ?? raw.id ?? ""),
    name: name || "?",
    color: HEX.test(raw.color ?? "") ? raw.color : null,
    parent: raw.parent ? String(raw.parent) : null,
    sort: Number.isFinite(raw.sort) ? raw.sort : 0
  };
}

/**
 * All folders, with parents that don't exist (or would form a cycle) moved to the root.
 * @returns {Folder[]}
 */
export function folderList(map = {}) {
  const folders = Object.entries(map ?? {}).map(([id, f]) => normalizeFolder(f, id)).filter(Boolean);
  const byId = new Map(folders.map(f => [f.id, f]));
  for ( const f of folders ) {
    if ( f.parent && !byId.has(f.parent) ) f.parent = null;
  }
  // Break cycles: walk up from each folder; if we come back to it, cut it loose.
  for ( const f of folders ) {
    const seen = new Set([f.id]);
    let p = f.parent;
    while ( p ) {
      if ( seen.has(p) ) { f.parent = null; break; }
      seen.add(p);
      p = byId.get(p)?.parent ?? null;
    }
  }
  return folders.sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
}

/** Ids of a folder and everything nested inside it. */
export function folderAndDescendants(folders, id) {
  const list = Array.isArray(folders) ? folders : folderList(folders);
  const out = new Set([id]);
  let grew = true;
  while ( grew ) {
    grew = false;
    for ( const f of list ) {
      if ( f.parent && out.has(f.parent) && !out.has(f.id) ) { out.add(f.id); grew = true; }
    }
  }
  return out;
}

/** Can folder `id` be moved under `parent` (null = root) without creating a cycle? */
export function canNest(folders, id, parent) {
  if ( !parent ) return true;
  return !folderAndDescendants(folders, id).has(parent);
}

/** Depth of a folder (root folders are 0). */
export function folderDepth(folders, id) {
  const list = Array.isArray(folders) ? folders : folderList(folders);
  const byId = new Map(list.map(f => [f.id, f]));
  let d = 0;
  let p = byId.get(id)?.parent;
  while ( p && (d < 50) ) { d++; p = byId.get(p)?.parent; }
  return d;
}

/* -------------------------------------------- */
/*  Listing                                     */
/* -------------------------------------------- */

/**
 * Order cards for the list.
 * @param {import("./cards.mjs").Card[]} cards
 * @param {"board"|"name"|"newest"} sort
 * @param {import("./cards.mjs").Card[]} boardOrder  All cards in reading order (for "board")
 */
export function sortCards(cards, sort, boardOrder) {
  const list = [...cards];
  if ( sort === "name" ) return list.sort((a, b) => (a.title || "￿").localeCompare(b.title || "￿", undefined, { sensitivity: "base" }));
  if ( sort === "newest" ) return list.sort((a, b) => b.created - a.created);
  const index = new Map(boardOrder.map((c, i) => [c.id, i]));
  return list.sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
}

/**
 * The evidence list as flat rows, ready for a template: group headers and cards, each with a
 * depth and the chain of group ids above it (for collapsing and search).
 *
 * @param {object} args
 * @param {Record<string, object>} args.cards        Raw card map
 * @param {Record<string, object>} [args.folders]    Raw folder map
 * @param {Record<string, object>} [args.categories] Raw category map (undefined = defaults)
 * @param {"folders"|"categories"|"all"} args.mode
 * @param {"board"|"name"|"newest"} [args.sort]
 * @param {boolean} [args.includeHidden]
 * @param {object[]} [args.items]  Already normalised items in their natural order (e.g. Evidence
 *   Journal pages by page order), used instead of `cards`; "board" sort keeps this order.
 * @returns {Array<{type: "group"|"card", id: string, depth: number, ancestors: string[], [k: string]: any}>}
 */
export function listRows({ cards, folders = {}, categories, mode, sort = "board", includeHidden = true, items }) {
  const boardOrder = items ? items.filter(i => includeHidden || !i.hidden) : orderedCards(cards, { includeHidden });
  const visible = sortCards(boardOrder, sort, boardOrder);
  const rows = [];
  const cardRow = (c, depth, ancestors) => rows.push({ type: "card", id: c.id, depth, ancestors, card: c });

  if ( mode === "categories" ) {
    const cats = categoryList(categories);
    const known = new Set(cats.map(c => c.id));
    for ( const cat of [...cats, { id: "", name: null, color: null, icon: "fa-circle-question", sort: Infinity }] ) {
      const members = visible.filter(c => (cat.id ? c.category === cat.id : !known.has(c.category)));
      if ( !cat.id && !members.length ) continue;   // no "Uncategorized" group when everything has one
      const gid = `category:${cat.id}`;
      rows.push({ type: "group", kind: "category", id: gid, groupId: cat.id, depth: 0, ancestors: [], group: cat, count: members.length });
      for ( const c of members ) cardRow(c, 1, [gid]);
    }
    return rows;
  }

  if ( mode === "folders" ) {
    const list = folderList(folders);
    const known = new Set(list.map(f => f.id));
    const countIn = id => {
      const ids = folderAndDescendants(list, id);
      return visible.filter(c => ids.has(c.folder)).length;
    };
    const walk = (parent, depth, ancestors) => {
      for ( const f of list.filter(f => f.parent === parent) ) {
        const gid = `folder:${f.id}`;
        rows.push({ type: "group", kind: "folder", id: gid, groupId: f.id, depth, ancestors, group: f, count: countIn(f.id) });
        walk(f.id, depth + 1, [...ancestors, gid]);
        for ( const c of visible.filter(c => c.folder === f.id) ) cardRow(c, depth + 1, [...ancestors, gid]);
      }
    };
    walk(null, 0, []);
    for ( const c of visible.filter(c => !c.folder || !known.has(c.folder)) ) cardRow(c, 0, []);
    return rows;
  }

  for ( const c of visible ) cardRow(c, 0, []);
  return rows;
}

/* -------------------------------------------- */
/*  Scene update payloads                       */
/* -------------------------------------------- */

/**
 * Write the whole category set. Used for every category edit, so a board that was still on the
 * defaults gets them stored together with the change.
 * @param {Category[]} categories
 * @param {Record<string, object>|undefined} previous  The stored map (ids missing now are deleted)
 * @param {unknown} deletion
 */
export function categoriesUpdate(categories, previous, deletion) {
  const update = {};
  categories.forEach((c, i) => {
    update[`${FLAG_CATEGORIES}.${c.id}`] = { id: c.id, name: c.name, color: c.color, icon: c.icon, sort: i };
  });
  const keep = new Set(categories.map(c => c.id));
  for ( const id of Object.keys(previous ?? {}) ) if ( !keep.has(id) ) update[`${FLAG_CATEGORIES}.${id}`] = deletion;
  // An empty set still has to be stored (as {}), or the board would fall back to the defaults.
  if ( !categories.length && !previous ) update[FLAG_CATEGORIES] = {};
  return update;
}

/** Cards whose category no longer exists lose it. */
export function clearCategories(cards, removedIds) {
  const removed = new Set(removedIds);
  const update = {};
  for ( const c of cardList(cards) ) if ( c.category && removed.has(c.category) ) update[`${FLAG_CARDS}.${c.id}.category`] = null;
  return update;
}

export function folderCreate(folder) {
  return { [`${FLAG_FOLDERS}.${folder.id}`]: { ...folder } };
}

export function folderUpdate(id, patch) {
  const update = {};
  for ( const [k, v] of Object.entries(patch) ) if ( k !== "id" ) update[`${FLAG_FOLDERS}.${id}.${k}`] = v;
  return update;
}

/**
 * Delete a folder; its cards and sub-folders move up to its parent, so nothing is lost.
 * @returns {Record<string, unknown>}
 */
export function folderDelete(folders, cards, id, deletion) {
  const list = folderList(folders);
  const parent = list.find(f => f.id === id)?.parent ?? null;
  const update = { [`${FLAG_FOLDERS}.${id}`]: deletion };
  for ( const f of list ) if ( f.parent === id ) update[`${FLAG_FOLDERS}.${f.id}.parent`] = parent;
  for ( const c of cardList(cards) ) if ( c.folder === id ) update[`${FLAG_CARDS}.${c.id}.folder`] = parent;
  return update;
}

/** A sort value placing a new folder after its siblings. */
export function nextFolderSort(folders, parent) {
  const siblings = folderList(folders).filter(f => f.parent === (parent ?? null));
  return siblings.length ? Math.max(...siblings.map(f => f.sort)) + 1 : 0;
}
