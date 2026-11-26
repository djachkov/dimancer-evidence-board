import { MODULE_ID, BOARD_DEFAULTS, DEFAULT_THUMB, TEMPLATES, t } from "./constants.mjs";
import { isBoard, boardSettings } from "./permissions.mjs";
import { DEFAULT_SURFACE, defaultFrameColor, getSurface, surfaceFlag, validColor } from "./surface-presets.mjs";
import { boardStyle, registerSurfaceHooks, surfaceChoices, surfaceOf } from "./surfaces.mjs";
import { bindStyleFields, styleFieldsData } from "./style-fields.mjs";
import { promptNewBoard, registerCreateDefaults, setPlaceholderColor } from "./create-board-dialog.mjs";
import { getEvidenceJournal, openEvidenceJournal } from "./journal-store.mjs";

const OWNER = () => CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

/* -------------------------------------------- */
/*  Thumbnails                                  */
/* -------------------------------------------- */

/** Core appends "?<timestamp>" to a thumb it has just changed. */
const isDefaultThumb = thumb => !!thumb && (thumb.split("?")[0] === DEFAULT_THUMB);

/** Whether any of the scene's Levels has a background image, which core can make a thumbnail of. */
const hasBackground = scene => !!scene.levels?.some(l => l.background?.src);

/** Core's thumbnail of the scene's background and tiles, or null if it can't make one here. */
async function generateThumb(scene) {
  if ( game.settings.get("core", "noCanvas") || !hasBackground(scene) ) return null;
  const level = scene.initialLevel?.background?.src ? scene.initialLevel : scene.levels.find(l => l.background?.src);
  try {
    return (await scene.createThumbnail({ level })).thumb;
  } catch(err) {
    console.warn(`${MODULE_ID} | thumbnail for ${scene.name}`, err);
    return null;
  }
}

/**
 * A board that has only its surface gets the default thumbnail. Once it gets a background image
 * (here or in the Scene configuration, which only makes a thumbnail for a scene without one),
 * replace the default with core's thumbnail of it.
 */
async function onUpdateScene(scene, changed, options, userId) {
  if ( (userId !== game.user.id) || !("levels" in changed) ) return;
  if ( !isBoard(scene) || !isDefaultThumb(scene.thumb) ) return;
  const thumb = await generateThumb(scene);
  if ( thumb ) await scene.update({ thumb });
}

/** Boards made before thumbnails existed, with no background to make one from, get the default. */
async function backfillThumbs() {
  if ( game.user !== game.users.activeGM ) return;
  const updates = game.scenes
    .filter(s => isBoard(s) && !s.thumb && !hasBackground(s))
    .map(s => ({ _id: s.id, thumb: DEFAULT_THUMB }));
  if ( updates.length ) await Scene.implementation.updateDocuments(updates);
}

/**
 * Scene data for a new, empty board.
 * @param {string} name
 * @param {object} [options]
 * @param {string|null} [options.surface]  A surface preset id ("plain" for a flat colour), null for none
 * @param {string} [options.color]         The colour of a plain board
 * @param {string|null} [options.frame]   The border colour (null: the surface's own)
 * @param {string} [options.surround]      The colour around the board (the Level's background colour)
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {object} [options.style]         Card, pin and thread styles (absent: the surface's theme)
 * @param {object} [options.decor]         Decorations
 */
export function boardSceneData(name, {
  surface = DEFAULT_SURFACE, color = BOARD_DEFAULTS.color, frame = null, surround = BOARD_DEFAULTS.surround,
  width = BOARD_DEFAULTS.width, height = BOARD_DEFAULTS.height, style, decor
} = {}) {
  const board = { version: 1, locked: false, surface: surfaceFlag(surface, { color, frame }) };
  if ( style ) board.style = style;
  if ( decor ) board.decor = decor;
  const levelId = foundry.documents.BaseScene.metadata.defaultLevelId;
  return {
    name,
    width,
    height,
    padding: BOARD_DEFAULTS.padding,
    grid: { type: CONST.GRID_TYPES.GRIDLESS },
    levels: [{ _id: levelId, name, background: { color: surround } }],
    initialLevel: levelId,
    tokenVision: false,
    fog: { mode: CONST.FOG_EXPLORATION_MODES.DISABLED },
    environment: { globalLight: { enabled: true }, darknessLevel: 0 },
    navigation: true,
    // Its surface is drawn by this module, not a Level background, so core can't make a thumbnail of it.
    thumb: DEFAULT_THUMB,
    ownership: { default: OWNER() },
    flags: { [MODULE_ID]: { board, cards: {} } }
  };
}

/** Ask for a name, surface, size and colours, create a board scene and open it. */
export async function createBoard({ folder } = {}) {
  const choice = await promptNewBoard();
  if ( !choice ) return null;
  const data = boardSceneData(choice.name || t("Scene.DefaultName"), choice);
  if ( folder ) data.folder = folder;
  const scene = await Scene.implementation.create(data);
  await scene?.view();
  return scene;
}

/**
 * Turn an existing scene into a board, keeping everything else about it. A scene with a background
 * keeps (or gets) core's thumbnail of it, and "Generate Thumbnail" keeps working; one without
 * gets the default thumbnail.
 */
