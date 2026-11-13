import { A4 } from "./cards.mjs";

/**
 * PDF evidence: a picture of a PDF's first page (for the board and the journal), and a window that
 * reads the whole file in Foundry's bundled PDF viewer.
 *
 * Only page 1 is ever rendered here, once per file per session, then shared: the board draws it as a
 * texture, the journal shows it as an image. Opening the PDF itself is the viewer window's job.
 */

const route = path => foundry.utils.getRoute(path);
const isPdfPath = src => /\.pdf(\?.*)?$/i.test(String(src ?? ""));
export { isPdfPath };

/** Is this card or list item a PDF document (a document whose `src` is its file)? */
export const isPdfDocument = c => (c?.kind === "document") && !!c.src;

let pdfjs = null;

/** Foundry ships pdf.js for its PDF journal pages; load it (and point it at its worker) on first use. */
function loadPdfjs() {
  pdfjs ??= import(route("scripts/pdfjs/build/pdf.mjs")).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = route("scripts/pdfjs/build/pdf.worker.mjs");
    return lib;
  });
  return pdfjs;
}

/** The URL pdf.js and the viewer load a source from (data paths are routed, URLs kept). */
const fileUrl = src => (URL.parse(src) ? src : route(src));

/** Width in pixels of the rendered first page: sharp on a board card, light on memory. */
const PREVIEW_WIDTH = 720;

/** @type {Map<string, Promise<PdfPreview|null>>} */
const previews = new Map();

/**
 * @typedef {object} PdfPreview
 * @property {HTMLCanvasElement} canvas  Page 1, rendered
 * @property {number} pages              How many pages the PDF has
 * @property {number} aspect             Page 1's width / height
 * @property {Promise<string>} url       Page 1 as an image URL (a blob URL, made on first ask)
 * @property {PIXI.Texture} texture      Page 1 as a texture (made on first ask, shared by every card)
 */

/**
 * The first page of a PDF, rendered once and cached. Resolves to null when it can't be read (not
 * found, not a PDF, a remote file without CORS); a later call tries again.
 * @param {string} src
 * @returns {Promise<PdfPreview|null>}
 */
export function pdfPreview(src) {
  if ( !src ) return Promise.resolve(null);
  if ( !previews.has(src) ) {
    previews.set(src, renderFirstPage(src).catch(err => {
      console.warn(`dimancer_board | couldn't read the PDF ${src}`, err);
      previews.delete(src);
      return null;
    }));
  }
  return previews.get(src);
}

async function renderFirstPage(src) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ url: fileUrl(src) }).promise;
  try {
    const page = await doc.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PREVIEW_WIDTH / natural.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    // PDFs assume white paper; transparent pages would show the board through.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    let url = null;
    let texture = null;
    return {
      canvas,
      pages: doc.numPages,
      aspect: natural.width / natural.height,
      get url() {
        url ??= new Promise(resolve => canvas.toBlob(b => resolve(b ? URL.createObjectURL(b) : canvas.toDataURL())));
        return url;
      },
      get texture() {
        texture ??= PIXI.Texture.from(canvas);
        return texture;
      }
    };
  } finally {
    // Only the picture is kept; the parsed document goes.
    doc.destroy();
  }
}

/** A card size for a PDF: its first page's shape at the height of an A4 card. */
export async function pdfCardSize(src) {
  const preview = await pdfPreview(src);
  if ( !preview ) return { ...A4 };
  return { width: Math.round(A4.height * preview.aspect), height: A4.height };
}

/**
 * A window reading a whole PDF in Foundry's PDF viewer. One per piece of evidence; opening it again
 * brings it to the front.
 */
export class PdfViewer extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["dimancer-board-pdf"],
    window: { icon: "fa-solid fa-file-pdf", resizable: true },
    position: { width: 760, height: 900 }
  };

  /**
   * Open (or focus) the viewer.
   * @param {{src: string, title: string, key: string}} options  key: a stable id (the page id)
   */
  static open({ src, title, key }) {
    const id = `dimancer-board-pdf-${key}`;
    const existing = foundry.applications.instances.get(id);
    if ( existing ) {
      existing.bringToFront();
      return existing;
    }
    const app = new this({ id, src, window: { title } });
    app.render({ force: true });
    return app;
  }

  /** @override */
  async _renderHTML() {
    const frame = document.createElement("iframe");
    const params = new URLSearchParams({ file: fileUrl(this.options.src) });
    frame.src = `${route("scripts/pdfjs/web/viewer.html")}?${params}`;
    frame.title = this.options.window.title ?? "";
    return frame;
  }

  /** @override */
  _replaceHTML(frame, content) {
    // Once loaded, the frame stays: replacing it would reload the PDF and lose the reader's place.
    if ( !content.querySelector("iframe") ) content.replaceChildren(frame);
  }
}
