import { frameWidth, shadeColor } from "../surface-presets.mjs";
import { bandTexture, glowTexture } from "./textures.mjs";
import { shade } from "./threads.mjs";

/**
 * Board frames and the decorations around them. A surface preset names its frame style:
 * - bevel:  a plain moulded frame (wood around cork, aluminium around the whiteboard, …)
 * - timber: a heavy plank frame with iron corner brackets and nails (the quest board); optional
 *           header sign, shingle roof and lanterns
 * - neon:   a dark bezel with a neon tube (the cyberpunk panel); optional HUD header and corner brackets
 *
 * Everything is drawn around the scene rectangle r, in the scene's padding. Decorations shrink to
 * the room the padding leaves and are left out when there isn't enough.
 */

const toNumber = hex => Number.parseInt(hex.slice(1), 16);
const IRON = 0x2a2a2e;
const IRON_DARK = 0x111114;
/** The second neon colour of a neon frame (its outer edge and corner brackets). */
const ACCENT = 0xff2bd6;

/** Frame thickness of a frame style around r. */
export function frameThickness(frameStyle, r) {
  const fw = frameWidth(r.width, r.height);
  return frameStyle === "timber" ? Math.round(fw * 1.6) : fw;
}

/** A soft drop shadow onto the surround: stacked translucent rings, nudged down. */
function dropShadow(g, r, fw) {
  const spread = fw * 1.4;
  const steps = 10;
  for ( let i = steps; i >= 1; i-- ) {
    const d = fw + (spread * (i / steps));
    g.beginFill(0x000000, 0.045)
      .drawRoundedRect(r.x - d, r.y - d + (fw * 0.35), r.width + (d * 2), r.height + (d * 2), d * 0.5)
      .endFill();
  }
}

/* -------------------------------------------- */
/*  Frames                                      */
/* -------------------------------------------- */

/** The plain frame: a face with a lit outer edge and a shaded inner lip. */
function bevel(r, color) {
  const fw = frameWidth(r.width, r.height);
  const g = new PIXI.Graphics();
  dropShadow(g, r, fw);
  const outer = new PIXI.Rectangle(r.x - fw, r.y - fw, r.width + (fw * 2), r.height + (fw * 2));
  const ring = (rect, inset, hex) => {
    g.beginFill(toNumber(hex))
      .drawRect(rect.x + inset, rect.y + inset, rect.width - (inset * 2), rect.height - (inset * 2))
      .beginHole()
      .drawRect(r.x, r.y, r.width, r.height)
      .endHole()
      .endFill();
  };
  ring(outer, 0, shadeColor(color, -0.35));
  ring(outer, Math.max(1, fw * 0.06), shadeColor(color, 0.25));
  ring(outer, Math.max(2, fw * 0.16), color);
  ring(outer, fw * 0.78, shadeColor(color, -0.25));
  return g;
}

/** A forged nail head. */
function nail(g, x, y, r) {
  g.beginFill(0x000000, 0.35).drawCircle(x + (r * 0.3), y + (r * 0.4), r).endFill()
    .beginFill(0x3a3a3e).drawCircle(x, y, r).endFill()
    .beginFill(0xffffff, 0.25).drawCircle(x - (r * 0.3), y - (r * 0.3), r * 0.4).endFill();
}

/** A rivet. */
function rivet(g, x, y, r) {
  g.beginFill(IRON_DARK).drawCircle(x + (r * 0.25), y + (r * 0.3), r).endFill()
    .beginFill(0x5a5a62).drawCircle(x, y, r).endFill()
    .beginFill(0xffffff, 0.3).drawCircle(x - (r * 0.3), y - (r * 0.3), r * 0.4).endFill();
}

