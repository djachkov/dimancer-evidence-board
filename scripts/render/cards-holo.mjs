import { noteColors } from "../styles.mjs";
import { isPdfDocument } from "../pdf-preview.mjs";
import { scanlineTexture } from "./textures.mjs";
import { placeDocument, placePhoto, placeTitle } from "./cards-classic.mjs";
import { shade } from "./threads.mjs";
import { NODE_COLOR } from "./pins.mjs";
import { CARD_LOOKS } from "./card-look.mjs";

/**
 * Holographic cards for a cyberpunk board: dark translucent panels with two corners cut off, a neon
 * rim in the card's category colour (cyan without one), scanlines over pictures, documents as
 * terminal windows, notes as small panels lit in their colour.
 */

const LOOK = CARD_LOOKS.holo;
const MONO = LOOK.fonts.note;
const PANEL = LOOK.paper;

/** The card's accent: its category's colour, or the default neon. */
function accentOf(obj) {
  const category = obj.layer.categories?.get(obj.card.category);
  return category ? Number.parseInt(category.color.slice(1), 16) : NODE_COLOR;
}

/** A box with its top-left and bottom-right corners cut off. */
function chamfered(left, top, fw, fh, c) {
  return [left + c, top, left + fw, top, left + fw, top + fh - c, left + fw - c, top + fh, left, top + fh, left, top + c];
}

const cutOf = ({ fw, fh }) => Math.max(4, Math.min(fw, fh) * 0.07);
const offset = (pts, dx, dy) => pts.map((v, i) => v + ((i % 2) ? dy : dx));

/** A glow around the panel instead of a drop shadow, and the panel itself. */
function panel(obj, pts, color, { fill = PANEL, alpha = 0.9, line }) {
  obj.shadow.beginFill(0x000000, 0.35).drawPolygon(offset(pts, 4, 7)).endFill()
    .lineStyle({ width: line * 7, color, alpha: 0.06, join: PIXI.LINE_JOIN.MITER }).drawPolygon(pts)
    .lineStyle({ width: line * 3.5, color, alpha: 0.12, join: PIXI.LINE_JOIN.MITER }).drawPolygon(pts)
    .lineStyle(0);
  obj.frame.lineStyle({ width: line, color, alpha: 0.95, join: PIXI.LINE_JOIN.MITER }).beginFill(fill, alpha).drawPolygon(pts).endFill().lineStyle(0);
}

/** Scanlines over a rectangle of the card (the picture), no mask needed. */
function scanlines(obj, x, y, w, h) {
  const o = obj.overlay;
  o.texture = scanlineTexture();
  o.visible = true;
  o.position.set(x, y);
  o.width = w;
  o.height = h;
  o.alpha = 0.45;
  const k = Math.max(1, Math.min(w, h) / 320);
  o.tileScale.set(k, k);
}

/** Corner ticks just outside a rectangle. */
function ticks(g, x, y, w, h, len, gap, width, color) {
  g.lineStyle({ width, color, alpha: 1 });
  for ( const [cx, cy, sx, sy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x + w, y + h, 1, 1], [x, y + h, -1, 1]] ) {
    const px = cx + (sx * gap);
    const py = cy + (sy * gap);
    g.moveTo(px - (sx * len), py).lineTo(px, py).lineTo(px, py - (sy * len));
  }
  g.lineStyle(0);
}

