import { MODULE_ID, t } from "./constants.mjs";
import { isBoard } from "./permissions.mjs";
import { SURFACES, getSurface, normalizeSurface, randomSeed, frameColor, frameWidth } from "./surface-presets.mjs";
import { normalizeDecor, normalizeStyle } from "./styles.mjs";
import { makeRepeating, rgbaCanvas } from "./render/textures.mjs";
import { drawDecorations, drawFrame } from "./render/decor.mjs";
import { setAnimation } from "./render/animation.mjs";

/**
 * The board on the canvas: a framed panel at the very bottom of the primary group. The panel is one
 * repeating tile (an image, or a procedurally generated one) drawn as a single TilingSprite, or a
 * flat colour; the frame (render/decor.mjs, in the surface's frame style) sits just outside the
 * scene rectangle and casts a soft shadow onto the padding, whose colour is the Level's own
 * background colour (the "surrounding colour"). A quest-board or cyberpunk frame can carry
 * decorations in the padding (a sign, a roof, lanterns; a HUD header, corner brackets).
 *
 * It sorts below the Level's background mesh, so a background image set in the Scene configuration
 * covers the panel (inside the frame), and Foundry's background stays the way to use a custom image.
 */

const FLAG_SURFACE = `flags.${MODULE_ID}.board.surface`;
const FLAG_DECOR = `flags.${MODULE_ID}.board.decor`;

/** The normalised surface of a scene: {id, seed, color}, id null for none. */
export function surfaceOf(scene) {
  return normalizeSurface(scene?.flags?.[MODULE_ID]?.board?.surface);
}

/**
 * How a board's cards, pins and threads look, and its decorations. A board that never chose a
 * style takes its surface's theme.
 * @returns {{cards: string, pins: string, threads: string, decor: object}}
 */
export function boardStyle(scene) {
  const board = scene?.flags?.[MODULE_ID]?.board;
  return { ...normalizeStyle(board?.style, surfaceOf(scene).id), decor: normalizeDecor(board?.decor) };
}

/* -------------------------------------------- */
/*  Textures                                    */
/* -------------------------------------------- */

/** @type {Map<string, Promise<PIXI.Texture|null>>} Per id:seed, for the session. */
const textures = new Map();
/** @type {Map<string, string>} Thumbnail data URLs for procedural presets. */
const thumbs = new Map();

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
    thumb: thumbnails ? surfaceThumb(p) : null,
    theme: p.theme,
    frameStyle: p.frameStyle
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
  setAnimation("surface", null);
  if ( panel && !panel.destroyed ) {
    panel.parent?.removeChild(panel);
    // Texts own their textures; everything else here is shared and cached.
    for ( const text of panel.texts ?? [] ) if ( !text.destroyed ) text.destroy(true);
    // Textures are cached and shared, so keep them.
    panel.destroy({ children: true, texture: false, baseTexture: false });
  }
  panel = null;
}

const toNumber = hex => Number.parseInt(hex.slice(1), 16);

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
  const full = canvas.dimensions.rect;
  const frame = frameColor(surface);
  const container = new PIXI.Container();
  container.name = `${MODULE_ID}.surface`;
  container.eventMode = "none";
  container.addChild(drawFrame(r, frame, preset.frameStyle, { texture }));

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

  // Decorations go in the padding around the frame, over the panel's edge.
  const { decor } = boardStyle(scene);
  const deco = drawDecorations(r, {
    frameStyle: preset.frameStyle, color: frame, decor, texture,
    text: decor.signText || scene.name,
    room: { top: r.y - full.y, left: r.x - full.x }
  });
  if ( deco ) {
    container.addChild(deco.container);
    container.texts = deco.container.texts;
    if ( deco.animate ) setAnimation("surface", deco.animate);
  }

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
  if ( scene !== canvas.scene ) return;
  const has = path => foundry.utils.hasProperty(changed, path);
  // The sign and HUD show the board's name unless they have their own text.
  const renamed = ("name" in changed) && !boardStyle(scene).decor.signText;
  if ( has(FLAG_SURFACE) || has(FLAG_DECOR) || renamed ) drawSurface();
}

export function registerSurfaceHooks() {
  Hooks.on("drawPrimaryCanvasGroup", () => drawSurface());
  Hooks.on("tearDownPrimaryCanvasGroup", () => removePanel());
  Hooks.on("preUpdateScene", onPreUpdateScene);
  Hooks.on("updateScene", onUpdateScene);
}