export async function convertToBoard(scene) {
  const update = { [`flags.${MODULE_ID}`]: { board: { version: 1, locked: false }, cards: {} } };
  if ( !scene.thumb ) {
    const thumb = hasBackground(scene) ? await generateThumb(scene) : DEFAULT_THUMB;
    if ( thumb ) update.thumb = thumb;
  }
  await scene.update(update);
  ui.notifications.info(t("Scene.Converted", { name: scene.name }));
}

/** Stop treating a scene as a board. Its cards are deleted, so confirm first. */
export async function removeBoard(scene) {
  const count = Object.keys(scene.flags?.[MODULE_ID]?.cards ?? {}).length;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("Scene.RemoveTitle") },
    content: `<p>${t("Scene.RemoveConfirm", { name: foundry.utils.escapeHTML(scene.name), count })}</p>`
  });
  if ( !ok ) return;
  const update = { [`flags.${MODULE_ID}`]: _del };
  if ( isDefaultThumb(scene.thumb) ) update.thumb = null;
  await scene.update(update);
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/** A "Create Board" button next to "Create Scene" in the Scenes sidebar (GMs only see it). */
function onRenderSceneDirectory(app, element) {
  if ( !game.user.isGM ) return;
  const actions = element.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".dimancer-board-create") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dimancer-board-create";
  button.innerHTML = `<i class="fa-solid fa-thumbtack" inert></i><span>${t("Scene.CreateButton")}</span>`;
  button.addEventListener("click", () => createBoard());
  actions.append(button);
}

/** An "Evidence Journal" button in the Journal sidebar: opens it (a GM creates it on first use). */
function onRenderJournalDirectory(app, element) {
  const entry = getEvidenceJournal();
  if ( !game.user.isGM && !entry?.visible ) return;
  const actions = element.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".dimancer-board-journal-open") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dimancer-board-journal-open";
  button.innerHTML = `<i class="fa-solid fa-magnifying-glass" inert></i><span>${t(entry ? "Journal.Open" : "Journal.Create")}</span>`;
  button.addEventListener("click", () => openEvidenceJournal());
  actions.append(button);
}

function onGetSceneContextOptions(app, entries) {
  const sceneOf = li => game.scenes.get(li.dataset.entryId);
  entries.push({
    label: "DIMANCER_BOARD.Scene.Convert",
    icon: '<i class="fa-solid fa-thumbtack"></i>',
    visible: li => game.user.isGM && !isBoard(sceneOf(li)),
    onClick: (event, li) => convertToBoard(sceneOf(li))
  }, {
    label: "DIMANCER_BOARD.Scene.Remove",
    icon: '<i class="fa-solid fa-thumbtack-slash"></i>',
    visible: li => game.user.isGM && isBoard(sceneOf(li)),
    onClick: (event, li) => removeBoard(sceneOf(li))
  });
}

/** A "Board" fieldset at the top of the Basics tab of a board scene's configuration. */
async function onRenderSceneConfig(app, element) {
  const scene = app.document;
  if ( !isBoard(scene) ) return;
  const tab = element.querySelector('.tab[data-tab="basics"]');
  if ( !tab || tab.querySelector(".dimancer-board-config") ) return;
  const current = surfaceOf(scene);
  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATES.sceneConfig, {
    locked: boardSettings(scene).locked,
    surfaces: surfaceChoices().map(s => ({ ...s, selected: s.id === current.id })),
    // The stored plain colour (kept while another surface is shown), not the current texture's tone.
    plainColor: validColor(scene.flags[MODULE_ID]?.board?.surface?.color, getSurface("plain").color),
    frame: current.frame ?? "",
    defaultFrame: defaultFrameColor(current) ?? "",
    rootId: app.id,
    style: (() => {
      const { decor, ...style } = boardStyle(scene);
      return styleFieldsData(style, decor, `flags.${MODULE_ID}.board.`);
    })()
  });
  tab.insertAdjacentHTML("afterbegin", html);
  // The border picker shows the surface's own frame colour until one is chosen.
  const fieldset = tab.querySelector(".dimancer-board-config");
  const select = fieldset.querySelector('select[name$="surface.id"]');
  const plain = fieldset.querySelector('color-picker[name$="surface.color"]');
  const border = fieldset.querySelector('color-picker[name$="surface.frame"]');
  const syncBorder = () => setPlaceholderColor(border, defaultFrameColor({ id: select.value, color: plain.value }) ?? "");
  select.addEventListener("change", syncBorder);
  plain.addEventListener("change", syncBorder);
  // Choosing another surface switches the styles to its theme and offers its frame's decorations.
  const styleFields = bindStyleFields(fieldset, () => select.value || null);
  select.addEventListener("change", () => styleFields.surfaceChanged());
  app.setPosition?.();
}

export function registerSceneHooks() {
  registerCreateDefaults();
  registerSurfaceHooks();
  Hooks.on("renderSceneDirectory", onRenderSceneDirectory);
  Hooks.on("renderJournalDirectory", onRenderJournalDirectory);
  Hooks.on("getSceneContextOptions", onGetSceneContextOptions);
  Hooks.on("renderSceneConfig", onRenderSceneConfig);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.once("ready", backfillThumbs);
}
