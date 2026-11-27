import { MODULE_ID, t } from "./constants.mjs";
import { cardDelete, cardUpdate, isEvidence } from "./cards.mjs";
import { linkDelete, linksOf, orphanPinsUpdate } from "./links.mjs";
import { boardCards, boardLinks, canEditBoard, canEditCard, getCard, isBoard } from "./permissions.mjs";
import {
  EVIDENCE_TYPE, accessUpdate, evidencePageData, isPageHidden, journalOrder, journalOwnership, journalStyle,
  movedPageData, pageItem, pickDefaultJournal, placementIndex
} from "./journal-pages.mjs";
import { emit, onSocket } from "./socket.mjs";
import { categoriesOf } from "./organize-actions.mjs";
import { promptJournalOptions } from "./create-journal-dialog.mjs";

/**
 * Evidence journals, Foundry side: finding, creating and choosing them, and creating, hiding,
 * placing, moving and deleting their pages.
 *
 * A journal is an ordinary JournalEntry flagged as an evidence journal (with the style it was
 * created in) and pinned to the EvidenceJournalSheet. There can be several: shared ones every player
 * owns, and private ones only their creator (and the GM) can open. Each user marks one as their
 * default (a User flag); evidence they file from a board goes there. A hidden page is GM-only
 * (ownership NONE), which the server enforces for edits and the UI for viewing.
 */

export const SHEET_ID = `${MODULE_ID}.EvidenceJournalSheet`;

export const isEvidenceJournal = entry => !!entry?.flags?.[MODULE_ID]?.evidenceJournal;
export const isEvidencePage = page => page?.type === EVIDENCE_TYPE;

/** The look a journal was created with. */
export const journalStyleOf = entry => journalStyle(entry?.flags?.[MODULE_ID]?.evidenceJournal);

/** The evidence journals this user can open, in sidebar order. */
export function evidenceJournals(user = game.user) {
  return (game.journal?.contents ?? [])
    .filter(e => isEvidenceJournal(e) && (user.isGM || e.testUserPermission(user, "OBSERVER")))
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
}

/** Can this user add evidence to (and organise) a journal? */
export function canEditJournal(entry = defaultJournal(), user = game.user) {
  return !!entry && entry.testUserPermission(user, "OWNER");
}

/** The journal a user's filed evidence goes to (see pickDefaultJournal), or null. */
export function defaultJournal(user = game.user) {
  const journals = evidenceJournals(user);
  const id = pickDefaultJournal(journals.map(e => ({ id: e.id, editable: canEditJournal(e, user) })),
    user.getFlag(MODULE_ID, "defaultJournal") ?? null);
  return journals.find(e => e.id === id) ?? null;
}

/** Is this the journal the current user marked as their default (or falls back to)? */
export const isDefaultJournal = entry => !!entry && (defaultJournal()?.id === entry.id);

/** Mark a journal as this user's default. */
export async function setDefaultJournal(entry) {
  if ( !entry || !canEditJournal(entry) ) return;
  await game.user.setFlag(MODULE_ID, "defaultJournal", entry.id);
  refreshJournalViews();
}

/** The world's (first) evidence journal for this user: their default, else the first they can open. */
export function getEvidenceJournal() {
  return defaultJournal() ?? evidenceJournals()[0] ?? null;
}

/** Re-render what shows journals: open evidence sheets, the board controls, the Journal sidebar. */
export const refreshJournalViews = foundry.utils.debounce(() => {
  for ( const app of foundry.applications.instances.values() ) {
    if ( app.isEvidenceJournalSheet && app.rendered ) app.render();
  }
  if ( isBoard(canvas?.scene) ) ui.controls?.render({ reset: false });
  if ( ui.journal?.rendered ) ui.journal.render();
}, 50);

export const canSeePage = (page, user = game.user) => !!page && page.testUserPermission(user, "OBSERVER");
export const canEditPage = (page, user = game.user) => !!page && page.testUserPermission(user, "OWNER");

/** Creation data for a journal. */
function journalData({ name, style, shared, userId, isGM }) {
  return {
    name: name || t("Journal.DefaultName"),
    ownership: journalOwnership({ shared, userId, isGM }),
    flags: { core: { sheetClass: SHEET_ID }, [MODULE_ID]: { evidenceJournal: { version: 2, style: journalStyle({ style }) } } }
  };
}

