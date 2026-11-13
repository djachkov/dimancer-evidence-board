import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_TYPE, LEVELS, accessUpdate, cardPatchFromPage, evidencePageData, isPageHidden, journalOrder, pageItem,
  pagePatchFromCard, placementIndex
} from "../scripts/journal-pages.mjs";
import { normalizeCard } from "../scripts/cards.mjs";
import { listRows } from "../scripts/organize.mjs";

const page = (over = {}) => ({
  id: "p1", uuid: "JournalEntry.j.JournalEntryPage.p1", name: "Muddy footprint", src: "a.png", sort: 100,
  ownership: { default: -1, user1: 3 },
  system: { notes: "<p>Size 11</p>", category: "object", folder: "f1", link: null, author: "user1", created: 5 },
  ...over
});

test("pageItem maps a page to a card-shaped list item", () => {
  const item = pageItem(page(), [{ sceneId: "s", sceneName: "Board", cardId: "c" }]);
  assert.equal(item.id, "p1");
  assert.equal(item.title, "Muddy footprint");
  assert.equal(item.src, "a.png");
  assert.equal(item.notes, "<p>Size 11</p>");
  assert.equal(item.category, "object");
  assert.equal(item.folder, "f1");
  assert.equal(item.kind, "image");
  assert.equal(item.hidden, false);
  assert.equal(item.placements.length, 1);
  assert.equal(pageItem(page({ ownership: { default: 0 } })).hidden, true);
  assert.equal(pageItem({ _id: "x", name: "", system: {} }).created, 0);
});

test("hidden means ownership default NONE", () => {
  assert.equal(isPageHidden({ default: LEVELS.NONE }), true);
  assert.equal(isPageHidden({ default: LEVELS.INHERIT, u: 3 }), false);
  assert.equal(isPageHidden(undefined), false);
});

test("accessUpdate: hiding replaces the whole ownership (no per-user entries), revealing inherits", () => {
  const replace = v => ({ replaced: v });
  assert.deepEqual(accessUpdate(true, replace), { ownership: { replaced: { default: 0 } } });
  assert.deepEqual(accessUpdate(false, replace), { "ownership.default": -1 });
});

test("placementIndex finds every card that links to a page, across boards", () => {
  const uuid = "JournalEntry.j.JournalEntryPage.p1";
  const index = placementIndex([
    { sceneId: "a", sceneName: "A", cards: { c1: { id: "c1", page: uuid }, c2: { id: "c2" }, bad: null } },
    { sceneId: "b", sceneName: "B", cards: { c3: { id: "c3", page: uuid }, c4: { id: "c4", page: "other" } } }
  ]);
  assert.deepEqual(index.get(uuid), [
    { sceneId: "a", sceneName: "A", cardId: "c1" },
    { sceneId: "b", sceneName: "B", cardId: "c3" }
  ]);
  assert.equal(index.get("other").length, 1);
});

test("mirror diffs are empty when in step, and carry only what changed", () => {
  const item = pageItem(page());
  const card = normalizeCard({ kind: "image", title: item.title, src: item.src, notes: item.notes, hidden: false, page: item.uuid }, "c");
  assert.deepEqual(cardPatchFromPage(card, item), {});
  assert.deepEqual(pagePatchFromCard(item, card), { update: {} });

  const renamed = { ...item, title: "Boot print", hidden: true };
  assert.deepEqual(cardPatchFromPage(card, renamed), { title: "Boot print", hidden: true });

  const edited = normalizeCard({ ...card, title: "Print", notes: "", hidden: true }, "c");
  assert.deepEqual(pagePatchFromCard(item, edited), { update: { name: "Print", "system.notes": "" }, hidden: true });
  // An untitled card never blanks the page's (required) name.
  const blank = normalizeCard({ ...card, title: "" }, "c");
  assert.deepEqual(pagePatchFromCard(item, blank).update, {});
});

