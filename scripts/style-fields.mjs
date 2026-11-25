import { t } from "./constants.mjs";
import { CARD_STYLES, DECORATIONS, PIN_STYLES, SIGN_MAX, THEMES, THREAD_STYLES, decorationsOf } from "./styles.mjs";
import { getSurface } from "./surface-presets.mjs";

/**
 * The style fields shared by the Create Board dialog and a board's scene configuration
 * (templates/style-fields.hbs): card, pin and thread styles, decorations and the sign text.
 */

/**
 * Data for the style fields.
 * @param {{cards: string, pins: string, threads: string}} style
 * @param {object} decor      Normalised decorations
 * @param {string} prefix     Prepended to every field name ("" or "flags.dimancer_board.board.")
 */
export function styleFieldsData(style, decor, prefix = "") {
  const options = (list, group, current) => list.map(s => ({ id: s.id, label: t(`Style.${group}.${s.id}`), selected: s.id === current }));
  const decorations = Object.entries(DECORATIONS).flatMap(([frame, ids]) => ids.map(id => ({ id, frame, label: t(`Decor.${id}`), checked: decor[id] })));
  return {
    prefix,
    cards: options(CARD_STYLES, "Cards", style.cards),
    pins: options(PIN_STYLES, "Pins", style.pins),
    threads: options(THREAD_STYLES, "Threads", style.threads),
    decorations,
    animate: decor.animate,
    signText: decor.signText,
    signMax: SIGN_MAX
  };
}

/**
 * Keep the style fields in step with the chosen surface: show only the decorations its frame can
 * have, and (when the surface changes) switch the styles to its theme.
 * @param {HTMLElement} root         Element holding the style fields
 * @param {() => string|null} surfaceId   The surface chosen right now
 * @returns {{surfaceChanged: Function, sync: Function}}
 */
export function bindStyleFields(root, surfaceId) {
  const fields = root.querySelector(".mb-style-fields");
  if ( !fields ) return { surfaceChanged: () => {}, sync: () => {} };
  const select = part => fields.querySelector(`select[name$="style.${part}"]`);
  const sync = () => {
    const frame = getSurface(surfaceId())?.frameStyle ?? "bevel";
    const offered = decorationsOf(frame);
    for ( const el of fields.querySelectorAll("[data-frame]") ) el.hidden = !el.dataset.frame.split(" ").includes(frame);
    // Animate only means something with a moving part: node pins, data lines, lanterns, a neon frame.
    const moving = (select("pins").value === "node") || (select("threads").value === "dataline") || ["timber", "neon"].includes(frame);
    fields.querySelector(".mb-decor-animate").hidden = !moving;
    const any = offered.length || moving;
    fields.querySelector(".mb-decor").hidden = !any;
    fields.querySelector(".mb-decor-hint").hidden = !offered.length;
  };
  const surfaceChanged = () => {
    const theme = THEMES[getSurface(surfaceId())?.theme] ?? THEMES.classic;
    for ( const part of ["cards", "pins", "threads"] ) select(part).value = theme[part];
    sync();
  };
  fields.addEventListener("change", sync);
  sync();
  return { surfaceChanged, sync };
}

/** Read the style fields of a form: {style, decor}. */
export function readStyleFields(form, prefix = "") {
  const el = name => form.elements[`${prefix}${name}`];
  const decor = { signText: el("decor.signText")?.value.trim() ?? "", animate: !!el("decor.animate")?.checked };
  for ( const id of Object.values(DECORATIONS).flat() ) decor[id] = !!el(`decor.${id}`)?.checked;
  return {
    style: { cards: el("style.cards").value, pins: el("style.pins").value, threads: el("style.threads").value },
    decor
  };
}