/** Requests for a GM to create a journal for a player, by request id. */
const pendingCreates = new Map();

/**
 * Create an evidence journal. Players can't create journal entries by default (it's a Trusted
 * permission), so a player without it asks an active GM, whose client creates it for them.
 * @param {{name?: string, style?: string, shared?: boolean, makeDefault?: boolean}} [options]
 * @returns {Promise<JournalEntry|null>}
 */
export async function createEvidenceJournal({ name, style = "classic", shared = true, makeDefault = false } = {}) {
  let entry = null;
  const data = { name, style, shared, userId: game.user.id, isGM: game.user.isGM };
  if ( game.user.isGM || game.user.can("JOURNAL_CREATE") ) {
    entry = await JournalEntry.implementation.create(journalData(data));
  } else {
    if ( !game.users.activeGM ) {
      ui.notifications.warn(t("Journal.NeedGM"));
      return null;
    }
    const requestId = foundry.utils.randomID();
    const id = await new Promise(resolve => {
      const timer = setTimeout(() => {
        pendingCreates.delete(requestId);
        resolve(null);
      }, 15000);
      pendingCreates.set(requestId, id => {
        clearTimeout(timer);
        resolve(id);
      });
      emit("createJournal", { requestId, name, style, shared });
    });
    pendingCreates.delete(requestId);
    entry = id ? game.journal.get(id) : null;
    if ( !entry ) ui.notifications.error(t("Journal.CreateFailed"));
  }
  if ( entry && makeDefault ) await setDefaultJournal(entry);
  return entry;
}

/** Socket handlers: the active GM creates journals players ask for, and tells them which. */
export function registerJournalSocket() {
  onSocket("createJournal", async ({ requestId, name, style, shared }, senderId) => {
    if ( !game.users.activeGM?.isSelf ) return;
    const sender = game.users.get(senderId);
    if ( !sender ) return;
    let id = null;
    try {
      const entry = await JournalEntry.implementation.create(journalData({
        name: String(name ?? "").slice(0, 120), style, shared: !!shared, userId: sender.id, isGM: sender.isGM
      }));
      id = entry?.id ?? null;
    } catch(err) {
      console.error(`${MODULE_ID} | creating a journal for ${sender.name}`, err);
    }
    emit("journalCreated", { requestId, id, userId: sender.id });
  });
  onSocket("journalCreated", ({ requestId, id, userId }) => {
    if ( userId !== game.user.id ) return;
    // The entry's own creation may reach this client just after the reply.
    const resolve = pendingCreates.get(requestId);
    if ( !resolve ) return;
    if ( !id || game.journal.get(id) ) return resolve(id);
    Hooks.once("createJournalEntry", () => resolve(id));
  });
}

/**
 * Ask for a new journal (name, style, who can use it), create it and open it.
 * @returns {Promise<JournalEntry|null>}
 */
export async function promptNewJournal({ open = true } = {}) {
  const choice = await promptJournalOptions({ hasDefault: !!defaultJournal() });
  if ( !choice ) return null;
  const entry = await createEvidenceJournal(choice);
  if ( entry && open ) entry.sheet.render({ force: true });
  return entry;
}

/**
 * Open an evidence journal, optionally at one page: the given one, else the user's default, else the
 * first they can open. With none at all, offer to create one.
 */
export async function openEvidenceJournal({ pageId, entry } = {}) {
  entry ??= getEvidenceJournal();
  if ( !entry ) {
    entry = await promptNewJournal({ open: false });
    if ( !entry ) return null;
  }
  if ( !entry.visible ) return ui.notifications.warn(t("Journal.NoAccess"));
  return entry.sheet.render({ force: true, pageId });
}

/**
 * The journal to file into, creating one first (asking) when the user has none they can add to.
 * @returns {Promise<JournalEntry|null>}
 */
