import { test } from "node:test";
import assert from "node:assert/strict";
import { fit, fitScale, zoomAt, zoomTo, pan, clampPan, actualSize, minScale, MAX_SCALE } from "../scripts/viewport.mjs";

const image = { width: 2000, height: 1000 };
const viewport = { width: 800, height: 600 };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} ${a} ≈ ${b}`);

/** The image point shown at viewport point (px, py). */
const imagePointAt = (view, px, py) => ({ x: (px - view.x) / view.scale, y: (py - view.y) / view.scale });

test("fit scales to the tighter axis and centres", () => {
  const v = fit(image, viewport);
  close(v.scale, 0.4);
  close(v.x, 0);
  close(v.y, 100, "letterboxed vertically");
});

test("fit never upscales past 2x", () => {
  close(fitScale({ width: 10, height: 10 }, viewport), 2);
});

test("zoomAt keeps the image point under the cursor fixed", () => {
  const start = { scale: 1, x: -300, y: -100 };
  const before = imagePointAt(start, 250, 400);
  const after = zoomAt(start, 1.5, 250, 400, image, viewport);
  close(after.scale, 1.5);
  const p = imagePointAt(after, 250, 400);
  close(p.x, before.x);
  close(p.y, before.y);
});

test("zoom is clamped between min and max", () => {
  const v = fit(image, viewport);
  close(zoomTo(v, 100, 0, 0, image, viewport).scale, MAX_SCALE);
  close(zoomTo(v, 0.0001, 0, 0, image, viewport).scale, minScale(image, viewport));
});

test("clampPan keeps the image over the middle of the viewport", () => {
  const small = clampPan({ scale: 0.1, x: 999, y: -999 }, image, viewport);
  close(small.x, 400, "left edge at most at the middle");
  close(small.y, 300 - 100, "bottom edge at least at the middle");
  const inside = clampPan({ scale: 0.1, x: 300, y: 250 }, image, viewport);
  close(inside.x, 300, "a position over the middle stays where it is");
  close(inside.y, 250);
  const big = clampPan({ scale: 1, x: 500, y: -5000 }, image, viewport);
  close(big.x, 400, "left edge comes in by at most half the viewport");
  close(big.y, 300 - 1000, "bottom edge comes in by at most half the viewport");
  const covered = clampPan({ scale: 1, x: -300, y: -200 }, image, viewport);
  close(covered.x, -300, "a covering position is left alone");
  close(covered.y, -200);
});

test("zooming off-centre on a page narrower than the viewport keeps the point under the cursor", () => {
  // A portrait page fitted into a wide box (it's centred, with room either side).
  const page = { width: 720, height: 932 };
  const box = { width: 443, height: 260 };
  let v = fit(page, box);
  const px = v.x + (0.3 * page.width * v.scale);
  const py = v.y + (0.3 * page.height * v.scale);
  const before = imagePointAt(v, px, py);
  // …through many notches, past the point where the page is wider than the box.
  for ( let i = 0; i < 8; i++ ) {
    v = zoomAt(v, 1.3, px, py, page, box);
    const after = imagePointAt(v, px, py);
    close(after.x, before.x, `notch ${i}`);
    close(after.y, before.y, `notch ${i}`);
  }
});

test("pan moves by the delta within bounds", () => {
  const v = pan({ scale: 1, x: -100, y: -100 }, -50, 20, image, viewport);
  close(v.x, -150);
  close(v.y, -80);
});

test("actualSize goes to 100% around the viewport centre", () => {
  const v = fit(image, viewport);
  const centreBefore = imagePointAt(v, 400, 300);
  const a = actualSize(v, image, viewport);
  close(a.scale, 1);
  const centreAfter = imagePointAt(a, 400, 300);
  close(centreAfter.x, centreBefore.x);
  close(centreAfter.y, centreBefore.y);
});
