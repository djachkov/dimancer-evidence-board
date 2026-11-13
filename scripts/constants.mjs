export const MODULE_ID = "dimancer_board";
export const SOCKET = `module.${MODULE_ID}`;

/** Flag paths on a board Scene. */
export const FLAG_BOARD = `flags.${MODULE_ID}.board`;
export const FLAG_CARDS = `flags.${MODULE_ID}.cards`;
export const FLAG_LINKS = `flags.${MODULE_ID}.links`;
export const FLAG_CATEGORIES = `flags.${MODULE_ID}.categories`;
export const FLAG_FOLDERS = `flags.${MODULE_ID}.folders`;

/** Defaults for a newly created board scene. */
export const BOARD_DEFAULTS = Object.freeze({
  width: 4000,
  height: 3000,
  padding: 0.1,
  /** A plain board's colour */
  color: "#9c7650",
  /** The colour around a board: a dark wall */
  surround: "#3b3633"
});

/** Long side, in scene pixels, of a newly pinned image. */
export const NEW_CARD_SIZE = 300;

/** Where uploaded evidence goes, relative to the "data" file source. */
export const uploadDir = () => `worlds/${game.world.id}/dimancer-board`;

export const TEMPLATES = Object.freeze({
  categoryManager: `modules/${MODULE_ID}/templates/category-manager.hbs`,
  addEvidence: `modules/${MODULE_ID}/templates/add-evidence.hbs`,
  sceneConfig: `modules/${MODULE_ID}/templates/scene-config.hbs`,
  createBoard: `modules/${MODULE_ID}/templates/create-board.hbs`,
  evidenceJournal: `modules/${MODULE_ID}/templates/evidence-journal.hbs`
});

/** i18n helper. */
export const t = (key, data) => data ? game.i18n.format(`DIMANCER_BOARD.${key}`, data) : game.i18n.localize(`DIMANCER_BOARD.${key}`);