export async function journalToFileInto() {
  return defaultJournal() ?? promptNewJournal({ open: false });
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
export async function createEvidencePage(data, { hidden = false, entry = defaultJournal() } = {}) {
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
  const links = boardLinks(scene);
  const threads = linksOf(links, cardIds).map(l => l.id);
  await scene.update({ ...orphanPinsUpdate(links, threads, _del, cardIds), ...cardDelete(cardIds, _del), ...linkDelete(threads, _del) });
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

/**
 * Add an existing board card to a journal (default: the user's default journal): a new page from its
 * content, then link the card.
 */
export async function linkCardToJournal(scene, cardId, entry = defaultJournal()) {
  const card = getCard(scene, cardId);
  if ( !card || !isEvidence(card) || card.page || !canEditCard(scene, card) ) return null;
  const page = await createEvidencePage(
    { title: card.title, src: card.src, notes: card.notes, link: card.link, kind: card.kind, docPages: card.docPages },
    { hidden: card.hidden, entry }
  );
  if ( page ) await scene.update(cardUpdate(cardId, { page: page.uuid }));
  return page;
}

/** Add every unlinked evidence card of a board to a journal (default: the user's default). */
export async function linkBoardToJournal(scene, entry = defaultJournal()) {
  if ( !entry ) return 0;
  const cards = Object.values(boardCards(scene)).map(c => getCard(scene, c.id)).filter(c => isEvidence(c) && !c.page);
  for ( const c of cards ) await linkCardToJournal(scene, c.id, entry);
  return cards.length;
}

/**
 * Start a new text document in a journal (default: the user's default; a GM's starts hidden), and
 * open the journal on it so it can be written. On a board, with `place`, it's also pinned there.
 */
export async function newDocument({ place = false, point, entry } = {}) {
  entry ??= await journalToFileInto();
  if ( !entry ) return null;
  if ( !canEditJournal(entry) ) return ui.notifications.warn(t("Journal.NoAccess"));
  const page = await createEvidencePage({ kind: "document", title: t("Document.Untitled") }, { hidden: game.user.isGM && !place, entry });
  if ( !page ) return null;
  if ( place ) await placeOnBoard(page, point);
  await openEvidenceJournal({ entry, pageId: page.id });
  return page;
}

/**
 * Move a page into another journal: a copy there, the cards showing it re-linked (on every board
 * this user can edit; a GM's, all of them), then the old page deleted. Cards someone else pinned on
 * a board this user can't edit become plain cards, as when a page is deleted.
 * @returns {Promise<JournalEntryPage|null>}  The page in its new journal
 */
export async function movePage(page, target) {
  if ( !isEvidencePage(page) || !target || (page.parent === target) ) return null;
  if ( !canEditPage(page) || !canEditJournal(target) ) return null;
  const categories = new Set(categoriesOf(journalOrganizer(target)).map(c => c.id));
  const [moved] = await target.createEmbeddedDocuments("JournalEntryPage", [movedPageData(page.toObject(), categories, nextSort(target))]);
  if ( !moved ) return null;
  for ( const p of boardPlacements().get(page.uuid) ?? [] ) {
    const scene = game.scenes.get(p.sceneId);
    const card = scene && getCard(scene, p.cardId);
    if ( !card || (!game.user.isGM && !canEditCard(scene, card)) ) continue;
    await scene.update(cardUpdate(card.id, { page: moved.uuid }), { dimancerMirror: true });
  }
  await page.delete();
  return moved;
}

/**
 * Unlink board cards from pages that are gone, so they become plain cards that can be filed again.
 * `isGone(uuid)` says which page links to drop. A GM changes every board; others only cards they
 * can edit.
 * @returns {Promise<number>}  How many cards were unlinked
 */
export async function unlinkCards(isGone) {
  let count = 0;
  for ( const scene of game.scenes.filter(isBoard) ) {
    const update = {};
    for ( const c of Object.values(boardCards(scene)) ) {
      const card = getCard(scene, c.id);
      if ( !card?.page || !isGone(card.page) ) continue;
      if ( !game.user.isGM && !canEditCard(scene, card) ) continue;
      Object.assign(update, cardUpdate(card.id, { page: null }));
      count++;
    }
    if ( foundry.utils.isEmpty(update) ) continue;
    try {
      await scene.update(update, { dimancerMirror: true });
    } catch(err) {
      console.warn(`${MODULE_ID} | unlink cards`, err);
    }
  }
  return count;
}

/** Unlink cards whose page no longer exists anywhere (a GM sees every journal, so only a GM can tell). */
export function unlinkMissingPages() {
  if ( !game.user.isGM ) return Promise.resolve(0);
  return unlinkCards(uuid => !fromUuidSync(uuid, { strict: false }));
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
