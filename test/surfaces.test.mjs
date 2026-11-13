import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SURFACES, getSurface, normalizeSurface, surfaceFlag, fbm, mulberry32, DEFAULT_SURFACE, frameColor, defaultFrameColor, shadeColor,
  validColor, boardSize, frameWidth, BOARD_SIZES, DEFAULT_SIZE, SIZE_LIMITS
} from "../scripts/surface-presets.mjs";

const procedural = SURFACES.filter(p => p.kind === "procedural");

test("every preset has an id, label, colours, tile, and an image or a generator", () => {
  assert.equal(new Set(SURFACES.map(p => p.id)).size, SURFACES.length);
  for ( const p of SURFACES ) {
    assert.match(p.color, /^#[0-9a-f]{6}$/, p.id);
    assert.ok(p.label, p.id);
    assert.ok(p.tile > 0, p.id);
    if ( p.kind === "image" ) assert.match(p.src, /^modules\/dimancer_board\/assets\/surfaces\/.+\.webp$/, p.id);
    else if ( p.kind === "procedural" ) assert.equal(typeof p.generate, "function", p.id);
    else assert.equal(p.kind, "color", p.id);
    if ( p.kind !== "color" ) assert.match(p.frame, /^#[0-9a-f]{6}$/, p.id);
  }
  assert.ok(getSurface(DEFAULT_SURFACE));
});

test("generators are deterministic per seed and fill the tile", () => {
  for ( const p of procedural ) {
    const a = p.generate(64, 7);
    assert.equal(a.length, 64 * 64 * 4, p.id);
    assert.deepEqual(a, p.generate(64, 7), p.id);
    assert.notDeepEqual(a, p.generate(64, 8), p.id);
    for ( let i = 3; i < a.length; i += 4 ) assert.equal(a[i], 255);
  }
});

/** Mean absolute difference between two pixel columns (or rows) of an RGBA tile. */
function edgeDiff(data, size, horizontal, i, j) {
  let sum = 0;
  for ( let k = 0; k < size; k++ ) {
    const p = horizontal ? ((k * size) + i) * 4 : ((i * size) + k) * 4;
    const q = horizontal ? ((k * size) + j) * 4 : ((j * size) + k) * 4;
    for ( let c = 0; c < 3; c++ ) sum += Math.abs(data[p + c] - data[q + c]);
  }
  return sum / (size * 3);
}

test("generated tiles are seamless: the wrap seam is no rougher than the inside", () => {
  const size = 128;
  for ( const p of procedural ) {
    const data = p.generate(size, 3);
    for ( const horizontal of [true, false] ) {
      const seam = edgeDiff(data, size, horizontal, size - 1, 0);
      let inside = 0;
      for ( let i = 0; i < size - 1; i++ ) inside += edgeDiff(data, size, horizontal, i, i + 1);
      inside /= size - 1;
      assert.ok(seam <= (inside * 1.6) + 1, `${p.id} ${horizontal ? "left/right" : "top/bottom"} seam ${seam.toFixed(2)} vs ${inside.toFixed(2)}`);
    }
  }
});

test("fbm wraps exactly at the tile edge", () => {
  const size = 64;
  const f = fbm(size, mulberry32(5), { cells: 4, octaves: 3 });
  // Continuing one pixel past the right edge must land back on column 0: compare the step
  // across the seam with steps inside.
  let seam = 0;
  let inside = 0;
  for ( let y = 0; y < size; y++ ) {
    seam += Math.abs(f[(y * size) + size - 1] - f[y * size]);
    inside += Math.abs(f[(y * size) + 1] - f[y * size]);
  }
  assert.ok(seam < inside * 2, `${seam} vs ${inside}`);
});

test("normalizeSurface", () => {
  const none = { id: null, seed: 1, color: null, frame: null };
  assert.deepEqual(normalizeSurface(undefined), none);
  assert.deepEqual(normalizeSurface({ id: "nope" }), none);
  assert.deepEqual(normalizeSurface({ id: "" }), none);
  assert.deepEqual(normalizeSurface({ id: "cork-002" }), { id: "cork-002", seed: 1, color: "#af8265", frame: null });
  assert.equal(normalizeSurface({ id: "cork-002", frame: "#000000" }).frame, "#000000");
  assert.equal(normalizeSurface({ id: "cork-002", frame: "" }).frame, null);
  assert.deepEqual(normalizeSurface({ id: "whiteboard", seed: 42 }).seed, 42);
  assert.deepEqual(normalizeSurface({ id: "whiteboard", seed: -3 }).seed, 1);
  assert.equal(normalizeSurface({ id: "plain", color: "#12AB34" }).color, "#12ab34");
  assert.equal(normalizeSurface({ id: "plain", color: "red" }).color, getSurface("plain").color);
});

test("surfaceFlag seeds procedural surfaces only", () => {
  assert.deepEqual(surfaceFlag(null), { id: null });
  assert.deepEqual(surfaceFlag("cork-001"), { id: "cork-001" });
  assert.deepEqual(surfaceFlag("plain", { color: "#102030" }), { id: "plain", color: "#102030" });
  assert.deepEqual(surfaceFlag("plain"), { id: "plain", color: getSurface("plain").color });
  assert.deepEqual(surfaceFlag("kraft", { frame: "#ABCDEF" }), { id: "kraft", frame: "#abcdef" });
  assert.deepEqual(surfaceFlag("kraft", { frame: "" }), { id: "kraft" });
  const flag = surfaceFlag("chalkboard");
  assert.equal(flag.id, "chalkboard");
  assert.ok(Number.isInteger(flag.seed) && flag.seed > 0);
});

test("frames: preset colours, a darker shade for plain boards, none without a surface", () => {
  assert.equal(frameColor({ id: "whiteboard" }), getSurface("whiteboard").frame);
  assert.equal(frameColor({ id: "plain", color: "#ffffff" }), shadeColor("#ffffff", -0.45));
  assert.equal(frameColor({ id: null }), null);
  assert.equal(frameColor({ id: "whiteboard", frame: "#112233" }), "#112233");
  assert.equal(frameColor({ id: "whiteboard", frame: "" }), getSurface("whiteboard").frame);
  assert.equal(frameColor({ id: null, frame: "#112233" }), null);
  assert.equal(defaultFrameColor({ id: "whiteboard", frame: "#112233" }), getSurface("whiteboard").frame);
  assert.equal(shadeColor("#808080", -1), "#000000");
  assert.equal(shadeColor("#808080", 1), "#ffffff");
  assert.equal(validColor("#ABCDEF", "#000000"), "#abcdef");
  assert.equal(validColor("nope", "#000000"), "#000000");
  assert.equal(frameWidth(4000, 3000), 36);
  assert.equal(frameWidth(100, 100), 16);
  assert.equal(frameWidth(100000, 100000), 64);
});

test("board sizes: presets, clamped custom sizes", () => {
  assert.ok(BOARD_SIZES.some(s => s.id === DEFAULT_SIZE));
  assert.deepEqual(boardSize("large"), { width: 6000, height: 4500 });
  assert.deepEqual(boardSize(null, "5000", 2500.4), { width: 5000, height: 2500 });
  assert.deepEqual(boardSize("custom", 10, 99999), { width: SIZE_LIMITS.min, height: SIZE_LIMITS.max });
  assert.deepEqual(boardSize(null, "abc", ""), { width: SIZE_LIMITS.min, height: SIZE_LIMITS.min });
});