/** An L-shaped iron plate over a frame corner at (x, y), its arms running towards (sx, sy). */
function bracket(g, x, y, sx, sy, len, thick, fw) {
  const P = (dx, dy) => [x + (sx * dx), y + (sy * dy)];
  const pts = [...P(0, 0), ...P(len, 0), ...P(len, thick), ...P(thick, thick), ...P(thick, len), ...P(0, len)];
  g.beginFill(0x000000, 0.35).drawPolygon(pts.map((v, i) => v + ((i % 2) ? fw * 0.12 : fw * 0.08))).endFill()
    .lineStyle({ width: Math.max(1, fw * 0.04), color: IRON_DARK, alpha: 1 }).beginFill(IRON).drawPolygon(pts).endFill()
    .lineStyle({ width: Math.max(1, fw * 0.035), color: 0x8a8a92, alpha: 0.35 })
    .moveTo(...P(thick * 0.2, len * 0.95)).lineTo(...P(thick * 0.2, thick * 0.2)).lineTo(...P(len * 0.95, thick * 0.2))
    .lineStyle(0);
  const rr = thick * 0.17;
  for ( const [dx, dy] of [[thick / 2, thick / 2], [len * 0.55, thick / 2], [len - (thick * 0.5), thick / 2], [thick / 2, len * 0.55], [thick / 2, len - (thick * 0.5)]] ) {
    rivet(g, ...P(dx, dy), rr);
  }
}

/** Fill with the wood texture (tinted), its grain along the strip; a flat colour without one. */
function woodFill(g, texture, tint, x, y, vertical = false) {
  if ( !texture ) return g.beginFill(tint);
  const matrix = new PIXI.Matrix();
  if ( vertical ) matrix.rotate(Math.PI / 2);
  matrix.translate(x, y);
  return g.beginTextureFill({ texture, color: tint, matrix });
}

/** The quest board's heavy frame: four planks butted at the corners, nailed, with iron corner brackets. */
function timber(r, color, texture) {
  const fw = frameThickness("timber", r);
  const g = new PIXI.Graphics();
  dropShadow(g, r, fw);
  const tint = toNumber(shadeColor(color, 0.5));
  const strips = [
    [r.x - fw, r.y - fw, r.width + (2 * fw), fw, false],
    [r.x - fw, r.y + r.height, r.width + (2 * fw), fw, false],
    [r.x - fw, r.y, fw, r.height, true],
    [r.x + r.width, r.y, fw, r.height, true]
  ];
  for ( const [x, y, w, h, vertical] of strips ) {
    woodFill(g, texture, texture ? tint : toNumber(color), x, y, vertical).drawRect(x, y, w, h).endFill()
      .lineStyle({ width: Math.max(1, fw * 0.05), color: 0x000000, alpha: 0.5 }).drawRect(x, y, w, h)
      .lineStyle({ width: Math.max(1, fw * 0.04), color: 0xffffff, alpha: 0.12 });
    if ( vertical ) g.moveTo(x + (fw * 0.06), y).lineTo(x + (fw * 0.06), y + h);
    else g.moveTo(x, y + (fw * 0.06)).lineTo(x + w, y + (fw * 0.06));
    g.lineStyle(0);
  }
  const nr = Math.max(1.5, fw * 0.07);
  const spacing = fw * 3.2;
  for ( let x = r.x + (fw * 3); x < r.x + r.width - (fw * 2); x += spacing ) {
    nail(g, x, r.y - (fw / 2), nr);
    nail(g, x, r.y + r.height + (fw / 2), nr);
  }
  for ( let y = r.y + (fw * 2.4); y < r.y + r.height - (fw * 2); y += spacing ) {
    nail(g, r.x - (fw / 2), y, nr);
    nail(g, r.x + r.width + (fw / 2), y, nr);
  }
  const corners = [
    [r.x - fw, r.y - fw, 1, 1], [r.x + r.width + fw, r.y - fw, -1, 1],
    [r.x + r.width + fw, r.y + r.height + fw, -1, -1], [r.x - fw, r.y + r.height + fw, 1, -1]
  ];
  for ( const [x, y, sx, sy] of corners ) bracket(g, x, y, sx, sy, fw * 2.6, fw * 0.55, fw);
  return g;
}

/** A box with all four corners cut off at 45°. */
function chamferBox(x, y, w, h, c) {
  return [x + c, y, x + w - c, y, x + w, y + c, x + w, y + h - c, x + w - c, y + h, x + c, y + h, x, y + h - c, x, y + c];
}

