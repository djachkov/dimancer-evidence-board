import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCard, orderedCards } from "../scripts/cards.mjs";
import {
  newNote, newSketch, simplifyPoints, strokeBounds, localToView, strokeAddUpdate, strokeDeleteUpdate,
  stickerName, isSticker, noteSizeFor, SKETCH_MARGIN, NOTE_SIZE
} from "../scripts/stickers.mjs";

test("notes grow with long text, up to twice the size", () => {
  assert.equal(noteSizeFor("Who was at the docks?"), NOTE_SIZE);
  assert.equal(noteSizeFor(""), NOTE_SIZE);
  const medium = noteSizeFor("x".repeat(560));
  assert.equal(medium, NOTE_SIZE * 2);
  const some = noteSizeFor("x".repeat(250));
  assert.ok(some > NOTE_SIZE && some < NOTE_SIZE * 2);
  assert.equal(noteSizeFor("x".repeat(100000)), NOTE_SIZE * 2);
  // Many short lines count as long text too.
  assert.ok(noteSizeFor("a\nb\nc\nd\ne\nf\ng\nh") > NOTE_SIZE);
});

const F = "flags.dimancer_board.cards";

test("old cards normalize to images with an empty view box of their own size", () => {
  const c = normalizeCard({ src: "a.png", width: 300, height: 200 }, "a");
  assert.equal(c.kind, "image");
  assert.deepEqual(c.view, { x: 0, y: 0, w: 300, h: 200 });
  assert.deepEqual(c.strokes, {});
  assert.equal(isSticker(c), false);
});

test("invalid strokes are dropped and odd point lists trimmed", () => {
  const c = normalizeCard({ kind: "sketch", strokes: {
    a: { color: "#ff0000", width: 3, points: [0, 0, 5, 5, 9] },
    b: { points: [1] },
    c: null,
    d: { color: "nope", width: -1, points: [1, 2] }
  } }, "s");
  assert.deepEqual(Object.keys(c.strokes), ["a", "d"]);
  assert.deepEqual(c.strokes.a.points, [0, 0, 5, 5]);
  assert.equal(c.strokes.d.color, "#222222");
  assert.equal(c.strokes.d.width, 4);
});

