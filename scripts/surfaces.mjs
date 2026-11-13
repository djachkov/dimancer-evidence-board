import { MODULE_ID, t } from "./constants.mjs";
import { isBoard } from "./permissions.mjs";
import { SURFACES, getSurface, normalizeSurface, randomSeed, frameColor, frameWidth, shadeColor } from "./surface-presets.mjs";

/**
 * The board on the canvas: a framed panel at the very bottom of the primary group. The panel is one
 * repeating tile (an image, or a procedurally generated one) drawn as a single TilingSprite, or a
 * flat colour; the frame sits just outside the scene rectangle and casts a soft shadow onto the
 * padding, whose colour is the Level's own background colour (the "surrounding colour").
 *
 * It sorts below the Level's background mesh, so a background image set in the Scene configuration
 * covers the panel (inside the frame), and Foundry's background stays the way to use a custom image.
 */

const FLAG_SURFACE = `flags.${MODULE_ID}.board.surface`;

/** The normalised surface of a scene: {id, seed, color}, id null for none. */
export function surfaceOf(scene) {
  return normalizeSurface(scene?.flags?.[MODULE_ID]?.board?.surface);
}

/* -------------------------------------------- */
/*  Textures                                    */
/* -------------------------------------------- */

/** @type {Map<string, Promise<PIXI.Texture|null>>} Per id:seed, for the session. */
const textures = new Map();
/** @type {Map<string, string>} Thumbnail data URLs for procedural presets. */
const thumbs = new Map();

/** RGBA bytes → a canvas element. */
function rgbaCanvas(data, size) {
  const el = document.createElement("canvas");
  el.width = el.height = size;
  el.getContext("2d").putImageData(new ImageData(data, size, size), 0, 0);
  return el;
}

/** Make a texture tile: repeat, with mipmaps so a zoomed-out board doesn't shimmer. */
function makeRepeating(texture) {
  const base = texture?.baseTexture;
  if ( !base ) return texture;
  base.wrapMode = PIXI.WRAP_MODES.REPEAT;
  base.mipmap = PIXI.MIPMAP_MODES.ON;
  return texture;
}

/**
 * The tile texture of a textured surface (not a plain colour).
 * @returns {Promise<PIXI.Texture|null>}
 */
export function surfaceTexture(id, seed) {
  const preset = getSurface(id);
  if ( !preset || (preset.kind === "color") ) return Promise.resolve(null);
  const key = preset.kind === "procedural" ? `${id}:${seed}` : id;
  if ( !textures.has(key) ) {
    textures.set(key, (async () => {
      if ( preset.kind === "image" ) return makeRepeating(await foundry.canvas.loadTexture(preset.src));
      const el = rgbaCanvas(preset.generate(preset.size, seed), preset.size);
      return makeRepeating(PIXI.Texture.from(el));
    })().catch(err => {
      console.error(`${MODULE_ID} | surface ${key}`, err);
      textures.delete(key);
      return null;
    }));
  }
  return textures.get(key);
}

/** A picture of a surface's tile for pickers (null for a plain colour). */
export function surfaceThumb(preset, size = 160) {
  if ( preset.kind === "image" ) return preset.src;
  if ( preset.kind !== "procedural" ) return null;
  if ( !thumbs.has(preset.id) ) thumbs.set(preset.id, rgbaCanvas(preset.generate(size, 1), size).toDataURL("image/png"));
  return thumbs.get(preset.id);
}

/** Presets for a template: id, label, colours and (optionally) picture. */
export function surfaceChoices({ thumbnails = false } = {}) {
  return SURFACES.map(p => ({
    id: p.id,
    label: t(`Surface.${p.label}`),
    kind: p.kind,
    color: p.color,
    frame: p.frame ?? "",
    tile: p.tile,
    thumb: thumbnails ? surfaceThumb(p) : null
  }));
}

/* -------------------------------------------- */
/*  Canvas                                      */
/* -------------------------------------------- */

/** @type {PIXI.Container|null} */
let panel = null;
/** Guards against an older, slower texture load landing after a newer one. */
let drawToken = 0;

function removePanel() {
  drawToken++;
  if ( panel && !panel.destroyed ) {
    panel.parent?.removeChild(panel);
    // Textures are cached and shared, so keep them.
    panel.destroy({ children: true, texture: false, baseTexture: false });
  }
  panel = null;
}

const toNumber = hex => Number.parseInt(hex.slice(1), 16);

/**
 * The frame and its shadows, around (not over) the rectangle r.
 * @param {PIXI.Rectangle} r
 * @param {string} color
 */