/** A closed neon tube along a polygon: glow, coloured core and a white-hot centre. */
function tube(g, pts, color, width) {
  const join = PIXI.LINE_JOIN.MITER;
  g.lineStyle({ width: width * 5.5, color, alpha: 0.06, join }).drawPolygon(pts)
    .lineStyle({ width: width * 3, color, alpha: 0.12, join }).drawPolygon(pts)
    .lineStyle({ width, color, alpha: 1, join }).drawPolygon(pts)
    .lineStyle({ width: width * 0.38, color: 0xffffff, alpha: 0.8, join }).drawPolygon(pts)
    .lineStyle(0);
}

/** The cyberpunk frame: a dark bezel with cut corners, a neon tube around it and an accent edge. */
function neon(r, color) {
  const fw = frameThickness("neon", r);
  const col = toNumber(color);
  const g = new PIXI.Graphics();
  dropShadow(g, r, fw);
  const outer = chamferBox(r.x - fw, r.y - fw, r.width + (2 * fw), r.height + (2 * fw), fw * 1.4);
  g.beginFill(0x0a0f18).drawPolygon(outer).beginHole().drawRect(r.x, r.y, r.width, r.height).endHole().endFill();
  tube(g, chamferBox(r.x - (fw * 0.5), r.y - (fw * 0.5), r.width + fw, r.height + fw, fw * 0.9), col, Math.max(1.5, fw * 0.16));
  g.lineStyle({ width: fw * 0.3, color: ACCENT, alpha: 0.1, join: PIXI.LINE_JOIN.MITER }).drawPolygon(outer)
    .lineStyle({ width: Math.max(1, fw * 0.06), color: ACCENT, alpha: 0.9, join: PIXI.LINE_JOIN.MITER }).drawPolygon(outer)
    .lineStyle({ width: Math.max(1, fw * 0.05), color: col, alpha: 0.35 });
  for ( let x = r.x + (fw * 2); x < r.x + r.width - fw; x += fw * 1.5 ) {
    g.moveTo(x, r.y + r.height + (fw * 0.78)).lineTo(x, r.y + r.height + (fw * 0.92));
  }
  g.lineStyle(0);
  return g;
}

/**
 * The frame around r.
 * @param {PIXI.Rectangle} r
 * @param {string} color          Frame colour (#rrggbb)
 * @param {string} frameStyle     bevel | timber | neon
 * @param {object} [options]
 * @param {PIXI.Texture|null} [options.texture]  The board's tile (a timber frame is made of it)
 */
export function drawFrame(r, color, frameStyle, { texture = null } = {}) {
  if ( frameStyle === "timber" ) return timber(r, color, texture);
  if ( frameStyle === "neon" ) return neon(r, color);
  return bevel(r, color);
}

/* -------------------------------------------- */
/*  Quest board decorations                     */
/* -------------------------------------------- */

const PreciseText = () => foundry.canvas.containers.PreciseText;

