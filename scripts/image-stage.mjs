import * as VP from "./viewport.mjs";

/**
 * A zoomable, pannable image in a box (the Evidence Journal's
 * picture). Wheel zooms at the cursor, dragging pans, double-click toggles fit / zoomed in, and the
 * zoom bar's buttons call zoomBy / fit / actual.
 *
 * The controller outlives re-renders: call attach() with the freshly rendered stage element each
 * time. The view is kept while the same image (key) is shown, and starts fitted for a new one.
 *
 * Markup: a `[data-stage]` element holding an `<img>`, optionally a `[data-zoom-label]`, and a
 * `.mb-broken` message shown when the image fails to load (styles in dimancer-board.css, `.mb-stage`).
 */
export default class ImageStage {
  /** @param {object} [options]
   * @param {(height: number) => void} [options.onResize]  Called (debounced) when the user resizes the
   *   stage's height (a stage with CSS `resize: vertical`)
   */
  constructor({ onResize } = {}) {
    this.#onResize = onResize ?? null;
  }

  #onResize;
  /** @type {HTMLElement|null} */
  #stage = null;
  /** @type {import("./viewport.mjs").View|null} */
  #view = null;
  #key = null;
  /** True while the view is "fit"; then a resize re-fits instead of keeping the zoom. */
  #fitted = true;
  #image = { width: 0, height: 0 };
  #observer = null;
  #height = 0;
  #resizeTimer = null;

  /** Start over at "fit" the next time an image is attached. */
  reset() {
    this.#view = null;
    this.#key = null;
    this.#image = { width: 0, height: 0 };
  }

  /**
   * Wire up a freshly rendered stage.
   * @param {HTMLElement|null} stage
   * @param {string} key   Identifies the image shown (its src, or page + src); a new key re-fits
   */
  attach(stage, key) {
    this.detach();
    if ( !stage ) return;
    this.#stage = stage;
    const img = stage.querySelector("img");
    if ( !img ) return;
    if ( key !== this.#key ) {
      this.#view = null;
      this.#fitted = true;
    }

    const layout = () => {
      if ( !this.#image.width || !stage.clientWidth || !stage.clientHeight ) return;
      const vp = this.#viewport();
      if ( !this.#view || this.#fitted || (this.#key !== key) ) this.#set(VP.fit(this.#image, vp), true);
      else this.#set(VP.clampPan(this.#view, this.#image, vp), false);
      this.#key = key;
      stage.classList.add("ready");
    };
    const init = () => {
      this.#image = { width: img.naturalWidth || 1, height: img.naturalHeight || 1 };
      layout();
    };
    if ( img.complete && img.naturalWidth ) init();
    else {
      img.addEventListener("load", init, { once: true });
      img.addEventListener("error", () => stage.classList.add("broken"), { once: true });
    }

    const local = ev => {
      const r = stage.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };

    stage.addEventListener("wheel", ev => {
      if ( !this.#view ) return;
      ev.preventDefault();
      const p = local(ev);
      // Firefox reports mouse wheels in lines (deltaMode 1), others in pixels; pages are rare.
      const unit = ev.deltaMode === 1 ? 40 : (ev.deltaMode === 2 ? stage.clientHeight : 1);
      const dy = Math.max(-300, Math.min(300, ev.deltaY * unit));
      this.#set(VP.zoomAt(this.#view, Math.exp(-dy * 0.0015), p.x, p.y, this.#image, this.#viewport()));
    }, { passive: false });

    let drag = null;
    stage.addEventListener("pointerdown", ev => {
      if ( (ev.button !== 0) || !this.#view || ev.target.closest("button") || this.#onResizeHandle(ev) ) return;
      drag = { x: ev.clientX, y: ev.clientY };
      stage.setPointerCapture(ev.pointerId);
      stage.classList.add("panning");
    });
    stage.addEventListener("pointermove", ev => {
      if ( !drag ) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      drag = { x: ev.clientX, y: ev.clientY };
      this.#set(VP.pan(this.#view, dx, dy, this.#image, this.#viewport()));
    });
    const end = ev => {
      if ( !drag ) return;
      drag = null;
      stage.classList.remove("panning");
      if ( stage.hasPointerCapture(ev.pointerId) ) stage.releasePointerCapture(ev.pointerId);
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);

    // Double-click toggles between fit and zoomed in at the cursor.
    stage.addEventListener("dblclick", ev => {
      if ( !this.#view || ev.target.closest("button") ) return;
      const vp = this.#viewport();
      const p = local(ev);
      if ( this.#fitted ) this.#set(VP.zoomTo(this.#view, Math.max(1, VP.fitScale(this.#image, vp) * 2), p.x, p.y, this.#image, vp));
      else this.#set(VP.fit(this.#image, vp), true);
    });

    // Lay out once the box has a size, and keep the image sensibly placed when it resizes.
    this.#height = stage.offsetHeight;
    this.#observer = new ResizeObserver(() => {
      layout();
      this.#noticeHeight();
    });
    this.#observer.observe(stage);
  }

  /** Stop observing the stage (on close, or before attaching a new one). */
  detach() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#stage = null;
  }

  zoomBy(factor) {
    if ( !this.#stage || !this.#view ) return;
    const vp = this.#viewport();
    this.#set(VP.zoomAt(this.#view, factor, vp.width / 2, vp.height / 2, this.#image, vp));
  }

  zoomIn() { this.zoomBy(1.25); }

  zoomOut() { this.zoomBy(1 / 1.25); }

  fit() {
    if ( !this.#stage || !this.#image.width ) return;
    this.#set(VP.fit(this.#image, this.#viewport()), true);
  }

  actual() {
    if ( !this.#stage || !this.#view ) return;
    this.#set(VP.actualSize(this.#view, this.#image, this.#viewport()));
  }

  #viewport() {
    return { width: this.#stage.clientWidth || 1, height: this.#stage.clientHeight || 1 };
  }

  #set(view, fitted = false) {
    this.#view = view;
    this.#fitted = fitted;
    const img = this.#stage?.querySelector("img");
    if ( !img ) return;
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    const label = this.#stage.querySelector("[data-zoom-label]");
    if ( label ) label.textContent = `${Math.round(view.scale * 100)}%`;
  }

  /** Is the pointer on the native resize grip (the bottom-right corner of a resizable stage)? */
  #onResizeHandle(ev) {
    if ( getComputedStyle(this.#stage).resize === "none" ) return false;
    const r = this.#stage.getBoundingClientRect();
    return ((r.right - ev.clientX) < 18) && ((r.bottom - ev.clientY) < 18);
  }

  /** Report a user-made height change (debounced), ignoring width-only changes. */
  #noticeHeight() {
    if ( !this.#onResize || !this.#stage ) return;
    const h = this.#stage.offsetHeight;
    if ( !h || (h === this.#height) ) return;
    this.#height = h;
    clearTimeout(this.#resizeTimer);
    this.#resizeTimer = setTimeout(() => this.#onResize(h), 300);
  }
}
