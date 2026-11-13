import { sagControl, sampleCurve, strokePolygon } from "./links.mjs";

const toNumber = color => Number.parseInt(String(color).slice(1), 16) || 0xc0392b;

/**
 * One thread between two pins: a sagging piece of yarn with a soft shadow and a knot at each pin.
 * Drawn in layer (= canvas) coordinates. Right-click opens the thread menu.
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

  /**
   * @param {{x: number, y: number}} p1   Pin of the first card
   * @param {{x: number, y: number}} p2   Pin of the second card
   * @param {{faded?: boolean, interactive?: boolean}} [options]
   */
  draw(p1, p2, { faded = false, interactive = true } = {}) {
    this.ends = [p1, p2];
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
    this.hitArea = new PIXI.Polygon(strokePolygon(sampleCurve(p1, c, p2, 20), Math.max(7, width)));
    // Only people who can edit the board get the thread menu; for everyone else the thread must
    // not swallow clicks meant for the cards underneath.
    this.eventMode = interactive ? "static" : "none";
    this.cursor = "context-menu";
  }

  #createInteractionManager() {
    const MIM = foundry.canvas.interaction.MouseInteractionManager;
    const permissions = { clickLeft: () => true, clickRight: () => true, dragStart: () => false };
    const callbacks = {
      hoverIn: () => { this.hovered = true; this.#redraw(); },
      hoverOut: () => { this.hovered = false; this.#redraw(); },
      clickLeft: event => event.stopPropagation(),
      clickRight: event => {
        event.stopPropagation();
        this.layer.openThreadMenu(this, event);
      }
    };
    return new MIM(this, canvas.stage, permissions, callbacks);
  }

  #redraw() {
    if ( this.ends && !this.destroyed ) this.draw(...this.ends, { faded: this.alpha < 1, interactive: this.eventMode !== "none" });
  }

  /** @override */
  destroy(options) {
    const MIM = foundry.canvas.interaction.MouseInteractionManager;
    const mim = this.mouseInteractionManager;
    if ( mim?.state > MIM.INTERACTION_STATES.HOVER ) mim.cancel();
    super.destroy(options);
  }
}
