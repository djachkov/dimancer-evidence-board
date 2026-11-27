import { hashString, noteColors, tornEdge } from "../styles.mjs";
import { isPdfDocument } from "../pdf-preview.mjs";
import { parchmentTexture } from "./textures.mjs";
import { placeDocument, placePhoto, placeTitle } from "./cards-classic.mjs";
import { shade } from "./threads.mjs";
import { CARD_LOOKS } from "./card-look.mjs";

/**
 * Parchment cards for a quest board: every card is a sheet with a torn edge (the same edge for the
 * same card at any size), aged darker towards the rim. Photos get a warm tint, a stack of pages is
 * sealed with wax, notes are tinted scraps and the category tab is a ribbon.
 */

const LOOK = CARD_LOOKS.parchment;
const SERIF = LOOK.fonts.note;

/** Torn-edge outlines by seed (fractions of the paper). */
const edges = new Map();

/** The torn outline of a card's paper box, in local space. */
function tornOutline({ left, top, fw, fh }, seed) {
  let f = edges.get(seed);
  if ( !f ) {
    if ( edges.size > 2000 ) edges.clear();
    edges.set(seed, f = tornEdge(seed));
  }
  const pts = new Array(f.length);
  for ( let i = 0; i < f.length; i += 2 ) {
    pts[i] = left + (f[i] * fw);
    pts[i + 1] = top + (f[i + 1] * fh);
  }
  return pts;
}

const offset = (pts, dx, dy) => pts.map((v, i) => v + ((i % 2) ? dy : dx));

/** Points turned by `degrees` around the card's centre and nudged by (dx, dy). */
function turn(pts, degrees, dx, dy) {
  const a = Math.toRadians(degrees);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out = new Array(pts.length);
  for ( let i = 0; i < pts.length; i += 2 ) {
    out[i] = (pts[i] * cos) - (pts[i + 1] * sin) + dx;
    out[i + 1] = (pts[i] * sin) + (pts[i + 1] * cos) + dy;
  }
  return out;
}

/** A sheet of parchment: the texture (tinted), offset per card so neighbours don't match, and an aged rim. */
function sheet(g, pts, seed, { tint = 0xffffff, rim }) {
  const matrix = new PIXI.Matrix().scale(0.55, 0.55).translate(seed % 512, (seed >>> 9) % 512);
  g.lineStyle(0).beginTextureFill({ texture: parchmentTexture(), color: tint, matrix }).drawPolygon(pts).endFill()
    .lineStyle({ width: rim, color: 0x7a5426, alpha: 0.16, alignment: 0 }).drawPolygon(pts)
    .lineStyle({ width: rim * 0.4, color: 0x5a3a18, alpha: 0.28, alignment: 0 }).drawPolygon(pts)
    .lineStyle({ width: 1, color: 0x4a2e12, alpha: 0.45 }).drawPolygon(pts)
    .lineStyle(0);
}

const rimOf = ({ fw, fh }) => Math.max(3, Math.min(fw, fh) * 0.05);

function softShadow(obj, pts) {
  obj.shadow.beginFill(0x000000, 0.2).drawPolygon(offset(pts, 3, 5)).endFill()
    .beginFill(0x000000, 0.15).drawPolygon(offset(pts, 6, 9)).endFill();
}

/** A blob of sealing wax with a stamped ring, in this colour. */
function waxSeal(g, x, y, r, color, seed) {
  const dark = shade(color, -0.35);
  g.beginFill(0x000000, 0.25).drawCircle(x + (r * 0.15), y + (r * 0.25), r * 1.05).endFill().beginFill(color);
  // Wax spreads unevenly: lobes around the rim.
  for ( let i = 0; i < 7; i++ ) {
    const a = ((i / 7) * Math.PI * 2) + ((seed % 7) * 0.4);
    const d = r * (0.7 + (((seed >>> i) & 3) * 0.06));
    g.drawCircle(x + (Math.cos(a) * d), y + (Math.sin(a) * d), r * 0.36);
  }
  g.drawCircle(x, y, r).endFill()
    .lineStyle({ width: r * 0.12, color: dark, alpha: 0.9 }).drawCircle(x, y, r * 0.62)
    .lineStyle({ width: r * 0.1, color: dark, alpha: 0.9 })
    .moveTo(x - (r * 0.3), y).lineTo(x + (r * 0.3), y).moveTo(x, y - (r * 0.3)).lineTo(x, y + (r * 0.3))
    .lineStyle(0)
    .beginFill(0xffffff, 0.25).drawEllipse(x - (r * 0.35), y - (r * 0.4), r * 0.3, r * 0.18).endFill();
}

