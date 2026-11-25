import { circuitPath, densify, pointAlong, polylineLength, sagControl, sampleCurve } from "../links.mjs";

/**
 * Threads, one painter per thread style. A painter knows the thread's shape (`path`: a polyline,
 * used for its hit area and for anything travelling along it) and draws it into a Graphics.
 * Everything is in canvas coordinates; `k` is the zoom compensation (≥ 1 when zoomed out), so
 * threads stay readable at any zoom.
 */

const toNumber = color => Number.parseInt(String(color).slice(1), 16) || 0xc0392b;

/** Mix a 0xRRGGBB colour towards black (amount < 0) or white (amount > 0). */
export function shade(color, amount) {
  const target = amount < 0 ? 0 : 255;
  const a = Math.abs(amount);
  const mix = c => Math.round(c + ((target - c) * a));
  return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff);
}

const ROUND = () => ({ cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });

/** Red yarn on a corkboard: a gentle sag, a soft shadow and a knot at each pin. */
const yarn = {
  width: hovered => (hovered ? 6 : 4),
  path(p1, p2) {
    return sampleCurve(p1, sagControl(p1, p2), p2, 24);
  },
  paint(g, p1, p2, { color, k, hovered }) {
    const c = sagControl(p1, p2);
    const col = toNumber(color);
    const width = this.width(hovered) * k;
    const knot = 5 * k;
    g.lineStyle({ width: width + 1, color: 0x000000, alpha: 0.28, ...ROUND() })
      .moveTo(p1.x + (2 * k), p1.y + (5 * k)).quadraticCurveTo(c.x + (2 * k), c.y + (5 * k), p2.x + (2 * k), p2.y + (5 * k))
      .lineStyle({ width, color: col, alpha: 1, ...ROUND() })
      .moveTo(p1.x, p1.y).quadraticCurveTo(c.x, c.y, p2.x, p2.y)
      .lineStyle(0)
      .beginFill(col).drawCircle(p1.x, p1.y, knot).drawCircle(p2.x, p2.y, knot).endFill()
      .beginFill(0xffffff, 0.35).drawCircle(p1.x - (0.3 * knot), p1.y - (0.3 * knot), 0.36 * knot)
      .drawCircle(p2.x - (0.3 * knot), p2.y - (0.3 * knot), 0.36 * knot).endFill();
  }
};

/** Twisted twine between nails: a deeper sag, twist marks along it, a loop and a loose end at each nail. */
const TWINE_SAG = { amount: 0.11, max: 120 };
const twine = {
  width: hovered => (hovered ? 7.5 : 5.5),
  path(p1, p2) {
    return sampleCurve(p1, sagControl(p1, p2, TWINE_SAG), p2, 24);
  },
  paint(g, p1, p2, { color, k, hovered }) {
    const c = sagControl(p1, p2, TWINE_SAG);
    const col = toNumber(color);
    const dark = shade(col, -0.5);
    const light = shade(col, 0.45);
    const w = this.width(hovered) * k;
    const curve = (dx, dy) => g.moveTo(p1.x + dx, p1.y + dy).quadraticCurveTo(c.x + dx, c.y + dy, p2.x + dx, p2.y + dy);

    g.lineStyle({ width: w + 1, color: 0x000000, alpha: 0.3, ...ROUND() });
    curve(2 * k, 6 * k);
    g.lineStyle({ width: w + (1.5 * k), color: dark, alpha: 1, ...ROUND() });
    curve(0, 0);
    g.lineStyle({ width: w, color: col, alpha: 1, ...ROUND() });
    curve(0, 0);
    g.lineStyle({ width: w * 0.22, color: light, alpha: 0.4, ...ROUND() });
    curve(0, -w * 0.18);

    // Twist: short slanted marks across the strand, about one per strand width.
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.min(160, Math.max(6, Math.round(len / (w * 1.3))));
    const pts = sampleCurve(p1, c, p2, n);
    g.lineStyle({ width: w * 0.26, color: dark, alpha: 0.55, cap: PIXI.LINE_CAP.ROUND });
    for ( let i = 1; i < pts.length - 1; i++ ) {
      const a = pts[i - 1];
      const b = pts[i + 1];
      const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const tx = (b.x - a.x) / tl;
      const ty = (b.y - a.y) / tl;
      // Halfway between the tangent and the normal: the twist leans along the strand.
      const dx = (tx - ty) * 0.707 * w * 0.5;
      const dy = (ty + tx) * 0.707 * w * 0.5;
      g.moveTo(pts[i].x - dx, pts[i].y - dy).lineTo(pts[i].x + dx, pts[i].y + dy);
    }

    // A loop around each nail and a short loose end hanging from it.
    for ( const [p, side] of [[p1, -1], [p2, 1]] ) {
      g.lineStyle({ width: w * 0.55, color: dark, alpha: 1, ...ROUND() }).drawCircle(p.x, p.y, w * 0.95)
        .lineStyle({ width: w * 0.4, color: col, alpha: 1, ...ROUND() }).drawCircle(p.x, p.y, w * 0.95)
        .lineStyle({ width: w * 0.55, color: col, alpha: 1, ...ROUND() })
        .moveTo(p.x + (side * w * 0.4), p.y + (w * 0.8))
        .quadraticCurveTo(p.x + (side * w * 1.2), p.y + (w * 2.2), p.x + (side * w * 0.7), p.y + (w * 3.4));
    }
  }
};

