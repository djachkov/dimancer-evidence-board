import { FLAG_BOARD, t } from "./constants.mjs";
import {
  A4, cardList, cardUpdate, cardCreate, cardDelete, isEvidence, newCard, topSort, bottomSort, isTop, clampToRect
} from "./cards.mjs";
import { isBoard, boardCards, boardLinks, boardSettings, getCard, canEditBoard, canEditCard, canSeeCard } from "./permissions.mjs";
import { THREAD_COLORS, linkBetween, linkCreate, linkDelete, linkUpdate, linksOf, newLink, visibleLinks } from "./links.mjs";
import ThreadObject from "./thread-object.mjs";
import { emit } from "./socket.mjs";
import CardObject from "./card-object.mjs";
import { openAddEvidence } from "./add-evidence.mjs";
import { imageSize } from "./uploads.mjs";
import { PdfViewer, isPdfDocument, pdfCardSize } from "./pdf-preview.mjs";
import { closeMenu, menuItems, showMenu } from "./menu.mjs";
import { categoriesOf, openCategoryPicker } from "./organize-actions.mjs";
import {
  INK_COLORS, NOTE_COLORS, NOTE_MAX_TEXT, cardLabel, noteSizeFor, localToView, newNote, newSketch, simplifyPoints,
  strokeAddUpdate, strokeDeleteUpdate, viewScale
} from "./stickers.mjs";
import { drawStroke } from "./ink.mjs";
import { closePenBar, penPrefs, showPenBar } from "./pen-bar.mjs";
import { closeNoteEditor, editNote } from "./note-editor.mjs";
import {
  canEditJournal, canEditPage, createEvidencePage, deleteEvidence, getEvidenceJournal, linkCardToJournal,
  newDocument, openEvidenceJournal, pageOfCard, removeCards
} from "./journal-store.mjs";

/**
 * The board's interaction layer. It draws the evidence cards stored in the Scene's flags and owns
 * selection, the card menu and all writes back to the Scene. On a non-board scene it's empty.
 */
