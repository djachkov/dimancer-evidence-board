import { MODULE_ID, t } from "./constants.mjs";
import { cardDelete, cardUpdate, isEvidence } from "./cards.mjs";
import { linkDelete, linksOf } from "./links.mjs";
import { boardCards, boardLinks, canEditBoard, canEditCard, getCard, isBoard } from "./permissions.mjs";
import {
  EVIDENCE_TYPE, LEVELS, accessUpdate, evidencePageData, isPageHidden, journalOrder, pageItem, placementIndex
} from "./journal-pages.mjs";

/**
 * The Evidence Journal (POC), Foundry side: finding and creating the world's evidence journal, and
 * creating, hiding, placing and deleting its pages.
 *
 * The journal is an ordinary JournalEntry flagged as the evidence journal and pinned to the
 * EvidenceJournalSheet. Players own it (so they can add and edit evidence without a GM); a hidden
 * page is GM-only (ownership NONE), which the server enforces for edits and the UI for viewing.
 */

export const SHEET_ID = `${MODULE_ID}.EvidenceJournalSheet`;

export const isEvidenceJournal = entry => !!entry?.flags?.[MODULE_ID]?.evidenceJournal;
export const isEvidencePage = page => page?.type === EVIDENCE_TYPE;

/** The world's evidence journal, or null. */
export function getEvidenceJournal() {
  return game.journal?.contents.filter(isEvidenceJournal).sort((a, b) => a.sort - b.sort)[0] ?? null;
}

/** Can this user add evidence to (and organise) the journal? */
export function canEditJournal(entry = getEvidenceJournal(), user = game.user) {
  return !!entry && entry.testUserPermission(user, "OWNER");
}

export const canSeePage = (page, user = game.user) => !!page && page.testUserPermission(user, "OBSERVER");
export const canEditPage = (page, user = game.user) => !!page && page.testUserPermission(user, "OWNER");

/** Create the evidence journal (GM). Players own it, so they can add evidence. */
export async function createEvidenceJournal() {
  if ( !game.user.isGM ) return null;
  return JournalEntry.implementation.create({
    name: t("Journal.DefaultName"),
    ownership: { default: LEVELS.OWNER },
    flags: { core: { sheetClass: SHEET_ID }, [MODULE_ID]: { evidenceJournal: { version: 1 } } }
  });
}

/** Open the evidence journal (creating it first, for a GM), optionally at one page. */
export async function openEvidenceJournal({ pageId } = {}) {
  let entry = getEvidenceJournal();
  if ( !entry && game.user.isGM ) entry = await createEvidenceJournal();
  if ( !entry ) return ui.notifications.warn(t("Journal.Missing"));
  if ( !entry.visible ) return ui.notifications.warn(t("Journal.NoAccess"));
  return entry.sheet.render({ force: true, pageId });
}

/** The journal's evidence pages, unsorted. */
export const evidencePages = entry => entry?.pages.contents.filter(isEvidencePage) ?? [];

/** Where every page is pinned, across all board scenes: page UUID → [{sceneId, sceneName, cardId}]. */
export function boardPlacements() {
  return placementIndex(game.scenes.filter(isBoard).map(s => ({ sceneId: s.id, sceneName: s.name, cards: boardCards(s) })));
}

/** The journal's pages as list items, in journal order, with their placements. */
export function journalItems(entry, index = boardPlacements()) {
  return journalOrder(evidencePages(entry).map(p => pageItem(p, index.get(p.uuid) ?? [])));
}

/** The next page sort value, after every page already there. */
function nextSort(entry) {
  const sorts = entry.pages.contents.map(p => p.sort);
  return (sorts.length ? Math.max(...sorts) : 0) + CONST.SORT_INTEGER_DENSITY;
}

/**
 * Add evidence to the journal.
 * @param {object} data   {title, src, notes, link, category, folder}, or for a text document
 *   {kind: "document", docPages: [html, …], title, notes, …}
 * @param {object} [options]
 * @param {boolean} [options.hidden]  GM only; players' evidence is always revealed
 * @returns {Promise<JournalEntryPage|null>}
 */
export async function createEvidencePage(data, { hidden = false, entry = getEvidenceJournal() } = {}) {
  if ( !entry || !canEditJournal(entry) ) return null;
  const pageData = evidencePageData({
    ...data,
    title: data.title || t(data.kind === "document" ? "Document.Untitled" : "Card.Untitled"),
    hidden: game.user.isGM && hidden,
    author: game.user.id,
    created: Date.now(),
    sort: nextSort(entry)
  });
  const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [pageData]);
  return page ?? null;
}

/** Hide a page from players, or reveal it (GM). Linked cards follow (journal-sync.mjs). */
export async function setPageHidden(page, hidden) {
  if ( !game.user.isGM || !page ) return;
  if ( isPageHidden(page.ownership) === hidden ) return;
  await page.update(accessUpdate(hidden, _replace));
}

/** Remove cards from a board scene, with their threads, in one update. */
export async function removeCards(scene, cardIds) {
  if ( !cardIds.length ) return;
  const threads = linksOf(boardLinks(scene), cardIds).map(l => l.id);
  await scene.update({ ...cardDelete(cardIds, _del), ...linkDelete(threads, _del) });
}

