import { TEMPLATES, t } from "./constants.mjs";
import { JOURNAL_STYLES } from "./journal-pages.mjs";
import { cardView, styleVars } from "./journal-cards.mjs";
import { parchmentCss } from "./journal-paper.mjs";

/**
 * The New Journal dialog: a name, the journal's style (shown as a sample card in each look, since
 * the style can't be changed later), who can use it, and whether it becomes the user's default.
 */

/** A sample document card, drawn in one style. */
function sample(style) {
  return {
    ...cardView({ id: `sample-${style}`, kind: "document", title: t("NewJournal.SampleTitle"), src: "", docPages: [""], hidden: false, placements: [] },
      { style, text: t("NewJournal.SampleText") }),
    pagesLabel: ""
  };
}

/**
 * @param {{hasDefault: boolean}} options  Whether the user already has a default journal
 * @returns {Promise<{name: string, style: string, shared: boolean, makeDefault: boolean}|null>}
 */
export async function promptJournalOptions({ hasDefault = false } = {}) {
  await foundry.applications.handlebars.loadTemplates([TEMPLATES.journalCard]);
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.createJournal, {
    name: t("Journal.DefaultName"),
    styles: JOURNAL_STYLES.map((id, i) => ({
      id, label: t(`NewJournal.Style.${id}`), hint: t(`NewJournal.StyleHint.${id}`),
      checked: i === 0, vars: styleVars(id), card: sample(id)
    })),
    makeDefault: !hasDefault,
    gm: game.user.isGM
  });
  return foundry.applications.api.DialogV2.prompt({
    window: { title: t("NewJournal.Title"), icon: "fa-solid fa-book-medical" },
    classes: ["dimancer-board-new-journal"],
    position: { width: 560 },
    content,
    rejectClose: false,
    ok: {
      label: t("NewJournal.Create"),
      icon: "fa-solid fa-book-medical",
      callback: (event, button) => {
        const els = button.form.elements;
        return {
          name: els.name.value.trim(),
          style: els.style.value,
          shared: els.access.value === "shared",
          makeDefault: els.makeDefault.checked
        };
      }
    },
    render: (event, dialog) => {
      dialog.element.querySelector(".mb-style-picker")?.style.setProperty("--mb-parchment", parchmentCss());
      dialog.element.querySelector("input[name=name]")?.select();
    }
  });
}
