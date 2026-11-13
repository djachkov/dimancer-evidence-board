import { MODULE_ID } from "./constants.mjs";
import { EVIDENCE_TYPE } from "./journal-pages.mjs";

/**
 * The "evidence" Journal page type (stored as "dimancer_board.evidence"): either an image (the page's
 * own `src`) or a text document (`pages`, one HTML string per sheet of paper), with notes, a
 * category and a folder inside the Evidence Journal, and the document it was made from. Board
 * placements aren't stored here; they are cards that point at the page.
 */
export class EvidencePageData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const f = foundry.data.fields;
    const id = () => new f.StringField({ required: true, nullable: true, blank: false, initial: null });
    return {
      kind: new f.StringField({ required: true, blank: false, choices: ["image", "document"], initial: "image" }),
      /** A text document's pages, in order (unused for an image). */
      pages: new f.ArrayField(new f.HTMLField({ required: true, blank: true }), { required: true, initial: [] }),
      notes: new f.HTMLField({ required: true, blank: true, initial: "" }),
      category: id(),
      folder: id(),
      link: id(),
      author: id(),
      created: new f.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
    };
  }
}

const TEMPLATE_VIEW = `modules/${MODULE_ID}/templates/evidence-page-view.hbs`;
const TEMPLATE_EDIT = `modules/${MODULE_ID}/templates/evidence-page-edit.hbs`;

/**
 * A plain sheet for an evidence page, so one still reads (and edits) well wherever it's shown on
 * its own. In the Evidence Journal the evidence sheet shows pages itself.
 */
export function makeEvidencePageSheet() {
  const Base = foundry.applications.sheets.journal.JournalEntryPageImageSheet;
  return class EvidencePageSheet extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["dimancer-board-evidence-page"],
      window: { icon: "fa-solid fa-magnifying-glass" }
    };

    static EDIT_PARTS = {
      header: Base.EDIT_PARTS.header,
      content: { template: TEMPLATE_EDIT, classes: ["standard-form", "scrollable"], scrollable: [""] },
      footer: Base.EDIT_PARTS.footer
    };

    static VIEW_PARTS = {
      content: { template: TEMPLATE_VIEW, root: true }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const page = this.page;
      context.notesField = page.system.schema.fields.notes;
      context.notes = page.system.notes;
      const TE = foundry.applications.ux.TextEditor.implementation;
      const enrich = html => TE.enrichHTML(html, { secrets: page.isOwner, relativeTo: page });
      context.notesHTML = await enrich(page.system.notes);
      context.isDocument = page.system.kind === "document";
      // Pages aren't cleaned by the server (it only cleans single HTML fields), so clean them here.
      context.docPagesHTML = context.isDocument
        ? await Promise.all(page.system.pages.map(p => enrich(foundry.utils.cleanHTML(p)))) : [];
      return context;
    }
  };
}

export function registerEvidencePageType() {
  CONFIG.JournalEntryPage.dataModels[EVIDENCE_TYPE] = EvidencePageData;
  CONFIG.JournalEntryPage.typeIcons ??= {};
  CONFIG.JournalEntryPage.typeIcons[EVIDENCE_TYPE] = "fa-solid fa-magnifying-glass";
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, makeEvidencePageSheet(), {
    types: [EVIDENCE_TYPE],
    makeDefault: true,
    label: () => game.i18n.localize("DIMANCER_BOARD.Journal.PageSheet")
  });
}
