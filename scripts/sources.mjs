import { t } from "./constants.mjs";
import { isBoard } from "./permissions.mjs";
import { isImageFile } from "./uploads.mjs";
import { pinFiles } from "./add-evidence.mjs";
import { isEvidencePage, placeOnBoard } from "./journal-store.mjs";

/** Document types that can be dropped on a board as evidence. */
export const DOCUMENT_TYPES = new Set(["Actor", "Item", "JournalEntry", "JournalEntryPage"]);

const FALLBACK_IMAGE = {
  Actor: "icons/svg/mystery-man.svg",
  Item: "icons/svg/item-bag.svg",
  JournalEntry: "icons/svg/book.svg",
  JournalEntryPage: "icons/svg/book.svg"
};

/** The image that represents a document on the board. */
export function documentImage(doc) {
  switch ( doc.documentName ) {
    case "JournalEntryPage":
      return (doc.type === "image" && doc.src) ? doc.src : FALLBACK_IMAGE.JournalEntryPage;
    case "JournalEntry": {
      const page = doc.pages.contents.sort((a, b) => a.sort - b.sort).find(p => (p.type === "image") && p.src);
      return page?.src ?? FALLBACK_IMAGE.JournalEntry;
    }
    default:
      return doc.img || FALLBACK_IMAGE[doc.documentName] || "icons/svg/hazard.svg";
  }
}

/**
 * The pages of text a dropped Journal page or entry reads as, or null when it's a picture (an image
 * page, or an entry with one) or has no text pages at all.
 * @returns {string[]|null}  HTML, one string per page
 */
export function documentText(doc) {
  const text = p => (p.type === "text") ? String(p.text?.content ?? "") : null;
  if ( doc.documentName === "JournalEntryPage" ) {
    const content = text(doc);
    return content === null ? null : [content];
  }
  if ( doc.documentName === "JournalEntry" ) {
    const pages = doc.pages.contents.sort((a, b) => a.sort - b.sort);
    if ( pages.some(p => (p.type === "image") && p.src) ) return null;
    const texts = pages.map(text).filter(c => c !== null);
    return texts.length ? texts : null;
  }
  return null;
}

/**
 * Pin a dropped Actor, Item, Journal entry or Journal page, linked back to the document. A text
 * page, or an entry of text pages, becomes a text document (a copy of its pages); a PDF page, a
 * document of that PDF.
 * @param {string} uuid
 * @param {{x: number, y: number}} point
 */
export async function pinDocument(uuid, point) {
  const doc = await fromUuid(uuid);
  if ( !doc ) return ui.notifications.warn(t("Notify.NoDocument"));
  // Evidence from the Evidence Journal is placed as itself (linked), not copied into a new page.
  if ( isEvidencePage(doc) ) return placeOnBoard(doc, point);
  // A PDF page: a document whose file is the PDF (only its first page is drawn on the board).
  if ( (doc.documentName === "JournalEntryPage") && (doc.type === "pdf") && doc.src ) {
    return canvas.board.addCard({ kind: "document", src: doc.src, x: point.x, y: point.y, title: doc.name ?? "", link: doc.uuid });
  }
  const docPages = documentText(doc);
  if ( docPages ) {
    return canvas.board.addCard({ kind: "document", docPages, x: point.x, y: point.y, title: doc.name ?? "", link: doc.uuid });
  }
  return canvas.board.addCard({ src: documentImage(doc), x: point.x, y: point.y, title: doc.name ?? "", link: doc.uuid });
}

/**
 * Open the document a card links to. Journal pages open in their journal.
 * @param {string} uuid
 */
export async function openLinked(uuid) {
  const doc = await fromUuid(uuid);
  if ( !doc ) return ui.notifications.warn(t("Notify.NoDocument"));
  if ( !doc.testUserPermission(game.user, "LIMITED") ) return ui.notifications.warn(t("Notify.NoDocumentPermission"));
  if ( doc.documentName === "JournalEntryPage" ) return doc.parent.sheet.render({ force: true, pageId: doc.id });
  return doc.sheet.render({ force: true });
}

const IMAGE_URL = /^(https?:\/\/\S+|[\w./-]+)\.(apng|avif|gif|jpe?g|png|svg|webp)(\?\S*)?$/i;

/**
 * Ctrl+V on a board pins pasted images (uploaded) or a pasted image URL at the mouse; any other
 * text becomes a sticky note there. Text fields keep their normal paste.
 * @param {ClipboardEvent} event
 */
function onPaste(event) {
  if ( !canvas.ready || !isBoard(canvas.scene) || !canvas.board?.active ) return;
  if ( event.target?.closest?.("input, textarea, select, [contenteditable], prose-mirror, .application") ) return;
  const point = { x: canvas.mousePosition.x, y: canvas.mousePosition.y };
  const files = [...(event.clipboardData?.files ?? [])].filter(isImageFile);
  if ( files.length ) {
    event.preventDefault();
    pinFiles(files, point, { titles: false });
    return;
  }
  const raw = event.clipboardData?.getData("text/plain") ?? "";
  const text = raw.replace(/\r\n?/g, "\n").replace(/^\s*\n|\s+$/g, "");
  if ( !text.trim() ) return;
  event.preventDefault();
  if ( IMAGE_URL.test(text.trim()) ) return canvas.board.addCard({ src: text.trim(), ...point });
  canvas.board.placeNote(point, { text });
}

export function registerPaste() {
  document.addEventListener("paste", onPaste);
}
