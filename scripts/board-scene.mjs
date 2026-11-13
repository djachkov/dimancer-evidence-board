import { MODULE_ID, BOARD_DEFAULTS, TEMPLATES, t } from "./constants.mjs";
import { isBoard, boardSettings } from "./permissions.mjs";
import { DEFAULT_SURFACE, defaultFrameColor, getSurface, surfaceFlag, validColor } from "./surface-presets.mjs";
import { registerSurfaceHooks, surfaceChoices, surfaceOf } from "./surfaces.mjs";
import { promptNewBoard, registerCreateDefaults, setPlaceholderColor } from "./create-board-dialog.mjs";
import { getEvidenceJournal, openEvidenceJournal } from "./journal-store.mjs";

const OWNER = () => CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

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
 */
export function boardSceneData(name, {
  surface = DEFAULT_SURFACE, color = BOARD_DEFAULTS.color, frame = null, surround = BOARD_DEFAULTS.surround,
  width = BOARD_DEFAULTS.width, height = BOARD_DEFAULTS.height
} = {}) {
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
    ownership: { default: OWNER() },
    flags: { [MODULE_ID]: { board: { version: 1, locked: false, surface: surfaceFlag(surface, { color, frame }) }, cards: {} } }
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

/** Turn an existing scene into a board, keeping everything else about it. */
export async function convertToBoard(scene) {
  await scene.update({ [`flags.${MODULE_ID}`]: { board: { version: 1, locked: false }, cards: {} } });
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
  await scene.update({ [`flags.${MODULE_ID}`]: _del });
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
    rootId: app.id
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
  app.setPosition?.();
}

export function registerSceneHooks() {
  registerCreateDefaults();
  registerSurfaceHooks();
  Hooks.on("renderSceneDirectory", onRenderSceneDirectory);
  Hooks.on("renderJournalDirectory", onRenderJournalDirectory);
  Hooks.on("getSceneContextOptions", onGetSceneContextOptions);
  Hooks.on("renderSceneConfig", onRenderSceneConfig);
}