/** A small gable roof of wooden shingles over the top of the frame. */
function roof(c, r, fw, room, texture, color) {
  const space = room.top - fw;
  const H = Math.min(space * 0.85, r.width * 0.1, fw * 9);
  if ( H < fw * 1.5 ) return null;
  const over = fw * 1.4;
  const yb = r.y - (fw * 0.55);
  const yt = yb - H;
  const x0 = r.x - fw - over;
  const x1 = r.x + r.width + fw + over;
  const inset = H * 1.2;
  const g = c.addChild(new PIXI.Graphics());

  // The eave's shadow on the board.
  for ( let i = 1; i <= 5; i++ ) g.beginFill(0x000000, 0.06).drawRect(r.x, r.y, r.width, fw * 0.45 * i).endFill();

  g.beginFill(0x24160d).drawPolygon([x0, yb, x1, yb, x1 - inset, yt, x0 + inset, yt]).endFill();
  // Courses of shingles from the eave up, each overlapping the top of the one below.
  const sh = Math.max(fw * 0.55, H / 7);
  const sw = sh * 1.6;
  const base = 0x6b4430;
  for ( let row = 0; ; row++ ) {
    const y = yb - ((row + 1) * sh);
    if ( y + sh <= yt + 0.5 ) break;
    const top = Math.max(y, yt);
    const bottom = Math.min(y + (sh * 1.2), yb);
    const f = ((top + bottom) / 2 - yt) / H;
    const left = x0 + (inset * (1 - f));
    const right = x1 - (inset * (1 - f));
    const start = left - ((row % 2) ? sw / 2 : 0);
    for ( let x = start, col = 0; x < right; x += sw, col++ ) {
      const xa = Math.max(x, left);
      const xb = Math.min(x + sw, right);
      if ( xb - xa < 1 ) continue;
      const v = (((row * 7) + (col * 13)) % 5) / 5;
      g.beginFill(shade(base, -0.2 + (v * 0.3))).drawRect(xa, top, xb - xa, bottom - top).endFill()
        .beginFill(0x000000, 0.3).drawRect(xa, bottom - (sh * 0.12), xb - xa, sh * 0.12).endFill()
        .beginFill(0x000000, 0.35).drawRect(xa, top, Math.max(1, sw * 0.04), bottom - top).endFill();
    }
  }
  // Barge boards up the slopes, the ridge, and the fascia board along the eave.
  const wood = toNumber(shadeColor(color, -0.15));
  g.lineStyle({ width: sh * 0.55, color: wood, alpha: 1, join: PIXI.LINE_JOIN.MITER, cap: PIXI.LINE_CAP.SQUARE })
    .moveTo(x0, yb).lineTo(x0 + inset, yt).lineTo(x1 - inset, yt).lineTo(x1, yb)
    .lineStyle({ width: Math.max(1, sh * 0.08), color: 0x000000, alpha: 0.4 })
    .moveTo(x0, yb).lineTo(x0 + inset, yt).lineTo(x1 - inset, yt).lineTo(x1, yb)
    .lineStyle(0);
  const fh = sh * 0.6;
  woodFill(g, texture, texture ? toNumber(shadeColor(color, 0.45)) : wood, x0, yb - (fh * 0.2)).drawRect(x0, yb - (fh * 0.2), x1 - x0, fh).endFill()
    .lineStyle({ width: Math.max(1, fh * 0.08), color: 0x000000, alpha: 0.5 }).drawRect(x0, yb - (fh * 0.2), x1 - x0, fh).lineStyle(0);
  return { yb, yt, H, x0, x1, inset };
}

