import { parchment } from "./surface-presets.mjs";
import { rgbaCanvas } from "./render/textures.mjs";

/** The parchment of quest-board cards (the board's own texture), as a CSS image, made once. */
let parchmentImage = null;
export function parchmentCss() {
  parchmentImage ??= `url("${rgbaCanvas(parchment(512, 7), 512).toDataURL("image/webp", 0.85)}")`;
  return parchmentImage;
}
