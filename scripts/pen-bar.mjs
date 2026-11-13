import { MODULE_ID, t } from "./constants.mjs";
import { INK_COLORS, NOTE_COLORS, PEN_WIDTHS } from "./stickers.mjs";

/**
 * The small floating bar shown while the Note or Draw tool is active: paper colour for new notes,
 * or ink colour, pen width and undo for drawing. The choices are remembered per browser.
 */

const KEY = `${MODULE_ID}.pen`;
const DEFAULTS = { ink: INK_COLORS[0].color, width: PEN_WIDTHS[1].width, paper: NOTE_COLORS[0].color };

export function penPrefs() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch(err) {
    saved = {};
  }
  return {
    ink: INK_COLORS.some(c => c.color === saved.ink) ? saved.ink : DEFAULTS.ink,
    width: PEN_WIDTHS.some(w => w.width === saved.width) ? saved.width : DEFAULTS.width,
    paper: NOTE_COLORS.some(c => c.color === saved.paper) ? saved.paper : DEFAULTS.paper
  };
}

function savePrefs(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...penPrefs(), ...patch }));
  } catch(err) { /* private mode: the choice just isn't remembered */ }
}

let bar = null;

export function closePenBar() {
  bar?.remove();
  bar = null;
}

/**
 * @param {"note"|"draw"} tool
 * @param {{onUndo: Function}} handlers
 */
export function showPenBar(tool, { onUndo }) {
  closePenBar();
  const prefs = penPrefs();
  const swatch = (c, group, key, active) => `<button type="button" class="swatch${active ? " active" : ""}"
    data-pen="${group}" data-value="${c.color}" style="--swatch: ${c.color}"
    aria-label="${t(`${key}.${c.key}`)}" data-tooltip="${t(`${key}.${c.key}`)}"></button>`;
  let html;
  if ( tool === "note" ) {
    html = `<span class="mb-pen-label">${t("Sticker.Paper")}</span>
      ${NOTE_COLORS.map(c => swatch(c, "paper", "Sticker.PaperColor", c.color === prefs.paper)).join("")}
      <span class="mb-pen-hint">${t("Sticker.NoteHint")}</span>`;
  } else {
    html = `${INK_COLORS.map(c => swatch(c, "ink", "Sticker.InkColor", c.color === prefs.ink)).join("")}
      <span class="mb-pen-sep"></span>
      ${PEN_WIDTHS.map(w => `<button type="button" class="mb-pen-width${w.width === prefs.width ? " active" : ""}"
        data-pen="width" data-value="${w.width}" style="--dot: ${Math.max(4, w.width)}px"
        aria-label="${t(`Sticker.Width.${w.key}`)}" data-tooltip="${t(`Sticker.Width.${w.key}`)}"><span></span></button>`).join("")}
      <span class="mb-pen-sep"></span>
      <button type="button" class="icon fa-solid fa-rotate-left" data-pen="undo"
        aria-label="${t("Sticker.Undo")}" data-tooltip="${t("Sticker.Undo")}"></button>`;
  }
  bar = document.createElement("div");
  bar.id = "dimancer-board-pen";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", t(tool === "note" ? "Controls.Note" : "Controls.Draw"));
  bar.innerHTML = html;
  bar.addEventListener("click", event => {
    const button = event.target.closest("button[data-pen]");
    if ( !button ) return;
    const group = button.dataset.pen;
    if ( group === "undo" ) return onUndo();
    const value = group === "width" ? Number(button.dataset.value) : button.dataset.value;
    savePrefs({ [group]: value });
    for ( const b of bar.querySelectorAll(`[data-pen="${group}"]`) ) b.classList.toggle("active", b === button);
  });
  document.body.append(bar);
}
