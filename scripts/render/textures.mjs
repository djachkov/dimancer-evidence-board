import { parchment } from "../surface-presets.mjs";

/**
 * Small textures shared by everything the board styles draw, each made once per session.
 */

/** RGBA bytes → a canvas element. */
export function rgbaCanvas(data, size) {
  const el = document.createElement("canvas");
  el.width = el.height = size;
  el.getContext("2d").putImageData(new ImageData(data, size, size), 0, 0);
  return el;
}

/** Make a texture tile: repeat, with mipmaps so a zoomed-out board doesn't shimmer. */
export function makeRepeating(texture) {
  const base = texture?.baseTexture;
  if ( !base ) return texture;
  base.wrapMode = PIXI.WRAP_MODES.REPEAT;
  base.mipmap = PIXI.MIPMAP_MODES.ON;
  return texture;
}

const cache = new Map();
const once = (key, make) => {
  let tex = cache.get(key);
  if ( !tex || tex.baseTexture?.destroyed ) cache.set(key, tex = make());
  return tex;
};

/** A canvas of this size drawn by fn, as a texture. */
function canvasTexture(width, height, fn) {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  fn(el.getContext("2d"), width, height);
  return PIXI.Texture.from(el);
}

/** Parchment for cards (512 px tile). */
export const parchmentTexture = () => once("parchment", () => makeRepeating(PIXI.Texture.from(rgbaCanvas(parchment(512, 7), 512))));

/** Dark horizontal scanlines over transparency, one line every 4 px. */
export const scanlineTexture = () => once("scanlines", () => makeRepeating(canvasTexture(4, 4, (ctx) => {
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, 2, 4, 1);
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(0, 0, 4, 1);
})));

/** A soft white disc fading to nothing, for glows (tint it). */
export const glowTexture = () => once("glow", () => canvasTexture(128, 128, (ctx, w) => {
  const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, "rgba(255, 255, 255, 1)");
  g.addColorStop(0.35, "rgba(255, 255, 255, 0.45)");
  g.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
}));

/** A horizontal band brightest in the middle, fading up and down (tint it). */
export const bandTexture = () => once("band", () => canvasTexture(4, 64, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(255, 255, 255, 0)");
  g.addColorStop(0.85, "rgba(255, 255, 255, 0.7)");
  g.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}));