/** A neon data line routed like a circuit trace, with terminals at the pins and packets when animated. */
const dataline = {
  width: hovered => (hovered ? 5 : 3.5),
  corners(p1, p2) {
    return circuitPath(p1, p2);
  },
  path(p1, p2) {
    return densify(circuitPath(p1, p2), 24);
  },
  paint(g, p1, p2, { color, k, hovered }) {
    const col = toNumber(color);
    const w = this.width(hovered) * k;
    const pts = circuitPath(p1, p2);
    const poly = style => {
      g.lineStyle(style).moveTo(pts[0].x, pts[0].y);
      for ( let i = 1; i < pts.length; i++ ) g.lineTo(pts[i].x, pts[i].y);
    };
    poly({ width: w * 5, color: col, alpha: 0.06, ...ROUND() });
    poly({ width: w * 2.8, color: col, alpha: 0.14, ...ROUND() });
    poly({ width: w, color: col, alpha: 1, cap: PIXI.LINE_CAP.SQUARE, join: PIXI.LINE_JOIN.MITER });
    poly({ width: w * 0.35, color: 0xffffff, alpha: 0.7, cap: PIXI.LINE_CAP.SQUARE, join: PIXI.LINE_JOIN.MITER });
    const s = w * 1.4;
    g.lineStyle({ width: w * 0.6, color: col, alpha: 1 }).beginFill(0x050a10)
      .drawRect(p1.x - s, p1.y - s, s * 2, s * 2).drawRect(p2.x - s, p2.y - s, s * 2, s * 2).endFill().lineStyle(0);
  },
  /** Packets travelling along the line, drawn into their own Graphics. */
  animate(g, p1, p2, { color, k, t }) {
    const pts = circuitPath(p1, p2);
    const len = polylineLength(pts);
    g.clear();
    if ( len < 1 ) return;
    const col = toNumber(color);
    const n = Math.min(4, Math.max(1, Math.round(len / 500)));
    const r = this.width(false) * k * 1.1;
    for ( let i = 0; i < n; i++ ) {
      const p = pointAlong(pts, (((t * 220) / len) + (i / n)) % 1);
      g.beginFill(col, 0.25).drawCircle(p.x, p.y, r * 2.2).endFill()
        .beginFill(col).drawCircle(p.x, p.y, r).endFill()
        .beginFill(0xffffff, 0.9).drawCircle(p.x, p.y, r * 0.45).endFill();
    }
  }
};

const PAINTERS = { yarn, twine, dataline };

/** The painter of a thread style (yarn for an unknown one). */
export const threadPainter = style => PAINTERS[style] ?? yarn;
