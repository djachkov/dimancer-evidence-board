import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLink, linkList, linkBetween, linksOf, otherEnd, visibleLinks, newLink, linkCreate, linkUpdate, linkDelete,
  sagControl, sampleCurve, strokePolygon, DEFAULT_THREAD_COLOR, MAIN_PIN, pinOf, usedPins, orphanedPins, orphanPinsUpdate
} from "../scripts/links.mjs";

const links = {
  ab: { from: "a", to: "b", color: "#2e6fd1", created: 2 },
  bc: { from: "b", to: "c", created: 1 },
  self: { from: "a", to: "a" },
  junk: "x"
};

test("normalizeLink rejects self-loops and junk, defaults the colour", () => {
  assert.equal(normalizeLink({ from: "a", to: "a" }, "x"), null);
  assert.equal(normalizeLink(null, "x"), null);
  assert.equal(normalizeLink({ from: "a" }, "x"), null);
  const l = normalizeLink({ from: "a", to: "b", color: "red" }, "k");
  assert.equal(l.id, "k");
  assert.equal(l.color, DEFAULT_THREAD_COLOR, "non-hex colours fall back to red");
});

test("linkList keeps valid threads, oldest first", () => {
  assert.deepEqual(linkList(links).map(l => l.id), ["bc", "ab"]);
});

test("linkBetween is undirected", () => {
  assert.equal(linkBetween(links, "b", "a").id, "ab");
  assert.equal(linkBetween(links, "a", "b").id, "ab");
  assert.equal(linkBetween(links, "a", "c"), null);
});

test("linksOf, otherEnd and visibleLinks", () => {
  assert.deepEqual(linksOf(links, ["b"]).map(l => l.id).sort(), ["ab", "bc"]);
  assert.deepEqual(linksOf(links, ["c"]).map(l => l.id), ["bc"]);
  assert.equal(otherEnd(normalizeLink(links.ab, "ab"), "b"), "a");
  assert.deepEqual(visibleLinks(links, ["a", "b"]).map(l => l.id), ["ab"], "a thread to a hidden card is hidden");
});

test("newLink and update payloads", () => {
  assert.equal(newLink({ id: "n", from: "a", to: "a" }), null);
  const l = newLink({ id: "n", from: "a", to: "b", author: "u", created: 5 });
  assert.deepEqual(linkCreate(l), { "flags.dimancer_board.links.n": l });
  assert.deepEqual(linkUpdate("n", { id: "x", color: "#222222" }), { "flags.dimancer_board.links.n.color": "#222222" });
  const DEL = Symbol("del");
  assert.deepEqual(linkDelete(["n", "m"], DEL), { "flags.dimancer_board.links.n": DEL, "flags.dimancer_board.links.m": DEL });
});

test("threads sag below the midpoint, more when longer, capped", () => {
  const short = sagControl({ x: 0, y: 0 }, { x: 100, y: 0 });
  assert.deepEqual(short, { x: 50, y: 8 });
  const long = sagControl({ x: 0, y: 0 }, { x: 5000, y: 0 });
  assert.equal(long.y, 80);
});

test("sampleCurve starts and ends on the pins", () => {
  const p1 = { x: 0, y: 0 }; const p2 = { x: 100, y: 50 };
  const pts = sampleCurve(p1, sagControl(p1, p2), p2, 10);
  assert.equal(pts.length, 11);
  assert.deepEqual(pts[0], p1);
  assert.deepEqual(pts.at(-1), p2);
});

test("strokePolygon surrounds a straight line by the half-width", () => {
  const poly = strokePolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2);
  // left side (y = +2) forward, right side (y = -2) back
  assert.deepEqual(poly, [0, 2, 10, 2, 10, -2, 0, -2]);
  assert.deepEqual(strokePolygon([{ x: 0, y: 0 }], 2), []);
});

test("threads hang from the main pin unless they name another", () => {
  const l = normalizeLink({ from: "a", to: "b", toPin: "p1" }, "k");
  assert.equal(l.fromPin, MAIN_PIN);
  assert.equal(l.toPin, "p1");
  assert.equal(pinOf(l, "a"), MAIN_PIN);
  assert.equal(pinOf(l, "b"), "p1");
  assert.equal(newLink({ id: "n", from: "a", to: "b", fromPin: "q" }).fromPin, "q");
});

test("usedPins and orphanedPins", () => {
  const pinned = {
    ab: { from: "a", to: "b", fromPin: "p1", created: 1 },
    ac: { from: "a", to: "c", fromPin: "p1", toPin: "p2", created: 2 },
    cb: { from: "c", to: "b", fromPin: "p3", created: 3 }
  };
  assert.deepEqual([...usedPins(pinned, "a")], ["p1"]);
  assert.deepEqual([...usedPins(pinned, "b")], [MAIN_PIN]);
  assert.deepEqual(orphanedPins(pinned, ["ab"]), {}, "p1 still holds the thread to c");
  assert.deepEqual(orphanedPins(pinned, ["ab", "ac"]), { a: ["p1"], c: ["p2"] });
  assert.deepEqual(orphanedPins(pinned, ["cb"]), { c: ["p3"] }, "main pins are never orphaned");
});

test("orphanPinsUpdate deletes orphaned pins, skipping cards deleted alongside", () => {
  const pinned = { ab: { from: "a", to: "b", fromPin: "p1", toPin: "p2", created: 1 } };
  assert.deepEqual(orphanPinsUpdate(pinned, ["ab"], "DEL"),
    { "flags.dimancer_board.cards.a.pins.p1": "DEL", "flags.dimancer_board.cards.b.pins.p2": "DEL" });
  assert.deepEqual(orphanPinsUpdate(pinned, ["ab"], "DEL", ["a"]), { "flags.dimancer_board.cards.b.pins.p2": "DEL" });
});
