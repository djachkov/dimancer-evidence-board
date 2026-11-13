import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCard, fitSize, newCard, cardList, topSort, bottomSort, isTop, orderedCards, neighbours,
  clampToRect, cardUpdate, cardCreate, cardDelete, MIN_CARD_SIZE, A4, isEvidence
} from "../scripts/cards.mjs";

const card = (id, x, y, extra = {}) => ({ id, src: `${id}.png`, x, y, width: 100, height: 100, ...extra });
const board = (...cards) => Object.fromEntries(cards.map(c => [c.id, c]));

test("normalizeCard fills defaults, coerces types and takes the storage key as id", () => {
  const c = normalizeCard({ id: "wrong", x: "12", width: 5, hidden: 1, title: null }, "abc");
  assert.equal(c.id, "abc");
  assert.equal(c.x, 0, "non-numeric x falls back to 0");
  assert.equal(c.width, MIN_CARD_SIZE, "width clamps to the minimum");
  assert.equal(c.hidden, true);
  assert.equal(c.title, "");
  assert.equal(c.link, null);
});

test("fitSize keeps the aspect ratio with the long side at the target", () => {
  assert.deepEqual(fitSize(1200, 600, 300), { width: 300, height: 150 });
  assert.deepEqual(fitSize(500, 1000, 300), { width: 150, height: 300 });
  assert.deepEqual(fitSize(0, 0, 300), { width: 300, height: 225 }, "broken sizes fall back to 4:3");
});

test("newCard centres on the point and lands on top", () => {
  const cards = board(card("a", 0, 0, { sort: 4 }), card("b", 0, 0, { sort: 9 }));
  const c = newCard({ id: "n", src: "n.png", x: 1000, y: 500, naturalWidth: 800, naturalHeight: 400, cards });
  assert.equal(c.width, 300);
  assert.equal(c.height, 150);
  assert.equal(c.x, 850);
  assert.equal(c.y, 425);
  assert.equal(c.sort, 10);
});

test("sorting helpers", () => {
  const cards = board(card("a", 0, 0, { sort: 2 }), card("b", 0, 0, { sort: -1 }), card("c", 0, 0, { sort: 5 }));
  assert.deepEqual(cardList(cards).map(c => c.id), ["b", "a", "c"]);
  assert.equal(topSort(cards), 6);
  assert.equal(bottomSort(cards), -2);
  assert.equal(topSort({}), 0);
  assert.ok(isTop(cards, "c"));
  assert.ok(!isTop(cards, "a"));
});

test("cardList skips junk entries", () => {
  assert.deepEqual(cardList({ a: null, b: "x", c: card("c", 0, 0) }).map(c => c.id), ["c"]);
});

test("orderedCards reads rows top to bottom, then left to right", () => {
  const cards = board(
    card("r2-right", 900, 400), card("r1-right", 800, 10), card("r1-left", 100, 60), card("r2-left", 50, 420)
  );
  assert.deepEqual(orderedCards(cards).map(c => c.id), ["r1-left", "r1-right", "r2-left", "r2-right"]);
});

test("orderedCards can leave hidden cards out", () => {
  const cards = board(card("a", 0, 0), card("h", 200, 0, { hidden: true }), card("b", 400, 0));
  assert.deepEqual(orderedCards(cards, { includeHidden: false }).map(c => c.id), ["a", "b"]);
});

test("neighbours wraps around and handles lone or unknown cards", () => {
  const cards = board(card("a", 0, 0), card("b", 200, 0), card("c", 400, 0));
  const n = neighbours(cards, "a");
  assert.equal(n.index, 0);
  assert.equal(n.total, 3);
  assert.equal(n.prev.id, "c");
  assert.equal(n.next.id, "b");
  assert.deepEqual(neighbours(board(card("a", 0, 0)), "a"), { index: 0, total: 1, prev: null, next: null });
  assert.equal(neighbours(cards, "zzz").index, -1);
  const hidden = neighbours(board(card("a", 0, 0), card("h", 200, 0, { hidden: true })), "a", { includeHidden: false });
  assert.equal(hidden.total, 1, "a hidden card isn't a neighbour when hidden cards are excluded");
});

test("clampToRect lets cards overhang the edge by half their size", () => {
  const rect = { x: 100, y: 100, width: 1000, height: 800 };
  assert.deepEqual(clampToRect({ x: -500, y: 5000, width: 200, height: 100 }, rect), { x: 0, y: 850 });
  assert.deepEqual(clampToRect({ x: 300, y: 300, width: 200, height: 100 }, rect), { x: 300, y: 300 });
});

test("update payloads use per-field dotted keys", () => {
  assert.deepEqual(cardUpdate("abc", { id: "ignored", x: 5, title: "Knife" }), {
    "flags.dimancer_board.cards.abc.x": 5,
    "flags.dimancer_board.cards.abc.title": "Knife"
  });
  const c = normalizeCard(card("abc", 1, 2), "abc");
  assert.deepEqual(cardCreate(c), { "flags.dimancer_board.cards.abc": c });
  const DEL = Symbol("del");
  assert.deepEqual(cardDelete(["a", "b"], DEL), {
    "flags.dimancer_board.cards.a": DEL, "flags.dimancer_board.cards.b": DEL
  });
});

test("text documents are evidence cards with pages, sized as A4", () => {
  const doc = normalizeCard({ kind: "document", docPages: ["<p>a</p>", null, "<p>b</p>"], page: "JournalEntry.j.JournalEntryPage.p" }, "d");
  assert.equal(doc.kind, "document");
  assert.deepEqual(doc.docPages, ["<p>a</p>", "<p>b</p>"]);
  assert.equal(doc.page, "JournalEntry.j.JournalEntryPage.p");
  assert.ok(isEvidence(doc));
  // Only documents carry pages; stickers never link to the journal.
  assert.deepEqual(normalizeCard({ kind: "image", docPages: ["x"] }).docPages, []);
  assert.equal(normalizeCard({ kind: "note", page: "p" }).page, null);
  assert.ok(!isEvidence(normalizeCard({ kind: "sketch" })));
  const c = newCard({ id: "n", x: 0, y: 0, naturalWidth: A4.width, naturalHeight: A4.height, kind: "document" });
  assert.equal(c.height, 300);
  assert.equal(c.width, 212);
  // Reading order takes documents along with images, and leaves stickers out.
  const order = orderedCards(board(card("a", 0, 0), card("s", 200, 0, { kind: "note" }), card("d", 400, 0, { kind: "document" })), { evidenceOnly: true });
  assert.deepEqual(order.map(x => x.id), ["a", "d"]);
});