test("evidencePageData builds a typed page, hidden or inheriting", () => {
  const d = evidencePageData({ title: "Knife", src: "k.png", hidden: true, author: "u", created: 9, sort: 5 });
  assert.equal(d.type, EVIDENCE_TYPE);
  assert.equal(d.name, "Knife");
  assert.equal(d.src, "k.png");
  assert.deepEqual(d.ownership, { default: 0 });
  assert.equal(d.sort, 5);
  assert.equal(d.system.author, "u");
  assert.deepEqual(evidencePageData({ title: "X" }).ownership, { default: -1 });
});

test("listRows takes journal items in their own order and groups them", () => {
  const items = journalOrder([
    pageItem(page({ id: "b", name: "Bravo", sort: 200, system: { folder: "f1", category: "object", created: 1 } })),
    pageItem(page({ id: "a", name: "Alpha", sort: 100, system: { folder: null, category: "person", created: 2 } })),
    pageItem(page({ id: "h", name: "Hidden", sort: 300, ownership: { default: 0 }, system: { created: 3 } }))
  ]);
  const all = listRows({ items, mode: "all", sort: "board", includeHidden: true });
  assert.deepEqual(all.map(r => r.id), ["a", "b", "h"]);
  const players = listRows({ items, mode: "all", sort: "board", includeHidden: false });
  assert.deepEqual(players.map(r => r.id), ["a", "b"]);
  const newest = listRows({ items, mode: "all", sort: "newest" });
  assert.deepEqual(newest.map(r => r.id), ["h", "a", "b"]);
  const folders = listRows({ items, folders: { f1: { id: "f1", name: "Shoes" } }, mode: "folders", includeHidden: false });
  assert.deepEqual(folders.map(r => r.id), ["folder:f1", "b", "a"]);
  const cats = listRows({ items, mode: "categories", includeHidden: false });
  assert.ok(cats.some(r => r.id === "category:person"));
  // Items keep fields cards don't have (placements), since they skip normalisation.
  assert.ok(Array.isArray(all[0].card.placements));
});

test("text documents: page items, creation data and mirroring of their pages", () => {
  const doc = page({ src: null, system: { kind: "document", pages: ["<p>One</p>", "<p>Two</p>", 7], notes: "", created: 1 } });
  const item = pageItem(doc);
  assert.equal(item.kind, "document");
  assert.deepEqual(item.docPages, ["<p>One</p>", "<p>Two</p>"]);
  assert.equal(pageItem(page()).kind, "image");
  assert.deepEqual(pageItem(page()).docPages, []);

  const data = evidencePageData({ title: "Letter", kind: "document" });
  assert.equal(data.system.kind, "document");
  assert.deepEqual(data.system.pages, [""]);
  assert.equal(data.src, null);
  // A PDF document: the file is its src, and it has no written pages.
  const pdf = evidencePageData({ title: "Report", kind: "document", src: "report.pdf" });
  assert.equal(pdf.src, "report.pdf");
  assert.equal(pdf.system.pages, undefined);
  assert.equal(evidencePageData({ title: "Pic", src: "a.png" }).system.kind, "image");
  assert.equal(evidencePageData({ title: "Pic", src: "a.png" }).system.pages, undefined);

  const card = normalizeCard({ kind: "document", title: item.title, notes: item.notes, docPages: item.docPages, page: item.uuid }, "c");
  assert.equal(card.page, item.uuid);
  assert.deepEqual(cardPatchFromPage(card, item), {});
  const edited = { ...item, docPages: ["<p>One</p>", "<p>Two!</p>"] };
  assert.deepEqual(cardPatchFromPage(card, edited), { docPages: ["<p>One</p>", "<p>Two!</p>"] });
  assert.deepEqual(pagePatchFromCard(item, card).update, {});
  const changed = normalizeCard({ ...card, docPages: ["<p>New</p>"] }, "c");
  assert.deepEqual(pagePatchFromCard(item, changed).update, { "system.pages": ["<p>New</p>"] });
  // An image card never carries (or pushes) pages.
  const image = normalizeCard({ kind: "image", title: item.title, notes: item.notes, src: item.src, page: item.uuid }, "i");
  assert.equal(cardPatchFromPage(image, item).docPages, undefined);
});
