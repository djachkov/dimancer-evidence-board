import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardTilt, cardView, contentSections, cssColor, excerpt, matchesQuery, pageTurn, styleVars, tornClipPath
} from "../scripts/journal-cards.mjs";
import { CARD_LOOKS, cardLook } from "../scripts/render/card-look.mjs";

const item = (over = {}) => ({
  id: "abc", kind: "image", title: "Letter", src: "a.webp", docPages: [], hidden: false, placements: [], ...over
});

test("cssColor pads and lower-cases", () => {
  assert.equal(cssColor(0x00e5ff), "#00e5ff");
  assert.equal(cssColor(0xF7F3EA), "#f7f3ea");
  assert.equal(cssColor(0), "#000000");
});

test("cardTilt is stable per id and within range", () => {
  for ( const id of ["a", "b", "xyz", "12345", "Ω"] ) {
    const t = cardTilt(id);
    assert.equal(t, cardTilt(id));
    assert.ok(Math.abs(t) <= 2.5, `${id}: ${t}`);
  }
  const tilts = new Set(["a", "b", "c", "d", "e", "f"].map(id => cardTilt(id)));
  assert.ok(tilts.size > 1, "different cards lean differently");
});

test("tornClipPath is a CSS polygon of percentages, the same for the same card", () => {
  const clip = tornClipPath("card1");
  assert.match(clip, /^polygon\((\d+(\.\d+)?% \d+(\.\d+)?%, )+\d+(\.\d+)?% \d+(\.\d+)?%\)$/);
  assert.equal(clip, tornClipPath("card1"));
  assert.notEqual(clip, tornClipPath("card2"));
});

test("excerpt cuts at a word and adds an ellipsis", () => {
  assert.equal(excerpt("  short   text "), "short text");
  const long = "word ".repeat(100);
  const e = excerpt(long, 50);
  assert.ok(e.endsWith("…"));
  assert.ok(e.length <= 51);
  assert.ok(!e.includes("wor…"), "no word cut in half");
  assert.equal(excerpt(null), "");
});

test("styleVars covers every look and uses its fonts", () => {
  for ( const id of Object.keys(CARD_LOOKS) ) {
    const vars = styleVars(id);
    assert.ok(vars.includes(`--mb-card-font-title: ${CARD_LOOKS[id].fonts.title}`));
    assert.match(vars, /--mb-card-paper: #[0-9a-f]{6}/);
  }
  assert.equal(styleVars("nope"), styleVars("classic"));
  assert.equal(cardLook("nope"), CARD_LOOKS.classic);
});

test("cardView: a photo", () => {
  const v = cardView(item({ placements: [{ sceneId: "s" }] }));
  assert.equal(v.kind, "photo");
  assert.ok(v.isPhoto && !v.isDocument && !v.isPdf);
  assert.equal(v.placed, 1);
  assert.equal(v.stacked, false);
  assert.equal(v.clip, null);
  assert.equal(v.style, "classic");
});

test("cardView: an untitled photo shows the fallback label", () => {
  const v = cardView(item({ title: "" }), { untitled: "Untitled evidence" });
  assert.equal(v.title, "Untitled evidence");
  assert.equal(v.untitled, true);
});

test("cardView: a text document with several pages is a stack with an excerpt", () => {
  const v = cardView(item({ kind: "document", src: "", docPages: ["<p>a</p>", "<p>b</p>", ""] }), { text: "Attention! A bounty." });
  assert.equal(v.kind, "document");
  assert.equal(v.pages, 3);
  assert.equal(v.stacked, true);
  assert.equal(v.excerpt, "Attention! A bounty.");
});

test("cardView: a document with a src is a PDF", () => {
  const v = cardView(item({ kind: "document", src: "x.pdf" }));
  assert.equal(v.kind, "pdf");
  assert.equal(v.isPdf, true);
  assert.equal(v.stacked, false);
});

test("cardView: parchment gets a torn edge; category colours the accent and the seal", () => {
  const cat = { name: "Person", color: "#3366ff", icon: "fa-user" };
  const v = cardView(item(), { style: "parchment", category: cat });
  assert.equal(v.clip, tornClipPath("abc"));
  assert.equal(v.accent, "#3366ff");
  assert.equal(v.seal, "#3366ff");
  const plain = cardView(item(), { style: "parchment" });
  assert.equal(plain.seal, cssColor(CARD_LOOKS.parchment.seal));
  assert.equal(cardView(item(), { style: "holo" }).accent, "#00e5ff");
  assert.equal(cardView(item(), { style: "bogus" }).style, "classic");
});

const group = (id, depth = 0, ancestors = []) => ({ type: "group", id, depth, ancestors, group: { name: id } });
const card = (id, ancestors = []) => ({ type: "card", id, depth: ancestors.length, ancestors });

test("contentSections: folders with their cards, subfolders after the parent, loose cards last", () => {
  const rows = [
    group("folder:a"),
    group("folder:a1", 1, ["folder:a"]),
    card("c1", ["folder:a", "folder:a1"]),
    card("c2", ["folder:a"]),
    group("folder:b"),
    card("c3"),
    card("c4")
  ];
  const sections = contentSections(rows);
  assert.deepEqual(sections.map(s => s.key), ["folder:a", "folder:a1", "folder:b", ""]);
  assert.deepEqual(sections[0].cards.map(c => c.id), ["c2"]);
  assert.deepEqual(sections[1].cards.map(c => c.id), ["c1"]);
  assert.deepEqual(sections[2].cards, []);
  assert.equal(sections[3].group, null);
  assert.deepEqual(sections[3].cards.map(c => c.id), ["c3", "c4"]);
});

test("contentSections: the All view is one loose section", () => {
  const sections = contentSections([card("x"), card("y")]);
  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].cards.map(c => c.id), ["x", "y"]);
});

test("pageTurn finds neighbours and the ends", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(pageTurn(ids, "b"), { index: 1, total: 3, prev: "a", next: "c" });
  assert.deepEqual(pageTurn(ids, "a"), { index: 0, total: 3, prev: null, next: "b" });
  assert.deepEqual(pageTurn(ids, "c"), { index: 2, total: 3, prev: "b", next: null });
  assert.deepEqual(pageTurn(ids, "z"), { index: -1, total: 3, prev: null, next: null });
});

test("matchesQuery needs every word", () => {
  assert.ok(matchesQuery("harpy queen contract", ""));
  assert.ok(matchesQuery("harpy queen contract", "queen HARPY"));
  assert.ok(!matchesQuery("harpy queen contract", "queen dragon"));
});
