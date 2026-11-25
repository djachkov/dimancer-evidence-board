import { MODULE_ID, t } from "./constants.mjs";
import { PEN_WIDTHS } from "./stickers.mjs";
import { inkColors, noteColors } from "./styles.mjs";

/**
 * The small floating bar shown while the Note or Draw tool is active: paper colour for new notes,
 * or ink colour, pen width and undo for drawing. The colours come from the board's card style; the
 * choices are remembered per browser, the colours per style.
 */

const KEY = `${MODULE_ID}.pen`;

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch(err) {
    return {};
  }
}

/** The pen and paper to use on a board of this card style. */
export function penPrefs(style = "classic") {
  const saved = readPrefs();
  // Colours are kept per style; an older single colour counts for whichever style offers it.
  const pick = (value, list) => {
    const v = (value && (typeof value === "object")) ? value[style] : value;
    return list.some(c => c.color === v) ? v : list[0].color;
  };
  return {
    ink: pick(saved.ink, inkColors(style)),
    width: PEN_WIDTHS.some(w => w.width === saved.width) ? saved.width : PEN_WIDTHS[1].width,
    paper: pick(saved.paper, noteColors(style))
  };
}

function savePrefs(style, group, value) {
  const saved = readPrefs();
  if ( group === "width" ) saved.width = value;
  else {
    const per = (saved[group] && (typeof saved[group] === "object")) ? saved[group] : {};
    per[style] = value;
    saved[group] = per;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch(err) { /* private mode: the choice just isn't remembered */ }
}

let bar = null;

export function closePenBar() {
  bar?.remove();
  bar = null;
}

/**
 * @param {"note"|"draw"} tool
 * @param {{onUndo: Function, style?: string}} options   style: the board's card style
 */
export function showPenBar(tool, { onUndo, style = "classic" }) {
  closePenBar();
  const prefs = penPrefs(style);
  const swatch = (c, group, key, active) => `<button type="button" class="swatch${active ? " active" : ""}"
    data-pen="${group}" data-value="${c.color}" style="--swatch: ${c.color}"
    aria-label="${t(`${key}.${c.key}`)}" data-tooltip="${t(`${key}.${c.key}`)}"></button>`;
  let html;
  if ( tool === "note" ) {
    html = `<span class="mb-pen-label">${t("Sticker.Paper")}</span>
      ${noteColors(style).map(c => swatch(c, "paper", "Sticker.PaperColor", c.color === prefs.paper)).join("")}
      <span class="mb-pen-hint">${t("Sticker.NoteHint")}</span>`;
  } else {
    html = `${inkColors(style).map(c => swatch(c, "ink", "Sticker.InkColor", c.color === prefs.ink)).join("")}
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
    savePrefs(style, group, value);
    for ( const b of bar.querySelectorAll(`[data-pen="${group}"]`) ) b.classList.toggle("active", b === button);
  });
  document.body.append(bar);
}