function drawFrame(r, color) {
  const fw = frameWidth(r.width, r.height);
  const g = new PIXI.Graphics();

  // Drop shadow onto the surround: stacked translucent rings, nudged down.
  const spread = fw * 1.4;
  const steps = 10;
  for ( let i = steps; i >= 1; i-- ) {
    const d = fw + (spread * (i / steps));
    g.beginFill(0x000000, 0.045)
      .drawRoundedRect(r.x - d, r.y - d + (fw * 0.35), r.width + (d * 2), r.height + (d * 2), d * 0.5)
      .endFill();
  }

  // The frame: a face with a lit outer edge and a shaded inner lip.
  const outer = new PIXI.Rectangle(r.x - fw, r.y - fw, r.width + (fw * 2), r.height + (fw * 2));
  const ring = (rect, inset, hex) => {
    g.beginFill(toNumber(hex))
      .drawRect(rect.x + inset, rect.y + inset, rect.width - (inset * 2), rect.height - (inset * 2))
      .beginHole()
      .drawRect(r.x, r.y, r.width, r.height)
      .endHole()
      .endFill();
  };
  ring(outer, 0, shadeColor(color, -0.35));
  ring(outer, Math.max(1, fw * 0.06), shadeColor(color, 0.25));
  ring(outer, Math.max(2, fw * 0.16), color);
  ring(outer, fw * 0.78, shadeColor(color, -0.25));
  return g;
}

/** A thin shadow just inside the frame, so the panel sits below it. */
function drawInnerShadow(r) {
  const fw = frameWidth(r.width, r.height);
  const g = new PIXI.Graphics();
  const depth = fw * 0.5;
  const steps = 6;
  for ( let i = 1; i <= steps; i++ ) {
    const d = depth * (i / steps);
    g.lineStyle({ width: depth / steps, color: 0x000000, alpha: 0.05 * (1 - (i / (steps + 1))), alignment: 0 })
      .drawRect(r.x + d, r.y + d, r.width - (d * 2), r.height - (d * 2));
  }
  return g;
}

/** Draw (or redraw) the board panel of the viewed scene. */
export async function drawSurface() {
  removePanel();
  const scene = canvas.scene;
  if ( !isBoard(scene) || !canvas.primary ) return;
  const surface = surfaceOf(scene);
  const preset = getSurface(surface.id);
  if ( !preset ) return;
  const token = drawToken;
  const texture = await surfaceTexture(surface.id, surface.seed);
  if ( (token !== drawToken) || (canvas.scene !== scene) ) return;
  if ( (preset.kind !== "color") && !texture ) return;

  const r = canvas.dimensions.sceneRect;
  const container = new PIXI.Container();
  container.name = `${MODULE_ID}.surface`;
  container.eventMode = "none";
  container.addChild(drawFrame(r, frameColor(surface)));

  let face;
  if ( texture ) face = new PIXI.TilingSprite(texture, r.width, r.height);
  else {
    face = new PIXI.Sprite(PIXI.Texture.WHITE);
    face.width = r.width;
    face.height = r.height;
    face.tint = toNumber(surface.color);
  }
  face.position.set(r.x, r.y);
  container.addChild(face, drawInnerShadow(r));

  // Below everything, the Level background included; the same trick as core's scene padding.
  container.elevation = -Infinity;
  container.sortLayer = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS.SCENE;
  container.sort = -Infinity;
  panel = container;
  canvas.primary.addChild(container);
  canvas.primary.sortDirty = true;
}

/* -------------------------------------------- */
/*  Changing a board's surface                  */
/* -------------------------------------------- */

/**
 * Before a board's surface changes (e.g. from the Scene configuration): give a procedural surface
 * its seed in the same update.
 */
function onPreUpdateScene(scene, changes) {
  if ( !foundry.utils.hasProperty(changes, `${FLAG_SURFACE}.id`) ) return;
  const id = foundry.utils.getProperty(changes, `${FLAG_SURFACE}.id`) || null;
  foundry.utils.setProperty(changes, `${FLAG_SURFACE}.id`, id);
  const preset = getSurface(id);
  if ( (preset?.kind !== "procedural") || foundry.utils.hasProperty(changes, `${FLAG_SURFACE}.seed`) ) return;
  const keep = (surfaceOf(scene).id === id) && Number.isInteger(scene.flags[MODULE_ID]?.board?.surface?.seed);
  if ( !keep ) foundry.utils.setProperty(changes, `${FLAG_SURFACE}.seed`, randomSeed());
}

function onUpdateScene(scene, changed) {
  if ( (scene === canvas.scene) && foundry.utils.hasProperty(changed, FLAG_SURFACE) ) drawSurface();
}

export function registerSurfaceHooks() {
  Hooks.on("drawPrimaryCanvasGroup", () => drawSurface());
  Hooks.on("tearDownPrimaryCanvasGroup", () => removePanel());
  Hooks.on("preUpdateScene", onPreUpdateScene);
  Hooks.on("updateScene", onUpdateScene);
}
