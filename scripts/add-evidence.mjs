import { TEMPLATES, t } from "./constants.mjs";
import { canBrowse, canUpload, uploadFile, isEvidenceFile, isPdfFile } from "./uploads.mjs";
import { isPdfPath } from "./pdf-preview.mjs";
import { categoriesOf } from "./organize-actions.mjs";
import { createEvidencePage } from "./journal-store.mjs";

/** A readable default title from a file name or path: "crime-scene_02.jpg" → "Crime scene 02". */
export function titleFromPath(path) {
  const name = decodeURIComponent(String(path ?? "").split(/[/\\]/).pop() ?? "")
    .replace(/\?.*$/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/-[A-Za-z0-9]{6}$/, "")        // our upload suffix
    .replace(/[-_]+/g, " ")
    .trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

/**
 * Open the "Add evidence" dialog. On a board the result is pinned at the centre of the view; into
 * the Evidence Journal it becomes a page only (not placed on any board; a GM's starts hidden).
 * Either way a PDF (picked, typed or uploaded) becomes a document whose file is the PDF.
 * @param {object} [options]
 * @param {"board"|"journal"} [options.target]
 * @param {"image"|"pdf"} [options.kind]   What the dialog asks for (its labels and file browser)
 * @param {object[]} [options.categories]  The categories to offer (default: the board's)
 */
export async function openAddEvidence({ target = "board", kind = "image", categories } = {}) {
  const journal = target === "journal";
  const pdf = kind === "pdf";
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.addEvidence, {
    canBrowse: canBrowse(),
    canUpload: canUpload(),
    pdf,
    categories: categories ?? categoriesOf(canvas.scene)
  });
  const windowTitle = pdf ? "Journal.AddPdf" : (journal ? "Journal.Add" : "Add.Title");
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: t(windowTitle), icon: pdf ? "fa-solid fa-file-pdf" : (journal ? "fa-solid fa-book" : "fa-solid fa-thumbtack") },
    position: { width: 480 },
    classes: ["dimancer-board-add"],
    content,
    buttons: [{
      action: "pin",
      label: t(journal ? "Journal.AddButton" : "Add.Pin"),
      icon: journal ? "fa-solid fa-book" : "fa-solid fa-thumbtack",
      default: true,
      callback: (event, button) => {
        const form = button.form;
        return {
          src: form.elements.src.value.trim(),
          file: form.elements.file?.files?.[0] ?? null,
          title: form.elements.title.value.trim(),
          category: form.elements.category?.value || null
        };
      }
    }, {
      action: "cancel",
      label: t("Add.Cancel"),
      icon: "fa-solid fa-xmark"
    }],
    rejectClose: false,
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form");
      const title = form.elements.title;
      form.querySelector("[data-browse]")?.addEventListener("click", () => {
        const FP = foundry.applications.apps.FilePicker.implementation;
        new FP({
          type: pdf ? "text" : "image",
          current: form.elements.src.value,
          callback: path => {
            form.elements.src.value = path;
            if ( !title.value ) title.value = titleFromPath(path);
          }
        }).browse();
      });
      form.elements.file?.addEventListener("change", ev => {
        const file = ev.target.files?.[0];
        if ( file && !title.value ) title.value = titleFromPath(file.name);
      });
    }
  });
  if ( !result || (result === "cancel") ) return;

  let src = result.src;
  if ( result.file ) {
    if ( !isEvidenceFile(result.file) ) return ui.notifications.warn(t("Notify.NotImage"));
    src = await uploadFile(result.file);
  }
  if ( !src ) {
    if ( !result.file ) ui.notifications.warn(t(pdf ? "Notify.NoPdf" : "Notify.NoImage"));
    return;
  }
  const title = result.title || titleFromPath(src);
  // A PDF is a document whose pages are the file's; anything else is a picture.
  const asPdf = isPdfPath(src) || (result.file && isPdfFile(result.file)) || (pdf && !/\.(apng|avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(\?.*)?$/i.test(src));
  const kindData = asPdf ? { kind: "document" } : {};
  if ( journal ) return createEvidencePage({ src, title, category: result.category, ...kindData }, { hidden: game.user.isGM });
  return canvas.board.addCard({ src, title, category: result.category, ...kindData });
}

/**
 * Upload and pin image and PDF files dropped from the operating system, fanned out around the drop
 * point. A PDF becomes a document.
 * @param {File[]} files
 * @param {{x: number, y: number}} point
 * @param {{titles?: boolean}} [options]  Title cards after their file names (pasted images have none)
 */
export async function pinFiles(files, point, { titles = true } = {}) {
  const usable = files.filter(isEvidenceFile);
  if ( !usable.length ) return ui.notifications.warn(t("Notify.NotImage"));
  if ( !canUpload() ) return ui.notifications.warn(t("Notify.NoUpload"));
  let i = 0;
  for ( const file of usable ) {
    const src = await uploadFile(file);
    if ( !src ) continue;
    const offset = i++ * 40;
    await canvas.board.addCard({
      src, x: point.x + offset, y: point.y + offset, title: titles ? titleFromPath(file.name) : "",
      ...(isPdfFile(file) ? { kind: "document" } : {})
    });
  }
}
