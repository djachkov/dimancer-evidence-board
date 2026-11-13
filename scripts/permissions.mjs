import { MODULE_ID } from "./constants.mjs";
import { normalizeCard } from "./cards.mjs";

/** Is this Scene an evidence board? */
export function isBoard(scene) {
  return !!scene?.flags?.[MODULE_ID]?.board;
}

/** The board settings of a board Scene. */
export function boardSettings(scene) {
  return { version: 1, locked: false, ...(scene?.flags?.[MODULE_ID]?.board ?? {}) };
}

/** The raw card map of a board Scene. */
export function boardCards(scene) {
  return scene?.flags?.[MODULE_ID]?.cards ?? {};
}

/** One normalized card, or null. */
export function getCard(scene, id) {
  const raw = boardCards(scene)[id];
  return raw && (typeof raw === "object") ? normalizeCard(raw, id) : null;
}

/**
 * Can the user change the board at all? They need to be able to update the Scene (OWNER), and a
 * locked board is GM-only.
 */
export function canEditBoard(scene, user = game.user) {
  if ( !isBoard(scene) ) return false;
  if ( !scene.canUserModify(user, "update") ) return false;
  return user.isGM || !boardSettings(scene).locked;
}

/** Can the user move, resize, rename or delete this card? Locked cards are GM-only. */
export function canEditCard(scene, card, user = game.user) {
  if ( !card || !canEditBoard(scene, user) ) return false;
  return user.isGM || !card.locked;
}

/** Can the user see this card? Hidden cards are GM-only. */
export function canSeeCard(card, user = game.user) {
  return !!card && (user.isGM || !card.hidden);
}

/** The raw thread map of a board Scene. */
export function boardLinks(scene) {
  return scene?.flags?.[MODULE_ID]?.links ?? {};
}

/** The raw folder map of a board Scene. */
export function boardFolders(scene) {
  return scene?.flags?.[MODULE_ID]?.folders ?? {};
}

/** The raw category map of a board Scene, or undefined while it still uses the defaults. */
export function boardCategoriesRaw(scene) {
  return scene?.flags?.[MODULE_ID]?.categories;
}
