/**
 * Drawing freehand strokes with PIXI. Points are smoothed with quadratic curves through the
 * midpoints of consecutive samples, which reads as a marker line rather than a polyline.
 */

const colorNum = hex => Number.parseInt(String(hex).slice(1), 16);

/**
 * @param {PIXI.Graphics} g
 * @param {{color: string, width: number, points: number[]}} stroke
 */
export function drawStroke(g, { color, width, points: p }) {
  const c = colorNum(color);
  if ( p.length < 2 ) return;
  if ( p.length === 2 ) {
    g.lineStyle(0).beginFill(c).drawCircle(p[0], p[1], width / 2).endFill();
    return;
  }
  g.lineStyle({ width, color: c, alpha: 1, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
  g.moveTo(p[0], p[1]);
  if ( p.length === 4 ) {
    g.lineTo(p[2], p[3]);
    return;
  }
  for ( let i = 2; i + 3 < p.length; i += 2 ) {
    g.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
  }
  g.lineTo(p.at(-2), p.at(-1));
}

/** Redraw a set of strokes (bottom to top) into one Graphics. */
export function drawStrokes(g, strokes) {
  g.clear();
  const list = Object.values(strokes ?? {}).sort((a, b) => a.sort - b.sort);
  for ( const s of list ) drawStroke(g, s);
}
