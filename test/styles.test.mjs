import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THEMES, CARD_STYLES, PIN_STYLES, THREAD_STYLES, DECORATIONS, SIGN_MAX, themeOf, normalizeStyle, normalizeDecor,
  decorationsOf, threadColors, noteColors, inkColors, hashString, tornEdge
} from "../scripts/styles.mjs";
import { SURFACES, parchment } from "../scripts/surface-presets.mjs";
import { circuitPath, densify, pointAlong, polylineLength } from "../scripts/links.mjs";

const HEX = /^#[0-9a-f]{6}$/;

test("every theme names known styles, and every surface a known theme and frame", () => {
  const ids = list => new Set(list.map(s => s.id));
  for ( const [name, theme] of Object.entries(THEMES) ) {
    assert.ok(ids(CARD_STYLES).has(theme.cards), name);
    assert.ok(ids(PIN_STYLES).has(theme.pins), name);
    assert.ok(ids(THREAD_STYLES).has(theme.threads), name);
  }
  for ( const p of SURFACES ) {
    assert.ok(THEMES[p.theme], p.id);
    assert.ok(DECORATIONS[p.frameStyle], p.id);
  }
});

test("palettes: valid colours with unique keys", () => {
  const check = (list, what) => {
    assert.ok(list.length > 0, what);
    assert.equal(new Set(list.map(c => c.key)).size, list.length, what);
    for ( const c of list ) assert.match(c.color, HEX, `${what} ${c.key}`);
  };
  for ( const s of THREAD_STYLES ) check(s.colors, s.id);
  for ( const s of CARD_STYLES ) {
    check(s.notes, `${s.id} notes`);
    check(s.ink, `${s.id} ink`);
  }
  assert.equal(threadColors("nope"), threadColors("yarn"));
  assert.equal(noteColors(undefined), noteColors("classic"));
  assert.equal(inkColors("holo"), CARD_STYLES.find(s => s.id === "holo").ink);
});

test("normalizeStyle: stored parts kept, the rest from the surface's theme", () => {
  assert.equal(themeOf("planks"), "medieval");
  assert.equal(themeOf("cyber-grid"), "cyberpunk");
  assert.equal(themeOf("cork-002"), "classic");
  assert.equal(themeOf(null), "classic");
  assert.deepEqual(normalizeStyle(undefined, "cork-002"), THEMES.classic);
  assert.deepEqual(normalizeStyle(undefined, "planks"), THEMES.medieval);
  assert.deepEqual(normalizeStyle({}, "cyber-grid"), THEMES.cyberpunk);
  assert.deepEqual(normalizeStyle({ cards: "holo", pins: "bogus" }, "planks"), { cards: "holo", pins: "nail", threads: "twine" });
});

test("normalizeDecor: booleans with defaults, trimmed sign text", () => {
  const d = normalizeDecor(undefined);
  assert.deepEqual(d, { sign: true, roof: true, lanterns: true, hud: true, brackets: true, animate: false, signText: "" });
  assert.equal(normalizeDecor({ roof: false }).roof, false);
  assert.equal(normalizeDecor({ roof: "no" }).roof, true);
  assert.equal(normalizeDecor({ animate: true }).animate, true);
  assert.equal(normalizeDecor({ signText: "  Wanted  " }).signText, "Wanted");
  assert.equal(normalizeDecor({ signText: "x".repeat(100) }).signText.length, SIGN_MAX);
  assert.deepEqual(decorationsOf("bevel"), []);
  assert.deepEqual(decorationsOf("nope"), []);
  assert.deepEqual(decorationsOf("timber"), ["sign", "roof", "lanterns"]);
});

test("tornEdge: deterministic per seed, inside the paper, close to its sides", () => {
  assert.equal(hashString("abc"), hashString("abc"));
  assert.notEqual(hashString("abc"), hashString("abd"));
  assert.ok(hashString("") > 0);
  const a = tornEdge(42);
  assert.deepEqual(a, tornEdge(42));
  assert.notDeepEqual(a, tornEdge(43));
  assert.equal(a.length, 12 * 4 * 2);
  for ( const v of a ) assert.ok((v >= 0) && (v <= 1), v);
  // Every point lies near the outline: within 7% of some side.
  for ( let i = 0; i < a.length; i += 2 ) {
    const [x, y] = [a[i], a[i + 1]];
    assert.ok(Math.min(x, y, 1 - x, 1 - y) <= 0.07, `${x},${y}`);
  }
});

test("circuitPath: from pin to pin in straight and 45° runs", () => {
  const cases = [[{ x: 0, y: 0 }, { x: 300, y: 100 }], [{ x: 50, y: 400 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: -200, y: -40 }],
    [{ x: 10, y: 10 }, { x: 110, y: 10 }], [{ x: 0, y: 0 }, { x: 100, y: 100 }]];
  for ( const [p1, p2] of cases ) {
    const pts = circuitPath(p1, p2);
    assert.deepEqual(pts[0], p1);
    assert.deepEqual(pts[pts.length - 1], p2);
    assert.ok(pts.length <= 4);
    for ( let i = 1; i < pts.length; i++ ) {
      const dx = Math.abs(pts[i].x - pts[i - 1].x);
      const dy = Math.abs(pts[i].y - pts[i - 1].y);
      assert.ok((dx < 1e-9) || (dy < 1e-9) || (Math.abs(dx - dy) < 1e-9), `segment ${dx},${dy}`);
    }
  }
});

test("densify and pointAlong follow the polyline", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
  assert.equal(polylineLength(pts), 150);
  const dense = densify(pts, 15);
  assert.deepEqual(dense[0], pts[0]);
  assert.deepEqual(dense[dense.length - 1], pts[2]);
  assert.ok(dense.some(p => (p.x === 100) && (p.y === 0)), "keeps the corner");
  assert.deepEqual(pointAlong(pts, 0), { x: 0, y: 0 });
  assert.deepEqual(pointAlong(pts, 0.5), { x: 75, y: 0 });
  assert.deepEqual(pointAlong(pts, 1), { x: 100, y: 50 });
});

test("parchment tile is deterministic and seamless", () => {
  const size = 128;
  const a = parchment(size, 3);
  assert.deepEqual(a, parchment(size, 3));
  const col = (i, j) => {
    let sum = 0;
    for ( let k = 0; k < size; k++ ) for ( let c = 0; c < 3; c++ ) sum += Math.abs(a[(((k * size) + i) * 4) + c] - a[(((k * size) + j) * 4) + c]);
    return sum / (size * 3);
  };
  let inside = 0;
  for ( let i = 0; i < size - 1; i++ ) inside += col(i, i + 1);
  inside /= size - 1;
  assert.ok(col(size - 1, 0) <= (inside * 1.6) + 1);
});
