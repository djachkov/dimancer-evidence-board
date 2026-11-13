import { canEditCard, getCard } from "./permissions.mjs";

/**
 * Editing a sticky note's text right on the board: a textarea laid over the note, matching its
 * paper, rotation, zoom and font, so typing looks like writing on the note itself.
 *
 * Enter adds a line; Ctrl/Cmd+Enter or clicking elsewhere saves; Esc discards the typing. A new
 * note stays on the board even when it's left empty, ready to be written or drawn on later.
 */

let current = null;

/** Finish any open editor (saving it). */
export function closeNoteEditor(save = true) {
  return current?.finish(save);
}

/**
 * @param {import("./board-layer.mjs").default} layer
 * @param {string} cardId
 * @param {{isNew?: boolean}} [options]
 */
export async function editNote(layer, cardId, { isNew = false } = {}) {
  await closeNoteEditor(true);
  const scene = layer.scene;
  const obj = layer.cards.get(cardId);
  const card = getCard(scene, cardId);
  if ( !obj || !card || (card.kind !== "note") || !canEditCard(scene, card) ) return;

  const ta = document.createElement("textarea");
  ta.className = "dimancer-board-note-editor";
  ta.value = card.text;
  ta.spellcheck = true;
  ta.setAttribute("aria-label", game.i18n.localize("DIMANCER_BOARD.Sticker.Edit"));
  ta.style.setProperty("--paper", card.color ?? "#fff17a");
  document.body.append(ta);
  obj.editing = true;
  obj.refresh();

  // Same sizing as the note's text on the canvas: start large, shrink until it fits.
  const fit = () => {
    const { width: w, height: h } = obj.card;
    const pad = obj.noteFont.pad;
    let size = Math.max(8, Math.round(w * 0.11));
    // Measure the text's own height: collapsed, scrollHeight is just padding + content.
    ta.style.padding = `${pad}px`;
    ta.style.height = "0px";
    for ( let i = 0; i < 16; i++ ) {
      ta.style.fontSize = `${size}px`;
      ta.style.lineHeight = `${Math.round(size * 1.25)}px`;
      if ( (ta.scrollHeight <= h) || (size <= 8) ) break;
      size = Math.max(8, Math.floor(size * 0.9));
    }
    const content = ta.scrollHeight - (2 * pad);
    ta.style.height = `${h}px`;
    // Centre the text vertically, as on the canvas.
    ta.style.paddingTop = `${Math.max(pad, (h - content) / 2)}px`;
  };

  const place = () => {
    if ( obj.destroyed ) return finish(false);
    const { x, y, width: w, height: h, rotation } = obj.card;
    const rect = canvas.app.view.getBoundingClientRect();
    const c = canvas.clientCoordinatesFromCanvas({ x: x + (w / 2), y: y + (h / 2) });
    Object.assign(ta.style, {
      left: `${rect.left + c.x}px`,
      top: `${rect.top + c.y}px`,
      width: `${w}px`,
      height: `${h}px`,
      transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${canvas.stage.scale.x})`
    });
  };

  let done = false;
  const panHook = Hooks.on("canvasPan", place);
  const finish = async save => {
    if ( done ) return;
    done = true;
    if ( current?.ta === ta ) current = null;
    Hooks.off("canvasPan", panHook);
    const text = ta.value.replace(/\s+$/, "");
    ta.remove();
    if ( !obj.destroyed ) {
      obj.editing = false;
      obj.refresh();
    }
    const latest = getCard(scene, cardId);
    if ( !latest ) return;
    if ( save && (text !== latest.text) ) await layer.patchCard(cardId, { text });
  };
  current = { ta, finish };

  ta.addEventListener("input", fit);
  ta.addEventListener("keydown", event => {
    event.stopPropagation();   // keep Foundry's keybindings (Delete, WASD…) out of the text
    if ( event.key === "Escape" ) {
      event.preventDefault();
      finish(false);
    } else if ( (event.key === "Enter") && (event.ctrlKey || event.metaKey) ) {
      event.preventDefault();
      finish(true);
    }
  });
  // Wheel over the note still zooms the board.
  // (Core only zooms when the wheel is over the canvas element itself.)
  ta.addEventListener("wheel", event => {
    const dy = event.deltaY || (event.shiftKey ? event.deltaX : 0);
    if ( !dy ) return;
    event.preventDefault();
    event.delta = dy;
    canvas._onMouseWheel(event);
  }, { passive: false });

  place();
  fit();
  // Opened from a press on the canvas (double-click): the browser moves focus away once that
  // press is handled, so focus (and start listening for blur) only after it.
  await new Promise(resolve => setTimeout(resolve, 0));
  if ( done ) return;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener("blur", () => finish(true));
}
