import { t } from "./constants.mjs";
import { MIN_CARD_SIZE, MAX_CARD_SIZE, clampToRect, isEvidence } from "./cards.mjs";
import { boardLinks, canEditBoard, canEditCard } from "./permissions.mjs";
import { linksOf } from "./links.mjs";
import { NOTE_COLORS, inkHit, localToView, viewScale } from "./stickers.mjs";
import { drawStrokes } from "./ink.mjs";
import { isPdfDocument, pdfPreview } from "./pdf-preview.mjs";

const SELECT_COLOR = 0xff9829;
const PAPER = 0xf7f3ea;
const PIN = 0xc0392b;
const DOC_PAPER = 0xfbfaf5;
const DOC_EDGE = 0xd3ccba;
const DOC_FONT = "Georgia, 'Times New Roman', serif";

/**
 * The text of some HTML as it reads on paper: paragraphs and headings apart, list items bulleted,
 * Foundry content links as their labels. GM-only secret blocks are left out for everyone else.
 */
export function htmlToPlain(html) {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ""}</body>`, "text/html");
  if ( !game.user.isGM ) doc.querySelectorAll("section.secret").forEach(e => e.remove());
  const out = [];
  const walk = node => {
    for ( const n of node.childNodes ) {
      if ( n.nodeType === Node.TEXT_NODE ) {
        out.push(n.textContent.replace(/\s+/g, " "));
        continue;
      }
      if ( n.nodeType !== Node.ELEMENT_NODE ) continue;
      const tag = n.tagName;
      if ( tag === "BR" ) {
        out.push("\n");
        continue;
      }
      if ( tag === "LI" ) out.push("• ");
      walk(n);
      if ( /^(P|H[1-6]|BLOCKQUOTE|PRE|TABLE|UL|OL)$/.test(tag) ) out.push("\n\n");
      else if ( /^(LI|DIV|TR|SECTION|ARTICLE|FIGURE)$/.test(tag) ) out.push("\n");
      else if ( /^(TD|TH)$/.test(tag) ) out.push("  ");
    }
  };
  walk(doc.body);
  return out.join("")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[([^\]]*)\]/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * One card on the board: a photo in a paper frame with a push-pin (kind "image"), a text document
 * on A4 paper, its first page showing and the rest stacked and clipped behind it ("document"), a
 * sticky note with text and ink ("note"), or freehand ink drawn straight onto the board ("sketch").
 * It isn't a PlaceableObject (players can't own embedded documents, see the README), but it uses
 * core's MouseInteractionManager, so clicking, dragging and double-clicking feel like Tiles do.
 *
 * The container sits at the image's centre and rotates around it; all drawing is in local space.
 */
export default class CardObject extends PIXI.Container {
  /**
   * @param {import("./board-layer.mjs").default} layer
   * @param {import("./cards.mjs").Card} card
   */
  constructor(layer, card) {
    super();
    this.layer = layer;
    this.card = card;
    this.shadow = this.addChild(new PIXI.Graphics());
    // The category tab sticks out above the frame's top-right corner, tucked behind the photo.
    this.tab = this.addChild(new PIXI.Graphics());
    this.tabText = this.addChild(new foundry.canvas.containers.PreciseText("", this.#textStyle(12, 0xffffff)));
    this.tabText.anchor.set(0.5);
    this.frame = this.addChild(new PIXI.Graphics());
    this.sprite = this.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
    this.sprite.anchor.set(0.5);
    this.placeholder = this.addChild(new PIXI.Graphics());
    this.noteText = this.addChild(new foundry.canvas.containers.PreciseText("", new PIXI.TextStyle({
      fontFamily: "Signika, sans-serif", fontSize: 24, fill: 0x2b2b2b, align: "center",
      wordWrap: true, breakWords: true, wordWrapWidth: 200, dropShadow: false, stroke: 0, strokeThickness: 0
    })));
    this.noteText.anchor.set(0.5);
    // A text document: its title and the start of its first page, typeset on the paper.
    const docStyle = (bold = false) => new PIXI.TextStyle({
      fontFamily: DOC_FONT, fontSize: 10, fill: bold ? 0x161616 : 0x2e2e2e, align: "left", fontWeight: bold ? "bold" : "normal",
      wordWrap: true, breakWords: true, wordWrapWidth: 200, dropShadow: false, stroke: 0, strokeThickness: 0
    });
    this.docTitle = this.addChild(new foundry.canvas.containers.PreciseText("", docStyle(true)));
    this.docBody = this.addChild(new foundry.canvas.containers.PreciseText("", docStyle()));
    this.docFoot = this.addChild(new foundry.canvas.containers.PreciseText("", this.#textStyle(10, 0x8a8478)));
    this.docFoot.anchor.set(0.5, 1);
    this.docMask = this.addChild(new PIXI.Graphics());
    this.docBody.mask = this.docMask;
    this.clip = this.addChild(new PIXI.Graphics());
    this.ink = this.addChild(new PIXI.Graphics());
    this.inkMask = this.addChild(new PIXI.Graphics());
    this.titleText = this.addChild(new foundry.canvas.containers.PreciseText("", this.#textStyle(16)));
    this.titleText.anchor.set(0.5);
    this.badgeText = this.addChild(new foundry.canvas.containers.PreciseText("", this.#textStyle(12, 0x8a6d3b)));
    this.badgeText.anchor.set(1, 0.5);
    this.pin = this.addChild(new PIXI.Graphics());
    this.outline = this.addChild(new PIXI.Graphics());
    this.handle = this.addChild(new PIXI.Graphics());
  }

  /** Geometry shown right now: a local drag, a remote drag, a just-dropped move, or the stored card. */
  preview = null;

  /** Set while this client is dragging the card. */
  dragging = null;

  hovered = false;

  #textureSrc = null;
  #lastEmit = 0;
  #inkDrawn = null;
  #noteKey = null;
  #docKey = null;

  /** Set while the note's text is being edited on the board (the text is hidden under the editor). */
  editing = false;

  /** Font metrics of the note's text as last laid out (the inline editor matches them). */
  noteFont = { size: 24, pad: 16, lineHeight: 30 };

  get kind() {
    return this.card.kind;
  }

  get id() {
    return this.card.id;
  }

  get selected() {
    return this.layer.selectedId === this.id;
  }

  get editable() {
    return canEditCard(canvas.scene, this.card);
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  async draw() {
    await this.#loadTexture();
    this.refresh();
    this.mouseInteractionManager = this.#createInteractionManager().activate();
    return this;
  }

  /** Apply a new stored version of the card. */
  async setCard(card) {
    this.card = card;
    // A drop's result has arrived: stop showing the optimistic preview.
    if ( !this.dragging ) this.preview = null;
    if ( card.src !== this.#textureSrc ) await this.#loadTexture();
    this.refresh();
  }

  /** A PDF document's page count, once its first page has been read. */
  pdfPages = 0;

  async #loadTexture() {
    const src = this.card.src;
    this.#textureSrc = src;
    let texture = null;
    let pages = 0;
    try {
      if ( isPdfDocument(this.card) ) {
        // Only the first page, rendered once per file and shared by every card showing it.
        const preview = await pdfPreview(src);
        texture = preview?.texture ?? null;
        pages = preview?.pages ?? 0;
      }
      else if ( src && (this.card.kind !== "document") ) texture = await foundry.canvas.loadTexture(src);
    } catch(err) {
      texture = null;
    }
    if ( this.destroyed || (this.#textureSrc !== src) ) return;
    this.sprite.texture = texture ?? PIXI.Texture.EMPTY;
    this.hasTexture = !!texture;
    this.pdfPages = pages;
  }

  #textStyle(size, fill = 0x2b2b2b) {
    return new PIXI.TextStyle({
      fontFamily: "Signika, sans-serif", fontSize: size, fill, align: "center",
      wordWrap: false, dropShadow: false, stroke: 0, strokeThickness: 0
    });
  }

  /** Frame measurements for an image of this size. */
  static metrics(w, h) {
    const m = Math.min(w, h);
    const pad = Math.round(Math.min(Math.max(m * 0.05, 6), 30));
    const strip = Math.round(Math.min(Math.max(m * 0.16, 22), 80));
    return { pad, strip, pinR: Math.min(Math.max(m * 0.05, 6), 20), handleR: Math.min(Math.max(m * 0.045, 7), 16) };
  }

  /**
   * Where things go in the card's local space (origin at its centre) for a geometry: the paper
   * (left, top, fw, fh), the photo's padding and title strip, and the pin and handle sizes.
   * Notes and sketches have no frame around them.
   */
  layout(g = this.preview ?? this.card) {
    const { width: w, height: h } = g;
    if ( this.kind === "image" ) {
      const { pad, strip, pinR, handleR } = CardObject.metrics(w, h);
      return { w, h, pad, strip, pinR, handleR, left: (-w / 2) - pad, top: (-h / 2) - pad, fw: w + (2 * pad), fh: h + (2 * pad) + strip };
    }
    const m = Math.min(w, h);
    return {
      w, h, pad: 0, strip: 0, left: -w / 2, top: -h / 2, fw: w, fh: h,
      pinR: Math.min(Math.max(m * 0.05, 6), 18), handleR: Math.min(Math.max(m * 0.045, 7), 16)
    };
  }

  /** Redraw everything from the current geometry and state. */
  refresh() {
    if ( this.destroyed ) return;
    const g = this.preview ?? this.card;
    const L = this.layout(g);
    const { w, h, pad, strip, pinR, handleR, left, top, fw, fh } = L;
    const kind = this.kind;

    this.position.set(g.x + (w / 2), g.y + (h / 2));
    this.angle = this.card.rotation;
    this.zIndex = this.dragging ? Number.MAX_SAFE_INTEGER : this.card.sort;
    this.alpha = this.card.hidden ? 0.55 : 1;

    this.shadow.clear();
    this.frame.clear();
    this.placeholder.clear();
    this.sprite.visible = false;
    this.titleText.visible = false;
    this.noteText.visible = false;
    this.docTitle.visible = this.docBody.visible = this.docFoot.visible = false;
    this.docMask.clear();
    this.clip.clear();
    if ( kind === "image" ) this.#drawPhoto(L);
    else if ( kind === "document" ) this.#drawDocument(L);
    else if ( kind === "note" ) this.#drawNote(L);
    this.#drawInk(L);

    // GM-facing state badges: on a photo's strip, or inside a sticker's bottom-right corner
    const badges = [];
    if ( this.card.hidden ) badges.push(t("Card.HiddenBadge"));
    if ( this.card.locked ) badges.push(t("Card.LockedBadge"));
    this.badgeText.text = badges.join(" · ");
    this.badgeText.visible = badges.length > 0;
    if ( kind === "image" ) {
      this.badgeText.style.fontSize = Math.max(10, Math.round(strip * 0.3));
      this.badgeText.position.set(left + fw - pad, (h / 2) + pad + strip - Math.max(8, strip * 0.22));
    } else {
      const size = Math.max(10, Math.round(Math.min(w, h) * 0.06));
      this.badgeText.style.fontSize = size;
      this.badgeText.position.set(left + fw - 6, top + fh - size);
    }

    // Category tab
    const category = this.layer.categories?.get(this.card.category);
    this.tab.clear();
    this.tabText.visible = !!category;
    if ( category ) {
      const tabH = Math.round(Math.min(Math.max((strip || (Math.min(w, h) * 0.16)) * 0.5, 14), 40));
      const tabFont = Math.round(tabH * 0.62);
      if ( this.tabText.style.fontSize !== tabFont ) this.tabText.style.fontSize = tabFont;
      this.tabText.text = category.name.toUpperCase();
      this.tabText.scale.set(1);
      const maxW = (fw / 2) - (pinR * 1.5) - pad;
      if ( this.tabText.width + tabH > maxW ) this.tabText.scale.set(Math.max(0.3, (maxW - tabH) / this.tabText.width));
      const tabW = this.tabText.width + tabH;
      const tabX = left + fw - (pad || 6) - tabW;
      const tabY = top - (tabH * 0.85);
      const color = Number.parseInt(category.color.slice(1), 16);
      this.tab.beginFill(0x000000, 0.2).drawRoundedRect(tabX + 2, tabY + 2, tabW, tabH + 6, tabH * 0.2).endFill()
        .beginFill(color).drawRoundedRect(tabX, tabY, tabW, tabH + 6, tabH * 0.2).endFill();
      this.tabText.position.set(tabX + (tabW / 2), tabY + (tabH * 0.85 / 2) + 1);
    }

    // Push-pin, top centre. Ink on the board only gets one once a thread hangs from it.
    this.pin.clear();
    if ( (kind !== "sketch") || linksOf(boardLinks(canvas.scene), [this.id]).length ) {
      this.pin
        .beginFill(0x000000, 0.25).drawCircle(pinR * 0.35, top + pinR * 0.55, pinR).endFill()
        .beginFill(PIN).drawCircle(0, top + (pinR * 0.2), pinR).endFill()
        .beginFill(0xffffff, 0.45).drawCircle(-pinR * 0.35, top + (pinR * 0.2) - (pinR * 0.35), pinR * 0.3).endFill();
    }

    // Hover / selection outline and the resize handle
    const lw = 2 / (canvas.stage?.scale.x || 1);
    this.outline.clear();
    if ( this.selected || this.hovered ) {
      this.outline.lineStyle(this.selected ? lw * 1.5 : lw, SELECT_COLOR, this.selected ? 1 : 0.6)
        .drawRect(left - lw, top - lw, fw + (2 * lw), fh + (2 * lw));
    }
    this.handle.clear();
    const showHandle = this.selected && this.editable;
    if ( showHandle ) {
      this.handle.lineStyle(lw, 0x000000, 0.8).beginFill(SELECT_COLOR)
        .drawCircle(left + fw, top + fh, handleR).endFill();
    }

    // Hit area: the paper plus the handle that overhangs the corner. An unselected sketch is only
    // grabbed by its ink, so its empty corners don't cover the evidence underneath.
    const r = showHandle ? handleR : 0;
    if ( (kind === "sketch") && !this.selected ) {
      const shown = { ...this.card, ...g };
      const tolerance = 8 * viewScale(shown);
      this.hitArea = { contains: (x, y) => {
        const v = localToView(shown, x + (w / 2), y + (h / 2));
        return inkHit(this.card.strokes, v.x, v.y, tolerance);
      } };
    } else {
      this.hitArea = new PIXI.Rectangle(left - r, top - (pinR * 0.8) - r, fw + (2 * r), fh + (pinR * 0.8) + (2 * r));
    }

    // Threads hang from the pin, so they follow every move, resize and remote drag.
    this.layer.queueThreads();
  }

  /** A photo in a polaroid frame, with its title on the bottom strip. */
  #drawPhoto({ w, h, pad, strip, left, top, fw, fh }) {
    // Shadow: two offset translucent rects read as a soft drop shadow without a filter per card.
    this.shadow
      .beginFill(0x000000, 0.18).drawRect(left + 3, top + 5, fw + 2, fh + 3).endFill()
      .beginFill(0x000000, 0.18).drawRect(left + 6, top + 9, fw, fh).endFill();

    // Paper
    this.frame.beginFill(PAPER).lineStyle(1, 0xd8d0bf, 1).drawRect(left, top, fw, fh).endFill();

    // Image (or a grey placeholder when it couldn't be loaded)
    this.sprite.visible = !!this.hasTexture;
    this.sprite.width = w;
    this.sprite.height = h;
    if ( !this.hasTexture ) {
      this.placeholder.beginFill(0x8c8c8c).drawRect(-w / 2, -h / 2, w, h).endFill()
        .lineStyle(Math.max(2, w / 60), 0xbdbdbd)
        .moveTo(-w / 2, -h / 2).lineTo(w / 2, h / 2).moveTo(w / 2, -h / 2).lineTo(-w / 2, h / 2);
    }

    // Title on the bottom strip, shrunk to fit
    const stripY = (h / 2) + (strip / 2) + (pad / 2);
    const fontSize = Math.round(strip * 0.45);
    if ( this.titleText.style.fontSize !== fontSize ) this.titleText.style.fontSize = fontSize;
    this.titleText.visible = true;
    this.titleText.text = this.card.title;
    this.titleText.position.set(0, stripY);
    this.titleText.scale.set(1);
    const maxTitle = fw - (2 * pad);
    if ( this.titleText.width > maxTitle ) this.titleText.scale.set(maxTitle / this.titleText.width);
  }

  /**
   * A sheet of A4 with the document's title and the start of its first page. More pages show as
   * sheets peeking out askew underneath, held together with a paper clip.
   */
  #drawDocument({ w, h, left, top, fw, fh }) {
    const pdf = isPdfDocument(this.card);
    const count = Math.max(1, pdf ? this.pdfPages : this.card.docPages.length);
    this.shadow
      .beginFill(0x000000, 0.18).drawRect(left + 3, top + 5, fw + 2, fh + 3).endFill()
      .beginFill(0x000000, 0.14).drawRect(left + 6, top + 9, fw, fh).endFill();

    // The sheets underneath (up to two drawn), each turned a little around the centre.
    const sheet = (degrees, dx, dy, tint) => {
      const a = Math.toRadians(degrees);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const pts = [[left, top], [left + fw, top], [left + fw, top + fh], [left, top + fh]]
        .flatMap(([x, y]) => [(x * cos) - (y * sin) + dx, (x * sin) + (y * cos) + dy]);
      this.frame.lineStyle(1, DOC_EDGE, 1).beginFill(tint).drawPolygon(pts).endFill();
    };
    const under = [[2.4, w * 0.02, h * 0.012, 0xf1eee4], [-1.8, -w * 0.015, h * 0.02, 0xe9e5d9]];
    for ( let i = Math.min(count - 1, under.length) - 1; i >= 0; i-- ) sheet(...under[i]);

    // The top sheet
    this.frame.lineStyle(1, DOC_EDGE, 1).beginFill(DOC_PAPER).drawRect(left, top, fw, fh).endFill().lineStyle(0);

    const { pad, body } = this.#fitDocText(w, h, count);
    if ( pdf && this.hasTexture ) {
      // The PDF's own first page, fitted onto the sheet: it is the paper.
      const tex = this.sprite.texture;
      const k = Math.min(fw / tex.width, fh / tex.height);
      this.sprite.visible = true;
      this.sprite.width = tex.width * k;
      this.sprite.height = tex.height * k;
    } else {
      // Typeset: a written document's title and first page (a PDF not read yet shows its title).
      this.docTitle.visible = true;
      this.docTitle.position.set(left + pad, top + pad);
      this.docBody.visible = !pdf;
      this.docBody.position.set(left + pad, top + pad + this.docTitle.height + (body * 0.6));
      const bottom = top + fh - pad - ((count > 1) ? body * 1.6 : 0);
      this.docMask.beginFill(0xffffff).drawRect(left + pad, top + pad, fw - (2 * pad), Math.max(0, bottom - top - pad)).endFill();
    }
    if ( count < 2 ) return;
    // A written document counts its pages at the foot (a PDF's own page shows there instead).
    if ( !pdf ) {
      this.docFoot.visible = true;
      this.docFoot.position.set(0, top + fh - (pad * 0.6));
    }
    // The paper clip over the top-left corner
    const cw = Math.max(6, w * 0.075);
    const ch = Math.max(14, h * 0.13);
    const cx = left + (fw * 0.16);
    const cy = top - (ch * 0.3);
    const lw = Math.max(1.5, w * 0.012);
    this.clip.lineStyle(lw, 0x000000, 0.2).drawRoundedRect(cx + 1.5, cy + 1.5, cw, ch, cw / 2)
      .lineStyle(lw, 0x9ea3a8, 1).drawRoundedRect(cx, cy, cw, ch, cw / 2)
      .drawRoundedRect(cx + (cw * 0.22), cy + (ch * 0.18), cw * 0.56, ch * 0.62, cw * 0.28);
  }

  /** Lay out the document's text for a sheet of this size (cached until the text or size changes). */
  #fitDocText(w, h, count) {
    const pad = Math.max(4, Math.round(w * 0.1));
    const body = Math.max(3, Math.round(w * 0.042 * 10) / 10);
    const first = this.card.docPages[0] ?? "";
    const key = `${this.card.title}|${first}|${w}|${h}|${count}`;
    if ( key === this.#docKey ) return { pad, body };
    this.#docKey = key;
    const wrap = Math.max(10, w - (2 * pad));
    const ts = this.docTitle.style;
    ts.fontSize = Math.round(body * 1.5 * 10) / 10;
    ts.lineHeight = Math.round(body * 1.9 * 10) / 10;
    ts.wordWrapWidth = wrap;
    this.docTitle.text = this.card.title || t("Document.Untitled");
    const bs = this.docBody.style;
    bs.fontSize = body;
    bs.lineHeight = Math.round(body * 1.4 * 10) / 10;
    bs.wordWrapWidth = wrap;
    // Only as much text as could fit (the rest is masked off anyway), so a long page stays cheap.
    const lines = Math.ceil(h / bs.lineHeight);
    const perLine = Math.ceil(wrap / (body * 0.45));
    const text = htmlToPlain(first);
    this.docBody.text = text.length > lines * perLine ? text.slice(0, lines * perLine) : text;
    this.docFoot.style.fontSize = Math.max(3, Math.round(body * 0.85 * 10) / 10);
    this.docFoot.text = t("Document.Pages", { count });
    return { pad, body };
  }

  /** A square of coloured paper with the note's text, shrunk until it fits. */
  #drawNote({ w, h, left, top, fw, fh }) {
    const color = Number.parseInt((this.card.color ?? NOTE_COLORS[0].color).slice(1), 16);
    // The bottom edge curls off the board a little, so the shadow is deeper there.
    this.shadow.beginFill(0x000000, 0.22)
      .drawPolygon([left + 3, top + 5, left + fw + 3, top + 5, left + fw + 1, top + fh + 8, left + 5, top + fh + 3]).endFill();
    this.frame.beginFill(color).drawRect(left, top, fw, fh).endFill()
      // The adhesive strip along the top reads slightly darker.
      .beginFill(0x000000, 0.045).drawRect(left, top, fw, fh * 0.13).endFill();
    this.#fitNoteText(w, h);
    this.noteText.visible = !this.editing;
    this.noteText.position.set(0, 0);
  }

  #fitNoteText(w, h) {
    const text = this.card.text;
    const empty = !text.trim();
    const key = `${text}|${w}|${h}|${empty && this.editable}`;
    if ( key === this.#noteKey ) return;
    this.#noteKey = key;
    const pad = Math.max(6, Math.round(w * 0.08));
    const style = this.noteText.style;
    style.wordWrapWidth = Math.max(10, w - (2 * pad));
    style.fontStyle = empty ? "italic" : "normal";
    this.noteText.text = empty ? (this.editable ? t("Sticker.EmptyNote") : "") : text;
    this.noteText.alpha = empty ? 0.45 : 1;
    let size = Math.max(8, Math.round(w * 0.11));
    for ( let i = 0; i < 16; i++ ) {
      style.fontSize = size;
      style.lineHeight = Math.round(size * 1.25);
      if ( (this.noteText.height <= h - (2 * pad)) || (size <= 8) ) break;
      size = Math.max(8, Math.floor(size * 0.9));
    }
    this.noteFont = { size, pad, lineHeight: Math.round(size * 1.25) };
  }

  /** Strokes, scaled from the card's view box to its current size; clipped to a note's or photo's paper. */
  #drawInk({ w, h, left, top, fw, fh }) {
    const strokes = this.card.strokes;
    if ( isEvidence(this.card) && !Object.keys(strokes).length ) {
      this.ink.visible = false;
      this.ink.mask = null;
      this.inkMask.clear();
      this.#inkDrawn = null;
      this.ink.clear();
      return;
    }
    if ( (this.#inkDrawn !== strokes) && !foundry.utils.equals(this.#inkDrawn, strokes) ) drawStrokes(this.ink, strokes);
    this.#inkDrawn = strokes;
    const v = this.card.view;
    const sx = w / v.w;
    const sy = h / v.h;
    this.ink.visible = true;
    this.ink.scale.set(sx, sy);
    this.ink.position.set((-w / 2) - (v.x * sx), (-h / 2) - (v.y * sy));
    this.inkMask.clear();
    if ( this.kind !== "sketch" ) {
      this.inkMask.beginFill(0xffffff).drawRect(left, top, fw, fh).endFill();
      this.ink.mask = this.inkMask;
    } else {
      this.ink.mask = null;
    }
  }

  /** Pulse a bright ring around the card for a moment, so it's easy to spot after a jump. */
  flash(duration = 1800) {
    if ( this.destroyed ) return;
    const ring = this.flashRing ??= this.addChild(new PIXI.Graphics());
    const L = this.layout();
    const lw = 3 / (canvas.stage?.scale.x || 1);
    const left = L.left - (2 * lw);
    const top = L.top - (2 * lw) - (L.pinR * 0.5);
    const rw = L.fw + (4 * lw);
    const rh = L.fh + (4 * lw) + (L.pinR * 0.5);
    ring.clear()
      .lineStyle(lw * 3, 0xffd84d, 0.35).drawRoundedRect(left - lw, top - lw, rw + (2 * lw), rh + (2 * lw), 4 * lw)
      .lineStyle(lw, 0xffd84d, 1).drawRoundedRect(left, top, rw, rh, 3 * lw);
    const ticker = canvas.app.ticker;
    if ( this.flashTick ) ticker.remove(this.flashTick);
    const start = performance.now();
    this.flashTick = () => {
      const t = (performance.now() - start) / duration;
      if ( (t >= 1) || this.destroyed || ring.destroyed ) {
        ticker.remove(this.flashTick);
        this.flashTick = null;
        if ( !ring.destroyed ) ring.clear();
        return;
      }
      ring.alpha = 0.25 + (0.75 * Math.abs(Math.cos(t * Math.PI * 3)));
    };
    ticker.add(this.flashTick);
  }

  /** The centre of the push-pin in canvas coordinates, for the geometry shown right now. */
  pinPoint() {
    const g = this.preview ?? this.card;
    const L = this.layout(g);
    const lx = 0;
    const ly = L.top + (L.pinR * 0.2);
    const theta = Math.toRadians(this.card.rotation);
    const cx = g.x + (g.width / 2);
    const cy = g.y + (g.height / 2);
    return {
      x: cx + (lx * Math.cos(theta)) - (ly * Math.sin(theta)),
      y: cy + (lx * Math.sin(theta)) + (ly * Math.cos(theta))
    };
  }

  /** Is a local-space point on the resize handle? */
  #onHandle(local) {
    if ( !this.selected || !this.editable ) return false;
    const L = this.layout();
    return Math.hypot(local.x - (L.left + L.fw), local.y - (L.top + L.fh)) <= L.handleR * 1.6;
  }

  /* -------------------------------------------- */
  /*  Interaction                                 */
  /* -------------------------------------------- */

  #createInteractionManager() {
    const MIM = foundry.canvas.interaction.MouseInteractionManager;
    const permissions = {
      hoverIn: () => true,
      clickLeft: () => true,
      clickLeft2: () => true,
      clickRight: () => true,
      dragStart: () => this.#canDrag(),
      dragLeftStart: () => this.#canDrag()
    };
    const callbacks = {
      hoverIn: this.#onHoverIn,
      hoverOut: this.#onHoverOut,
      clickLeft: this.#onClickLeft,
      clickLeft2: this.#onClickLeft2,
      clickRight: this.#onClickRight,
      dragLeftStart: this.#onDragLeftStart,
      dragLeftMove: this.#onDragLeftMove,
      dragLeftDrop: this.#onDragLeftDrop,
      dragLeftCancel: this.#onDragLeftCancel
    };
    return new MIM(this, canvas.stage, permissions, callbacks);
  }

  /** Moving needs the card to be editable; pulling a thread only needs the board to be. */
  #canDrag() {
    return this.layer.isConnectTool ? canEditBoard(canvas.scene) : this.editable;
  }

  #onHoverIn() {
    this.hovered = true;
    this.cursor = (this.layer.connecting || this.layer.isConnectTool) ? "crosshair" : (this.editable ? "pointer" : "zoom-in");
    this.refresh();
  }

  #onHoverOut() {
    this.hovered = false;
    this.refresh();
  }

  #onClickLeft(event) {
    event.stopPropagation();
    // Tying a thread: a click on the second card finishes it ("Connect to…" or the Connect tool).
    const connecting = this.layer.connecting;
    if ( connecting && (connecting.fromId !== this.id) ) {
      this.layer.finishConnect(this.id);
      return false;   // no drag from this press
    }
    if ( this.layer.isConnectTool ) {
      // The first card of a thread; a drag from here pulls the thread instead of moving the card.
      if ( connecting?.fromId === this.id ) return;
      this.layer.beginConnect(this.id);
      return;
    }
    this.layer.select(this.editable ? this.id : null);
    // Set the cursor for a possible resize, which starts from this press
    if ( this.#onHandle(event.getLocalPosition(this)) ) this.cursor = "nwse-resize";
  }

  #onClickLeft2(event) {
    event.stopPropagation();
    this.layer.openCard(this.id);
  }

  #onClickRight(event) {
    event.stopPropagation();
    if ( this.editable ) this.layer.select(this.id);
    this.layer.openMenu(this, event);
  }

  #onDragLeftStart(event) {
    this.layer.closeMenu();
    if ( this.layer.isConnectTool ) {
      if ( this.layer.connecting?.fromId !== this.id ) this.layer.beginConnect(this.id);
      this.dragging = { mode: "connect" };
      return;
    }
    const origin = event.interactionData.origin;
    const local = this.toLocal(origin, canvas.stage);
    const g = this.card;
    this.dragging = {
      mode: this.#onHandle(local) ? "resize" : "move",
      start: { x: g.x, y: g.y, width: g.width, height: g.height },
      origin: { x: origin.x, y: origin.y }
    };
    this.preview = { ...this.dragging.start };
    this.refresh();
  }

  #onDragLeftMove(event) {
    if ( !this.dragging ) return;
    if ( this.dragging.mode === "connect" ) return this.layer.updateRubber(event.interactionData.destination);
    this.#previewFrom(event.interactionData.destination);
    this.refresh();
    this.#emitDrag();
  }

  /** Geometry for the pointer at `dest` (canvas coordinates). */
  #previewFrom(dest) {
    if ( !dest ) return;
    const { mode, start, origin } = this.dragging;
    if ( mode === "move" ) {
      this.preview = { ...start, x: Math.round(start.x + dest.x - origin.x), y: Math.round(start.y + dest.y - origin.y) };
    } else {
      this.preview = this.#resizePreview(start, dest);
    }
  }

  /**
   * Resize keeping the aspect ratio and the image's top-left corner fixed (in the card's own,
   * rotated frame), so the card grows towards the handle being dragged.
   */
  #resizePreview(start, dest) {
    const theta = Math.toRadians(this.card.rotation);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const cx = start.x + (start.width / 2);
    const cy = start.y + (start.height / 2);
    // Pointer in the card's unrotated frame, relative to the image's top-left corner
    const dx = dest.x - cx;
    const dy = dest.y - cy;
    const lx = ((dx * cos) + (dy * sin)) + (start.width / 2);
    const ly = ((-dx * sin) + (dy * cos)) + (start.height / 2);
    const aspect = start.height / start.width;
    const k = Math.max(lx / start.width, ly / start.height);
    let width = start.width * k;
    width = Math.min(Math.max(width, MIN_CARD_SIZE, MIN_CARD_SIZE / aspect), MAX_CARD_SIZE, MAX_CARD_SIZE / aspect);
    const height = width * aspect;
    // Move the centre so the top-left corner stays where it was
    const ox = (width - start.width) / 2;
    const oy = (height - start.height) / 2;
    const ncx = cx + (ox * cos) - (oy * sin);
    const ncy = cy + (ox * sin) + (oy * cos);
    return {
      x: Math.round(ncx - (width / 2)), y: Math.round(ncy - (height / 2)),
      width: Math.round(width), height: Math.round(height)
    };
  }

  /** Throttled live preview for the other clients. */
  #emitDrag(force = false) {
    const now = Date.now();
    if ( !force && (now - this.#lastEmit < 66) ) return;
    this.#lastEmit = now;
    const p = this.preview;
    this.layer.emitDrag(this.id, p);
  }

  async #onDragLeftDrop(event) {
    if ( this.dragging?.mode === "connect" ) {
      // Released over another card ties the thread; anywhere else drops it.
      this.dragging = null;
      const dest = event.interactionData?.destination;
      const target = dest && this.layer.cardAt(dest);
      if ( target && (target.id !== this.id) ) return this.layer.finishConnect(target.id);
      return this.layer.cancelConnect();
    }
    if ( !this.dragging || !this.preview ) return;
    // Moves are throttled to the frame rate, so take the final position from the drop itself.
    this.#previewFrom(event.interactionData?.destination);
    const { start } = this.dragging;
    const rect = canvas.dimensions.sceneRect;
    const next = { ...this.preview, ...clampToRect(this.preview, rect) };
    this.dragging = null;
    this.preview = next;
    this.refresh();
    const changed = ["x", "y", "width", "height"].some(k => next[k] !== start[k]);
    if ( !changed ) {
      this.preview = null;
      this.layer.emitDragEnd(this.id);
      return;
    }
    await this.layer.commitGeometry(this.id, next);
  }

  #onDragLeftCancel() {
    // A drop also ends in a cancel; only a drag that never dropped snaps back.
    if ( !this.dragging ) return;
    if ( this.dragging.mode === "connect" ) {
      this.dragging = null;
      return this.layer.cancelConnect();
    }
    this.dragging = null;
    this.preview = null;
    this.cursor = this.editable ? "pointer" : "zoom-in";
    this.refresh();
    this.layer.emitDragEnd(this.id);
  }

  /** Show another user's in-progress drag. */
  showRemotePreview(geometry) {
    if ( this.dragging ) return;
    this.preview = geometry ? { ...this.card, ...geometry } : null;
    this.refresh();
  }

  /** @override */
  destroy(options) {
    if ( this.flashTick ) canvas.app?.ticker.remove(this.flashTick);
    const MIM = foundry.canvas.interaction.MouseInteractionManager;
    const mim = this.mouseInteractionManager;
    if ( mim?.state > MIM.INTERACTION_STATES.HOVER ) {
      mim.interactionData.cancelled = true;
      mim.cancel();
    }
    MIM.emulateMoveEvent();
    super.destroy({ ...options, children: true, texture: false, baseTexture: false });
  }
}
