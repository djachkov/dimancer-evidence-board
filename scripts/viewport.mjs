/**
 * Pure zoom/pan maths for the Evidence Journal's zoomable picture.
 *
 * The image is drawn at `translate(x, y) scale(scale)` with its origin at the top-left of the
 * viewport, so a viewport point (px, py) shows image point ((px - x) / scale, (py - y) / scale).
 *
 * @typedef {{scale: number, x: number, y: number}} View
 * @typedef {{width: number, height: number}} Size
 */

export const MAX_SCALE = 8;

/** The scale that fits the whole image into the viewport (never upscaling past 2×). */
export function fitScale(image, viewport) {
  if ( !(image.width > 0) || !(image.height > 0) ) return 1;
  return Math.min(viewport.width / image.width, viewport.height / image.height, 2);
}

/** The smallest allowed scale: half of "fit", but never more than 1. */
export function minScale(image, viewport) {
  return Math.min(fitScale(image, viewport) / 2, 1);
}

/** The view that fits and centres the image. */
export function fit(image, viewport) {
  return centre({ scale: fitScale(image, viewport), x: 0, y: 0 }, image, viewport);
}

/** The view at 100%, centred on the point of the image currently in the middle of the viewport. */
export function actualSize(view, image, viewport) {
  return zoomTo(view, 1, viewport.width / 2, viewport.height / 2, image, viewport);
}

function centre(view, image, viewport) {
  return {
    scale: view.scale,
    x: (viewport.width - (image.width * view.scale)) / 2,
    y: (viewport.height - (image.height * view.scale)) / 2
  };
}

/**
 * Zoom to an absolute scale, keeping the image point under (px, py) fixed.
 * @returns {View}
 */
export function zoomTo(view, scale, px, py, image, viewport) {
  const s = Math.min(Math.max(scale, minScale(image, viewport)), MAX_SCALE);
  const k = s / view.scale;
  return clampPan({ scale: s, x: px - ((px - view.x) * k), y: py - ((py - view.y) * k) }, image, viewport);
}

/** Zoom by a factor (e.g. 1.2 in, 1/1.2 out) around (px, py). */
export function zoomAt(view, factor, px, py, image, viewport) {
  return zoomTo(view, view.scale * factor, px, py, image, viewport);
}

/** Move the view by (dx, dy) viewport pixels. */
export function pan(view, dx, dy, image, viewport) {
  return clampPan({ ...view, x: view.x + dx, y: view.y + dy }, image, viewport);
}

/**
 * Keep the image on screen: it always covers the middle of the viewport. That's all; pulling it
 * back to the middle, or its edge back to the viewport's, would drag the point under the cursor
 * away while zooming in. (Zooming in with the cursor on the image never needs to move it, since
 * the image only grows around the cursor.) Fit centres it again.
 * @returns {View}
 */
export function clampPan(view, image, viewport) {
  const axis = (pos, imageLen, viewLen) => {
    const len = imageLen * view.scale;
    return Math.min(viewLen / 2, Math.max((viewLen / 2) - len, pos));
  };
  return {
    scale: view.scale,
    x: axis(view.x, image.width, viewport.width),
    y: axis(view.y, image.height, viewport.height)
  };
}
