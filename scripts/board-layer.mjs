import { FLAG_BOARD, t } from "./constants.mjs";
import {
  A4, cardList, cardUpdate, cardCreate, isEvidence, newCard, topSort, bottomSort, isTop, clampToRect,
  clampGroupDelta, stackSorts, centreInRect
} from "./cards.mjs";
import { isBoard, boardCards, boardLinks, boardSettings, getCard, canEditBoard, canEditCard, canMoveCard, canSeeCard } from "./permissions.mjs";
import {
  MAIN_PIN, linkBetween, linkCreate, linkDelete, linkList, linkUpdate, linksOf, newLink, orphanedPins,
  orphanPinsUpdate, pinOf, visibleLinks
} from "./links.mjs";
import ThreadObject from "./thread-object.mjs";
import { emit } from "./socket.mjs";
import CardObject from "./card-object.mjs";
import { openAddEvidence } from "./add-evidence.mjs";
import { imageSize } from "./uploads.mjs";
import { PdfViewer, isPdfDocument, pdfCardSize } from "./pdf-preview.mjs";
import { closeMenu, menuItems, showMenu } from "./menu.mjs";
import { focusCardForEveryone } from "./focus.mjs";
import { categoriesOf, openCategoryPicker } from "./organize-actions.mjs";
import {
  NOTE_MAX_TEXT, cardLabel, noteSizeFor, localToView, newNote, newSketch, simplifyPoints,
  strokeAddUpdate, strokeDeleteUpdate, viewScale
} from "./stickers.mjs";
import { drawStroke } from "./ink.mjs";
import { inkColors, noteColors, threadColors } from "./styles.mjs";
import { boardStyle } from "./surfaces.mjs";
import { threadPainter } from "./render/threads.mjs";
import { setAnimation } from "./render/animation.mjs";
import { closePenBar, penPrefs, showPenBar } from "./pen-bar.mjs";
import { closeNoteEditor, editNote } from "./note-editor.mjs";
import {
  canEditJournal, createEvidencePage, getEvidenceJournal, linkCardToJournal,
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

  /**
   * The selected cards, by id. Only cards this user may edit get selected. One selected card shows
   * its resize handle; several move together when one of them is dragged.
   * @type {Set<string>}
   */
  selection = new Set();

  /** @type {Map<string, ThreadObject>} */
  threads = new Map();

  /** Threads are drawn above every card, a card being dragged included. */
  threadLayer = null;

  /**
   * An in-progress connection: the card the thread starts from and where on it (an existing pin,
   * or a new one), and the rubber-band line that follows the cursor until another card is clicked.
   * @type {{fromId: string, from: {pin: string, at?: object}, rubber: PIXI.Graphics, onMove: Function, onKey: Function}|null}
   */
  connecting = null;

  #threadsQueued = false;

  /**
   * The board's look: card, pin and thread styles and decorations (surfaces.mjs boardStyle),
   * refreshed with the cards.
   * @type {{cards: string, pins: string, threads: string, decor: object}|null}
   */
  style = null;

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
    this.selection = new Set();
    this.connecting = null;
    this.style = null;   // refreshCards sets it, and starts any animation
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
    setAnimation("board", null);
    this.style = null;
    this.cards.clear();
    this.threads.clear();
    this.threadLayer = null;
    this.selection = new Set();
    this.#group = null;
    return super._tearDown(options);
  }

  /** The board's categories by id, refreshed with the cards. */
  categories = new Map();

  /** Bring the drawn cards in line with the Scene's flags. */
  async refreshCards() {
    if ( !this.isBoard ) return;
    this.categories = new Map(categoriesOf(this.scene).map(c => [c.id, c]));
    const style = boardStyle(this.scene);
    const restyled = !foundry.utils.equals(style, this.style);
    this.style = style;
    const wanted = new Map(cardList(boardCards(this.scene)).filter(c => canSeeCard(c)).map(c => [c.id, c]));
    for ( const [id, obj] of this.cards ) {
      if ( wanted.has(id) ) continue;
      this.cards.delete(id);
      obj.destroy();
      this.selection.delete(id);
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
    if ( restyled ) {
      this.#syncAnimation();
      this.syncTool();   // the pen bar's colours follow the card style
    }
  }

  /* -------------------------------------------- */
  /*  Animation                                   */
  /* -------------------------------------------- */

  /** Data packets and pulsing node pins, while the board has Animate on and a style that moves. */
  #syncAnimation() {
    const s = this.style;
    const moving = s?.decor.animate && ((s.threads === "dataline") || (s.pins === "node"));
    if ( moving ) return setAnimation("board", t => this.#animate(t));
    setAnimation("board", null);
    for ( const thread of this.threads.values() ) thread.stopAnimation();
    for ( const card of this.cards.values() ) if ( !card.destroyed ) card.pinGlow.alpha = 1;
  }

  #animate(t) {
    if ( !this.isBoard ) return;
    if ( this.style.threads === "dataline" ) for ( const thread of this.threads.values() ) thread.animate(t);
    if ( this.style.pins === "node" ) {
      const pulse = 0.65 + (0.35 * Math.sin(t * 3));
      for ( const card of this.cards.values() ) if ( !card.destroyed ) card.pinGlow.alpha = pulse;
    }
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
      obj.draw(a.pinPoint(link.fromPin), b.pinPoint(link.toPin), {
        faded: a.card.hidden || b.card.hidden, interactive, trim: [a.pinReach(), b.pinReach()]
      });
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
    if ( this.isStickerTool && canEditBoard(this.scene) ) showPenBar(tool, { onUndo: () => this.undoStroke(), style: this.style?.cards });
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
   * @param {string} fromId
   * @param {{pin: string, at?: object}} [from]  Where on the card (see CardObject#anchorAt)
   */
  beginConnect(fromId, from = { pin: MAIN_PIN }) {
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
    this.connecting = { fromId, from, rubber, onMove, onKey };
    document.body.classList.add("dimancer-board-connecting");
    this.refreshThreads();   // threads stop catching clicks while connecting
    this.updateRubber(canvas.mousePosition);
  }

  /**
   * Draw the in-progress thread from its pin to a canvas point. Over an existing pin of another
   * card it snaps to that pin, ringed, since the thread will hang from it.
   */
  updateRubber(point) {
    const c = this.connecting;
    const from = c && this.cards.get(c.fromId);
    if ( !from || !point ) return;
    const p = from.pinPoint(c.from);
    const target = this.cardAt(point);
    const pin = (target && (target.id !== c.fromId)) ? target.pinAt(point) : null;
    const end = pin ? target.pinPoint(pin) : point;
    this.#highlightPin(pin ? target : null, pin);
    // The thread to be, in the board's thread style and its default colour.
    const k = Math.max(1, 0.55 / (canvas.stage?.scale.x || 1));
    c.rubber.clear();
    threadPainter(this.style?.threads).paint(c.rubber, p, end, { color: this.#newThreadColor, k, hovered: false });
    c.rubber.alpha = 0.75;
  }

  /** New threads take the first colour of the board's thread style. */
  get #newThreadColor() {
    return threadColors(this.style?.threads)[0].color;
  }

  /** The card whose pin is ringed as a thread's snap target. */
  #highlighted = null;

  /** Ring one pin as a thread's snap target (or none). */
  #highlightPin(card, pin) {
    if ( this.#highlighted && (this.#highlighted !== card) && !this.#highlighted.destroyed ) this.#highlighted.setPinHighlight([]);
    this.#highlighted = card;
    card?.setPinHighlight(pin ? [pin] : []);
  }

  /**
   * Tie the in-progress thread to a card: to its pin under `point`, or a new pin there.
   * @param {string} toId
   * @param {{x: number, y: number}} [point]  Canvas point where the card was clicked
   */
  async finishConnect(toId, point) {
    const c = this.connecting;
    if ( !c ) return;
    if ( toId === c.fromId ) return this.cancelConnect();
    const { fromId, from } = c;
    const to = this.cards.get(toId)?.anchorAt(point) ?? { pin: MAIN_PIN };
    this.cancelConnect();
    return this.createLink(fromId, toId, from, to);
  }

  cancelConnect() {
    const c = this.connecting;
    if ( !c ) return;
    this.connecting = null;
    canvas.stage?.off("pointermove", c.onMove);
    document.removeEventListener("keydown", c.onKey, { capture: true });
    if ( !c.rubber.destroyed ) c.rubber.destroy();
    this.#highlightPin(null);
    document.body.classList.remove("dimancer-board-connecting");
    this.refreshThreads();
  }

  /**
   * Tie a thread between two cards. Each end hangs from a pin: an existing one, or one made for it
   * in the same update (only on a card the user can edit; otherwise its own pin).
   * @param {string} from
   * @param {string} to
   * @param {{pin: string, at?: object}} [fromAnchor]
   * @param {{pin: string, at?: object}} [toAnchor]
   */
  async createLink(from, to, fromAnchor = { pin: MAIN_PIN }, toAnchor = { pin: MAIN_PIN }) {
    const scene = this.scene;
    if ( !canEditBoard(scene) ) return ui.notifications.warn(t("Notify.NoEdit"));
    if ( linkBetween(boardLinks(scene), from, to) ) return ui.notifications.info(t("Notify.AlreadyConnected"));
    const update = {};
    const pinFor = (cardId, anchor) => {
      if ( !anchor.at ) return anchor.pin;
      if ( !canEditCard(scene, getCard(scene, cardId)) ) return MAIN_PIN;
      Object.assign(update, cardUpdate(cardId, { [`pins.${anchor.pin}`]: anchor.at }));
      return anchor.pin;
    };
    const link = newLink({
      id: foundry.utils.randomID(), from, to, fromPin: pinFor(from, fromAnchor), toPin: pinFor(to, toAnchor),
      color: this.#newThreadColor, author: game.user.id, created: Date.now()
    });
    if ( link ) await scene.update({ ...update, ...linkCreate(link) });
    return link;
  }

  /** Cut threads, and take away the pins that no longer hold any. */
  async deleteLinks(ids) {
    if ( !ids.length || !canEditBoard(this.scene) ) return;
    await this.scene.update({ ...orphanPinsUpdate(boardLinks(this.scene), ids, _del), ...linkDelete(ids, _del) });
  }

  /**
   * Where a pulled thread end would be tied at a canvas point: a card other than the one at the
   * thread's other end (and not one that end is already tied to by another thread), and the pin
   * there, if any, which is ringed. Called with no link, it clears the ring.
   * @returns {{card: CardObject, pin: string|null, point: {x: number, y: number}|null}|null}
   */
  pullTarget(link, end, point) {
    const target = link && point ? this.cardAt(point) : null;
    const fixed = link && (end ? link.from : link.to);
    const other = target && linkBetween(boardLinks(this.scene), fixed, target.id);
    if ( !target || (target.id === fixed) || (other && (other.id !== link.id)) ) {
      this.#highlightPin(null);
      return null;
    }
    const pin = target.pinAt(point);
    this.#highlightPin(pin ? target : null, pin);
    return { card: target, pin, point: pin ? target.pinPoint(pin) : null };
  }

  /**
   * Tie a pulled thread end to the pin under a canvas point (or a new pin there), on any card but
   * the other end's. The pin it came off goes if no thread hangs from it any more. Dropped anywhere
   * else, the thread stays as it was.
   * @param {string} linkId
   * @param {0|1} end         0 = the thread's `from` end, 1 = its `to` end
   * @param {{x: number, y: number}} [point]
   */
  async repinThread(linkId, end, point) {
    this.#highlightPin(null);
    const scene = this.scene;
    const links = boardLinks(scene);
    const link = linkList(links).find(l => l.id === linkId);
    if ( !link || !canEditBoard(scene) ) return this.refreshThreads();
    const [cardKey, pinKey] = end ? ["to", "toPin"] : ["from", "fromPin"];
    const fixed = end ? link.from : link.to;
    const target = point ? this.cardAt(point) : null;
    if ( !target || (target.id === fixed) ) return this.refreshThreads();
    const other = linkBetween(links, fixed, target.id);
    if ( other && (other.id !== link.id) ) {
      ui.notifications.info(t("Notify.AlreadyConnected"));
      return this.refreshThreads();
    }
    const anchor = target.anchorAt(point);
    const update = {};
    let pin = anchor.pin;
    if ( anchor.at ) {
      if ( canEditCard(scene, target.card) ) Object.assign(update, cardUpdate(target.id, { [`pins.${pin}`]: anchor.at }));
      else pin = MAIN_PIN;
    }
    const oldCard = link[cardKey];
    const oldPin = link[pinKey];
    if ( (oldCard === target.id) && (oldPin === pin) ) return this.refreshThreads();
    // The pin it leaves goes when nothing else hangs from it.
    if ( orphanedPins(links, [link.id])[oldCard]?.includes(oldPin) ) {
      Object.assign(update, cardUpdate(oldCard, { [`pins.${oldPin}`]: _del }));
    }
    Object.assign(update, linkUpdate(link.id, { [cardKey]: target.id, [pinKey]: pin }));
    try {
      await scene.update(update);
    } catch(err) {
      ui.notifications.error(err.message);
      this.refreshThreads();
    }
  }

  /**
   * Merge two of a card's pins: one pin, where `target` is, holds both pins' threads. The card's
   * own pin always survives (moving to `target` if it was the one dragged); the other goes.
   */
  async mergePins(cardId, dragged, target) {
    const scene = this.scene;
    const card = getCard(scene, cardId);
    if ( !card || !canMoveCard(scene, card) || (dragged === target) ) return this.refreshCards();
    const keep = (dragged === MAIN_PIN) ? MAIN_PIN : target;
    const gone = (keep === target) ? dragged : target;
    const update = {};
    if ( dragged === MAIN_PIN ) {
      const at = card.pins[target];
      if ( at ) Object.assign(update, cardUpdate(cardId, { [`pins.${MAIN_PIN}`]: at }));
    }
    for ( const l of linksOf(boardLinks(scene), [cardId]) ) {
      if ( pinOf(l, cardId) !== gone ) continue;
      Object.assign(update, linkUpdate(l.id, { [(l.from === cardId) ? "fromPin" : "toPin"]: keep }));
    }
    if ( gone !== MAIN_PIN ) Object.assign(update, cardUpdate(cardId, { [`pins.${gone}`]: _del }));
    try {
      await this.#update(update);
    } catch(err) {
      ui.notifications.error(err.message);
      this.cards.get(cardId)?.setCard(card);
    }
  }

  /** Save a pin's new spot on its card (fractions of the paper). Locked cards keep their pins. */
  async movePin(cardId, pin, at) {
    const card = getCard(this.scene, cardId);
    if ( !card || !canMoveCard(this.scene, card) ) return this.refreshCards();
    try {
      await this.#update(cardUpdate(cardId, { [`pins.${pin}`]: at }));
    } catch(err) {
      ui.notifications.error(err.message);
      this.cards.get(cardId)?.setCard(card);
    }
  }

  async setLinkColor(id, color) {
    if ( !canEditBoard(this.scene) ) return;
    await this.scene.update(linkUpdate(id, { color }));
  }

  /* -------------------------------------------- */
  /*  Selection and events                        */
  /* -------------------------------------------- */

  /** Select one card, or none, letting go of the rest. */
  select(id) {
    this.setSelection(id ? [id] : []);
  }

  isSelected(id) {
    return this.selection.has(id);
  }

  /** Is more than one card selected (a group that moves together)? */
  get multiSelected() {
    return this.selection.size > 1;
  }

  /**
   * Select these cards (those this user may edit).
   * @param {string[]} ids
   * @param {{add?: boolean}} [options]  Keep the cards already selected
   */
  setSelection(ids, { add = false } = {}) {
    const scene = this.scene;
    const next = new Set(add ? this.selection : []);
    for ( const id of ids ) {
      // A card just created may not be drawn yet; it's checked once it is.
      const card = id && getCard(scene, id);
      if ( card && canEditCard(scene, card) ) next.add(id);
    }
    const prev = this.selection;
    if ( (prev.size === next.size) && [...prev].every(id => next.has(id)) ) return;
    this.selection = next;
    // Every selected card redraws: the resize handle shows only while one card is selected.
    for ( const id of new Set([...prev, ...next]) ) this.cards.get(id)?.refresh();
  }

  /** Add a card to the selection, or take it out if it's in. Returns whether it's selected now. */
  toggleSelect(id) {
    if ( this.selection.has(id) ) {
      this.setSelection([...this.selection].filter(s => s !== id));
      return false;
    }
    this.setSelection([id], { add: true });
    return this.selection.has(id);
  }

  /** Select the cards whose centre is inside a canvas rectangle (the selection box). */
  selectInRect(rect, { add = false } = {}) {
    const ids = [...this.cards.values()].filter(o => !o.destroyed && centreInRect(o.centre, rect)).map(o => o.id);
    this.setSelection(ids, { add });
  }

  /* -------------------------------------------- */
  /*  Moving several cards                        */
  /* -------------------------------------------- */

  /** A group move in progress: the card being dragged and the selected cards following it. */
  #group = null;

  /**
   * The dragged card is one of several selected: the others that can move follow it.
   * @param {CardObject} leader
   * @returns {CardObject[]}  The followers
   */
  beginGroupMove(leader) {
    this.#group = null;
    if ( !this.multiSelected || !this.selection.has(leader.id) ) return [];
    const followers = [...this.selection].map(id => this.cards.get(id))
      .filter(o => o && (o !== leader) && !o.destroyed && o.movable);
    for ( const o of followers ) o.follow();
    if ( followers.length ) this.#group = { leader, followers };
    return followers;
  }

  /** The group's members still on the board, the dragged card first. */
  #groupMembers() {
    const g = this.#group;
    return g ? [g.leader, ...g.followers].filter(o => !o.destroyed) : [];
  }

  /** Move the followers by the dragged card's offset from where it started. */
  moveGroup(dx, dy) {
    for ( const o of this.#groupMembers().slice(1) ) o.followBy(dx, dy);
  }

  /** Live previews of the whole group for the other clients. */
  emitGroupDrag() {
    this.emitDrag(this.#groupMembers().map(o => ({ id: o.id, ...o.preview })));
  }

  /**
   * Drop the group: the move is cut short so no card leaves the board, saved for every card in one
   * update, and the group comes to the front keeping its stacking order.
   * @param {number} dx
   * @param {number} dy
   */
  async dropGroup(dx, dy) {
    const members = this.#groupMembers();
    this.#group = null;
    const starts = members.map(o => o.dragging?.start ?? o.card);
    ({ dx, dy } = clampGroupDelta(starts, dx, dy, canvas.dimensions.sceneRect));
    const moves = members.map((o, i) => ({ id: o.id, x: starts[i].x + dx, y: starts[i].y + dy }));
    for ( const o of members ) o.endFollow({ dx, dy, keep: !!(dx || dy) });
    if ( !dx && !dy ) return this.emitDragEnd(members.map(o => o.id));
    return this.commitMoves(moves);
  }

  /** The group's drag was cancelled: everyone snaps back. */
  cancelGroup() {
    const members = this.#groupMembers();
    this.#group = null;
    for ( const o of members.slice(1) ) o.endFollow({ keep: false });
    if ( members.length ) this.emitDragEnd(members.map(o => o.id));
  }

  /**
   * Save new positions for several cards in one update, bringing them to the front. Cards that
   * can't move (locked meanwhile) snap back.
   * @param {{id: string, x: number, y: number}[]} moves
   */
  async commitMoves(moves) {
    const scene = this.scene;
    const ok = moves.filter(m => {
      const card = getCard(scene, m.id);
      return card && canMoveCard(scene, card);
    });
    for ( const m of moves ) {
      if ( ok.includes(m) ) continue;
      const obj = this.cards.get(m.id);
      if ( obj ) obj.preview = null;
      obj?.refresh();
    }
    if ( !ok.length ) return;
    const sorts = stackSorts(boardCards(scene), ok.map(m => m.id));
    const update = {};
    for ( const { id, x, y } of ok ) Object.assign(update, cardUpdate(id, { x, y, ...((id in sorts) ? { sort: sorts[id] } : {}) }));
    try {
      await this.#update(update);
    } catch(err) {
      ui.notifications.error(err.message);
      for ( const { id } of ok ) {
        const card = getCard(scene, id);
        if ( card ) this.cards.get(id)?.setCard(card);
      }
    }
  }

  /**
   * Patch several cards in one update (those this user may edit).
   * @param {string[]} ids
   * @param {(card: object) => object|null} patchFor
   */
  async patchCards(ids, patchFor) {
    const scene = this.scene;
    const update = {};
    for ( const id of ids ) {
      const card = getCard(scene, id);
      if ( !card || !canEditCard(scene, card) ) continue;
      const patch = patchFor(card);
      if ( patch ) Object.assign(update, cardUpdate(id, patch));
    }
    if ( !foundry.utils.isEmpty(update) ) return this.#update(update);
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
    // Shift starts a selection box that adds to the selection, so it doesn't let go of it here.
    if ( !((this.tool === "select") && event.shiftKey) ) this.select(null);
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
    // With the Select tool core draws the selection box, but only ends it for placeables layers.
    const box = canvas.controls.select;
    if ( box?.active ) {
      box.clear();
      box.active = false;
      const coords = event.interactionData.coords;
      if ( coords && (this.tool === "select") ) this.selectInRect(coords, { add: event.shiftKey });
    }
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
    const { ink, width } = penPrefs(this.style?.cards);
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
      color: penPrefs(this.style?.cards).paper, cards: boardCards(scene),
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
    if ( !this.selection.size ) return false;
    await this.deleteCards([...this.selection]);
    return true;
  }

  /** Ctrl+A selects every card this user may edit. @override */
  _onSelectAllKey(event) {
    if ( this.tool !== "select" ) return false;
    this.setSelection([...this.cards.keys()]);
    return true;
  }

  /** Esc lets go of the selection. @override */
  _onDismissKey(event) {
    if ( !this.selection.size ) return false;
    this.select(null);
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
    if ( !card || !canMoveCard(this.scene, card) ) return this.refreshCards();
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
   * Take cards off the board. Evidence stays in the Evidence Journal: evidence not in it yet is
   * added first (when the user can add to the journal). Deleting evidence for good is done in the
   * journal. Stickers, and evidence that can't go to the journal, are deleted, confirming first when
   * someone else pinned them.
   */
  async deleteCards(ids, { confirm = true } = {}) {
    const scene = this.scene;
    const cards = ids.map(id => getCard(scene, id)).filter(c => c && canEditCard(scene, c));
    if ( !cards.length ) return;
    const toJournal = c => !!c.page || (isEvidence(c) && canEditJournal());
    const lost = cards.filter(c => !toJournal(c));
    if ( confirm && lost.some(c => c.author && (c.author !== game.user.id)) ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("Card.DeleteTitle") },
        content: `<p>${t("Card.DeleteOthers", { title: foundry.utils.escapeHTML(cardLabel(lost[0])) })}</p>`
      });
      if ( !ok ) return;
    }
    this.select(null);
    for ( const c of cards ) if ( !c.page && toJournal(c) ) await linkCardToJournal(scene, c.id);
    // A card's threads go with it, in the same update (removeCards).
    return removeCards(scene, cards.map(c => c.id).filter(id => getCard(scene, id)));
  }

  /* -------------------------------------------- */
  /*  Live drag previews                          */
  /* -------------------------------------------- */

  /** @param {{id: string, x: number, y: number, width: number, height: number}[]} cards */
  emitDrag(cards) {
    emit("drag", { sceneId: this.scene.id, cards: cards.map(g => ({ id: g.id, x: g.x, y: g.y, width: g.width, height: g.height })) });
  }

  /** @param {string[]} ids */
  emitDragEnd(ids) {
    emit("dragEnd", { sceneId: this.scene.id, ids });
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
    if ( this.multiSelected && this.selection.has(obj.id) ) return this.#openGroupMenu(event);
    const card = obj.card;
    // "Connect to…" starts from the pin right-clicked, if any.
    this.#menuPin = obj.pinAt(event.getLocalPosition?.(canvas.stage)) ?? MAIN_PIN;
    const editable = canEditCard(this.scene, card);
    const boardEditable = canEditBoard(this.scene);
    const threadCount = linksOf(boardLinks(this.scene), [card.id]).length;
    const gm = game.user.isGM;
    const kind = card.kind;
    const inkCount = Object.keys(card.strokes).length;
    const items = [
      isEvidence(card) && { action: "view", icon: "fa-book-open", label: t("Journal.ShowInJournal") },
      isPdfDocument(card) && { action: "readPdf", icon: "fa-book-open-reader", label: t("Journal.ReadPdf") },
      gm && { action: "everyone", icon: "fa-people-arrows", label: t("Card.Everyone") },
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
      editable && isEvidence(card) && !card.page && canEditJournal() && { action: "addJournal", icon: "fa-book-medical", label: t("Journal.AddToJournal") },
      // Evidence stays in the journal; deleting it for good is done there.
      editable && { action: "remove", icon: "fa-right-from-bracket", label: t("Card.Remove") }
    ];
    const ne = event.nativeEvent ?? event;
    this.#menuAt = { x: ne.clientX, y: ne.clientY };
    // Stickers get colour swatches on top: the paper of a note, the ink of a sketch.
    let swatches = "";
    if ( editable && !isEvidence(card) ) {
      const sketch = kind === "sketch";
      const colors = sketch ? inkColors(this.style?.cards) : noteColors(this.style?.cards);
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

  /** The menu for the selected cards, opened with right-click on one of them. */
  #openGroupMenu(event) {
    const scene = this.scene;
    const ids = [...this.selection];
    const cards = ids.map(id => getCard(scene, id)).filter(Boolean);
    const gm = game.user.isGM;
    const allHidden = cards.every(c => c.hidden);
    const allLocked = cards.every(c => c.locked);
    const ne = event.nativeEvent ?? event;
    this.#menuAt = { x: ne.clientX, y: ne.clientY };
    const html = `<p class="mb-menu-heading">${t("Selection.Count", { count: cards.length })}</p>` + menuItems([
      { action: "category", icon: "fa-tag", label: t("Category.Set") },
      { action: "front", icon: "fa-arrow-up", label: t("Card.Front") },
      { action: "back", icon: "fa-arrow-down", label: t("Card.Back") },
      gm && { action: "hide", icon: allHidden ? "fa-eye" : "fa-eye-slash", label: t(allHidden ? "Card.Reveal" : "Card.Hide") },
      gm && { action: "lock", icon: allLocked ? "fa-lock-open" : "fa-lock", label: t(allLocked ? "Card.Unlock" : "Card.Lock") },
      { action: "deselect", icon: "fa-xmark", label: t("Selection.Clear") },
      { action: "remove", icon: "fa-right-from-bracket", label: t("Selection.Remove", { count: cards.length }) }
    ]);
    showMenu(ne.clientX, ne.clientY, html, action => {
      const stack = where => {
        const sorts = stackSorts(boardCards(scene), ids, where);
        return this.patchCards(Object.keys(sorts), c => ({ sort: sorts[c.id] }));
      };
      switch ( action ) {
        case "category": return openCategoryPicker(scene, ids, this.#menuAt.x, this.#menuAt.y);
        case "front": return stack("front");
        case "back": return stack("back");
        case "hide": return this.patchCards(ids, () => ({ hidden: !allHidden }));
        case "lock": return this.patchCards(ids, () => ({ locked: !allLocked }));
        case "deselect": return this.select(null);
        case "remove": return this.deleteCards(ids);
      }
    });
  }

  /** Where the last card menu opened (follow-up pickers open there too). */
  #menuAt = { x: 0, y: 0 };

  /** The pin the last card menu was opened on. */
  #menuPin = MAIN_PIN;

  /**
   * The menu for one thread: its colour and delete.
   * @param {ThreadObject} obj
   * @param {PIXI.FederatedPointerEvent} event
   */
  openThreadMenu(obj, event) {
    if ( !canEditBoard(this.scene) ) return;
    this.cancelConnect();
    const link = obj.link;
    const swatches = threadColors(this.style?.threads).map(c => `<button type="button" class="swatch${c.color === link.color ? " active" : ""}"
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
      case "everyone": return focusCardForEveryone(this.scene, id);
      case "readPdf": return PdfViewer.open({ src: card.src, title: card.title || t("Document.Untitled"), key: pageOfCard(card)?.id ?? card.id });
      case "edit": return this.editNote(id);
      case "paper": return this.patchCard(id, { color: button.dataset.color });
      case "ink": {
        const patch = {};
        for ( const sid of Object.keys(card.strokes) ) patch[`strokes.${sid}.color`] = button.dataset.color;
        return this.patchCard(id, patch);
      }
      case "clearInk": return this.patchCard(id, { strokes: _del });
      case "connect": return this.beginConnect(id, { pin: this.#menuPin });
      case "category": return openCategoryPicker(this.scene, id, this.#menuAt.x, this.#menuAt.y);
      case "unlink": return this.deleteLinks(linksOf(boardLinks(this.scene), [id]).map(l => l.id));
      case "rename": return this.#rename(card);
      case "front": return this.patchCard(id, { sort: topSort(cards) });
      case "back": return this.patchCard(id, { sort: bottomSort(cards) });
      case "hide": return this.patchCard(id, { hidden: !card.hidden });
      case "lock": return this.patchCard(id, { locked: !card.locked });
      case "remove": return this.deleteCards([id]);
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

