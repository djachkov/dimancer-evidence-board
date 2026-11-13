import { t } from "./constants.mjs";
import { emit } from "./socket.mjs";
import { getCard } from "./permissions.mjs";

/**
 * Go to a card on its board: switch to the board scene if needed, then pan to the card, select it
 * and flash it. Used by the Evidence Journal, and on every client when a GM brings everyone there.
 * @param {Scene} scene
 * @param {string} cardId
 * @param {{select?: boolean}} [options]
 */
export async function focusCard(scene, cardId, { select = true } = {}) {
  if ( !scene ) return;
  if ( canvas.scene !== scene ) {
    const ready = new Promise(resolve => Hooks.once("canvasReady", resolve));
    await scene.view();
    if ( !canvas.ready || (canvas.scene !== scene) ) await ready;
  }
  await canvas.board?.panToCard(cardId, { flash: true, select });
}

/**
 * GM: take every connected player to a card (their view switches to its board, pans to it and
 * flashes it), and go there too. Like core's "pull to scene", regardless of their scene permission.
 * @param {Scene} scene
 * @param {string} cardId
 * @param {{users?: string[]|null}} [options]  Only these user ids (default: everyone)
 */
export function focusCardForEveryone(scene, cardId, { users = null } = {}) {
  if ( !game.user.isGM || !scene ) return;
  // Players can't see a hidden card: they land on the board, but nothing is pointed out.
  if ( getCard(scene, cardId)?.hidden ) ui.notifications.warn(t("Journal.JumpHidden"));
  emit("focus", { sceneId: scene.id, cardId, users });
  return focusCard(scene, cardId);
}
