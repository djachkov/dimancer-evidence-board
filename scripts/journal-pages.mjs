/**
 * Pure helpers for the Evidence Journal (POC): a world JournalEntry whose pages (type
 * "dimancer_board.evidence") hold evidence that may or may not be pinned on boards.
 *
 * A board card linked to a page keeps its own copy of the page's content (title, image, notes,
 * hidden), kept in step both ways by journal-sync.mjs. The diffs here return only what differs, so a
 * mirrored write never bounces back.
 *
 * No Foundry globals in this file, so it can be tested under Node.
 */

/** The page subtype, as Foundry stores a module-declared type. */
export const EVIDENCE_TYPE = "dimancer_board.evidence";

/** What a piece of evidence is: a picture, or a text document of one or more pages. */
export const EVIDENCE_KINDS = Object.freeze(["image", "document"]);

/** Mirrors CONST.DOCUMENT_OWNERSHIP_LEVELS. */
export const LEVELS = Object.freeze({ INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 });

/** Is a page hidden from players? Hidden = nobody but the GM (ownership default NONE). */
export function isPageHidden(ownership) {
  return (ownership?.default ?? LEVELS.INHERIT) === LEVELS.NONE;
}

/**
 * The ownership update that hides or reveals a page.
 * - Hidden: the whole ownership replaced by {default: NONE}, so every per-user entry goes too (the
 *   server gives a page's creator an explicit OWNER entry, which would otherwise keep it visible to
 *   them). Foundry rejects deleting single ownership entries, hence the replacement.
 * - Revealed: inherit from the journal (whose default is OWNER, so players can edit it).
 * @param {boolean} hidden
 * @param {(value: object) => unknown} replace  The replacement operator (`_replace` in Foundry)
 */
export function accessUpdate(hidden, replace) {
  if ( hidden ) return { ownership: replace({ default: LEVELS.NONE }) };
  return { "ownership.default": LEVELS.INHERIT };
}

/**
 * A page as a list item, card-shaped so the evidence list helpers (listRows, sortCards) take it.
 * @param {object} page   A JournalEntryPage (or its source data)
 * @param {Array<{sceneId: string, sceneName: string, cardId: string}>} [placements]
 */
export function pageItem(page, placements = []) {
  const sys = page.system ?? {};
  return {
    id: page.id ?? page._id,
    uuid: page.uuid ?? null,
    kind: EVIDENCE_KINDS.includes(sys.kind) ? sys.kind : "image",
    title: String(page.name ?? ""),
    src: String(page.src ?? ""),
    notes: String(sys.notes ?? ""),
    category: sys.category || null,
    folder: sys.folder || null,
    link: sys.link || null,
    author: sys.author || null,
    created: Number.isFinite(sys.created) ? sys.created : 0,
    sort: Number.isFinite(page.sort) ? page.sort : 0,
    hidden: isPageHidden(page.ownership),
    docPages: Array.isArray(sys.pages) ? sys.pages.filter(p => typeof p === "string") : [],
    placements
  };
}

/** Pages in journal order (by sort, then title). */
export function journalOrder(items) {
  return [...items].sort((a, b) => (a.sort - b.sort) || a.title.localeCompare(b.title));
}

/**
 * Where each page is pinned: every card on the given boards that links to a page.
 * @param {Array<{sceneId: string, sceneName: string, cards: Record<string, object>}>} boards
 * @returns {Map<string, Array<{sceneId: string, sceneName: string, cardId: string}>>}  by page UUID
 */
export function placementIndex(boards) {
  const index = new Map();
  for ( const { sceneId, sceneName, cards } of boards ) {
    for ( const [cardId, card] of Object.entries(cards ?? {}) ) {
      const uuid = card?.page;
      if ( !uuid || (typeof uuid !== "string") ) continue;
      if ( !index.has(uuid) ) index.set(uuid, []);
      index.get(uuid).push({ sceneId, sceneName, cardId: card.id ?? cardId });
    }
  }
  return index;
}

/** The fields a linked card mirrors from its page. */
const MIRRORED = ["title", "src", "notes", "hidden", "docPages"];

const same = (a, b) => (Array.isArray(a) && Array.isArray(b))
  ? ((a.length === b.length) && a.every((v, i) => v === b[i]))
  : (a === b);

/**
 * What a linked card must change to match its page.
 * @param {object} card   A normalised card
 * @param {object} item   The page as a list item (pageItem)
 * @returns {Record<string, unknown>}  A card patch (empty when already in step)
 */
export function cardPatchFromPage(card, item) {
  const patch = {};
  for ( const key of MIRRORED ) {
    // Only a text document carries pages (an image card always normalises them to []).
    if ( (key === "docPages") && (card.kind !== "document") ) continue;
    if ( !same(card[key], item[key]) ) patch[key] = item[key];
  }
  return patch;
}

/**
 * What a page must change to match a linked card that was just edited on a board.
 * @param {object} item   The page as a list item (pageItem)
 * @param {object} card   The card, normalised
 * @returns {{update: Record<string, unknown>, hidden?: boolean}}  A page update for the content
 *   fields, plus the wanted hidden state when it differs (only a GM may apply that)
 */
export function pagePatchFromCard(item, card) {
  const update = {};
  if ( card.title && (card.title !== item.title) ) update.name = card.title;
  if ( card.src && (card.src !== item.src) ) update.src = card.src;
  if ( card.notes !== item.notes ) update["system.notes"] = card.notes;
  if ( (card.kind === "document") && !same(card.docPages, item.docPages) ) update["system.pages"] = [...card.docPages];
  const result = { update };
  if ( card.hidden !== item.hidden ) result.hidden = card.hidden;
  return result;
}

/**
 * Creation data for an evidence page.
 * @param {object} data
 * @param {string} data.title     Required by Foundry: callers pass a fallback for untitled evidence
 * @param {boolean} [data.hidden]
 * @param {"image"|"document"} [data.kind]
 * @param {string[]} [data.docPages]  A text document's pages (HTML each); a new one gets one blank page
 *   A document with a `src` is a PDF: its pages are the file's, so it has no written pages.
 */
export function evidencePageData({ title, src = "", notes = "", link = null, author = null, created = 0,
  category = null, folder = null, hidden = false, sort, kind = "image", docPages } = {}) {
  const document = kind === "document";
  const system = { kind: document ? "document" : "image", notes, category, folder, link, author, created };
  if ( document && !src ) system.pages = docPages?.length ? [...docPages] : [""];
  const data = {
    name: title,
    type: EVIDENCE_TYPE,
    src: src || null,
    system,
    ownership: { default: hidden ? LEVELS.NONE : LEVELS.INHERIT }
  };
  if ( Number.isFinite(sort) ) data.sort = sort;
  return data;
}
