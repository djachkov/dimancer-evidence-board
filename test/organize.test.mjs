import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CATEGORIES, categoryList, normalizeCategory, folderList, folderAndDescendants, canNest, folderDepth,
  sortCards, listRows, iconLabel, categoriesUpdate, clearCategories, folderDelete, folderCreate, folderUpdate, nextFolderSort
} from "../scripts/organize.mjs";

const card = (id, x, y, extra = {}) => ({ id, src: "x.png", x, y, width: 100, height: 100, ...extra });
const board = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));
const DEL = Symbol("del");

test("categories default until customised; an empty map means none", () => {
  assert.deepEqual(categoryList(undefined).map(c => c.id), DEFAULT_CATEGORIES.map(c => c.id));
  assert.deepEqual(categoryList({}), []);
  const list = categoryList({ b: { name: "B", sort: 1 }, a: { name: "A", sort: 0, color: "nope", icon: "fa-bogus" } });
  assert.deepEqual(list.map(c => c.id), ["a", "b"]);
  assert.equal(list[0].color, "#6b7280");
  assert.equal(list[0].icon, "fa-tag");
  assert.equal(normalizeCategory(null), null);
});

test("folderList repairs missing parents and cycles", () => {
  const list = folderList({ a: { name: "A", parent: "ghost" }, b: { name: "B", parent: "c" }, c: { name: "C", parent: "b" } });
  const byId = Object.fromEntries(list.map(f => [f.id, f]));
  assert.equal(byId.a.parent, null);
  assert.ok((byId.b.parent === null) || (byId.c.parent === null), "a cycle gets cut");
});

test("nesting rules and depth", () => {
  const folders = { a: { name: "A" }, b: { name: "B", parent: "a" }, c: { name: "C", parent: "b" }, d: { name: "D" } };
  assert.deepEqual([...folderAndDescendants(folders, "a")].sort(), ["a", "b", "c"]);
  assert.ok(!canNest(folders, "a", "c"), "can't move a folder into its own descendant");
  assert.ok(!canNest(folders, "a", "a"));
  assert.ok(canNest(folders, "c", "d"));
  assert.ok(canNest(folders, "c", null));
  assert.equal(folderDepth(folders, "c"), 2);
  assert.equal(nextFolderSort(folders, null), 1);
});

test("sortCards by board order, name, newest", () => {
  const cs = [card("b", 500, 0, { title: "beta", created: 1 }), card("a", 0, 0, { title: "Alpha", created: 3 }), card("u", 900, 0, { title: "", created: 2 })];
  const order = [cs[1], cs[0], cs[2]];
  assert.deepEqual(sortCards(cs, "board", order).map(c => c.id), ["a", "b", "u"]);
  assert.deepEqual(sortCards(cs, "name", order).map(c => c.id), ["a", "b", "u"], "untitled last, case-insensitive");
  assert.deepEqual(sortCards(cs, "newest", order).map(c => c.id), ["a", "u", "b"]);
});

test("listRows: folders view nests folders and cards, unfiled at the end", () => {
  const cards = board(card("c1", 0, 0, { folder: "f1" }), card("c2", 200, 0, { folder: "f2" }), card("c3", 400, 0), card("c4", 600, 0, { folder: "gone" }));
  const folders = { f1: { name: "Suspects", sort: 0 }, f2: { name: "Alibis", parent: "f1", sort: 0 } };
  const rows = listRows({ cards, folders, mode: "folders" });
  assert.deepEqual(rows.map(r => `${r.type}:${r.type === "group" ? r.groupId : r.id}@${r.depth}`),
    ["group:f1@0", "group:f2@1", "card:c2@2", "card:c1@1", "card:c3@0", "card:c4@0"]);
  assert.equal(rows[0].count, 2, "a folder counts its sub-folders' evidence");
  assert.deepEqual(rows[2].ancestors, ["folder:f1", "folder:f2"]);
});

test("listRows: categories view groups by category, Uncategorized only when needed", () => {
  const cards = board(card("p", 0, 0, { category: "person" }), card("x", 200, 0, { category: "gone" }), card("o", 400, 0, { category: "object" }));
  const rows = listRows({ cards, mode: "categories" });
  const groups = rows.filter(r => r.type === "group").map(r => [r.groupId, r.count]);
  assert.deepEqual(groups, [["person", 1], ["place", 0], ["object", 1], ["document", 0], ["event", 0], ["", 1]]);
  const all = listRows({ cards: board(card("p", 0, 0, { category: "person" })), mode: "categories" });
  assert.ok(!all.some(r => r.groupId === ""), "no Uncategorized group when everything has a category");
});

test("listRows: all view and hidden cards", () => {
  const cards = board(card("a", 0, 0), card("h", 200, 0, { hidden: true }));
  assert.deepEqual(listRows({ cards, mode: "all", includeHidden: false }).map(r => r.id), ["a"]);
  assert.deepEqual(listRows({ cards, mode: "all" }).map(r => r.id), ["a", "h"]);
});

test("category payloads store the full set and clear deleted ones", () => {
  const cats = [{ id: "a", name: "A", color: "#111111", icon: "fa-user" }];
  const u = categoriesUpdate(cats, { a: {}, old: {} }, DEL);
  assert.deepEqual(u["flags.dimancer_board.categories.a"], { id: "a", name: "A", color: "#111111", icon: "fa-user", sort: 0 });
  assert.equal(u["flags.dimancer_board.categories.old"], DEL);
  assert.deepEqual(categoriesUpdate([], undefined, DEL), { "flags.dimancer_board.categories": {} });
  assert.deepEqual(clearCategories(board(card("a", 0, 0, { category: "old" }), card("b", 0, 0, { category: "a" })), ["old"]),
    { "flags.dimancer_board.cards.a.category": null });
});

test("folder payloads; deleting a folder moves its contents up", () => {
  assert.deepEqual(folderCreate({ id: "f", name: "F", parent: null, sort: 0 }), { "flags.dimancer_board.folders.f": { id: "f", name: "F", parent: null, sort: 0 } });
  assert.deepEqual(folderUpdate("f", { id: "x", name: "G" }), { "flags.dimancer_board.folders.f.name": "G" });
  const folders = { top: { name: "Top" }, mid: { name: "Mid", parent: "top" }, low: { name: "Low", parent: "mid" } };
  const cards = board(card("c", 0, 0, { folder: "mid" }), card("d", 0, 0, { folder: "low" }));
  assert.deepEqual(folderDelete(folders, cards, "mid", DEL), {
    "flags.dimancer_board.folders.mid": DEL,
    "flags.dimancer_board.folders.low.parent": "top",
    "flags.dimancer_board.cards.c.folder": "top"
  });
});

test("iconLabel", () => {
  assert.equal(iconLabel("fa-location-dot"), "Location dot");
});