/** The cards on any board this user can edit that show a page, grouped by scene. */
function editablePlacements(uuid) {
  const out = new Map();
  for ( const p of boardPlacements().get(uuid) ?? [] ) {
    const scene = game.scenes.get(p.sceneId);
    const card = scene && getCard(scene, p.cardId);
    if ( !card || !canEditCard(scene, card) ) continue;
    if ( !out.has(scene) ) out.set(scene, []);
    out.get(scene).push(card);
  }
  return out;
}

/**
 * Delete a piece of evidence. With `fromBoards`, the cards showing it go too (on the boards this
 * user can edit); otherwise they stay as plain cards.
 */
export async function deleteEvidence(page, { fromBoards = false } = {}) {
  if ( !canEditPage(page) ) return;
  const placed = editablePlacements(page.uuid);
  for ( const [scene, cards] of placed ) {
    if ( fromBoards ) await removeCards(scene, cards.map(c => c.id));
    else {
      const update = {};
      for ( const c of cards ) Object.assign(update, cardUpdate(c.id, { page: null }));
      await scene.update(update);
    }
  }
  await page.delete();
}

/**
 * Pin a page on the board being viewed, at a point (default: the middle of the view). It isn't
 * copied into a new page: the card links to this one.
 */
export async function placeOnBoard(page, point = {}) {
  const scene = canvas.scene;
  if ( !isBoard(scene) || !canEditBoard(scene) ) return ui.notifications.warn(t("Journal.NoBoard"));
  if ( !canSeePage(page) ) return null;
  const document = page.system.kind === "document";
  return canvas.board.addCard({
    kind: document ? "document" : "image",
    // A PDF document keeps its file as src; a written one has none.
    src: document ? (page.src || "") : (page.src || "icons/svg/book.svg"),
    docPages: (document && !page.src) ? [...page.system.pages] : undefined,
    title: page.name,
    notes: page.system.notes,
    link: page.system.link,
    page: page.uuid,
    hidden: isPageHidden(page.ownership),
    x: point.x,
    y: point.y
  });
}

/** Add an existing board card to the journal: a new page from its content, then link the card. */
export async function linkCardToJournal(scene, cardId) {
  const card = getCard(scene, cardId);
  if ( !card || !isEvidence(card) || card.page || !canEditCard(scene, card) ) return null;
  const page = await createEvidencePage(
    { title: card.title, src: card.src, notes: card.notes, link: card.link, kind: card.kind, docPages: card.docPages },
    { hidden: card.hidden }
  );
  if ( page ) await scene.update(cardUpdate(cardId, { page: page.uuid }));
  return page;
}

/** Add every unlinked image card of a board to the journal (GM tidy-up for existing boards). */
export async function linkBoardToJournal(scene) {
  const cards = Object.values(boardCards(scene)).map(c => getCard(scene, c.id)).filter(c => isEvidence(c) && !c.page);
  for ( const c of cards ) await linkCardToJournal(scene, c.id);
  return cards.length;
}

/**
 * Start a new text document in the journal (a GM's starts hidden), and open the journal on it so
 * it can be written. On a board, with `place`, it's also pinned there.
 */
export async function newDocument({ place = false, point } = {}) {
  let entry = getEvidenceJournal();
  if ( !entry && game.user.isGM ) entry = await createEvidenceJournal();
  if ( !entry || !canEditJournal(entry) ) return ui.notifications.warn(t("Journal.Missing"));
  const page = await createEvidencePage({ kind: "document", title: t("Document.Untitled") }, { hidden: game.user.isGM && !place, entry });
  if ( !page ) return null;
  if ( place ) await placeOnBoard(page, point);
  await openEvidenceJournal({ pageId: page.id });
  return page;
}

/** The page a card shows, if any (and if this client has it). */
export function pageOfCard(card) {
  if ( !card?.page ) return null;
  const page = fromUuidSync(card.page, { strict: false });
  return isEvidencePage(page) ? page : null;
}

/**
 * The organizer (see organize-actions.mjs) of the evidence journal: folders and categories in the
 * entry's flags, items are its pages (`system.category`, `system.folder`).
 */
export function journalOrganizer(entry) {
  return {
    organizer: true,
    doc: entry,
    canEdit: () => canEditJournal(entry),
    items: () => evidencePages(entry).map(p => pageItem(p)),
    getItem: id => {
      const page = entry.pages.get(id);
      return isEvidencePage(page) ? pageItem(page) : null;
    },
    canEditItem: item => canEditPage(entry.pages.get(item.id)),
    commit: async (docUpdate, patches) => {
      if ( !foundry.utils.isEmpty(docUpdate) ) await entry.update(docUpdate);
      if ( !patches.size ) return;
      const updates = [...patches].map(([id, patch]) => {
        const u = { _id: id };
        for ( const [k, v] of Object.entries(patch) ) u[`system.${k}`] = v;
        return u;
      });
      await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
    }
  };
}