/** A plank sign with the board's name, on the roof or standing on the frame. */
function sign(c, r, fw, room, texture, color, text, onRoof) {
  if ( !text ) return;
  let hs;
  let cy;
  let maxW;
  if ( onRoof ) {
    hs = onRoof.H * 0.5;
    cy = onRoof.yb - (onRoof.H * 0.52);
    maxW = (onRoof.x1 - onRoof.x0) - (2 * onRoof.inset) - hs;
  } else {
    const space = room.top - fw;
    hs = Math.min(space * 0.6, fw * 3.2);
    if ( hs < fw * 1.2 ) return;
    cy = r.y - (fw * 0.7) - (hs / 2);
    maxW = r.width * 0.6;
  }
  const label = new (PreciseText())(text, new PIXI.TextStyle({
    fontFamily: "'Modesto Condensed', Georgia, serif", fontSize: Math.round(hs * 0.62), fill: 0x2a1a0c,
    letterSpacing: Math.round(hs * 0.02), dropShadow: false, stroke: 0, strokeThickness: 0
  }));
  label.anchor.set(0.5);
  const pw = Math.min(maxW, Math.max(hs * 3, label.width + (hs * 1.4)));
  if ( label.width > pw - hs ) label.scale.set((pw - hs) / label.width);
  const x = r.x + (r.width / 2) - (pw / 2);
  const y = cy - (hs / 2);
  const g = c.addChild(new PIXI.Graphics());
  if ( !onRoof ) {
    // Two iron straps hold it to the frame.
    for ( const sx of [x + (pw * 0.2), x + (pw * 0.8)] ) {
      g.beginFill(0x000000, 0.3).drawRect(sx - (hs * 0.09) + (fw * 0.08), y + (hs * 0.5), hs * 0.18, (r.y - (fw * 0.2)) - (y + (hs * 0.5))).endFill()
        .beginFill(IRON).drawRect(sx - (hs * 0.09), y + (hs * 0.5), hs * 0.18, (r.y - (fw * 0.25)) - (y + (hs * 0.5))).endFill();
      rivet(g, sx, r.y - (fw * 0.5), Math.max(1.5, hs * 0.05));
    }
  }
  const tint = toNumber(shadeColor(color, 0.65));
  g.beginFill(0x000000, 0.35).drawRoundedRect(x + (hs * 0.05), y + (hs * 0.08), pw, hs, hs * 0.08).endFill();
  woodFill(g, texture, texture ? tint : toNumber(shadeColor(color, 0.3)), x, y).drawRoundedRect(x, y, pw, hs, hs * 0.08).endFill()
    .lineStyle({ width: Math.max(1, hs * 0.04), color: 0x1a0f08, alpha: 0.8 }).drawRoundedRect(x, y, pw, hs, hs * 0.08)
    .lineStyle({ width: Math.max(1, hs * 0.03), color: 0xffffff, alpha: 0.15 }).drawRoundedRect(x + (hs * 0.06), y + (hs * 0.06), pw - (hs * 0.12), hs - (hs * 0.12), hs * 0.06)
    .lineStyle(0);
  const nr = Math.max(1.5, hs * 0.05);
  for ( const [nx, ny] of [[x + (hs * 0.18), y + (hs * 0.2)], [x + pw - (hs * 0.18), y + (hs * 0.2)], [x + (hs * 0.18), y + hs - (hs * 0.2)], [x + pw - (hs * 0.18), y + hs - (hs * 0.2)]] ) {
    nail(g, nx, ny, nr);
  }
  // Carved: a light edge under the letters, then the letters.
  const lip = new (PreciseText())(text, label.style.clone());
  lip.style.fill = 0xe8c890;
  lip.alpha = 0.35;
  lip.anchor.set(0.5);
  lip.scale.copyFrom(label.scale);
  lip.position.set(r.x + (r.width / 2), cy + Math.max(1, hs * 0.03));
  label.position.set(r.x + (r.width / 2), cy);
  c.addChild(lip, label);
  c.texts.push(lip, label);
}