export default class BoardLayer extends foundry.canvas.layers.InteractionLayer {
  /** @override */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: "board", zIndex: 150 });
  }

  /** @type {Map<string, CardObject>} */
  cards = new Map();

  /** @type {string|null} */
  selectedId = null;

  /** @type {Map<string, ThreadObject>} */
  threads = new Map();

  /** Threads are drawn above every card (but below a card being dragged). */
  threadLayer = null;

  /**
   * An in-progress connection: the card the thread starts from, and the rubber-band line that
   * follows the cursor until another card is clicked.
   * @type {{fromId: string, rubber: PIXI.Graphics, onMove: Function, onKey: Function}|null}
   */
  connecting = null;

  #threadsQueued = false;

  #remoteTimers = new Map();

  get scene() {
    return canvas.scene;
  }

  get isBoard() {
    return isBoard(this.scene);
  }

  /* -------------------------------------------- */
  /*  Scene controls                              */
  /* -------------------------------------------- */

  /** @override */
  static prepareSceneControls() {
    const scene = canvas?.scene;
    if ( !isBoard(scene) ) return null;
    const editable = canEditBoard(scene);
    return {
      name: "board",
      order: 0,
      title: "DIMANCER_BOARD.Controls.Group",
      layer: "board",
      icon: "fa-solid fa-thumbtack",
      onChange: (event, active) => {
        if ( active ) canvas.board.activate();
      },
      onToolChange: (event, tool, active) => {
        if ( !active ) return;
        // The Connect tool doesn't use the selection; a (re-)activated Select tool keeps it.
        if ( tool.name !== "select" ) canvas.board.select(null);
        canvas.board.cancelConnect();
        canvas.board.syncTool();
      },
      tools: {
        select: {
          name: "select",
          order: 1,
          title: "DIMANCER_BOARD.Controls.Select",
          icon: "fa-solid fa-hand-pointer",
          interaction: true
        },
        connect: {
          name: "connect",
          order: 2,
          title: "DIMANCER_BOARD.Controls.Connect",
          icon: "fa-solid fa-link",
          interaction: true,
          visible: editable
        },
        note: {
          name: "note",
          order: 3,
          title: "DIMANCER_BOARD.Controls.Note",
          icon: "fa-solid fa-note-sticky",
          visible: editable
        },
        draw: {
          name: "draw",
          order: 4,
          title: "DIMANCER_BOARD.Controls.Draw",
          icon: "fa-solid fa-pen",
          visible: editable
        },
        journal: {
          name: "journal",
          order: 5,
          title: "DIMANCER_BOARD.Controls.Journal",
          icon: "fa-solid fa-book",
          button: true,
          visible: game.user.isGM || !!getEvidenceJournal()?.visible,
          onChange: () => openEvidenceJournal()
        },
        add: {
          name: "add",
          order: 6,
          title: "DIMANCER_BOARD.Controls.Add",
          icon: "fa-solid fa-image",
          button: true,
          visible: editable,
          onChange: () => openAddEvidence()
        },
        document: {
          name: "document",
          order: 7,
          title: "DIMANCER_BOARD.Controls.Document",
          icon: "fa-solid fa-file-lines",
          button: true,
          visible: editable && (game.user.isGM || canEditJournal()),
          onChange: () => newDocument({ place: true })
        },
        lock: {
          name: "lock",
          order: 8,
          title: "DIMANCER_BOARD.Controls.Lock",
          icon: "fa-solid fa-lock",
          toggle: true,
          visible: game.user.isGM,
          active: boardSettings(scene).locked,
          onChange: (event, active) => canvas.scene.update({ [`${FLAG_BOARD}.locked`]: active })
        }
      },
      activeTool: "select"
    };
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _draw(options) {
    await super._draw(options);
    this.sortableChildren = true;
    this.cards.clear();
    this.threads.clear();
    this.selectedId = null;
    this.connecting = null;
    if ( !this.isBoard ) return;
    this.threadLayer = this.addChild(new PIXI.Container());
    this.threadLayer.zIndex = Number.MAX_SAFE_INTEGER - 1;
    await this.refreshCards();
  }

  /** @override */
  async _tearDown(options) {
    this.closeMenu();
    this.cancelConnect();
    this.#cancelStroke();
    closeNoteEditor(true);
    closePenBar();
    this.#undo = [];
    this.#session = null;
    for ( const timer of this.#remoteTimers.values() ) clearTimeout(timer);
    this.#remoteTimers.clear();
    this.cards.clear();
    this.threads.clear();
    this.threadLayer = null;
    this.selectedId = null;
    return super._tearDown(options);
  }

  /** The board's categories by id, refreshed with the cards. */
  categories = new Map();

  /** Bring the drawn cards in line with the Scene's flags. */
  async refreshCards() {
    if ( !this.isBoard ) return;
    this.categories = new Map(categoriesOf(this.scene).map(c => [c.id, c]));
    const wanted = new Map(cardList(boardCards(this.scene)).filter(c => canSeeCard(c)).map(c => [c.id, c]));
    for ( const [id, obj] of this.cards ) {
      if ( wanted.has(id) ) continue;
      this.cards.delete(id);
      obj.destroy();
      if ( this.selectedId === id ) this.selectedId = null;
    }
    const pending = [];
    for ( const [id, card] of wanted ) {
      const obj = this.cards.get(id);
      if ( obj ) {
        if ( !foundry.utils.equals(obj.card, card) ) pending.push(obj.setCard(card));
        continue;
      }
      const created = new CardObject(this, card);
      this.cards.set(id, created);
      this.addChild(created);
      pending.push(created.draw());
    }
    await Promise.all(pending);
    // Permissions can change without the card changing (board lock, ownership), so refresh all.
    for ( const obj of this.cards.values() ) obj.refresh();
    this.refreshThreads();
  }

  /* -------------------------------------------- */
  /*  Threads                                     */
  /* -------------------------------------------- */

  /** Redraw the threads once the current batch of card changes is done. */
  queueThreads() {
    if ( this.#threadsQueued ) return;
    this.#threadsQueued = true;
    queueMicrotask(() => {
      this.#threadsQueued = false;
      this.refreshThreads();
    });
  }

  /** Bring the drawn threads in line with the Scene's flags and the cards' current positions. */
  refreshThreads() {
    if ( !this.isBoard || !this.threadLayer || this.threadLayer.destroyed ) return;
    const wanted = new Map(visibleLinks(boardLinks(this.scene), [...this.cards.keys()]).map(l => [l.id, l]));
    for ( const [id, obj] of this.threads ) {
      if ( wanted.has(id) ) continue;
      this.threads.delete(id);
      obj.destroy();
    }
    const interactive = canEditBoard(this.scene) && !this.connecting;
    for ( const [id, link] of wanted ) {
      let obj = this.threads.get(id);
      if ( !obj ) {
        obj = new ThreadObject(this, link);
        this.threads.set(id, obj);
        this.threadLayer.addChild(obj);
      }
      obj.link = link;
      const a = this.cards.get(link.from);
      const b = this.cards.get(link.to);
      obj.draw(a.pinPoint(), b.pinPoint(), { faded: a.card.hidden || b.card.hidden, interactive });
    }
  }

  /** The board tool in use, or null when another control is active. */
  get tool() {
    return (ui.controls.control?.name === "board") ? (ui.controls.tool?.name ?? null) : null;
  }

  get isConnectTool() {
    return this.tool === "connect";
  }

  /** The Note and Draw tools work on the board itself: cards and threads stop catching the mouse. */
  get isStickerTool() {
    return ["note", "draw"].includes(this.tool);
  }

  /** Match interactivity and the pen bar to the current tool. */
  syncTool() {
    if ( !this.isBoard || !this.active ) return closePenBar();
    const tool = this.tool;
    this.interactiveChildren = !this.isStickerTool;
    if ( this.isStickerTool && canEditBoard(this.scene) ) showPenBar(tool, { onUndo: () => this.undoStroke() });
    else closePenBar();
    if ( tool !== "draw" ) this.#session = null;
  }

  /** The topmost card under a canvas point. */
  cardAt(point) {
    const objs = [...this.cards.values()].sort((a, b) => b.zIndex - a.zIndex);
    return objs.find(o => {
      const local = o.toLocal(point, canvas.stage);
      return o.hitArea?.contains(local.x, local.y);
    }) ?? null;
  }

  /**
   * Start a thread from a card. A line follows the cursor until another card is clicked;
   * Esc, right-click or a click on the empty board cancels.
   */
  beginConnect(fromId) {
    if ( !canEditBoard(this.scene) || !this.cards.has(fromId) ) return;
    this.cancelConnect();
    this.closeMenu();
    this.select(null);
    const rubber = this.threadLayer.addChild(new PIXI.Graphics());
    rubber.eventMode = "none";   // the line ends under the cursor; clicks must reach the card below
    const onMove = event => this.updateRubber(event.getLocalPosition(canvas.stage));
    const onKey = event => {
      if ( event.key === "Escape" ) {
        event.stopPropagation();
        this.cancelConnect();
      }
    };
    canvas.stage.on("pointermove", onMove);
    document.addEventListener("keydown", onKey, { capture: true });
    this.connecting = { fromId, rubber, onMove, onKey };
    document.body.classList.add("dimancer-board-connecting");
    this.refreshThreads();   // threads stop catching clicks while connecting
    this.updateRubber(canvas.mousePosition);
  }

  /** Draw the in-progress thread from its pin to a canvas point. */
  updateRubber(point) {
    const c = this.connecting;
    const from = c && this.cards.get(c.fromId);
    if ( !from || !point ) return;
    const p = from.pinPoint();
    c.rubber.clear()
      .lineStyle({ width: 4, color: 0xc0392b, alpha: 0.75, cap: PIXI.LINE_CAP.ROUND })
      .moveTo(p.x, p.y).lineTo(point.x, point.y)
      .lineStyle(0).beginFill(0xc0392b, 0.9).drawCircle(point.x, point.y, 6).endFill();
  }

  /** Tie the in-progress thread to a card. */
  async finishConnect(toId) {
    const c = this.connecting;
    if ( !c ) return;
    if ( toId === c.fromId ) return this.cancelConnect();
    const fromId = c.fromId;
    this.cancelConnect();
    return this.createLink(fromId, toId);
  }

  cancelConnect() {
    const c = this.connecting;
    if ( !c ) return;
    this.connecting = null;
    canvas.stage?.off("pointermove", c.onMove);
    document.removeEventListener("keydown", c.onKey, { capture: true });
    if ( !c.rubber.destroyed ) c.rubber.destroy();
    document.body.classList.remove("dimancer-board-connecting");
    this.refreshThreads();
  }

  async createLink(from, to) {
    const scene = this.scene;
    if ( !canEditBoard(scene) ) return ui.notifications.warn(t("Notify.NoEdit"));
    if ( linkBetween(boardLinks(scene), from, to) ) return ui.notifications.info(t("Notify.AlreadyConnected"));
    const link = newLink({ id: foundry.utils.randomID(), from, to, author: game.user.id, created: Date.now() });
    if ( link ) await scene.update(linkCreate(link));
    return link;
  }

  async deleteLinks(ids) {
    if ( !ids.length || !canEditBoard(this.scene) ) return;
    await this.scene.update(linkDelete(ids, _del));
  }

  async setLinkColor(id, color) {
    if ( !canEditBoard(this.scene) ) return;
    await this.scene.update(linkUpdate(id, { color }));
  }

  /* -------------------------------------------- */
  /*  Selection and events                        */
  /* -------------------------------------------- */

  select(id) {
    if ( this.selectedId === id ) return;
    const prev = this.cards.get(this.selectedId);
    this.selectedId = id;
    prev?.refresh();
    this.cards.get(id)?.refresh();
  }

  /**
   * When leaving a board, core re-activates the layer that was active ("board") on the next scene,
   * where there is no board control; SceneControls then crashes. Hand over to tokens instead.
   * @override
   */
  activate(options) {
    if ( !this.isBoard ) return canvas.tokens.activate();
    return super.activate(options);
  }

  /** @override */
  _activate() {
    this.syncTool();
  }

  /** @override */
  _deactivate() {
    this.select(null);
    this.closeMenu();
    this.cancelConnect();
    this.#cancelStroke();
    closePenBar();
  }

  /** @override */
  _onClickLeft(event) {
    this.select(null);
    this.closeMenu();
    this.cancelConnect();
    const point = event.interactionData?.origin ?? event.getLocalPosition(canvas.stage);
    if ( this.tool === "note" ) return this.placeNote(point);
    if ( this.tool === "draw" ) {
      // Core reports the click on press. The stroke starts now; a drag continues it, and a press
      // released without dragging leaves a dot.
      this.#beginStroke(point);
      window.addEventListener("pointerup", () => {
        if ( this.#stroke && !this.#stroke.dragging ) this.#finishStroke(null);
      }, { once: true });
    }
  }

  /* -------------------------------------------- */
  /*  Stickers: notes and drawing                 */
  /* -------------------------------------------- */

  /**
   * The stroke being drawn: its points in board coordinates, the card it goes on (null = a new
   * sketch) and the preview line.
   * @type {{points: number[], target: string|null, color: string, width: number, preview: PIXI.Graphics}|null}
   */
  #stroke = null;

  /** The sketch this drawing session is adding to, so strokes drawn close together stay together. */
  #session = null;

  /** This client's strokes, newest last, for undo. */
  #undo = [];

  /** @override */
  _canDragLeftStart(user, event) {
    return (this.tool !== "draw") || canEditBoard(this.scene);
  }

  /** @override */
  _onDragLeftStart(event) {
    if ( this.tool !== "draw" ) return;
    if ( !this.#stroke ) this.#beginStroke(event.interactionData.origin);
    if ( this.#stroke ) this.#stroke.dragging = true;
  }

  /** @override */
  _onDragLeftMove(event) {
    if ( this.#stroke ) this.#extendStroke(event.interactionData.destination);
  }

  /** @override */
  _onDragLeftDrop(event) {
    if ( this.#stroke ) return this.#finishStroke(event.interactionData.destination);
  }

  /** @override */
  _onDragLeftCancel(event) {
    this.#cancelStroke();
  }

  /** @override */
  _onUndoKey(event) {
    if ( !this.#undo.length ) return false;
    this.undoStroke();
    return true;
  }

  /**
   * Which card a stroke starting here draws on: the card under the pen (evidence, note or sketch),
   * so the ink travels with it; else the sketch this session has been drawing (if the pen is near
   * it); else none (a new sketch).
   */
  #strokeTarget(point) {
    const hit = this.cardAt(point);
    if ( hit ) return canEditCard(this.scene, hit.card) ? hit.id : null;
    const session = this.cards.get(this.#session);
    if ( !session || !canEditCard(this.scene, session.card) ) return null;
    const { x, y, width, height } = session.card;
    const near = 60;
    const inside = (point.x >= x - near) && (point.x <= x + width + near) && (point.y >= y - near) && (point.y <= y + height + near);
    return inside ? session.id : null;
  }

  #beginStroke(point) {
    this.#cancelStroke();
    if ( !point || !canEditBoard(this.scene) ) return;
    const { ink, width } = penPrefs();
    const preview = this.addChild(new PIXI.Graphics());
    preview.eventMode = "none";
    preview.zIndex = Number.MAX_SAFE_INTEGER;
    this.#stroke = { points: [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10], target: this.#strokeTarget(point), color: ink, width, preview };
    this.#drawPreview();
  }

  #extendStroke(point) {
    const st = this.#stroke;
    if ( !st || !point ) return;
    const [lx, ly] = st.points.slice(-2);
    // Ignore jitter smaller than a screen pixel.
    if ( Math.hypot(point.x - lx, point.y - ly) < (1 / canvas.stage.scale.x) ) return;
    st.points.push(Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10);
    this.#drawPreview();
  }

  #drawPreview() {
    const st = this.#stroke;
    st.preview.clear();
    drawStroke(st.preview, st);
  }

  #cancelStroke() {
    const st = this.#stroke;
    this.#stroke = null;
    if ( st && !st.preview.destroyed ) st.preview.destroy();
  }

  async #finishStroke(point) {
    const st = this.#stroke;
    if ( !st ) return;
    this.#extendStroke(point);
    this.#stroke = null;
    const scene = this.scene;
    const strokeId = foundry.utils.randomID();
    const points = simplifyPoints(st.points);
    try {
      const target = st.target && getCard(scene, st.target);
      const obj = target && this.cards.get(target.id);
      if ( target && obj ) {
        // Into the card's view box: undo its rotation, position and scale.
        const view = [];
        for ( let i = 0; i < points.length; i += 2 ) {
          const local = obj.toLocal({ x: points[i], y: points[i + 1] }, canvas.stage);
          const v = localToView(target, local.x + (target.width / 2), local.y + (target.height / 2));
          view.push(Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10);
        }
        const width = Math.round(st.width * viewScale(target) * 10) / 10;
        await scene.update(strokeAddUpdate(target, strokeId, { color: st.color, width, points: view, author: game.user.id }));
        this.#undo.push({ cardId: target.id, strokeId });
        if ( target.kind === "sketch" ) this.#session = target.id;
      } else {
        const card = newSketch({
          id: foundry.utils.randomID(), strokeId, cards: boardCards(scene),
          stroke: { color: st.color, width: st.width, points, author: game.user.id },
          author: game.user.id, created: Date.now()
        });
        await scene.update(cardCreate(card));
        this.#undo.push({ cardId: card.id, strokeId });
        this.#session = card.id;
      }
    } catch(err) {
      ui.notifications.error(err.message);
    } finally {
      if ( !st.preview.destroyed ) st.preview.destroy();
    }
  }

  /** Take back this client's last stroke. A sketch left with no ink goes away. */
  async undoStroke() {
    const scene = this.scene;
    while ( this.#undo.length ) {
      const { cardId, strokeId } = this.#undo.pop();
      const card = getCard(scene, cardId);
      if ( !card?.strokes[strokeId] || !canEditCard(scene, card) ) continue;
      const remaining = Object.keys(card.strokes).filter(id => id !== strokeId);
      if ( (card.kind === "sketch") && !remaining.length ) return this.deleteCards([cardId], { confirm: false });
      return scene.update(strokeDeleteUpdate(cardId, [strokeId], _del));
    }
    ui.notifications.info(t("Sticker.NothingToUndo"));
  }

  /**
   * Stick a new note on the board. With the Note tool it opens for typing; given text (a paste),
   * it's sized to the text and just placed.
   * @param {{x: number, y: number}} point  Centre
   * @param {{text?: string}} [options]
   */
  async placeNote(point, { text = "" } = {}) {
    const scene = this.scene;
    if ( !canEditBoard(scene) ) return ui.notifications.warn(t("Notify.NoEdit"));
    text = text.slice(0, NOTE_MAX_TEXT);
    const card = newNote({
      id: foundry.utils.randomID(), x: point.x, y: point.y, text, size: noteSizeFor(text),
      color: penPrefs().paper, cards: boardCards(scene),
      rotation: Math.round(((Math.random() * 4) - 2) * 10) / 10,
      author: game.user.id, created: Date.now()
    });
    Object.assign(card, clampToRect(card, canvas.dimensions.sceneRect));
    await scene.update(cardCreate(card));
    if ( text ) {
      if ( this.tool === "select" ) this.select(card.id);
      this.cards.get(card.id)?.flash(900);
      return card;
    }
    // Back to Select, like most whiteboards: the next click moves things again.
    ui.controls.activate({ control: "board", tool: "select" });
    this.select(card.id);
    return editNote(this, card.id, { isNew: true });
  }

  editNote(cardId) {
    return editNote(this, cardId);
  }

  /** Double-click: open evidence in the Evidence Journal, write on a note. */
  openCard(cardId) {
    const card = getCard(this.scene, cardId);
    if ( !card ) return;
    if ( isEvidence(card) ) return this.openInJournal(cardId);
    if ( card.kind === "note" ) return this.editNote(cardId);
  }

  /**
   * Show a piece of evidence in the Evidence Journal. A card that isn't in the journal yet (pinned
   * before it existed) is added first, when this user may; otherwise an image just opens on its own.
   */
  async openInJournal(cardId) {
    this.closeMenu();
    const card = getCard(this.scene, cardId);
    if ( !card ) return;
    let page = pageOfCard(card);
    if ( !page && canEditCard(this.scene, card) && canEditJournal() ) page = await linkCardToJournal(this.scene, cardId);
    if ( page ) return openEvidenceJournal({ pageId: page.id });
    if ( (card.kind === "image") && card.src ) {
      return new foundry.applications.apps.ImagePopout({ src: card.src, window: { title: card.title || t("Card.Untitled") } }).render({ force: true });
    }
    ui.notifications.warn(t("Journal.Missing"));
  }

  /** @override */
  _onClickRight(event) {
    this.closeMenu();
    this.cancelConnect();
  }

  /** @override */
  async _onDeleteKey(event) {
    if ( !this.selectedId ) return false;
    await this.deleteCards([this.selectedId]);
    return true;
  }

  /* -------------------------------------------- */
  /*  Writes                                      */
  /* -------------------------------------------- */

  #update(update) {
    return this.scene.update(update);
  }

  /** Save a drag result, bringing the card to the front. */
  async commitGeometry(id, geometry) {
    const card = getCard(this.scene, id);
    if ( !card || !canEditCard(this.scene, card) ) return this.refreshCards();
    const patch = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
    const cards = boardCards(this.scene);
    if ( !isTop(cards, id) ) patch.sort = topSort(cards);
    try {
      await this.#update(cardUpdate(id, patch));
    } catch(err) {
      ui.notifications.error(err.message);
      this.cards.get(id)?.setCard(card);
    }
  }

  async patchCard(id, patch) {
    const card = getCard(this.scene, id);
    if ( !card || !canEditCard(this.scene, card) ) return;
    return this.#update(cardUpdate(id, patch));
  }

  /**
   * Pin a new image on the board.
   * @param {object} data
   * @param {string} data.src
   * @param {number} [data.x]          Centre, defaults to the middle of the current view
   * @param {number} [data.y]
   * @param {string} [data.title]
   * @param {string|null} [data.link]  Source document UUID
   * @param {{width: number, height: number}|null} [data.size]  Natural image size, if known
   * @param {string} [data.notes]
   * @param {string|null} [data.page]   The Evidence Journal page it shows (placing from the journal)
   * @param {boolean} [data.hidden]
   * @param {boolean} [data.journal]    Also add it to the Evidence Journal (when it has no page yet)
   * @param {"image"|"document"} [data.kind]  A text document is drawn as A4 paper instead
   * @param {string[]} [data.docPages]  A document's pages (HTML each)
   */
  async addCard({ src = "", x, y, title = "", link = null, size = null, category = null, folder = null,
    notes = "", page = null, hidden = false, journal = true, kind = "image", docPages }) {
    const scene = this.scene;
    if ( !canEditBoard(scene) ) {
      ui.notifications.warn(t("Notify.NoEdit"));
      return null;
    }
    const centre = { x: x ?? canvas.stage.pivot.x, y: y ?? canvas.stage.pivot.y };
    const document = kind === "document";
    // A text document is A4; a PDF takes its first page's shape.
    size ??= document ? (src ? await pdfCardSize(src) : A4) : await imageSize(src);
    // Evidence pinned on a board also goes into the Evidence Journal (POC), as a page this card shows.
    if ( !page && journal && canEditJournal() ) {
      try {
        page = (await createEvidencePage({ title, src, notes, link, kind, docPages }, { hidden }))?.uuid ?? null;
      } catch(err) {
        console.warn("dimancer_board | could not add evidence to the journal", err);
      }
    }
    const card = newCard({
      id: foundry.utils.randomID(), src, ...centre, title, link, category, folder, notes, page, hidden,
      kind: document ? "document" : "image", docPages,
      naturalWidth: size?.width, naturalHeight: size?.height,
      cards: boardCards(scene),
      rotation: Math.round(((Math.random() * 4) - 2) * 10) / 10,   // a slight hand-pinned tilt
      author: game.user.id, created: Date.now()
    });
    Object.assign(card, clampToRect(card, canvas.dimensions.sceneRect));
    await scene.update(cardCreate(card));
    this.activate();
    this.select(card.id);
    return card;
  }

  /**
   * Delete cards, confirming first when any of them was pinned by someone else. Cards that show
   * Evidence Journal pages ask whether to just take them off the board (the evidence stays in the
   * journal) or to delete the evidence everywhere.
   */
  async deleteCards(ids, { confirm = true } = {}) {
    const scene = this.scene;
    let cards = ids.map(id => getCard(scene, id)).filter(c => c && canEditCard(scene, c));
    if ( !cards.length ) return;
    const linked = cards.filter(c => pageOfCard(c));
    if ( linked.length && confirm ) {
      const deletable = linked.some(c => canEditPage(pageOfCard(c)));
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: t("Card.DeleteTitle") },
        content: `<p>${t("Journal.CardDelete", { title: foundry.utils.escapeHTML(cardLabel(linked[0])) })}</p>`,
        buttons: [
          { action: "board", label: t("Journal.MoveToJournal"), icon: "fa-solid fa-book", default: true },
          deletable && { action: "everywhere", label: t("Journal.DeleteEverywhere"), icon: "fa-solid fa-trash" },
          { action: "cancel", label: t("Add.Cancel"), icon: "fa-solid fa-xmark" }
        ].filter(Boolean),
        rejectClose: false
      });
      if ( (choice !== "board") && (choice !== "everywhere") ) return;
      this.select(null);
      if ( choice === "everywhere" ) {
        for ( const c of linked ) {
          const p = pageOfCard(c);
          if ( canEditPage(p) ) await deleteEvidence(p, { fromBoards: true });
        }
      }
      // Whatever is still here comes off the board (the evidence stays in the journal).
      const left = cards.map(c => c.id).filter(id => getCard(scene, id));
      return removeCards(scene, left);
    }
    const others = cards.some(c => c.author && (c.author !== game.user.id));
    if ( others && confirm ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("Card.DeleteTitle") },
        content: `<p>${t("Card.DeleteOthers", { title: foundry.utils.escapeHTML(cardLabel(cards[0])) })}</p>`
      });
      if ( !ok ) return;
    }
    this.select(null);
    const cardIds = cards.map(c => c.id);
    // A card's threads go with it, in the same update.
    const threads = linksOf(boardLinks(scene), cardIds).map(l => l.id);
    await scene.update({ ...cardDelete(cardIds, _del), ...linkDelete(threads, _del) });
  }

  /* -------------------------------------------- */
  /*  Live drag previews                          */
  /* -------------------------------------------- */

  emitDrag(cardId, g) {
    emit("drag", { sceneId: this.scene.id, cardId, x: g.x, y: g.y, width: g.width, height: g.height });
  }

  emitDragEnd(cardId) {
    emit("dragEnd", { sceneId: this.scene.id, cardId });
  }

  /** Another client is dragging (geometry) or stopped dragging (null). */
  onRemoteDrag(cardId, geometry) {
    const obj = this.cards.get(cardId);
    if ( !obj ) return;
    clearTimeout(this.#remoteTimers.get(cardId));
    obj.showRemotePreview(geometry);
    // If the dragging client vanishes mid-drag, don't leave the card floating.
    if ( geometry ) this.#remoteTimers.set(cardId, setTimeout(() => obj.showRemotePreview(null), 3000));
  }

  /* -------------------------------------------- */
  /*  Card menu                                   */
  /* -------------------------------------------- */

  /**
   * Pan and zoom the board so a card fills a good part of the view.
   * @param {string} cardId
   * @param {{flash?: boolean, select?: boolean}} [options]  Pulse a highlight around the card once
   *   it's in view; select it (when this user may edit it)
   */
  async panToCard(cardId, { flash = false, select = true } = {}) {
    const card = getCard(this.scene, cardId);
    if ( !card || !canSeeCard(card) ) return;
    const scale = Math.clamp(Math.min(window.innerWidth / (card.width * 3), window.innerHeight / (card.height * 3)), 0.25, 2);
    if ( select ) this.select(canEditCard(this.scene, card) ? cardId : null);
    await canvas.animatePan({ x: card.x + (card.width / 2), y: card.y + (card.height / 2), scale, duration: 400 });
    if ( flash ) this.cards.get(cardId)?.flash();
  }

  /**
   * A small HTML menu for one card, opened with right-click.
   * @param {CardObject} obj
   * @param {PIXI.FederatedPointerEvent} event
   */
  openMenu(obj, event) {
    this.cancelConnect();
    const card = obj.card;
    const editable = canEditCard(this.scene, card);
    const boardEditable = canEditBoard(this.scene);
    const threadCount = linksOf(boardLinks(this.scene), [card.id]).length;
    const gm = game.user.isGM;
    const kind = card.kind;
    const inkCount = Object.keys(card.strokes).length;
    const items = [
      isEvidence(card) && { action: "view", icon: "fa-book-open", label: t("Journal.ShowInJournal") },
      isPdfDocument(card) && { action: "readPdf", icon: "fa-book-open-reader", label: t("Journal.ReadPdf") },
      (kind === "note") && editable && { action: "edit", icon: "fa-i-cursor", label: t("Sticker.Edit") },
      boardEditable && (this.cards.size > 1) && { action: "connect", icon: "fa-link", label: t("Card.Connect") },
      boardEditable && threadCount && { action: "unlink", icon: "fa-link-slash", label: t("Card.Unlink", { count: threadCount }) },
      editable && { action: "category", icon: "fa-tag", label: t("Category.Set") },
      editable && (kind !== "note") && { action: "rename", icon: "fa-pen", label: t("Card.Rename") },
      editable && (kind !== "sketch") && inkCount && { action: "clearInk", icon: "fa-eraser", label: t("Sticker.ClearInk") },
      editable && { action: "front", icon: "fa-arrow-up", label: t("Card.Front") },
      editable && { action: "back", icon: "fa-arrow-down", label: t("Card.Back") },
      gm && { action: "hide", icon: card.hidden ? "fa-eye" : "fa-eye-slash", label: t(card.hidden ? "Card.Reveal" : "Card.Hide") },
      gm && { action: "lock", icon: card.locked ? "fa-lock-open" : "fa-lock", label: t(card.locked ? "Card.Unlock" : "Card.Lock") },
      // Evidence Journal (POC)
      editable && card.page && { action: "unplace", icon: "fa-book", label: t("Journal.MoveToJournal") },
      editable && isEvidence(card) && !card.page && canEditJournal() && { action: "addJournal", icon: "fa-book-medical", label: t("Journal.AddToJournal") },
      editable && { action: "delete", icon: "fa-trash", label: t("Card.Delete"), danger: true }
    ];
    const ne = event.nativeEvent ?? event;
    this.#menuAt = { x: ne.clientX, y: ne.clientY };
    // Stickers get colour swatches on top: the paper of a note, the ink of a sketch.
    let swatches = "";
    if ( editable && !isEvidence(card) ) {
      const sketch = kind === "sketch";
      const colors = sketch ? INK_COLORS : NOTE_COLORS;
      const inks = new Set(Object.values(card.strokes).map(s => s.color));
      swatches = `<div class="dimancer-board-swatches">${colors.map(c => {
        const active = sketch ? ((inks.size === 1) && inks.has(c.color)) : (c.color === card.color);
        const label = t(`${sketch ? "Sticker.InkColor" : "Sticker.PaperColor"}.${c.key}`);
        return `<button type="button" class="swatch${active ? " active" : ""}" data-action="${sketch ? "ink" : "paper"}"
          data-color="${c.color}" style="--swatch: ${c.color}" aria-label="${label}" data-tooltip="${label}"></button>`;
      }).join("")}</div>`;
    }
    showMenu(ne.clientX, ne.clientY, swatches + menuItems(items), (action, button) => this.#onMenuAction(action, card.id, button));
  }

  /** Where the last card menu opened (follow-up pickers open there too). */
  #menuAt = { x: 0, y: 0 };

  /**
   * The menu for one thread: its colour and delete.
   * @param {ThreadObject} obj
   * @param {PIXI.FederatedPointerEvent} event
   */
  openThreadMenu(obj, event) {
    if ( !canEditBoard(this.scene) ) return;
    this.cancelConnect();
    const link = obj.link;
    const swatches = THREAD_COLORS.map(c => `<button type="button" class="swatch${c.color === link.color ? " active" : ""}"
      data-action="color" data-color="${c.color}" style="--swatch: ${c.color}"
      aria-label="${t(`Thread.Color.${c.key}`)}" data-tooltip="${t(`Thread.Color.${c.key}`)}"></button>`).join("");
    const ne = event.nativeEvent ?? event;
    showMenu(ne.clientX, ne.clientY, `<div class="dimancer-board-swatches">${swatches}</div>` + menuItems([
      { action: "delete", icon: "fa-scissors", label: t("Thread.Delete"), danger: true }
    ]), (action, button) => {
      if ( action === "color" ) return this.setLinkColor(link.id, button.dataset.color);
      if ( action === "delete" ) return this.deleteLinks([link.id]);
    });
  }

  closeMenu() {
    closeMenu();
  }

  async #onMenuAction(action, id, button) {
    const card = getCard(this.scene, id);
    if ( !card ) return;
    const cards = boardCards(this.scene);
    switch ( action ) {
      case "view": return this.openInJournal(id);
      case "readPdf": return PdfViewer.open({ src: card.src, title: card.title || t("Document.Untitled"), key: pageOfCard(card)?.id ?? card.id });
      case "edit": return this.editNote(id);
      case "paper": return this.patchCard(id, { color: button.dataset.color });
      case "ink": {
        const patch = {};
        for ( const sid of Object.keys(card.strokes) ) patch[`strokes.${sid}.color`] = button.dataset.color;
        return this.patchCard(id, patch);
      }
      case "clearInk": return this.patchCard(id, { strokes: _del });
      case "connect": return this.beginConnect(id);
      case "category": return openCategoryPicker(this.scene, id, this.#menuAt.x, this.#menuAt.y);
      case "unlink": return this.deleteLinks(linksOf(boardLinks(this.scene), [id]).map(l => l.id));
      case "rename": return this.#rename(card);
      case "front": return this.patchCard(id, { sort: topSort(cards) });
      case "back": return this.patchCard(id, { sort: bottomSort(cards) });
      case "hide": return this.patchCard(id, { hidden: !card.hidden });
      case "lock": return this.patchCard(id, { locked: !card.locked });
      case "delete": return this.deleteCards([id]);
      case "unplace":
        this.select(null);
        return removeCards(this.scene, [id]);
      case "addJournal": return linkCardToJournal(this.scene, id);
    }
  }

  async #rename(card) {
    const title = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("Card.Rename") },
      content: `<div class="form-group"><label>${t("Card.Title")}</label>
        <input type="text" name="title" value="${foundry.utils.escapeHTML(card.title)}" autofocus></div>`,
      ok: { label: t("Card.Save"), callback: (event, button) => button.form.elements.title.value.trim() },
      rejectClose: false
    });
    if ( typeof title === "string" ) await this.patchCard(card.id, { title });
  }
}

