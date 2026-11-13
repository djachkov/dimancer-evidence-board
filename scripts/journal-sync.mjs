import { MODULE_ID } from "./constants.mjs";
import { cardUpdate } from "./cards.mjs";
import { canEditCard, getCard, isBoard } from "./permissions.mjs";
import { cardPatchFromPage, pageItem, pagePatchFromCard } from "./journal-pages.mjs";
import { boardPlacements, canEditPage, isEvidenceJournal, isEvidencePage, pageOfCard, setPageHidden } from "./journal-store.mjs";

/**
 * Keeps board cards and their Evidence Journal pages in step (POC).
 *
 * A linked card carries a copy of its page's title, image, notes and hidden state. Whoever changes
 * one side writes the other, on their own client, as far as they're allowed: a card edited on a
 * board updates its page, and a page edited in the journal updates every card showing it on the
 * boards that user can edit. The diffs only carry what differs, so the echo of a mirrored write is
 * empty and nothing bounces.
 */

const MIRRORED_CARD_KEYS = ["title", "src", "notes", "hidden", "docPages"];

/** Re-render open evidence journal sheets (placements and contents change from several places). */
const refreshSheets = foundry.utils.debounce(() => {
  for ( const app of foundry.applications.instances.values() ) {
    if ( app.isEvidenceJournalSheet && app.rendered ) app.render();
  }
}, 50);

/** A board card was edited here: carry content changes over to its page. */
async function onUpdateScene(scene, changed, options, userId) {
  const cards = changed.flags?.[MODULE_ID]?.cards;
  if ( !cards || !isBoard(scene) ) return;
  refreshSheets();
  if ( (userId !== game.user.id) || options.dimancerMirror ) return;
  for ( const [id, delta] of Object.entries(cards) ) {
    if ( !delta || (typeof delta !== "object") ) continue;
    if ( !MIRRORED_CARD_KEYS.some(k => k in delta) ) continue;
    const card = getCard(scene, id);
    const page = pageOfCard(card);
    if ( !page ) continue;
    const { update, hidden } = pagePatchFromCard(pageItem(page), card);
    try {
      if ( !foundry.utils.isEmpty(update) && canEditPage(page) ) await page.update(update);
      if ( (hidden !== undefined) && game.user.isGM ) await setPageHidden(page, hidden);
    } catch(err) {
      console.warn(`${MODULE_ID} | journal sync`, err);
    }
  }
}

/** A page was edited here: update the cards showing it, on every board this user can edit. */
async function onUpdatePage(page, changed, options, userId) {
  if ( !isEvidencePage(page) || !isEvidenceJournal(page.parent) ) return;
  refreshSheets();
  if ( userId !== game.user.id ) return;
  if ( !["name", "src", "system", "ownership"].some(k => k in changed) ) return;
  const item = pageItem(page);
  const byScene = new Map();
  for ( const p of boardPlacements().get(page.uuid) ?? [] ) {
    const scene = game.scenes.get(p.sceneId);
    const card = scene && getCard(scene, p.cardId);
    if ( !card ) continue;
    // A GM may always change a card; others only cards they can edit.
    if ( !game.user.isGM && !canEditCard(scene, card) ) continue;
    const patch = cardPatchFromPage(card, item);
    if ( foundry.utils.isEmpty(patch) ) continue;
    if ( !byScene.has(scene) ) byScene.set(scene, {});
    Object.assign(byScene.get(scene), cardUpdate(card.id, patch));
  }
  for ( const [scene, update] of byScene ) {
    try {
      await scene.update(update, { dimancerMirror: true });
    } catch(err) {
      console.warn(`${MODULE_ID} | journal sync`, err);
    }
  }
}

/** A page was deleted here: the cards that showed it become plain cards. */
async function onDeletePage(page, options, userId) {
  if ( !isEvidencePage(page) ) return;
  refreshSheets();
  if ( userId !== game.user.id ) return;
  for ( const p of boardPlacements().get(page.uuid) ?? [] ) {
    const scene = game.scenes.get(p.sceneId);
    const card = scene && getCard(scene, p.cardId);
    if ( card && (game.user.isGM || canEditCard(scene, card)) ) {
      await scene.update(cardUpdate(card.id, { page: null }), { dimancerMirror: true });
    }
  }
}

export function registerJournalSync() {
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("updateJournalEntryPage", onUpdatePage);
  Hooks.on("deleteJournalEntryPage", onDeletePage);
  Hooks.on("createJournalEntryPage", page => isEvidencePage(page) && refreshSheets());
  Hooks.on("updateJournalEntry", entry => isEvidenceJournal(entry) && refreshSheets());
  Hooks.on("deleteScene", refreshSheets);
}