export default {
  id: "parchment",
  fonts: LOOK.fonts,
  colors: LOOK.colors,
  tabText: () => 0xfff4dc,
  noteEditor: color => ({ paper: color, ink: "#2a1c10", font: SERIF }),

  /** A picture glued onto a torn sheet, its title written underneath. */
  photo(obj, L) {
    const { w, h, pad } = L;
    const seed = hashString(obj.card.id);
    const pts = tornOutline(L, seed);
    softShadow(obj, pts);
    sheet(obj.frame, pts, seed, { rim: rimOf(L) });
    placePhoto(obj, w, h, { tint: LOOK.photoTint, placeholder: [0x8a7a62, 0xb5a586] });
    obj.clip.lineStyle({ width: Math.max(1, pad * 0.12), color: 0x4a3418, alpha: 0.45 }).drawRect(-w / 2, -h / 2, w, h).lineStyle(0);
    placeTitle(obj, L, { size: 0.55 });
  },

  /** A written sheet; more pages lie askew underneath, sealed together with wax at a corner. */
  document(obj, L) {
    const { left, top, fw, fh } = L;
    const seed = hashString(obj.card.id);
    const pts = tornOutline(L, seed);
    const count = Math.max(1, isPdfDocument(obj.card) ? obj.pdfPages : obj.card.docPages.length);
    softShadow(obj, pts);
    const rim = rimOf(L);
    const under = [[2.4, fw * 0.02, fh * 0.012, LOOK.under[0]], [-1.8, -fw * 0.015, fh * 0.02, LOOK.under[1]]];
    for ( let i = Math.min(count - 1, under.length) - 1; i >= 0; i-- ) {
      const [deg, dx, dy, tint] = under[i];
      sheet(obj.frame, turn(tornOutline(L, seed + i + 1), deg, dx, dy), seed + i + 1, { tint, rim });
    }
    sheet(obj.frame, pts, seed, { rim });
    placeDocument(obj, L, { tint: LOOK.docTint });
    if ( count < 2 ) return;
    const category = obj.layer.categories?.get(obj.card.category);
    const color = category ? Number.parseInt(category.color.slice(1), 16) : LOOK.seal;
    const r = Math.max(5, Math.min(fw, fh) * 0.075);
    // On the bottom-left corner, clear of the title and the page count.
    waxSeal(obj.clip, left + (r * 1.1), top + fh - (r * 1.1), r, color, seed);
  },

  /** A torn scrap tinted the note's colour. */
  note(obj, L) {
    const seed = hashString(obj.card.id);
    const pts = tornOutline(L, seed);
    const color = Number.parseInt((obj.card.color ?? noteColors("parchment")[0].color).slice(1), 16);
    softShadow(obj, pts);
    sheet(obj.frame, pts, seed, { tint: color, rim: rimOf(L) });
  },

  /** The category as a ribbon with forked ends. */
  tab(g, { x, y, w, h }, color) {
    const b = y + h + 6;
    const m = (y + b) / 2;
    const n = h * 0.3;
    const pts = [x, y, x + w, y, x + w - n, m, x + w, b, x, b, x + n, m];
    g.beginFill(0x000000, 0.22).drawPolygon(offset(pts, 2, 2)).endFill()
      .lineStyle({ width: 1, color: shade(color, -0.4), alpha: 0.9 }).beginFill(color).drawPolygon(pts).endFill().lineStyle(0);
  }
};
