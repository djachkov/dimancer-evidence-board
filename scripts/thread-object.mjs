import { sagControl, sampleCurve, strokePolygon } from "./links.mjs";

const toNumber = color => Number.parseInt(String(color).slice(1), 16) || 0xc0392b;

/**
 * One thread between two pins: a sagging piece of yarn with a soft shadow and a knot at each pin.
 * Drawn in layer (= canvas) coordinates. Right-click opens the thread menu; dragging the yarn pulls
 * its nearer end off its pin, to tie it to another pin (on any card but the other end's).
 */
export default class ThreadObject extends PIXI.Graphics {
  /**
   * @param {import("./board-layer.mjs").default} layer
   * @param {import("./links.mjs").Link} link
   */
  constructor(layer, link) {
    super();
    this.layer = layer;
    this.link = link;
    this.hovered = false;
    this.mouseInteractionManager = this.#createInteractionManager().activate();
  }

  get id() {
    return this.link.id;
  }

  /** While the yarn is pulled: which end (0 = from, 1 = to) follows the pointer. */
  pulling = null;

  /**
   * @param {{x: number, y: number}} p1   Pin of the first card
   * @param {{x: number, y: number}} p2   Pin of the second card
   * @param {{faded?: boolean, interactive?: boolean, trim?: number[]}} [options]
   *   trim: how far from each pin the yarn stops catching the mouse, so the pins stay grabbable
   */
  draw(p1, p2, { faded = false, interactive = true, trim = [0, 0] } = {}) {
    if ( this.pulling ) return;   // the pulled end follows the pointer until the drop
    this.#paint(p1, p2, { faded, interactive, trim });
  }

  #paint(p1, p2, { faded = false, interactive = true, trim = [0, 0] } = {}) {
    this.ends = [p1, p2];
    this.drawOptions = { faded, interactive, trim };
    const c = sagControl(p1, p2);
    const color = toNumber(this.link.color);
    const round = { cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND };
    // Keep the yarn readable when zoomed out: at least ~2 screen px, never thinner than 4 board px.
    const k = Math.max(1, 0.55 / (canvas.stage?.scale.x || 1));
    const width = (this.hovered ? 6 : 4) * k;
    const knot = 5 * k;
    this.clear()
      .lineStyle({ width: width + 1, color: 0x000000, alpha: 0.28, ...round })
      .moveTo(p1.x + (2 * k), p1.y + (5 * k)).quadraticCurveTo(c.x + (2 * k), c.y + (5 * k), p2.x + (2 * k), p2.y + (5 * k))
      .lineStyle({ width, color, alpha: 1, ...round })
      .moveTo(p1.x, p1.y).quadraticCurveTo(c.x, c.y, p2.x, p2.y)
      .lineStyle(0)
      .beginFill(color).drawCircle(p1.x, p1.y, knot).drawCircle(p2.x, p2.y, knot).endFill()
      .beginFill(0xffffff, 0.35).drawCircle(p1.x - (0.3 * knot), p1.y - (0.3 * knot), 0.36 * knot)
      .drawCircle(p2.x - (0.3 * knot), p2.y - (0.3 * knot), 0.36 * knot).endFill();
    this.alpha = faded ? 0.5 : 1;
    const yarn = sampleCurve(p1, c, p2, 24)
      .filter(p => (Math.hypot(p.x - p1.x, p.y - p1.y) > trim[0]) && (Math.hypot(p.x - p2.x, p.y - p2.y) > trim[1]));
    this.hitArea = new PIXI.Polygon(strokePolygon(yarn, Math.max(7, width)));
    // Only people who can edit the board get the thread menu; for everyone else the thread must
    // not swallow clicks meant for the cards underneath.
    this.eventMode = interactive ? "static" : "none";
    this.cursor = "grab";
  }

  #createInteractionManager() {
    const MIM = foundry.canvas.interaction.MouseInteractionManager;
    const canPull = () => this.eventMode !== "none";
    const permissions = { clickLeft: () => true, clickRight: () => true, dragStart: canPull, dragLeftStart: canPull };
    const callbacks = {
      hoverIn: () => { this.hovered = true; this.#redraw(); },
      hoverOut: () => { this.hovered = false; this.#redraw(); },
      clickLeft: event => event.stopPropagation(),
      clickRight: event => {
        event.stopPropagation();
        this.layer.openThreadMenu(this, event);
      },
      dragLeftStart: event => this.#onPullStart(event),
      dragLeftMove: event => this.#onPullMove(event),
      dragLeftDrop: event => this.#onPullDrop(event),
      dragLeftCancel: () => this.#onPullCancel()
    };
    return new MIM(this, canvas.stage, permissions, callbacks);
  }

  #redraw() {
    if ( this.ends && !this.destroyed && !this.pulling ) this.#paint(...this.ends, { ...this.drawOptions, interactive: this.eventMode !== "none" });
  }

  /** The end nearer the press comes off its pin. */
  #onPullStart(event) {
    const o = event.interactionData.origin;
    const [a, b] = this.ends;
    const end = (Math.hypot(o.x - a.x, o.y - a.y) <= Math.hypot(o.x - b.x, o.y - b.y)) ? 0 : 1;
    this.pulling = { end, fixed: this.ends[1 - end] };
    this.layer.closeMenu();
    this.#onPullMove(event);
  }

  /** The loose end follows the pointer, snapping to a pin it can be tied to (ringed). */
  #onPullMove(event) {
    if ( !this.pulling ) return;
    const dest = event.interactionData.destination;
    if ( !dest ) return;
    const snap = this.layer.pullTarget(this.link, this.pulling.end, dest);
    const loose = snap?.point ?? dest;
    const { fixed, end } = this.pulling;
    this.#paint(end ? fixed : loose, end ? loose : fixed, { ...this.drawOptions, interactive: true, trim: [0, 0] });
  }

  #onPullDrop(event) {
    if ( !this.pulling ) return;
    const { end } = this.pulling;
    this.pulling = null;
    this.layer.repinThread(this.link.id, end, event.interactionData?.destination);
  }

  /** A drag that never dropped puts the end back. */
  #onPullCancel() {
    if ( !this.pulling ) return;
    this.pulling = null;
    this.layer.pullTarget(null);
    this.layer.refreshThreads();
  }

  /** @override */
  destroy(options) {
    const MIM = foundry.canvas.interaction.MouseInteractionManager;
    const mim = this.mouseInteractionManager;
    if ( mim?.state > MIM.INTERACTION_STATES.HOVER ) mim.cancel();
    super.destroy(options);
  }
}
