import { t } from "./constants.mjs";
import { MIN_CARD_SIZE, MAX_CARD_SIZE, clampToRect, isEvidence } from "./cards.mjs";
import { boardLinks, canEditBoard, canEditCard, canMoveCard } from "./permissions.mjs";
import { MAIN_PIN, usedPins } from "./links.mjs";
import { inkHit, localToView, viewScale } from "./stickers.mjs";
import { noteColors } from "./styles.mjs";
import { drawStrokes } from "./ink.mjs";
import { isPdfDocument, pdfPreview } from "./pdf-preview.mjs";
import { cardPainter } from "./render/cards.mjs";
import { drawPin } from "./render/pins.mjs";

const SELECT_COLOR = 0xff9829;
const MERGE_COLOR = 0x37b24d;

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
 * One card on the board: a photo in a paper frame with a pin (kind "image"), a text document, its
 * first page showing and the rest stacked behind it ("document"), a note with text and ink
 * ("note"), or freehand ink drawn straight onto the board ("sketch"). How the paper, pins and texts
 * look is the board's card and pin style (render/cards-*.mjs, render/pins.mjs).
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
    // Over the picture: a style's scanlines.
    this.overlay = this.addChild(new PIXI.TilingSprite(PIXI.Texture.EMPTY, 1, 1));
    this.overlay.visible = false;
    this.placeholder = this.addChild(new PIXI.Graphics());
    this.noteText = this.addChild(new foundry.canvas.containers.PreciseText("", new PIXI.TextStyle({
      fontFamily: "Signika, sans-serif", fontSize: 24, fill: 0x2b2b2b, align: "center",
      wordWrap: true, breakWords: true, wordWrapWidth: 200, dropShadow: false, stroke: 0, strokeThickness: 0
    })));
    this.noteText.anchor.set(0.5);
    // A text document: its title and the start of its first page, typeset on the paper.
    const docStyle = (bold = false) => new PIXI.TextStyle({
      fontFamily: "Georgia, serif", fontSize: 10, fill: bold ? 0x161616 : 0x2e2e2e, align: "left", fontWeight: bold ? "bold" : "normal",
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
    this.pinGlow = this.addChild(new PIXI.Graphics());
    this.pin = this.addChild(new PIXI.Graphics());
    this.outline = this.addChild(new PIXI.Graphics());
    this.handle = this.addChild(new PIXI.Graphics());
  }

  /** Geometry shown right now: a local drag, a remote drag, a just-dropped move, or the stored card. */
  preview = null;

  /** Set while this client is dragging the card. */
  dragging = null;

  /** A pin being dragged here, or just dropped: {id, x, y} as fractions of the paper. */
  pinPreview = null;

  /** The pin under the pointer, ringed when it can be moved or tied to. */
  #hoverPin = null;

  /** Pins the layer rings (a thread's snap target). */
  #highlights = new Set();

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
    return this.layer.isSelected(this.id);
  }

  /** The resize handle shows on a card selected on its own that can be resized. */
  get showsHandle() {
    return this.selected && !this.layer.multiSelected && this.movable;
  }

  /** The centre of the card's image in canvas coordinates, for the geometry shown right now. */
  get centre() {
    const g = this.preview ?? this.card;
    return { x: g.x + (g.width / 2), y: g.y + (g.height / 2) };
  }

  get editable() {
    return canEditCard(canvas.scene, this.card);
  }

  /** Can this card be dragged or resized? Not while it's locked, even by a GM. */
  get movable() {
    return canMoveCard(canvas.scene, this.card);
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  async draw() {
    await this.#loadTexture();
    this.refresh();
    this.mouseInteractionManager = this.#createInteractionManager().activate();
    this.on("pointermove", this.#onPointerMove, this);
    return this;
  }

  /** Apply a new stored version of the card. */
  async setCard(card) {
    this.card = card;
    // A drop's result has arrived: stop showing the optimistic preview.
    if ( !this.dragging ) this.preview = this.pinPreview = null;
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
    // A card being moved or resized is lifted above the other cards, but stays under the threads
    // (they hang from its pins). Dragging one of its pins or pulling a thread out of it leaves it put.
    // A group being moved keeps its stacking order among itself.
    const lifted = ["move", "resize"].includes(this.dragging?.mode);
    this.zIndex = lifted ? 1e12 + this.card.sort : this.card.sort;
    this.alpha = this.card.hidden ? 0.55 : 1;

    const painter = this.painter;
    this.#applyFonts(painter);
    this.shadow.clear();
    this.frame.clear();
    this.placeholder.clear();
    this.sprite.visible = false;
    this.sprite.tint = 0xffffff;
    this.overlay.visible = false;
    this.titleText.visible = false;
    this.noteText.visible = false;
    this.docTitle.visible = this.docBody.visible = this.docFoot.visible = false;
    this.docMask.clear();
    this.clip.clear();
    if ( kind === "image" ) painter.photo(this, L);
    else if ( kind === "document" ) painter.document(this, L);
    else if ( kind === "note" ) {
      painter.note(this, L);
      this.fitNoteText(w, h);
      this.noteText.visible = !this.editing;
      this.noteText.position.set(0, 0);
    }
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
      painter.tab(this.tab, { x: tabX, y: tabY, w: tabW, h: tabH }, color);
      this.tabText.style.fill = painter.tabText(color);
      this.tabText.position.set(tabX + (tabW / 2), tabY + (tabH * 0.85 / 2) + 1);
    }

    // Push-pins: the card's own (top centre unless moved) and one for each other pin a thread hangs
    // from. Ink on the board only gets its own pin once a thread hangs from it.
    // A ring marks the pin under the pointer and a thread's snap target; a green one the two pins a
    // pin being dragged would merge.
    this.pin.clear();
    this.pinGlow.clear();
    const pinStyle = this.layer.style?.pins;
    const merge = this.dragging?.merge;
    const ringW = 2.5 / (canvas.stage?.scale.x || 1);
    for ( const id of this.shownPins() ) {
      const p = this.#pinLocal(id, L);
      const merging = merge && ((id === merge) || (id === this.dragging.pin));
      const ringed = merging || (id === this.#hoverPin) || this.#highlights.has(id)
        || ((this.dragging?.mode === "pin") && (id === this.dragging.pin));
      if ( ringed ) {
        const color = merging ? MERGE_COLOR : SELECT_COLOR;
        this.pin.beginFill(color, 0.3).drawCircle(p.x, p.y, pinR * 1.7).endFill()
          .lineStyle(ringW, color, 1).drawCircle(p.x, p.y, pinR * 1.7).lineStyle(0);
      }
      drawPin(this.pin, this.pinGlow, pinStyle, p, pinR);
    }

    // Hover / selection outline and the resize handle
    const lw = 2 / (canvas.stage?.scale.x || 1);
    this.outline.clear();
    if ( this.selected || this.hovered ) {
      this.outline.lineStyle(this.selected ? lw * 1.5 : lw, SELECT_COLOR, this.selected ? 1 : 0.6)
        .drawRect(left - lw, top - lw, fw + (2 * lw), fh + (2 * lw));
    }
    this.handle.clear();
    const showHandle = this.showsHandle;
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

  /** The painter of the board's card style. */
  get painter() {
    return cardPainter(this.layer.style?.cards);
  }

  /** The style whose fonts the texts were last set up for. */
  #fontsFor = null;

  /** Fonts and colours of the texts for a card style (only when the style changes). */
  #applyFonts(painter) {
    if ( this.#fontsFor === painter ) return;
    this.#fontsFor = painter;
    const { fonts, colors } = painter;
    const set = (text, family, fill) => {
      text.style.fontFamily = family;
      if ( fill !== undefined ) text.style.fill = fill;
    };
    set(this.titleText, fonts.title, colors.title);
    set(this.badgeText, fonts.badge, colors.badge);
    set(this.tabText, fonts.tab);
    set(this.noteText, fonts.note, colors.note);
    set(this.docTitle, fonts.docTitle, colors.docTitle);
    set(this.docBody, fonts.docBody, colors.docBody);
    set(this.docFoot, fonts.docFoot, colors.docFoot);
    // Cached layouts were measured in the old fonts.
    this.#noteKey = this.#docKey = null;
  }

  /** How the note editor should look over this note: {paper, ink, font} as CSS values. */
  noteEditorLook() {
    const color = this.card.color ?? noteColors(this.layer.style?.cards)[0].color;
    return this.painter.noteEditor(color);
  }

  /** Lay out the document's text for a sheet of this size (cached until the text, size or style changes). */
  fitDocText(w, h, count) {
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

  /** Fit the note's text to its paper, shrinking it until it fits (cached). */
  fitNoteText(w, h) {
    const text = this.card.text;
    const empty = !text.trim();
    const painter = this.painter;
    const color = this.card.color ?? noteColors(this.layer.style?.cards)[0].color;
    const key = `${text}|${w}|${h}|${empty && this.editable}|${color}`;
    if ( key === this.#noteKey ) return;
    this.#noteKey = key;
    const pad = Math.max(6, Math.round(w * 0.08));
    const style = this.noteText.style;
    style.fill = painter.noteText ? painter.noteText(Number.parseInt(color.slice(1), 16)) : painter.colors.note;
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

  /** The pins drawn on this card: its own, unless it's ink without a thread on it, and those threads use. */
  shownPins() {
    const used = usedPins(boardLinks(canvas.scene), this.id);
    // A thread naming a pin that no longer exists hangs from the main pin.
    for ( const id of used ) if ( (id !== MAIN_PIN) && !this.card.pins[id] ) used.add(MAIN_PIN);
    const ids = [...used].filter(id => (id === MAIN_PIN) || this.card.pins[id]);
    if ( (this.kind !== "sketch") && !ids.includes(MAIN_PIN) ) ids.unshift(MAIN_PIN);
    return ids;
  }

  /** A pin's position as fractions of the paper (a moving pin's preview, its stored spot, or the default). */
  #pinFraction(id, L) {
    if ( this.pinPreview?.id === id ) return this.pinPreview;
    const stored = this.card.pins[id] ?? this.card.pins[MAIN_PIN];
    if ( stored ) return stored;
    return { x: 0.5, y: (L.pinR * 0.2) / L.fh };
  }

  /** A pin's centre in local space. */
  #pinLocal(id, L) {
    const f = (id && typeof id === "object") ? id : this.#pinFraction(id, L);
    return { x: L.left + (f.x * L.fw), y: L.top + (f.y * L.fh) };
  }

  /** A local point as fractions of the paper, clamped onto it. */
  #toFraction(local, L = this.layout()) {
    const clamp = v => Math.round(Math.min(Math.max(v, 0), 1) * 10000) / 10000;
    return { x: clamp((local.x - L.left) / L.fw), y: clamp((local.y - L.top) / L.fh) };
  }

  /** How close (in board units) the pointer must be to a pin to grab it. */
  pinReach(L = this.layout()) {
    return Math.max(L.pinR * 1.5, 10 / (canvas.stage?.scale.x || 1));
  }

  /** The shown pin under a local point, or null. */
  #pinAtLocal(local, { except = null } = {}) {
    const L = this.layout();
    const reach = this.pinReach(L);
    let best = null;
    let bestD = Infinity;
    for ( const id of this.shownPins() ) {
      if ( id === except ) continue;
      const p = this.#pinLocal(id, L);
      const d = Math.hypot(local.x - p.x, local.y - p.y);
      if ( (d <= reach) && (d < bestD) ) [best, bestD] = [id, d];
    }
    return best;
  }

  /** Ring these pins (or none) for the layer: a thread's snap target. */
  setPinHighlight(pins = []) {
    const next = new Set(pins);
    if ( (next.size === this.#highlights.size) && [...next].every(p => this.#highlights.has(p)) ) return;
    this.#highlights = next;
    this.refresh();
  }

  /** Can the pins be grabbed right now: moved (Select tool), or tied to (connecting)? */
  #pinsLive() {
    if ( this.dragging ) return false;
    const tool = this.layer.tool;
    if ( this.layer.connecting || (tool === "connect") ) return canEditBoard(canvas.scene);
    return (tool === "select") && this.movable;
  }

  #onPointerMove(event) {
    const pin = this.#pinsLive() ? this.#pinAtLocal(event.getLocalPosition(this)) : null;
    if ( pin === this.#hoverPin ) return;
    this.#hoverPin = pin;
    if ( !this.layer.connecting && (this.layer.tool === "select") ) this.cursor = pin ? "grab" : (this.editable ? "pointer" : "zoom-in");
    this.refresh();
  }

  /** The shown pin under a canvas point, or null. */
  pinAt(point) {
    return point ? this.#pinAtLocal(this.toLocal(point, canvas.stage)) : null;
  }

  /**
   * Where a thread touching this card at a canvas point hangs: an existing pin under the point, else
   * a new pin right there (when `create` and the card is editable), else the card's own pin.
   * @returns {{pin: string, at?: {x: number, y: number}}}  `at` is set for a pin still to be made
   */
  anchorAt(point, { create = true } = {}) {
    const pin = this.pinAt(point);
    if ( pin ) return { pin };
    if ( create && point && this.editable ) {
      return { pin: foundry.utils.randomID(), at: this.#toFraction(this.toLocal(point, canvas.stage)) };
    }
    return { pin: MAIN_PIN };
  }

  /**
   * A pin's centre in canvas coordinates, for the geometry shown right now.
   * @param {string|{pin: string, at?: object}} [pin]  A pin id, or an anchor from anchorAt
   */
  pinPoint(pin = MAIN_PIN) {
    const g = this.preview ?? this.card;
    const L = this.layout(g);
    const { x: lx, y: ly } = this.#pinLocal((typeof pin === "object") ? (pin.at ?? pin.pin) : pin, L);
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
    if ( !this.showsHandle ) return false;
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

  /** Moving needs the card to be movable (editable, not locked); pulling a thread only needs the board to be. */
  #canDrag() {
    return this.layer.isConnectTool ? canEditBoard(canvas.scene) : this.movable;
  }

  #onHoverIn() {
    this.hovered = true;
    this.cursor = (this.layer.connecting || this.layer.isConnectTool) ? "crosshair" : (this.editable ? "pointer" : "zoom-in");
    this.refresh();
  }

  #onHoverOut() {
    this.hovered = false;
    this.#hoverPin = null;
    this.refresh();
  }

  #onClickLeft(event) {
    event.stopPropagation();
    // Tying a thread: a click on the second card finishes it ("Connect to…" or the Connect tool).
    const connecting = this.layer.connecting;
    if ( connecting && (connecting.fromId !== this.id) ) {
      this.layer.finishConnect(this.id, event.interactionData?.origin ?? event.getLocalPosition(canvas.stage));
      return false;   // no drag from this press
    }
    if ( this.layer.isConnectTool ) {
      // The first card of a thread; a drag from here pulls the thread instead of moving the card.
      if ( connecting?.fromId === this.id ) return;
      this.layer.beginConnect(this.id, this.anchorAt(event.interactionData?.origin ?? event.getLocalPosition(canvas.stage)));
      return;
    }
    // Shift (or Ctrl/Cmd) adds the card to the selection or takes it out.
    const ne = event.nativeEvent ?? event;
    if ( event.shiftKey || event.ctrlKey || event.metaKey || ne.shiftKey || ne.ctrlKey || ne.metaKey ) {
      if ( !this.editable ) return false;
      // A card just taken out of the selection isn't dragged from this press.
      return this.layer.toggleSelect(this.id) ? undefined : false;
    }
    if ( this.selected && this.layer.multiSelected ) {
      // Pressing one of several selected cards keeps them all, so a drag moves the group; a plain
      // click (released without dragging) selects just this card.
      this.#collapseOnUp = true;
      window.addEventListener("pointerup", () => {
        if ( this.#collapseOnUp && !this.destroyed ) this.layer.select(this.id);
        this.#collapseOnUp = false;
      }, { once: true });
      return;
    }
    this.layer.select(this.editable ? this.id : null);
    // Set the cursor for a possible resize, which starts from this press
    if ( this.movable && this.#onHandle(event.getLocalPosition(this)) ) this.cursor = "nwse-resize";
  }

  #onClickLeft2(event) {
    event.stopPropagation();
    this.layer.openCard(this.id);
  }

  /** Set by a press on one of several selected cards; a drag clears it. */
  #collapseOnUp = false;

  #onClickRight(event) {
    event.stopPropagation();
    // Right-clicking one of several selected cards opens the menu for all of them.
    if ( this.editable && !this.selected ) this.layer.select(this.id);
    this.layer.openMenu(this, event);
  }

  #onDragLeftStart(event) {
    this.layer.closeMenu();
    this.#collapseOnUp = false;
    if ( this.layer.isConnectTool ) {
      if ( this.layer.connecting?.fromId !== this.id ) this.layer.beginConnect(this.id, this.anchorAt(event.interactionData.origin));
      this.dragging = { mode: "connect" };
      return;
    }
    const origin = event.interactionData.origin;
    const local = this.toLocal(origin, canvas.stage);
    // A press on a pin moves the pin (the resize handle wins where they overlap).
    const pin = !this.#onHandle(local) && this.#pinAtLocal(local);
    if ( pin ) {
      const start = { ...this.#pinFraction(pin, this.layout()) };
      this.dragging = { mode: "pin", pin, start, merge: null };
      this.#hoverPin = null;
      this.cursor = "grabbing";
      this.pinPreview = { id: pin, ...start };
      this.refresh();
      return;
    }
    const g = this.card;
    this.dragging = {
      mode: this.#onHandle(local) ? "resize" : "move",
      start: { x: g.x, y: g.y, width: g.width, height: g.height },
      origin: { x: origin.x, y: origin.y }
    };
    this.preview = { ...this.dragging.start };
    // One of several selected cards: the others follow it.
    if ( this.dragging.mode === "move" ) this.dragging.group = this.layer.beginGroupMove(this).length > 0;
    this.refresh();
  }

  /** Follow the card being dragged in a group move (see BoardLayer#beginGroupMove). */
  follow() {
    const g = this.card;
    this.dragging = { mode: "move", follower: true, start: { x: g.x, y: g.y, width: g.width, height: g.height } };
    this.preview = { ...this.dragging.start };
    this.refresh();
  }

  /** Show the follower moved by an offset from where the group move started. */
  followBy(dx, dy) {
    if ( !this.dragging?.follower ) return;
    const s = this.dragging.start;
    this.preview = { ...s, x: s.x + dx, y: s.y + dy };
    this.refresh();
  }

  /**
   * The group move is over. A dropped card stays shown where it landed until the saved position
   * arrives; a cancelled one snaps back.
   */
  endFollow({ dx = 0, dy = 0, keep = false } = {}) {
    if ( this.destroyed ) return;
    const s = this.dragging?.start ?? this.card;
    this.dragging = null;
    this.preview = keep ? { ...s, x: s.x + dx, y: s.y + dy } : null;
    this.refresh();
  }

  #onDragLeftMove(event) {
    if ( !this.dragging ) return;
    if ( this.dragging.mode === "connect" ) return this.layer.updateRubber(event.interactionData.destination);
    if ( this.dragging.mode === "pin" ) return this.#pinFrom(event.interactionData.destination);
    this.#previewFrom(event.interactionData.destination);
    this.refresh();
    if ( this.dragging.group ) {
      const { start } = this.dragging;
      this.layer.moveGroup(this.preview.x - start.x, this.preview.y - start.y);
    }
    this.#emitDrag();
  }

  /** Move the dragged pin under the pointer at `dest` (canvas coordinates). */
  #pinFrom(dest) {
    if ( !dest ) return;
    const local = this.toLocal(dest, canvas.stage);
    this.pinPreview = { id: this.dragging.pin, ...this.#toFraction(local) };
    // Dropped on another of this card's pins, the two merge: one pin holding both pins' threads.
    this.dragging.merge = this.#pinAtLocal(local, { except: this.dragging.pin });
    this.refresh();
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
    if ( this.dragging?.group ) return this.layer.emitGroupDrag();
    this.layer.emitDrag([{ id: this.id, ...this.preview }]);
  }

  async #onDragLeftDrop(event) {
    if ( this.dragging?.mode === "connect" ) {
      // Released over another card ties the thread; anywhere else drops it.
      this.dragging = null;
      const dest = event.interactionData?.destination;
      const target = dest && this.layer.cardAt(dest);
      if ( target && (target.id !== this.id) ) return this.layer.finishConnect(target.id, dest);
      return this.layer.cancelConnect();
    }
    if ( this.dragging?.mode === "pin" ) {
      this.#pinFrom(event.interactionData?.destination);
      const { pin, start, merge } = this.dragging;
      const at = { x: this.pinPreview.x, y: this.pinPreview.y };
      this.dragging = null;
      this.cursor = "grab";
      if ( merge ) return this.layer.mergePins(this.id, pin, merge);
      if ( (at.x === start.x) && (at.y === start.y) ) {
        this.pinPreview = null;
        return this.refresh();
      }
      return this.layer.movePin(this.id, pin, at);
    }
    if ( !this.dragging || !this.preview ) return;
    // Moves are throttled to the frame rate, so take the final position from the drop itself.
    this.#previewFrom(event.interactionData?.destination);
    const { start } = this.dragging;
    if ( this.dragging.group ) return this.layer.dropGroup(this.preview.x - start.x, this.preview.y - start.y);
    const rect = canvas.dimensions.sceneRect;
    const next = { ...this.preview, ...clampToRect(this.preview, rect) };
    this.dragging = null;
    this.preview = next;
    this.refresh();
    const changed = ["x", "y", "width", "height"].some(k => next[k] !== start[k]);
    if ( !changed ) {
      this.preview = null;
      this.layer.emitDragEnd([this.id]);
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
    const group = this.dragging.group;
    this.dragging = null;
    this.preview = this.pinPreview = null;
    this.cursor = this.editable ? "pointer" : "zoom-in";
    this.refresh();
    if ( group ) this.layer.cancelGroup();
    else this.layer.emitDragEnd([this.id]);
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