/** Two lanterns on iron arms at the frame's top corners, glowing on the planks. */
function lanterns(c, r, fw, room, animate) {
  const arm = Math.min(room.left - (fw * 1.4), fw * 2.6);
  if ( arm < fw * 1.2 ) return null;
  const ya = r.y + (fw * 1.5);
  const glows = [];
  for ( const side of [-1, 1] ) {
    const fx = side < 0 ? r.x - fw : r.x + r.width + fw;
    const ex = fx + (side * arm);
    const lx = ex - (side * fw * 0.15);
    const lw = Math.min(arm * 0.55, fw * 1.6);
    const lh = lw * 1.45;
    const top = ya + (fw * 0.35);
    const capTop = top + (lw * 0.2);
    const capH = lw * 0.32;
    const gy = capTop + capH;
    const gh = lh * 0.62;

    const glow = new PIXI.Sprite(glowTexture());
    glow.anchor.set(0.5);
    glow.position.set(lx, gy + (gh * 0.55));
    glow.width = glow.height = arm * 5.5;
    glow.tint = 0xffa640;
    glow.blendMode = PIXI.BLEND_MODES.ADD;
    glow.alpha = 0.5;
    glows.push(glow);

    const g = new PIXI.Graphics();
    g.beginFill(IRON).drawRect(side < 0 ? fx - (fw * 0.3) : fx, ya - (fw * 0.4), fw * 0.3, (arm * 0.6) + (fw * 0.8)).endFill()
      .lineStyle({ width: fw * 0.2, color: IRON, cap: PIXI.LINE_CAP.ROUND }).moveTo(fx, ya).lineTo(ex, ya)
      .lineStyle({ width: fw * 0.14, color: IRON }).moveTo(fx, ya + (arm * 0.6)).lineTo(fx + (side * arm * 0.6), ya)
      .lineStyle({ width: lw * 0.08, color: IRON }).moveTo(lx, ya).lineTo(lx, top).drawCircle(lx, top + (lw * 0.1), lw * 0.12)
      .lineStyle(0)
      .beginFill(IRON).drawPolygon([lx - (lw * 0.2), capTop, lx + (lw * 0.2), capTop, lx + (lw * 0.55), gy, lx - (lw * 0.55), gy]).endFill()
      .beginFill(0xffb84d, 0.95).drawRect(lx - (lw * 0.45), gy, lw * 0.9, gh).endFill()
      .beginFill(0xfff2b8, 0.95).drawEllipse(lx, gy + (gh * 0.55), lw * 0.16, gh * 0.28).endFill()
      .lineStyle({ width: lw * 0.07, color: IRON })
      .drawRect(lx - (lw * 0.45), gy, lw * 0.9, gh)
      .moveTo(lx - (lw * 0.22), gy).lineTo(lx - (lw * 0.22), gy + gh)
      .moveTo(lx + (lw * 0.22), gy).lineTo(lx + (lw * 0.22), gy + gh)
      .lineStyle(0)
      .beginFill(IRON).drawPolygon([lx - (lw * 0.55), gy + gh, lx + (lw * 0.55), gy + gh, lx + (lw * 0.35), gy + gh + (lw * 0.25), lx - (lw * 0.35), gy + gh + (lw * 0.25)]).endFill();
    c.addChild(glow, g);
  }
  if ( !animate ) return null;
  return t => glows.forEach((gl, i) => {
    gl.alpha = 0.5 + (0.06 * Math.sin((t * 9.1) + (i * 2))) + (0.05 * Math.sin((t * 23.7) + (i * 5)));
  });
}

/* -------------------------------------------- */
/*  Cyberpunk decorations                       */
/* -------------------------------------------- */

/** Neon L-brackets just outside the frame's corners. */
function cornerBrackets(c, r, fw, room) {
  const o = fw * 0.8;
  if ( Math.min(room.top, room.left) < fw + o + (fw * 0.3) ) return;
  const len = fw * 4;
  const g = c.addChild(new PIXI.Graphics());
  const x0 = r.x - fw - o;
  const y0 = r.y - fw - o;
  const x1 = r.x + r.width + fw + o;
  const y1 = r.y + r.height + fw + o;
  const corners = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]];
  for ( const [width, alpha] of [[fw * 1.2, 0.08], [fw * 0.6, 0.15], [fw * 0.22, 1]] ) {
    g.lineStyle({ width, color: ACCENT, alpha, join: PIXI.LINE_JOIN.MITER, cap: PIXI.LINE_CAP.SQUARE });
    for ( const [x, y, sx, sy] of corners ) g.moveTo(x + (sx * len), y).lineTo(x, y).lineTo(x, y + (sy * len));
  }
  g.lineStyle(0);
}

