import { NOTE_COLORS } from "../stickers.mjs";
import { isPdfDocument } from "../pdf-preview.mjs";

/**
 * The classic card style of an investigation corkboard: photos in a polaroid frame, text documents
 * on A4 with a paper clip, square sticky notes.
 *
 * A card painter draws into the CardObject's own children (shadow, frame, sprite, clip, the texts…),
 * all in the card's local space, inside the paper box `L` it's given. It never changes that box.
 */

const PAPER = 0xf7f3ea;
const DOC_PAPER = 0xfbfaf5;
const DOC_EDGE = 0xd3ccba;
const DOC_FONT = "Georgia, 'Times New Roman', serif";
const SANS = "Signika, sans-serif";

/** The four corners of the paper turned by `degrees` around the card's centre and nudged by (dx, dy). */
export function turnedSheet({ left, top, fw, fh }, degrees, dx, dy) {
  const a = Math.toRadians(degrees);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [[left, top], [left + fw, top], [left + fw, top + fh], [left, top + fh]]
    .flatMap(([x, y]) => [(x * cos) - (y * sin) + dx, (x * sin) + (y * cos) + dy]);
}

/** The grey crossed-out box shown where a picture couldn't be loaded. */
export function drawPlaceholder(obj, w, h, fill = 0x8c8c8c, line = 0xbdbdbd) {
  obj.placeholder.beginFill(fill).drawRect(-w / 2, -h / 2, w, h).endFill()
    .lineStyle(Math.max(2, w / 60), line)
    .moveTo(-w / 2, -h / 2).lineTo(w / 2, h / 2).moveTo(w / 2, -h / 2).lineTo(-w / 2, h / 2);
}

/** Show the photo sprite at the image's size (or the placeholder). */
export function placePhoto(obj, w, h, { tint = 0xffffff, placeholder } = {}) {
  obj.sprite.visible = !!obj.hasTexture;
  obj.sprite.width = w;
  obj.sprite.height = h;
  obj.sprite.tint = tint;
  if ( !obj.hasTexture ) drawPlaceholder(obj, w, h, ...(placeholder ?? []));
}

/** Put the title on the photo's bottom strip, shrunk to fit. */
export function placeTitle(obj, { h, pad, strip, fw }, { size = 0.45, text = obj.card.title } = {}) {
  const stripY = (h / 2) + (strip / 2) + (pad / 2);
  const fontSize = Math.round(strip * size);
  if ( obj.titleText.style.fontSize !== fontSize ) obj.titleText.style.fontSize = fontSize;
  obj.titleText.visible = true;
  obj.titleText.text = text;
  obj.titleText.position.set(0, stripY);
  obj.titleText.scale.set(1);
  const maxTitle = fw - (2 * pad);
  if ( obj.titleText.width > maxTitle ) obj.titleText.scale.set(maxTitle / obj.titleText.width);
}

/**
 * Show a document's typeset title and first page (or its PDF page) on the sheet.
 * @returns {{pad: number, body: number, pdf: boolean, count: number}}
 */
export function placeDocument(obj, { w, h, left, top, fw, fh }, { tint = 0xffffff } = {}) {
  const pdf = isPdfDocument(obj.card);
  const count = Math.max(1, pdf ? obj.pdfPages : obj.card.docPages.length);
  const { pad, body } = obj.fitDocText(w, h, count);
  if ( pdf && obj.hasTexture ) {
    // The PDF's own first page, fitted onto the sheet: it is the paper.
    const tex = obj.sprite.texture;
    const k = Math.min(fw / tex.width, fh / tex.height);
    obj.sprite.visible = true;
    obj.sprite.tint = tint;
    obj.sprite.width = tex.width * k;
    obj.sprite.height = tex.height * k;
  } else {
    // Typeset: a written document's title and first page (a PDF not read yet shows its title).
    obj.docTitle.visible = true;
    obj.docTitle.position.set(left + pad, top + pad);
    obj.docBody.visible = !pdf;
    obj.docBody.position.set(left + pad, top + pad + obj.docTitle.height + (body * 0.6));
    const bottom = top + fh - pad - ((count > 1) ? body * 1.6 : 0);
    obj.docMask.beginFill(0xffffff).drawRect(left + pad, top + pad, fw - (2 * pad), Math.max(0, bottom - top - pad)).endFill();
  }
  // A written document counts its pages at the foot (a PDF's own page shows there instead).
  if ( (count > 1) && !pdf ) {
    obj.docFoot.visible = true;
    obj.docFoot.position.set(0, top + fh - (pad * 0.6));
  }
  return { pad, body, pdf, count };
}