test("a new note is centred, square, on top, and coloured", () => {
  const n = newNote({ id: "n", x: 500, y: 400, cards: { a: { sort: 7 } } });
  assert.equal(n.kind, "note");
  assert.equal(n.width, NOTE_SIZE);
  assert.equal(n.x, 500 - (NOTE_SIZE / 2));
  assert.equal(n.sort, 8);
  assert.match(n.color, /^#[0-9a-f]{6}$/i);
  assert.ok(isSticker(n));
});

test("a new sketch sits exactly around its ink, with a margin and a minimum size", () => {
  const stroke = { color: "#222222", width: 4, points: [100, 100, 300, 160] };
  const s = newSketch({ id: "s", strokeId: "k", stroke });
  assert.equal(s.kind, "sketch");
  assert.equal(s.x, 100 - 2 - SKETCH_MARGIN);
  assert.equal(s.width, 200 + 4 + (2 * SKETCH_MARGIN));
  assert.deepEqual(s.view, { x: s.x, y: s.y, w: s.width, h: s.height });
  assert.deepEqual(s.strokes.k.points, [100, 100, 300, 160]);
  // A dot still gets a card big enough to grab.
  const dot = newSketch({ id: "d", strokeId: "k", stroke: { color: "#222222", width: 4, points: [50, 50] } });
  assert.ok(dot.width >= 40 && dot.height >= 40);
});

test("simplify keeps the ends and the corners, drops points on a straight line", () => {
  const line = [0, 0, 1, 0, 2, 0, 3, 0, 10, 0, 10, 5, 10, 10];
  assert.deepEqual(simplifyPoints(line), [0, 0, 10, 0, 10, 10]);
  assert.deepEqual(simplifyPoints([1.234, 2.345]), [1.2, 2.3]);
});

test("stroke bounds include half the pen width", () => {
  assert.deepEqual(strokeBounds([10, 20, 30, 60], 4), { x: 8, y: 18, w: 24, h: 44 });
});

test("local points map into the view box, following the card's scale", () => {
  const card = { width: 200, height: 100, view: { x: 50, y: 10, w: 100, h: 50 } };
  assert.deepEqual(localToView(card, 0, 0), { x: 50, y: 10 });
  assert.deepEqual(localToView(card, 200, 100), { x: 150, y: 60 });
});

test("adding a stroke to a note never resizes it", () => {
  const n = newNote({ id: "n", x: 0, y: 0 });
  const u = strokeAddUpdate(n, "k", { color: "#222222", width: 4, points: [-50, -50, 400, 400] });
  assert.deepEqual(Object.keys(u), [`${F}.n.strokes.k`]);
  assert.equal(u[`${F}.n.strokes.k`].sort, 0);
});

test("ink on evidence stays on it: the first stroke stores its view box, later ones don't touch it", () => {
  const card = normalizeCard({ id: "e", kind: "image", src: "a.png", x: 10, y: 20, width: 300, height: 200 }, "e");
  const first = strokeAddUpdate(card, "k", { color: "#222222", width: 4, points: [-50, -50, 400, 400] });
  assert.deepEqual(first[`${F}.e.view`], { x: 0, y: 0, w: 300, h: 200 });
  assert.equal(first[`${F}.e.x`], undefined);
  assert.equal(first[`${F}.e.width`], undefined);
  // Once it has ink (and was resized since), the stored view box is left alone.
  const inked = normalizeCard({ ...card, width: 600, height: 400, view: { x: 0, y: 0, w: 300, h: 200 },
    strokes: { k: { color: "#222222", width: 4, points: [0, 0, 10, 10], sort: 0 } } }, "e");
  const second = strokeAddUpdate(inked, "m", { color: "#222222", width: 4, points: [5, 5, 6, 6] });
  assert.deepEqual(Object.keys(second), [`${F}.e.strokes.m`]);
  assert.equal(second[`${F}.e.strokes.m`].sort, 1);
});

test("ink past a sketch's edge grows it without moving what's drawn", () => {
  const s = newSketch({ id: "s", strokeId: "a", stroke: { color: "#222222", width: 4, points: [100, 100, 200, 100] } });
  // The card was then scaled up 2x on the board (view box unchanged).
  const big = { ...s, width: s.width * 2, height: s.height * 2 };
  const inside = strokeAddUpdate(big, "b", { color: "#222222", width: 2, points: [120, 100, 130, 100] });
  assert.deepEqual(Object.keys(inside), [`${F}.s.strokes.b`]);
  assert.equal(inside[`${F}.s.strokes.b`].sort, 1);

  const left = strokeAddUpdate(big, "c", { color: "#222222", width: 2, points: [40, 100, 60, 100] });
  const view = left[`${F}.s.view`];
  assert.ok(view.x < s.view.x);
  // The view box's old left edge stays put on the board: x moves left by the growth × scale.
  assert.equal(left[`${F}.s.x`], Math.round(big.x + ((view.x - s.view.x) * 2)));
  assert.equal(left[`${F}.s.width`], Math.round(view.w * 2));
  assert.equal(left[`${F}.s.y`], big.y);
});

test("stroke deletion payload", () => {
  assert.deepEqual(strokeDeleteUpdate("s", ["a", "b"], "DEL"), { [`${F}.s.strokes.a`]: "DEL", [`${F}.s.strokes.b`]: "DEL" });
});

test("sticker names come from the title or the first line of text", () => {
  assert.equal(stickerName({ title: "", text: "\n  Who was at the docks?\nmore" }), "Who was at the docks?");
  assert.equal(stickerName({ title: "Alibi", text: "x" }), "Alibi");
  assert.equal(stickerName({ title: "", text: "a".repeat(60) }, 10), `${"a".repeat(9)}…`);
  assert.equal(stickerName({ title: "", text: "" }), "");
});

test("the viewer's paging can skip stickers", () => {
  const cards = {
    a: { src: "a.png", x: 0, y: 0 },
    n: { kind: "note", x: 400, y: 0 },
    s: { kind: "sketch", x: 800, y: 0 }
  };
  assert.deepEqual(orderedCards(cards).map(c => c.id), ["a", "n", "s"]);
  assert.deepEqual(orderedCards(cards, { evidenceOnly: true }).map(c => c.id), ["a"]);
});

test("ink hit testing follows the strokes, not the box", async () => {
  const { inkHit } = await import("../scripts/stickers.mjs");
  const strokes = { a: { width: 4, points: [0, 0, 100, 0] }, b: { width: 10, points: [50, 50] } };
  assert.ok(inkHit(strokes, 50, 1));
  assert.ok(!inkHit(strokes, 50, 20));
  assert.ok(inkHit(strokes, 50, 6, 5));
  assert.ok(inkHit(strokes, 53, 52));
  assert.ok(!inkHit({}, 0, 0, 100));
});