export default {
  id: "holo",
  fonts: LOOK.fonts,
  colors: LOOK.colors,
  tabText: color => shade(color, 0.55),
  /** Note text glows in the note's own colour. */
  noteText: color => shade(color, 0.35),
  noteEditor: color => ({ paper: "#07101a", ink: color, font: MONO }),

  /** A picture on a dark panel, under scanlines, with corner ticks and its title in the strip. */
  photo(obj, L) {
    const { w, h, pad, left, top, fw, fh } = L;
    const color = accentOf(obj);
    panel(obj, chamfered(left, top, fw, fh, cutOf(L)), color, { line: Math.max(1.5, pad * 0.14) });
    placePhoto(obj, w, h, { tint: LOOK.photoTint, placeholder: [0x1a2a3a, 0x2f4d66] });
    if ( obj.hasTexture ) scanlines(obj, -w / 2, -h / 2, w, h);
    ticks(obj.clip, -w / 2, -h / 2, w, h, pad * 1.4, pad * 0.35, Math.max(1.2, pad * 0.12), color);
    // A rule between the picture and the title strip.
    obj.frame.lineStyle({ width: 1, color, alpha: 0.35 }).moveTo(left + pad, (h / 2) + (pad * 0.6)).lineTo(left + fw - pad, (h / 2) + (pad * 0.6)).lineStyle(0);
    placeTitle(obj, L, { size: 0.38 });
  },

  /** A terminal window: a title bar, the text in monospace, more pages as panels stacked behind. */
  document(obj, L) {
    const { w, h, left, top, fw, fh } = L;
    const color = accentOf(obj);
    const c = cutOf(L);
    const pts = chamfered(left, top, fw, fh, c);
    const count = Math.max(1, isPdfDocument(obj.card) ? obj.pdfPages : obj.card.docPages.length);
    for ( let i = Math.min(count - 1, 2); i >= 1; i-- ) {
      obj.frame.lineStyle({ width: 1.5, color, alpha: 0.35, join: PIXI.LINE_JOIN.MITER }).beginFill(PANEL, 0.7)
        .drawPolygon(offset(pts, i * w * 0.03, i * h * 0.02)).endFill().lineStyle(0);
    }
    panel(obj, pts, color, { fill: LOOK.docPaper, alpha: 0.94, line: Math.max(1.5, w * 0.01) });
    const { pad, body, pdf } = placeDocument(obj, L, { tint: LOOK.docTint });
    if ( pdf && obj.hasTexture ) {
      scanlines(obj, -obj.sprite.width / 2, -obj.sprite.height / 2, obj.sprite.width, obj.sprite.height);
      return;
    }
    // The title bar, with three window lights at its right.
    const bar = Math.max(c, pad + obj.docTitle.height + (body * 0.25));
    obj.frame.beginFill(color, 0.14).drawPolygon([left + c, top, left + fw, top, left + fw, top + bar, left, top + bar, left, top + c]).endFill()
      .lineStyle({ width: 1, color, alpha: 0.5 }).moveTo(left, top + bar).lineTo(left + fw, top + bar).lineStyle(0);
    const dot = Math.max(1.5, body * 0.35);
    for ( let i = 0; i < 3; i++ ) obj.clip.beginFill(color, 0.9 - (i * 0.25)).drawCircle(left + fw - (pad * 0.5) - (i * dot * 3), top + (pad * 0.5), dot).endFill();
  },

  /** A small dark panel lit in the note's colour. */
  note(obj, L) {
    const { left, top, fw, fh } = L;
    const color = Number.parseInt((obj.card.color ?? noteColors("holo")[0].color).slice(1), 16);
    const c = cutOf(L);
    panel(obj, chamfered(left, top, fw, fh, c), color, { line: Math.max(1.5, fw * 0.012) });
    obj.frame.beginFill(color, 0.16).drawPolygon([left + c, top, left + fw, top, left + fw, top + (fh * 0.12), left, top + (fh * 0.12), left, top + c]).endFill();
  },

  /** The category as a lit label chip. */
  tab(g, { x, y, w, h }, color) {
    const c = h * 0.35;
    const pts = [x + c, y, x + w, y, x + w, y + h + 6, x, y + h + 6, x, y + c];
    g.lineStyle({ width: Math.max(1, h * 0.08), color, alpha: 1, join: PIXI.LINE_JOIN.MITER }).beginFill(PANEL, 0.95).drawPolygon(pts).endFill()
      .lineStyle(0).beginFill(color, 0.2).drawPolygon(pts).endFill();
  }
};
