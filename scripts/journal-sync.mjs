import { MODULE_ID } from "./constants.mjs";
import { cardUpdate } from "./cards.mjs";
import { canEditCard, getCard, isBoard } from "./permissions.mjs";
import { cardPatchFromPage, pageItem, pagePatchFromCard } from "./journal-pages.mjs";
import {
  boardPlacements, canEditPage, isEvidenceJournal, isEvidencePage, pageOfCard, refreshJournalViews, setPageHidden,
  unlinkCards, unlinkMissingPages
} from "./journal-store.mjs";

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

/**
 * Who unlinks cards after a deletion: the active GM, who can change every board, or, with no GM
 * online, the user who deleted it (as far as they can).
 */
function unlinksAfterDelete(userId) {
  const gm = game.users.activeGM;
  return gm ? gm.isSelf : (userId === game.user.id);
}

/** A page was deleted: the cards that showed it become plain cards. */
async function onDeletePage(page, options, userId) {
  if ( !isEvidencePage(page) ) return;
  refreshSheets();
  if ( unlinksAfterDelete(userId) ) await unlinkCards(uuid => uuid === page.uuid);
}

/**
 * A journal was deleted: its pages go with it (without their own delete hooks), so the cards that
 * showed any of them become plain cards that can be filed into another journal.
 */
async function onDeleteJournal(entry, options, userId) {
  if ( !isEvidenceJournal(entry) ) return;
  refreshJournalViews();
  if ( !unlinksAfterDelete(userId) ) return;
  const prefix = `${entry.uuid}.`;
  await unlinkCards(uuid => uuid.startsWith(prefix));
}

export function registerJournalSync() {
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("updateJournalEntryPage", onUpdatePage);
  Hooks.on("deleteJournalEntryPage", onDeletePage);
  Hooks.on("createJournalEntryPage", page => isEvidencePage(page) && refreshSheets());
  Hooks.on("updateJournalEntry", entry => isEvidenceJournal(entry) && refreshJournalViews());
  // Journals coming and going (or access to them changing) can change anyone's default journal.
  Hooks.on("createJournalEntry", entry => isEvidenceJournal(entry) && refreshJournalViews());
  Hooks.on("deleteJournalEntry", onDeleteJournal);
  Hooks.on("updateUser", (user, changed) => user.isSelf && foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`) && refreshJournalViews());
  Hooks.on("deleteScene", refreshSheets);
  // Cards left linked to journals deleted before this cleanup existed (or while no GM was online).
  Hooks.once("ready", () => game.users.activeGM?.isSelf && unlinkMissingPages());
}
