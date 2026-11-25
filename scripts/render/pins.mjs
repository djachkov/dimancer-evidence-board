/**
 * Pins, one drawer per pin style. Each draws one pin centred on p with radius r into `g`; a style
 * with a glow draws it into `glow`, a separate Graphics underneath, so an animation can pulse it by
 * changing that Graphics' alpha alone.
 */

/** Neon colour of a node pin. */
export const NODE_COLOR = 0x00e5ff;

/** An octagon's points around (x, y). */
function octagon(x, y, r) {
  const pts = [];
  for ( let i = 0; i < 8; i++ ) {
    const a = ((i + 0.5) * Math.PI) / 4;
    pts.push(x + (Math.cos(a) * r), y + (Math.sin(a) * r));
  }
  return pts;
}

/** The red plastic push-pin of a corkboard. */
function pushpin(g, glow, p, r) {
  g.beginFill(0x000000, 0.25).drawCircle(p.x + (r * 0.35), p.y + (r * 0.35), r).endFill()
    .beginFill(0xc0392b).drawCircle(p.x, p.y, r).endFill()
    .beginFill(0xffffff, 0.45).drawCircle(p.x - (r * 0.35), p.y - (r * 0.35), r * 0.3).endFill();
}

/** A hand-forged nail: a faceted iron head, a hammer dent and a spot of rust. */
function nail(g, glow, p, r) {
  g.beginFill(0x000000, 0.35).drawCircle(p.x + (r * 0.3), p.y + (r * 0.38), r * 0.92).endFill()
    .beginFill(0x232326).drawPolygon(octagon(p.x, p.y, r * 0.92)).endFill()
    .beginFill(0x4d4d53).drawPolygon(octagon(p.x, p.y, r * 0.78)).endFill()
    .beginFill(0x77777f, 0.85).drawPolygon(octagon(p.x - (r * 0.16), p.y - (r * 0.18), r * 0.5)).endFill()
    .beginFill(0x8a4b23, 0.45).drawCircle(p.x + (r * 0.3), p.y + (r * 0.24), r * 0.26).endFill()
    .beginFill(0x1e1e21, 0.7).drawCircle(p.x + (r * 0.04), p.y + (r * 0.02), r * 0.14).endFill();
}

/** A glowing network node: a dark diamond with a neon rim and core. */
function node(g, glow, p, r) {
  const c = NODE_COLOR;
  glow.beginFill(c, 0.07).drawCircle(p.x, p.y, r * 2.3).endFill()
    .beginFill(c, 0.14).drawCircle(p.x, p.y, r * 1.6).endFill();
  const d = r * 0.98;
  g.beginFill(0x000000, 0.4).drawPolygon([p.x, p.y - d + (r * 0.3), p.x + d + (r * 0.2), p.y + (r * 0.3), p.x, p.y + d + (r * 0.3), p.x - d + (r * 0.2), p.y + (r * 0.3)]).endFill()
    .lineStyle({ width: r * 0.2, color: c, alpha: 1, join: PIXI.LINE_JOIN.MITER })
    .beginFill(0x061018).drawPolygon([p.x, p.y - d, p.x + d, p.y, p.x, p.y + d, p.x - d, p.y]).endFill()
    .lineStyle(0)
    .beginFill(c).drawCircle(p.x, p.y, r * 0.32).endFill()
    .beginFill(0xffffff, 0.85).drawCircle(p.x, p.y, r * 0.14).endFill();
}

const PINS = { pushpin, nail, node };

/**
 * Draw one pin.
 * @param {PIXI.Graphics} g
 * @param {PIXI.Graphics} glow
 * @param {string} style        A PIN_STYLES id
 * @param {{x: number, y: number}} p
 * @param {number} r
 */
export function drawPin(g, glow, style, p, r) {
  (PINS[style] ?? pushpin)(g, glow, p, r);
}
