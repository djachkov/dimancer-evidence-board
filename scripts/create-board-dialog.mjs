import { MODULE_ID, BOARD_DEFAULTS, TEMPLATES, t } from "./constants.mjs";
import {
  BOARD_SIZES, DEFAULT_SIZE, DEFAULT_SURFACE, SIZE_LIMITS, boardSize, defaultFrameColor, frameColor, frameWidth, getSurface,
  shadeColor, validColor
} from "./surface-presets.mjs";
import { surfaceChoices } from "./surfaces.mjs";

/**
 * The Create Board dialog: name, surface (a scrollable list with a thumbnail per option), size,
 * board and surrounding colours, and a live preview of the framed board on its surround.
 */

const SETTING = "createDefaults";

export function registerCreateDefaults() {
  game.settings.register(MODULE_ID, SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
}

/** What the last board was created with, so the next one starts there. */
function lastChoice() {
  const saved = game.settings.get(MODULE_ID, SETTING) ?? {};
  const size = (saved.size === "custom") || BOARD_SIZES.some(s => s.id === saved.size) ? saved.size : DEFAULT_SIZE;
  const dims = boardSize(size === "custom" ? null : size, saved.width ?? BOARD_DEFAULTS.width, saved.height ?? BOARD_DEFAULTS.height);
  return {
    surface: getSurface(saved.surface)?.id ?? DEFAULT_SURFACE,
    color: validColor(saved.color, BOARD_DEFAULTS.color),
    frame: validColor(saved.frame, null),
    surround: validColor(saved.surround, BOARD_DEFAULTS.surround),
    size,
    ...dims
  };
}

/**
 * Show a colour as a color-picker's placeholder: its text field's hint and its swatch, while the
 * picker itself is empty.
 */
export function setPlaceholderColor(picker, color) {
  if ( !picker ) return;
  picker.setAttribute("placeholder", color);
  const text = picker.querySelector('input[type="text"]');
  if ( text ) text.placeholder = color;
  const swatch = picker.querySelector('input[type="color"]');
  if ( swatch && !picker.value ) swatch.value = color || "#000000";
}

/** Read the form into a choice. */
function readForm(form) {
  const els = form.elements;
  const size = els.size.value;
  return {
    name: els.name.value.trim(),
    surface: els.surface.value,
    color: els.color.value,
    frame: validColor(els.frame.value, null),
    surround: els.surround.value,
    size,
    ...boardSize(size === "custom" ? null : size, els.width.value, els.height.value)
  };
}

/** Redraw the preview from the form. */
function updatePreview(root) {
  const form = root.querySelector("form") ?? root;
  const choice = readForm(form);
  const radio = form.querySelector('input[name="surface"]:checked');
  const box = root.querySelector(".mb-create-preview");
  const board = root.querySelector(".mb-preview-board");
  if ( !radio || !box || !board ) return;

  // The plain option's thumbnail follows the board colour.
  const plainThumb = form.querySelector('input[name="surface"][value="plain"] + .mb-surface-thumb');
  if ( plainThumb ) plainThumb.style.backgroundColor = choice.color;

  // Fit the board, with room for its frame and shadow, into the preview box.
  const margin = 22;
  const scale = Math.min((box.clientWidth - (margin * 2)) / choice.width, (box.clientHeight - (margin * 2)) / choice.height);
  const kind = radio.dataset.kind;
  const surface = { id: radio.value, color: choice.color, frame: choice.frame };
  const frame = frameColor(surface);
  // An empty border picker shows (and follows) the surface's own frame colour.
  setPlaceholderColor(form.querySelector('color-picker[name="frame"]'), defaultFrameColor(surface));
  const border = Math.max(3, frameWidth(choice.width, choice.height) * scale);
  box.style.backgroundColor = choice.surround;
  Object.assign(board.style, {
    width: `${Math.round(choice.width * scale)}px`,
    height: `${Math.round(choice.height * scale)}px`,
    borderWidth: `${border}px`,
    borderColor: `${shadeColor(frame, 0.12)} ${shadeColor(frame, -0.1)} ${shadeColor(frame, -0.2)} ${shadeColor(frame, 0.05)}`,
    backgroundColor: kind === "color" ? choice.color : radio.dataset.color,
    backgroundImage: radio.dataset.thumb ? `url("${radio.dataset.thumb}")` : "none",
    backgroundSize: `${Math.max(4, Number(radio.dataset.tile) * scale)}px`
  });
  const body = root.querySelector(".mb-create");
  body?.classList.toggle("plain", kind === "color");
  body?.classList.toggle("custom", choice.size === "custom");
}

/**
 * Ask for everything a new board needs.
 * @returns {Promise<{name, surface, color, surround, size, width, height}|null>}
 */
export async function promptNewBoard() {
  const last = lastChoice();
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.createBoard, {
    name: t("Scene.DefaultName"),
    surfaces: surfaceChoices({ thumbnails: true }).map(s => ({
      ...s,
      color: s.kind === "color" ? last.color : s.color,
      checked: s.id === last.surface
    })),
    sizes: [
      ...BOARD_SIZES.map(s => ({ id: s.id, label: t("Size.Option", { name: t(`Size.${s.id}`), width: s.width, height: s.height }) })),
      { id: "custom", label: t("Size.custom") }
    ].map(s => ({ ...s, selected: s.id === last.size })),
    width: last.width,
    height: last.height,
    limits: SIZE_LIMITS,
    color: last.color,
    frame: last.frame ?? "",
    surround: last.surround
  });
  const choice = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("Scene.CreateTitle"), icon: "fa-solid fa-thumbtack" },
    classes: ["dimancer-board-create-dialog"],
    position: { width: 600 },
    content,
    ok: {
      label: t("Scene.Create"),
      icon: "fa-solid fa-thumbtack",
      callback: (event, button) => readForm(button.form)
    },
    render: (event, dialog) => {
      const root = dialog.element;
      root.querySelector(".mb-create")?.addEventListener("input", () => updatePreview(root));
      root.querySelector(".mb-create")?.addEventListener("change", () => updatePreview(root));
      // Back to the surface's own frame colour.
      root.querySelector(".mb-frame-reset")?.addEventListener("click", () => {
        root.querySelector('color-picker[name="frame"]').value = "";
      });
      root.querySelector('input[name="surface"]:checked')?.closest("label")?.scrollIntoView({ block: "nearest" });
      requestAnimationFrame(() => updatePreview(root));
    },
    rejectClose: false
  });
  if ( !choice || (typeof choice !== "object") ) return null;
  const { name, ...remembered } = choice;
  await game.settings.set(MODULE_ID, SETTING, remembered);
  return choice;
}