/** A header tab above the frame with the board's name, and status readouts beside it. */
function hud(c, r, fw, room, color, text, animate) {
  const space = room.top - fw;
  const hh = Math.min(space * 0.7, fw * 2.4);
  if ( hh < fw * 0.9 ) return null;
  const col = toNumber(color);
  const light = shade(col, 0.6);
  const yb = r.y - (fw * 0.95);
  const yt = yb - hh;
  const label = new (PreciseText())(`// ${text}`, new PIXI.TextStyle({
    fontFamily: "'Bruno Ace', Signika, sans-serif", fontSize: Math.round(hh * 0.42), fill: light,
    dropShadow: false, stroke: 0, strokeThickness: 0
  }));
  label.anchor.set(0.5);
  const maxW = r.width * 0.5;
  const tw = Math.min(maxW, label.width + (hh * 2));
  if ( label.width > tw - (hh * 1.6) ) label.scale.set((tw - (hh * 1.6)) / label.width);
  const cx = r.x + (r.width / 2);
  const x0 = cx - (tw / 2);
  const x1 = cx + (tw / 2);
  const pts = [x0 + (hh * 0.6), yt, x1 - (hh * 0.6), yt, x1, yb, x0, yb];
  const g = c.addChild(new PIXI.Graphics());
  g.lineStyle({ width: hh * 0.5, color: col, alpha: 0.06, join: PIXI.LINE_JOIN.MITER }).drawPolygon(pts)
    .lineStyle({ width: Math.max(1.5, hh * 0.05), color: col, alpha: 1, join: PIXI.LINE_JOIN.MITER }).beginFill(0x0a0f18, 0.95).drawPolygon(pts).endFill()
    .lineStyle(0).beginFill(col, 0.1).drawPolygon(pts).endFill();
  label.position.set(cx, (yt + yb) / 2);
  c.addChild(label);
  c.texts.push(label);

  const small = new PIXI.TextStyle({ fontFamily: "'Courier New', Courier, monospace", fontSize: Math.round(hh * 0.3), fill: col, dropShadow: false, stroke: 0, strokeThickness: 0 });
  const left = new (PreciseText())("SYS ONLINE", small);
  const right = new (PreciseText())("LINK ▮▮▮▮▯ 98%", small.clone());
  left.anchor.set(0, 1);
  right.anchor.set(1, 1);
  left.alpha = right.alpha = 0.8;
  const dot = hh * 0.12;
  left.position.set(r.x + fw + (dot * 3), yb - (hh * 0.1));
  right.position.set(r.x + r.width - fw, yb - (hh * 0.1));
  const blink = c.addChild(new PIXI.Graphics());
  blink.beginFill(0x7dff6a).drawCircle(r.x + fw + dot, yb - (hh * 0.1) - (left.height * 0.45), dot).endFill();
  c.addChild(left, right);
  c.texts.push(left, right);
  if ( !animate ) return null;
  return t => {
    blink.alpha = ((t % 1.6) < 1.1) ? 1 : 0.15;
  };
}

/** A faint bright band sweeping slowly down the board. */
function sweep(c, r, color) {
  const band = new PIXI.Sprite(bandTexture());
  band.width = r.width;
  band.height = Math.max(40, r.height * 0.12);
  band.x = r.x;
  band.tint = toNumber(color);
  band.blendMode = PIXI.BLEND_MODES.ADD;
  band.alpha = 0.3;
  c.addChild(band);
  return t => {
    band.y = r.y + (((t * 0.08) % 1) * (r.height - band.height));
  };
}

/**
 * The decorations of a frame style that the board has turned on.
 * @param {PIXI.Rectangle} r
 * @param {object} o
 * @param {string} o.frameStyle
 * @param {string} o.color        Frame colour
 * @param {object} o.decor        Normalised decorations (styles.mjs normalizeDecor)
 * @param {string} o.text         The sign's (or header's) text
 * @param {PIXI.Texture|null} o.texture
 * @param {{top: number, left: number}} o.room   Padding around the scene rectangle
 * @returns {{container: PIXI.Container, animate: Function|null}|null}
 */
export function drawDecorations(r, { frameStyle, color, decor, text, texture, room }) {
  if ( !["timber", "neon"].includes(frameStyle) ) return null;
  const fw = frameThickness(frameStyle, r);
  const c = new PIXI.Container();
  c.texts = [];
  const animations = [];
  if ( frameStyle === "timber" ) {
    const onRoof = decor.roof ? roof(c, r, fw, room, texture, color) : null;
    if ( decor.sign ) sign(c, r, fw, room, texture, color, text, onRoof);
    if ( decor.lanterns ) animations.push(lanterns(c, r, fw, room, decor.animate));
  } else {
    if ( decor.brackets ) cornerBrackets(c, r, fw, room);
    if ( decor.hud ) animations.push(hud(c, r, fw, room, color, text, decor.animate));
    if ( decor.animate ) animations.push(sweep(c, r, color));
  }
  const live = animations.filter(Boolean);
  return { container: c, animate: live.length ? t => live.forEach(fn => fn(t)) : null };
}