export default {
  id: "classic",
  fonts: { title: SANS, badge: SANS, tab: SANS, note: SANS, docTitle: DOC_FONT, docBody: DOC_FONT, docFoot: SANS },
  colors: { title: 0x2b2b2b, badge: 0x8a6d3b, note: 0x2b2b2b, docTitle: 0x161616, docBody: 0x2e2e2e, docFoot: 0x8a8478 },
  tabText: () => 0xffffff,
  /** The note editor's look over a note of this colour. */
  noteEditor: color => ({ paper: color, ink: "#2b2b2b", font: SANS }),

  /** A photo in a polaroid frame, with its title on the bottom strip. */
  photo(obj, L) {
    const { w, h, left, top, fw, fh } = L;
    // Shadow: two offset translucent rects read as a soft drop shadow without a filter per card.
    obj.shadow
      .beginFill(0x000000, 0.18).drawRect(left + 3, top + 5, fw + 2, fh + 3).endFill()
      .beginFill(0x000000, 0.18).drawRect(left + 6, top + 9, fw, fh).endFill();
    obj.frame.beginFill(PAPER).lineStyle(1, 0xd8d0bf, 1).drawRect(left, top, fw, fh).endFill();
    placePhoto(obj, w, h);
    placeTitle(obj, L);
  },

  /**
   * A sheet of A4 with the document's title and the start of its first page. More pages show as
   * sheets peeking out askew underneath, held together with a paper clip.
   */
  document(obj, L) {
    const { w, h, left, top, fw, fh } = L;
    obj.shadow
      .beginFill(0x000000, 0.18).drawRect(left + 3, top + 5, fw + 2, fh + 3).endFill()
      .beginFill(0x000000, 0.14).drawRect(left + 6, top + 9, fw, fh).endFill();
    const count = Math.max(1, isPdfDocument(obj.card) ? obj.pdfPages : obj.card.docPages.length);
    // The sheets underneath (up to two drawn), each turned a little around the centre.
    const under = [[2.4, w * 0.02, h * 0.012, 0xf1eee4], [-1.8, -w * 0.015, h * 0.02, 0xe9e5d9]];
    for ( let i = Math.min(count - 1, under.length) - 1; i >= 0; i-- ) {
      const [deg, dx, dy, tint] = under[i];
      obj.frame.lineStyle(1, DOC_EDGE, 1).beginFill(tint).drawPolygon(turnedSheet(L, deg, dx, dy)).endFill();
    }
    obj.frame.lineStyle(1, DOC_EDGE, 1).beginFill(DOC_PAPER).drawRect(left, top, fw, fh).endFill().lineStyle(0);
    placeDocument(obj, L);
    if ( count < 2 ) return;
    // The paper clip over the top-left corner
    const cw = Math.max(6, w * 0.075);
    const ch = Math.max(14, h * 0.13);
    const cx = left + (fw * 0.16);
    const cy = top - (ch * 0.3);
    const lw = Math.max(1.5, w * 0.012);
    obj.clip.lineStyle(lw, 0x000000, 0.2).drawRoundedRect(cx + 1.5, cy + 1.5, cw, ch, cw / 2)
      .lineStyle(lw, 0x9ea3a8, 1).drawRoundedRect(cx, cy, cw, ch, cw / 2)
      .drawRoundedRect(cx + (cw * 0.22), cy + (ch * 0.18), cw * 0.56, ch * 0.62, cw * 0.28);
  },

  /** A square of coloured paper with the note's text, shrunk until it fits. */
  note(obj, L) {
    const { left, top, fw, fh } = L;
    const color = Number.parseInt((obj.card.color ?? NOTE_COLORS[0].color).slice(1), 16);
    // The bottom edge curls off the board a little, so the shadow is deeper there.
    obj.shadow.beginFill(0x000000, 0.22)
      .drawPolygon([left + 3, top + 5, left + fw + 3, top + 5, left + fw + 1, top + fh + 8, left + 5, top + fh + 3]).endFill();
    obj.frame.beginFill(color).drawRect(left, top, fw, fh).endFill()
      // The adhesive strip along the top reads slightly darker.
      .beginFill(0x000000, 0.045).drawRect(left, top, fw, fh * 0.13).endFill();
  },

  /** The category tab: a coloured tab sticking out above the top-right corner. */
  tab(g, { x, y, w, h }, color) {
    g.beginFill(0x000000, 0.2).drawRoundedRect(x + 2, y + 2, w, h + 6, h * 0.2).endFill()
      .beginFill(color).drawRoundedRect(x, y, w, h + 6, h * 0.2).endFill();
  }
};
