/**
 * One throttled ticker for everything a board animates (data packets, pulsing pins, lantern
 * flicker, the scanline sweep). Callers register a function under a key and remove it again; the
 * ticker only runs while something is registered.
 */

const FRAME_MS = 33;
const animations = new Map();
let tick = null;
let ticker = null;
let last = 0;

function sync() {
  if ( animations.size && !tick && canvas.app?.ticker ) {
    ticker = canvas.app.ticker;
    tick = () => {
      const now = performance.now();
      if ( now - last < FRAME_MS ) return;
      last = now;
      const t = now / 1000;
      for ( const [key, fn] of animations ) {
        try {
          fn(t);
        } catch(err) {
          console.error(`dimancer_board | animation ${key}`, err);
          animations.delete(key);
        }
      }
    };
    ticker.add(tick);
  } else if ( !animations.size && tick ) {
    ticker?.remove(tick);
    tick = ticker = null;
  }
}

/** Run fn(seconds) about 30 times a second under this key; null stops it. */
export function setAnimation(key, fn) {
  if ( fn ) animations.set(key, fn);
  else animations.delete(key);
  sync();
}
