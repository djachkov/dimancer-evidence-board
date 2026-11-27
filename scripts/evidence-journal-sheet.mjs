import { MODULE_ID, TEMPLATES, t } from "./constants.mjs";
import { listRows } from "./organize.mjs";
import { boardCategoriesRaw, boardFolders, canEditBoard, isBoard } from "./permissions.mjs";
import {
  categoriesOf, createFolder, moveCardsToFolder, moveFolder, openCategoryManager, openCategoryPicker, openFolderMenu,
  setCardCategory
} from "./organize-actions.mjs";
import { menuItems, showMenu } from "./menu.mjs";
import { focusCard, focusCardForEveryone } from "./focus.mjs";
import { PdfViewer, isPdfDocument, pdfPreview } from "./pdf-preview.mjs";
import { openLinked } from "./sources.mjs";
import { openAddEvidence } from "./add-evidence.mjs";
import ImageStage from "./image-stage.mjs";
import { parchmentCss } from "./journal-paper.mjs";
import { cardView, contentSections, matchesQuery, pageTurn, styleVars } from "./journal-cards.mjs";
import {
  boardPlacements, canEditJournal, canEditPage, canSeePage, createEvidencePage, deleteEvidence, evidenceJournals,
  isDefaultJournal, journalItems, journalOrganizer, journalStyleOf, movePage, placeOnBoard, promptNewJournal,
  setDefaultJournal, setPageHidden
} from "./journal-store.mjs";

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
const DRAG_TYPE = "application/x-dimancer-board";
const MODES = ["folders", "categories", "all"];
const SORTS = ["board", "name", "newest"];
const PLACEMENTS = ["all", "placed", "unplaced"];

/**
 * Plain text of some HTML, for searching notes and pages. Parsed into an inert document, so nothing
 * in it loads or runs (an element of the live page would fetch images and fire their handlers).
 */
const parser = new DOMParser();
function plainText(html) {
  return parser.parseFromString(`<body>${html ?? ""}</body>`, "text/html").body.textContent ?? "";
}

/** Per-viewer preferences (view, sort, placement filter, collapsed groups), in browser storage. */
const prefs = {
  key: id => `${MODULE_ID}.journal.${id}`,
  get(id) {
    try {
      return JSON.parse(localStorage.getItem(this.key(id))) ?? {};
    } catch(err) {
      return {};
    }
  },
  set(id, value) {
    try {
      localStorage.setItem(this.key(id), JSON.stringify(value));
    } catch(err) { /* storage unavailable: preferences just don't persist */ }
  }
};

/** Is this element somewhere the user types (keys belong to it, not to page turning)? */
const isTyping = el => !!el?.closest?.("input, textarea, select, [contenteditable=true]");

/**
 * An Evidence Journal: evidence as a case-file notebook, browsable from any scene. A world can have
 * several (shared or private); each keeps the style it was created in (classic, quest-board
 * parchment or cyberpunk holo), for its paper and its cards.
 *
 * Two spreads of one open book:
 * - Contents: the left page is the table of contents (Folders, Categories or All; folders and
 *   categories are chapters, with counts; drop evidence on one to file it). The right page is a
 *   contact sheet of the evidence, each piece drawn as a board draws it in the journal's card style
 *   (polaroids, A4 sheets, parchment, holo panels), grouped by chapter.
 * - Reading: one piece. The left page shows it large (a zoomable picture in its frame, a document's
 *   sheet written in place, a PDF's first page); the right page its title, category and notes,
 *   typeset for reading and written in place, with the boards it's on at the foot. ‹ › (or the
 *   arrow keys) turn to the previous or next piece; Esc goes back to the contents.
 *
 * The bar's journal button switches to another journal, makes this one the user's default (where
 * evidence taken off a board is filed) or starts a new one. Cards drag onto a board to pin them
 * there. Double-clicking evidence on a board opens it in its journal.
 * Shown for JournalEntries flagged as evidence journals (pinned via flags.core.sheetClass).
 */
export default class EvidenceJournalSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {
  constructor(options) {
    super(options);
    const p = prefs.get(this.document.id);
    this.#mode = MODES.includes(p.mode) ? p.mode : "folders";
    this.#sort = SORTS.includes(p.sort) ? p.sort : "board";
    this.#placement = PLACEMENTS.includes(p.placement) ? p.placement : "all";
    this.#collapsed = new Set(Array.isArray(p.collapsed) ? p.collapsed : []);
  }

  static DEFAULT_OPTIONS = {
    classes: ["dimancer-board-journal"],
    tag: "div",
    window: { icon: "fa-solid fa-book-open", resizable: true },
    position: { width: 1060, height: 720 },
    actions: {
      open: EvidenceJournalSheet.#onOpen,
      contents: EvidenceJournalSheet.#onContents,
      prev: EvidenceJournalSheet.#onPrev,
      next: EvidenceJournalSheet.#onNext,
      toggle: EvidenceJournalSheet.#onToggle,
      goto: EvidenceJournalSheet.#onGoto,
      mode: EvidenceJournalSheet.#onMode,
      filter: EvidenceJournalSheet.#onFilter,
      addMenu: EvidenceJournalSheet.#onAddMenu,
      itemMenu: EvidenceJournalSheet.#onItemMenu,
      newFolder: EvidenceJournalSheet.#onNewFolder,
      manageCategories: EvidenceJournalSheet.#onManageCategories,
      groupMenu: EvidenceJournalSheet.#onGroupMenu,
      clearSearch: EvidenceJournalSheet.#onClearSearch,
      pickCategory: EvidenceJournalSheet.#onPickCategory,
      prevDocPage: EvidenceJournalSheet.#onPrevDocPage,
      nextDocPage: EvidenceJournalSheet.#onNextDocPage,
      addDocPage: EvidenceJournalSheet.#onAddDocPage,
      removeDocPage: EvidenceJournalSheet.#onRemoveDocPage,
      openBoard: EvidenceJournalSheet.#onOpenBoard,
      place: EvidenceJournalSheet.#onPlace,
      jump: EvidenceJournalSheet.#onJump,
      toggleHidden: EvidenceJournalSheet.#onToggleHidden,
      openImage: EvidenceJournalSheet.#onOpenImage,
      zoomIn: EvidenceJournalSheet.#onZoomIn,
      zoomOut: EvidenceJournalSheet.#onZoomOut,
      fit: EvidenceJournalSheet.#onFit,
      actual: EvidenceJournalSheet.#onActual,
      openLink: EvidenceJournalSheet.#onOpenLink,
      journals: EvidenceJournalSheet.#onJournals,
      makeDefault: EvidenceJournalSheet.#onMakeDefault
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.evidenceJournal, templates: [TEMPLATES.journalCard] }
  };

  /** Lets journal-sync find open evidence sheets. */
  get isEvidenceJournalSheet() {
    return true;
  }

  get organizer() {
    return journalOrganizer(this.document);
  }

  /** @override */
  get title() {
    return this.document.name;
  }

  #query = "";
  #mode;
  #sort;
  #placement;
  #collapsed;
  /** The piece being read (null: the contents). */
  #selected = null;
  /** Which page of the selected text document is shown (0-based). */
  #docPage = 0;
  #pending = false;
  /** Contents scroll positions, kept across re-renders and a visit to a piece. */
  #scroll = { toc: 0, sheet: 0 };
  #searchFocus = null;
  /** The reading order, from the last render (for page turning). */
  #order = [];
  /** @type {((ev: KeyboardEvent) => void)|null} */
  #keyListener = null;
  /** The zoomable picture; it outlives re-renders, so zoom and pan survive live updates. */
  #stage = new ImageStage();

  #savePrefs() {
    prefs.set(this.document.id, {
      mode: this.#mode, sort: this.#sort, placement: this.#placement, collapsed: [...this.#collapsed]
    });
  }

  /** Is the user typing in the sheet (a re-render would throw their edit away)? */
  #isBusy() {
    const el = this.element;
    if ( !el ) return false;
    if ( el.querySelector("prose-mirror[data-save-state=pending]") ) return true;
    const active = document.activeElement;
    // The search box doesn't count (it keeps its text and focus across a re-render), nor do selects
    // (they save the moment they change).
    return !!active && el.contains(active) && (active.matches("input[type=text], textarea") || active.isContentEditable);
  }

  /**
   * Live updates (pages, boards) re-render the sheet, but never while someone is typing in it;
   * the update is applied once they leave the field.
   * @override
   */
  async render(options = {}, _options = {}) {
    // Core still calls render(true, {pageId}) (e.g. for @UUID page links), so normalise like core does.
    if ( typeof options === "boolean" ) options = Object.assign(_options, { force: options });
    if ( options.pageId && (options.pageId !== this.#selected) ) {
      this.#selected = options.pageId;
      this.#docPage = 0;
    }
    if ( !options.force && this.rendered && this.#isBusy() ) {
      this.#pending = true;
      return this;
    }
    this.#pending = false;
    return super.render(options);
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** The card style: the one the journal was created with. */
  #cardStyle() {
    return journalStyleOf(this.document);
  }

  /** @override */
  async _prepareContext(options) {
    const entry = this.document;
    const gm = game.user.isGM;
    const editable = canEditJournal(entry);
    const index = boardPlacements();
    const allItems = journalItems(entry, index).filter(i => gm || canSeePage(entry.pages.get(i.id)));
    let items = allItems;
    if ( this.#placement === "placed" ) items = items.filter(i => i.placements.length);
    else if ( this.#placement === "unplaced" ) items = items.filter(i => !i.placements.length);
    const cats = categoriesOf(this.organizer);
    const catById = new Map(cats.map(c => [c.id, c]));
    const style = this.#cardStyle();
    const untitled = kind => t(kind === "document" ? "Document.Untitled" : "Card.Untitled");

    const rows = listRows({
      items, folders: boardFolders(entry), categories: boardCategoriesRaw(entry),
      mode: this.#mode, sort: this.#sort, includeHidden: true
    });
    const cardEntry = r => {
      const c = r.card;
      const cat = catById.get(c.category) ?? null;
      const text = c.kind === "document" ? plainText(c.docPages.join(" ")) : "";
      return {
        id: c.id,
        search: `${c.title} ${plainText(c.notes)} ${text} ${cat?.name ?? ""}`.toLowerCase(),
        card: {
          ...cardView(c, { style, category: cat, text: plainText(c.docPages[0] ?? ""), untitled: untitled(c.kind) }),
          pagesLabel: t("Document.Pages", { count: Math.max(1, c.docPages.length) })
        }
      };
    };
    const sections = contentSections(rows).map(s => {
      const g = s.group;
      const collapsed = this.#collapsed.has(s.key);
      const collapsedAbove = s.ancestors.some(a => this.#collapsed.has(a));
      const cards = s.cards.map(cardEntry);
      if ( !g ) {
        return {
          key: s.key, depth: 0, ancestors: [], cards, count: cards.length, collapsed, collapsedAbove,
          name: t(this.#mode === "all" ? "Journal.AllEvidence" : "Journal.Loose"), icon: "fa-layer-group", loose: true
        };
      }
      return {
        key: s.key, groupId: g.groupId, kind: g.kind, depth: s.depth, ancestors: s.ancestors, cards,
        count: g.count, collapsed, collapsedAbove,
        name: g.group.name ?? t("Category.Uncategorized"), color: g.group.color,
        icon: g.kind === "category" ? g.group.icon : (collapsed ? "fa-folder" : "fa-folder-open"),
        menu: editable && (g.kind === "folder"),
        draggable: editable && (g.kind === "folder")
      };
    });

    // Reading order: the contents' order, narrowed by the search.
    const cardEntries = sections.flatMap(s => s.cards);
    this.#order = cardEntries.filter(c => matchesQuery(c.search, this.#query)).map(c => c.id);

    const selectedPage = entry.pages.get(this.#selected);
    let selected = null;
    if ( selectedPage && (gm || canSeePage(selectedPage)) ) {
      const item = allItems.find(i => i.id === selectedPage.id);
      if ( item ) selected = await this.#readingContext(selectedPage, item, catById, style);
    }
    if ( !selected ) this.#selected = null;
    const order = this.#order.includes(this.#selected) ? this.#order : allItems.map(i => i.id);
    const turn = selected ? pageTurn(order, selected.id) : null;

    return {
      editable, gm, selected, style,
      isDefault: isDefaultJournal(entry),
      styleVars: styleVars(style),
      reading: !!selected,
      turn: turn && { ...turn, number: turn.index + 1 },
      title: entry.name,
      sections,
      toc: sections.filter(s => !s.loose || (this.#mode !== "folders") || s.cards.length),
      boards: this.#boards().map(s => ({ id: s.id, name: s.name, current: s === canvas.scene })),
      count: cardEntries.length,
      countLabel: cardEntries.length === 1 ? t("Journal.CountOne") : t("Journal.Count", { count: cardEntries.length }),
      empty: !allItems.length,
      query: this.#query,
      filtered: (this.#placement !== "all") || (this.#sort !== "board"),
      modes: MODES.map(m => ({ id: m, label: t(`List.Mode.${m}`), active: m === this.#mode })),
      isFolders: this.#mode === "folders",
      isCategories: this.#mode === "categories"
    };
  }

  /** The reading spread for one page. */
  async #readingContext(page, item, catById, style) {
    const editable = canEditPage(page);
    const board = canvas.scene;
    const onCurrent = item.placements.find(p => p.sceneId === board?.id);
    const link = item.link ? fromUuidSync(item.link, { strict: false }) : null;
    const TE = foundry.applications.ux.TextEditor.implementation;
    const category = catById.get(item.category) ?? null;
    const card = cardView(item, { style, category, untitled: t(item.kind === "document" ? "Document.Untitled" : "Card.Untitled") });
    // A PDF shows its first page like a picture (zoomable; the book button reads the whole file).
    const isPdf = isPdfDocument(item);
    const pdf = isPdf ? await pdfPreview(item.src) : null;
    const isDocument = (item.kind === "document") && !isPdf;
    const docPages = isDocument ? (item.docPages.length ? item.docPages : [""]) : [];
    if ( isDocument ) this.#docPage = Math.clamp(this.#docPage, 0, docPages.length - 1);
    // Pages aren't cleaned by the server (it only cleans single HTML fields), so clean them here,
    // both for showing and for the editor's starting value.
    const docPageRaw = isDocument ? foundry.utils.cleanHTML(docPages[this.#docPage] ?? "") : "";
    return {
      card,
      isDocument,
      isPdf,
      isPhoto: !isDocument && !isPdf,
      pdfPreview: pdf ? await pdf.url : null,
      pdfPages: pdf?.pages ?? 0,
      pdfBroken: isPdf && !pdf,
      docPage: this.#docPage + 1,
      docPageCount: docPages.length,
      docPageRaw,
      docPageHTML: isDocument ? await TE.enrichHTML(docPageRaw, { secrets: editable, relativeTo: page }) : "",
      docPageEmpty: !plainText(docPageRaw).trim(),
      isFirstDocPage: this.#docPage === 0,
      isLastDocPage: this.#docPage >= docPages.length - 1,
      id: page.id,
      uuid: page.uuid,
      title: item.title,
      untitled: !item.title,
      src: item.src,
      notes: item.notes,
      notesHTML: await TE.enrichHTML(item.notes, { secrets: editable, relativeTo: page }),
      hasNotes: !!plainText(item.notes).trim() || /<(img|hr|table)/i.test(item.notes),
      editable,
      hidden: item.hidden,
      category,
      placements: item.placements.map(p => ({ ...p, current: p.sceneId === board?.id })),
      canPlace: isBoard(board) && canEditBoard(board) && !onCurrent,
      boardName: isBoard(board) ? board.name : null,
      link: item.link ? { uuid: item.link, name: link?.name ?? t("Journal.Source") } : null,
      author: game.users.get(item.author)?.name ?? null
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // The root element outlives re-renders, so these are wired once.
    // Deferred live updates land once the user leaves the field they were typing in.
    this.element.addEventListener("focusout", () => setTimeout(() => {
      if ( this.#pending && !this.#isBusy() ) this.render();
    }, 0));
    // Keys reach the document even when focus isn't inside the window (a click on the page
    // doesn't focus anything), and the document hears them before Foundry's own window listener.
    this.#keyListener = ev => this.#onKeyDown(ev);
    document.addEventListener("keydown", this.#keyListener);
    this.element.style.setProperty("--mb-parchment", parchmentCss());
  }

  /** @override */
  _preRender(context, options) {
    const el = this.element;
    const toc = el?.querySelector(".mb-toc-list");
    const sheet = el?.querySelector(".mb-sheet");
    if ( toc ) this.#scroll.toc = toc.scrollTop;
    if ( sheet ) this.#scroll.sheet = sheet.scrollTop;
    const search = el?.querySelector("input[name=search]");
    this.#searchFocus = (search && (document.activeElement === search)) ? [search.selectionStart, search.selectionEnd] : null;
    return super._preRender(context, options);
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const toc = el.querySelector(".mb-toc-list");
    const sheet = el.querySelector(".mb-sheet");
    if ( toc ) toc.scrollTop = this.#scroll.toc;
    if ( sheet ) sheet.scrollTop = this.#scroll.sheet;
    if ( this.#searchFocus ) {
      const search = el.querySelector("input[name=search]");
      search?.focus();
      search?.setSelectionRange(...this.#searchFocus);
    }

    el.querySelector("input[name=search]")?.addEventListener("input", ev => {
      this.#query = ev.target.value;
      this.#filter();
    });

    for ( const cell of el.querySelectorAll(".mb-cell[data-card-id]") ) {
      cell.addEventListener("dblclick", () => this.#openOrJump(cell.dataset.cardId));
      cell.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        this.#itemMenu(cell.dataset.cardId, ev.clientX, ev.clientY);
      });
    }
    for ( const row of el.querySelectorAll("[data-kind=folder][data-group-id]") ) {
      row.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        openFolderMenu(this.organizer, row.dataset.groupId, ev.clientX, ev.clientY);
      });
    }
    this.#activateDragDrop(el, context.editable);
    this.#activateReading(el);
    this.#loadPdfThumbs(el);
    this.#stage.attach(el.querySelector(".mb-exhibit [data-stage]"), `${this.#selected}|${context.selected?.src ?? ""}`);
    this.#filter();
  }

  /** @override */
  _preClose(options) {
    document.removeEventListener("keydown", this.#keyListener);
    this.#keyListener = null;
    this.#stage.detach();
    return super._preClose(options);
  }

  /** A PDF's card shows its first page once it's been drawn (pdf.js, cached per file). */
  async #loadPdfThumbs(el) {
    for ( const img of el.querySelectorAll("img[data-pdf-src]") ) {
      try {
        const pdf = await pdfPreview(img.dataset.pdfSrc);
        const url = pdf ? await pdf.url : null;
        if ( !url || !img.isConnected ) continue;
        img.src = url;
        img.hidden = false;
        img.closest(".mb-card")?.classList.add("has-preview");
      } catch(err) { /* the card keeps its typeset title */ }
    }
  }

  /** The reading spread's fields save as they change. */
  #activateReading(el) {
    const page = this.document.pages.get(this.#selected);
    if ( !page ) return;
    const title = el.querySelector(".mb-reading [name=title]");
    if ( title ) {
      const fit = () => {
        title.style.height = "auto";
        title.style.height = `${title.scrollHeight}px`;
      };
      fit();
      title.addEventListener("input", fit);
      // Enter finishes the title rather than adding a line.
      title.addEventListener("keydown", ev => {
        if ( ev.key === "Enter" ) {
          ev.preventDefault();
          title.blur();
        }
      });
      title.addEventListener("change", () => {
        const name = title.value.replace(/\s+/g, " ").trim();
        if ( name && (name !== page.name) ) page.update({ name });
        else title.value = page.name;
      });
    }
    el.querySelector(".mb-reading prose-mirror[name=notes]")?.addEventListener("change", ev => {
      page.update({ "system.notes": ev.target.value ?? "" });
    });
    // A text document's page: the whole list of pages is written back with this one replaced.
    el.querySelector(".mb-exhibit prose-mirror[name=docPage]")?.addEventListener("change", ev => {
      const pages = this.#docPages(page);
      pages[this.#docPage] = ev.target.value ?? "";
      page.update({ "system.pages": pages });
    });
  }

  /** A copy of a text document's pages (at least one). */
  #docPages(page) {
    const pages = [...(page?.system.pages ?? [])];
    return pages.length ? pages : [""];
  }

  /**
   * ← → turn pages while reading, Esc goes back to the contents, / jumps to the search: while this
   * is the front window and the key isn't meant for something else.
   */
  #onKeyDown(ev) {
    if ( ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented || isTyping(ev.target) ) return;
    if ( (ui.activeWindow !== this) || !this.rendered || this.minimized ) return;
    const focus = document.activeElement;
    if ( focus && (focus !== document.body) && !this.element.contains(focus) ) return;
    if ( document.getElementById("dimancer-board-menu") ) return;
    const reading = !!this.#selected;
    if ( reading && ((ev.key === "ArrowLeft") || (ev.key === "ArrowRight")) ) {
      ev.preventDefault();
      this.#turn(ev.key === "ArrowLeft" ? -1 : 1);
    } else if ( reading && (ev.key === "Escape") ) {
      ev.preventDefault();
      ev.stopPropagation();
      this.#select(null);
    } else if ( !reading && (ev.key === "/") ) {
      ev.preventDefault();
      this.element.querySelector("input[name=search]")?.focus();
    }
  }

  /* -------------------------------------------- */
  /*  Search and collapsing                       */
  /* -------------------------------------------- */

  #filter() {
    const el = this.element;
    const q = this.#query.trim().toLowerCase();
    let matches = 0;
    const matchedSections = new Set();
    for ( const cell of el.querySelectorAll(".mb-cell[data-card-id]") ) {
      const match = matchesQuery(cell.dataset.search, q);
      cell.hidden = !match;
      if ( match ) {
        matches++;
        matchedSections.add(cell.closest(".mb-section")?.dataset.section);
      }
    }
    const ancestorsOf = node => (node.dataset.ancestors ? node.dataset.ancestors.split(" ").filter(Boolean) : []);
    for ( const section of el.querySelectorAll(".mb-section") ) {
      const key = section.dataset.section;
      const above = ancestorsOf(section).some(a => this.#collapsed.has(a));
      const collapsed = this.#collapsed.has(key);
      if ( q ) {
        // Searching shows every match, collapsed or not, and only the chapters that have some.
        section.hidden = !matchedSections.has(key);
        section.classList.remove("collapsed");
      } else {
        section.hidden = above;
        section.classList.toggle("collapsed", collapsed);
      }
    }
    for ( const entry of el.querySelectorAll(".mb-toc-entry[data-section]") ) {
      const key = entry.dataset.section;
      entry.hidden = ancestorsOf(entry).some(a => this.#collapsed.has(a));
      entry.classList.toggle("collapsed", this.#collapsed.has(key));
      entry.classList.toggle("no-match", !!q && !matchedSections.has(key));
    }
    const nomatch = el.querySelector(".mb-nomatch");
    if ( nomatch ) nomatch.hidden = !q || (matches > 0);
    const clear = el.querySelector("[data-action=clearSearch]");
    if ( clear ) clear.hidden = !q;
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /**
   * Cards drag in two ways at once: onto a chapter here (filing), and onto a board canvas
   * (Foundry's own JournalEntryPage drop data, which pins the page there). Folders drag in the
   * table of contents to nest them.
   */
  #activateDragDrop(el, editable) {
    const book = el.querySelector(".mb-spread");
    if ( !book ) return;
    book.addEventListener("dragstart", ev => {
      const node = ev.target.closest?.("[draggable=true]");
      if ( !node ) return;
      if ( node.dataset.cardId ) {
        const page = this.document.pages.get(node.dataset.cardId);
        ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: "card", id: node.dataset.cardId }));
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "JournalEntryPage", uuid: page.uuid }));
        ev.dataTransfer.effectAllowed = "copyMove";
        const card = node.querySelector(".mb-card");
        if ( card ) ev.dataTransfer.setDragImage(card, card.offsetWidth / 2, card.offsetHeight / 3);
      } else {
        ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: "folder", id: node.dataset.groupId }));
        ev.dataTransfer.effectAllowed = "move";
      }
      node.classList.add("dragging");
    });
    book.addEventListener("dragend", ev => ev.target.closest?.(".dragging")?.classList.remove("dragging"));
    if ( !editable ) return;

    // A chapter: its entry in the contents, or its section on the contact sheet.
    const targetOf = ev => {
      const node = ev.target.closest?.("[data-section]");
      if ( !node ) return null;
      if ( node.dataset.kind ) return { el: node, kind: node.dataset.kind, id: node.dataset.groupId };
      // Loose evidence: out of any folder (folders view only).
      if ( this.#mode === "folders" ) return { el: node, kind: "folder", id: "" };
      return null;
    };
    const clearHighlight = () => el.querySelectorAll(".drop-target").forEach(e => e.classList.remove("drop-target"));
    book.addEventListener("dragover", ev => {
      if ( !ev.dataTransfer.types.includes(DRAG_TYPE) ) return;
      const target = targetOf(ev);
      if ( !target ) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      clearHighlight();
      target.el.classList.add("drop-target");
    });
    book.addEventListener("dragleave", ev => {
      if ( !book.contains(ev.relatedTarget) ) clearHighlight();
    });
    book.addEventListener("drop", async ev => {
      clearHighlight();
      let payload;
      try {
        payload = JSON.parse(ev.dataTransfer.getData(DRAG_TYPE));
      } catch(err) {
        return;
      }
      const target = targetOf(ev);
      if ( !target ) return;
      ev.preventDefault();
      const org = this.organizer;
      if ( payload.type === "folder" ) {
        if ( (target.kind === "folder") && (target.id !== payload.id) ) await moveFolder(org, payload.id, target.id || null);
        return;
      }
      if ( target.kind === "folder" ) await moveCardsToFolder(org, [payload.id], target.id || null);
      else if ( target.kind === "category" ) await setCardCategory(org, [payload.id], target.id || null);
    });
  }

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  /** The boards this user can open (every board for a GM), in navigation order. */
  #boards() {
    return game.scenes.filter(s => isBoard(s) && (game.user.isGM || s.visible))
      .sort((a, b) => (a.navOrder - b.navOrder) || a.name.localeCompare(b.name));
  }

  /** Read a piece (null: back to the contents). */
  #select(pageId) {
    if ( pageId !== this.#selected ) this.#docPage = 0;
    this.#selected = pageId;
    this.render();
  }

  #turn(step) {
    const order = this.#order.includes(this.#selected) ? this.#order : this.document.pages.contents.map(p => p.id);
    const { prev, next } = pageTurn(order, this.#selected);
    const id = step < 0 ? prev : next;
    if ( id ) this.#select(id);
  }

  /** Double-click: go to where it's pinned (this board first), or look at the image. */
  #openOrJump(pageId) {
    const page = this.document.pages.get(pageId);
    if ( !page ) return;
    const placements = boardPlacements().get(page.uuid) ?? [];
    const here = placements.find(p => p.sceneId === canvas.scene?.id) ?? placements[0];
    if ( here ) return focusCard(game.scenes.get(here.sceneId), here.cardId);
    this.#select(pageId);
  }

  #openImage(page) {
    if ( !page?.src ) return;
    if ( isPdfDocument({ kind: page.system.kind, src: page.src }) ) {
      return PdfViewer.open({ src: page.src, title: page.name, key: page.id });
    }
    new foundry.applications.apps.ImagePopout({ src: page.src, uuid: page.uuid, window: { title: page.name } }).render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Menus                                       */
  /* -------------------------------------------- */

  #itemMenu(pageId, x, y) {
    const page = this.document.pages.get(pageId);
    if ( !page ) return;
    const editable = canEditPage(page);
    const placements = boardPlacements().get(page.uuid) ?? [];
    const board = canvas.scene;
    const canPlace = isBoard(board) && canEditBoard(board) && !placements.some(p => p.sceneId === board.id);
    const reading = this.#selected === pageId;
    const esc = foundry.utils.escapeHTML;
    showMenu(x, y, menuItems([
      !reading && { action: "read", icon: "fa-book-open", label: t("Journal.Read") },
      canPlace && { action: "place", icon: "fa-thumbtack", label: t("Journal.PlaceHere") },
      ...placements.map(p => ({ action: "jump", data: { scene: p.sceneId, card: p.cardId }, icon: "fa-location-crosshairs", label: t("Journal.JumpTo", { name: esc(p.sceneName) }) })),
      page.src && ((page.system.kind === "document")
        ? { action: "image", icon: "fa-file-pdf", label: t("Journal.ReadPdf") }
        : { action: "image", icon: "fa-up-right-from-square", label: t("Journal.PopOut") }),
      game.user.isGM && { separator: true },
      game.user.isGM && { action: "show", icon: "fa-users-viewfinder", label: t("Journal.ShowPlayers") },
      ...(game.user.isGM ? placements.map(p => ({ action: "jumpAll", data: { scene: p.sceneId, card: p.cardId }, icon: "fa-people-arrows", label: t("Journal.JumpEveryone", { name: esc(p.sceneName) }) })) : []),
      game.user.isGM && { action: "hide", icon: page.ownership.default === 0 ? "fa-eye" : "fa-eye-slash", label: t(page.ownership.default === 0 ? "Journal.Reveal" : "Journal.Hide") },
      editable && { separator: true },
      editable && { action: "category", icon: "fa-tag", label: t("Category.Set") },
      editable && page.system.folder && { action: "unfile", icon: "fa-arrow-turn-up", label: t("Folder.ToRoot") },
      ...(editable ? this.#otherJournals().map(j => ({ action: "move", data: { journal: j.id }, icon: "fa-book-bookmark", label: t("Journal.MoveTo", { name: esc(j.name) }) })) : []),
      editable && { action: "delete", icon: "fa-trash", label: t("Journal.Delete"), danger: true }
    ]), (action, button) => {
      switch ( action ) {
        case "read": return this.#select(pageId);
        case "place": return placeOnBoard(page);
        case "jump": return focusCard(game.scenes.get(button.dataset.scene), button.dataset.card);
        case "image": return this.#openImage(page);
        case "show": return this.#showPlayers(page);
        case "jumpAll": return focusCardForEveryone(game.scenes.get(button.dataset.scene), button.dataset.card);
        case "category": return openCategoryPicker(this.organizer, pageId, x, y);
        case "unfile": return moveCardsToFolder(this.organizer, [pageId], null);
        case "move": return this.#move(page, game.journal.get(button.dataset.journal));
        case "hide": return setPageHidden(page, page.ownership.default !== 0);
        case "delete": return this.#confirmDelete(page);
      }
    });
  }

  /** The other journals this user can add to (where a page can move). */
  #otherJournals() {
    return evidenceJournals().filter(j => (j !== this.document) && canEditJournal(j));
  }

  /** Move a page to another journal; the reading spread goes back to the contents. */
  async #move(page, target) {
    if ( !target ) return;
    if ( this.#selected === page.id ) this.#selected = null;
    const moved = await movePage(page, target);
    if ( moved ) ui.notifications.info(t("Journal.Moved", { name: page.name, journal: target.name }));
  }

  /** Show another journal in place of this one, in the same spot. */
  #switchTo(entry) {
    if ( !entry || (entry === this.document) ) return;
    const { left, top, width, height } = this.position;
    entry.sheet.render({ force: true, position: { left, top, width, height } });
    this.close();
  }

  /** Delete a page; if it's pinned somewhere, ask whether its cards go too. */
  async #confirmDelete(page) {
    const placed = (boardPlacements().get(page.uuid) ?? []).length;
    const esc = foundry.utils.escapeHTML;
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: t("Journal.Delete") },
      content: `<p>${t(placed ? "Journal.DeletePlaced" : "Journal.DeleteConfirm", { name: esc(page.name), count: placed })}</p>`,
      buttons: [
        placed && { action: "boards", label: t("Journal.DeleteEverywhere"), icon: "fa-solid fa-trash" },
        { action: "page", label: t(placed ? "Journal.DeleteKeepCards" : "Journal.Delete"), icon: "fa-solid fa-book", default: !placed },
        { action: "cancel", label: t("Add.Cancel"), icon: "fa-solid fa-xmark" }
      ].filter(Boolean),
      rejectClose: false
    });
    if ( (choice !== "boards") && (choice !== "page") ) return;
    if ( this.#selected === page.id ) this.#selected = null;
    await deleteEvidence(page, { fromBoards: choice === "boards" });
  }

  /**
   * GM: open this evidence for the players, with Foundry's own "Show Players" dialog (everyone or
   * chosen players, optionally even while it's hidden from them). It opens in their Evidence Journal.
   */
  #showPlayers(page) {
    if ( page && game.user.isGM ) foundry.documents.collections.Journal.showDialog(page, { parent: this });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onOpen(event, target) {
    const id = target.closest("[data-card-id]")?.dataset.cardId;
    if ( id ) this.#select(id);
  }

  static #onContents() {
    this.#select(null);
  }

  static #onPrev() { this.#turn(-1); }

  static #onNext() { this.#turn(1); }

  static #onToggle(event, target) {
    event.stopPropagation();
    const key = target.closest("[data-section]")?.dataset.section;
    if ( !key ) return;
    if ( this.#collapsed.has(key) ) this.#collapsed.delete(key);
    else this.#collapsed.add(key);
    this.#savePrefs();
    for ( const icon of this.element.querySelectorAll(`[data-section="${CSS.escape(key)}"] .mb-folder-icon`) ) {
      icon.classList.toggle("fa-folder", this.#collapsed.has(key));
      icon.classList.toggle("fa-folder-open", !this.#collapsed.has(key));
    }
    this.#filter();
  }

  /** A chapter in the contents: scroll the contact sheet to it (opening it if it's collapsed). */
  static #onGoto(event, target) {
    const key = target.closest("[data-section]")?.dataset.section;
    if ( key === undefined ) return;
    const entry = this.element.querySelector(`.mb-toc-entry[data-section="${CSS.escape(key)}"]`);
    const section = this.element.querySelector(`.mb-section[data-section="${CSS.escape(key)}"]`);
    const ancestors = (entry?.dataset.ancestors ?? "").split(" ").filter(Boolean);
    if ( [key, ...ancestors].some(k => this.#collapsed.has(k)) ) {
      this.#collapsed.delete(key);
      ancestors.forEach(a => this.#collapsed.delete(a));
      this.#savePrefs();
      this.#filter();
    }
    this.element.querySelectorAll(".mb-toc-entry.current").forEach(e => e.classList.remove("current"));
    entry?.classList.add("current");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  static #onMode(event, target) {
    const mode = target.dataset.mode;
    if ( !mode || (mode === this.#mode) ) return;
    this.#mode = mode;
    this.#scroll = { toc: 0, sheet: 0 };
    this.#savePrefs();
    this.render();
  }

  /** Sort and the placement filter, in one menu. */
  static #onFilter(event, target) {
    const r = target.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, menuItems([
      { heading: t("List.SortLabel") },
      ...SORTS.map(s => ({ action: "sort", data: { value: s }, icon: "fa-arrow-down-wide-short", active: s === this.#sort, label: t(s === "board" ? "Journal.SortOrder" : `List.Sort.${s}`) })),
      { heading: t("Journal.PlacementLabel") },
      ...PLACEMENTS.map(p => ({ action: "placement", data: { value: p }, icon: "fa-thumbtack", active: p === this.#placement, label: t(`Journal.Placement.${p}`) }))
    ]), (action, button) => {
      if ( action === "sort" ) this.#sort = button.dataset.value;
      else if ( action === "placement" ) this.#placement = button.dataset.value;
      this.#savePrefs();
      this.render();
    });
  }

  /** Add an image, a text document or a PDF. */
  static #onAddMenu(event, target) {
    const r = target.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, menuItems([
      { action: "image", icon: "fa-image", label: t("Journal.Add") },
      { action: "document", icon: "fa-file-lines", label: t("Journal.AddDocument") },
      { action: "pdf", icon: "fa-file-pdf", label: t("Journal.AddPdf") }
    ]), async action => {
      let page;
      if ( action === "document" ) {
        page = await createEvidencePage({ kind: "document", title: t("Document.Untitled") }, { hidden: game.user.isGM, entry: this.document });
      } else {
        page = await openAddEvidence({ target: "journal", entry: this.document, kind: action === "pdf" ? "pdf" : undefined, categories: categoriesOf(this.organizer) });
      }
      if ( page?.id ) this.#select(page.id);
    });
  }

  static #onItemMenu(event, target) {
    const r = target.getBoundingClientRect();
    if ( this.#selected ) this.#itemMenu(this.#selected, r.left, r.bottom + 4);
  }

  static #onNewFolder() {
    createFolder(this.organizer, null);
  }

  static #onManageCategories() {
    openCategoryManager(this.organizer);
  }

  static #onGroupMenu(event, target) {
    event.stopPropagation();
    const id = target.closest("[data-group-id]")?.dataset.groupId;
    const r = target.getBoundingClientRect();
    if ( id ) openFolderMenu(this.organizer, id, r.left, r.bottom);
  }

  static #onClearSearch() {
    this.#query = "";
    const input = this.element.querySelector("input[name=search]");
    if ( input ) {
      input.value = "";
      input.focus();
    }
    this.#filter();
  }

  static #onPickCategory(event, target) {
    const r = target.getBoundingClientRect();
    if ( this.#selected ) openCategoryPicker(this.organizer, this.#selected, r.left, r.bottom + 4);
  }

  #goDocPage(step) {
    const page = this.document.pages.get(this.#selected);
    const count = this.#docPages(page).length;
    const next = Math.clamp(this.#docPage + step, 0, count - 1);
    if ( next === this.#docPage ) return;
    this.#docPage = next;
    this.render();
  }

  static #onPrevDocPage() { this.#goDocPage(-1); }

  static #onNextDocPage() { this.#goDocPage(1); }

  /** A blank page after the one shown, which is then shown. */
  static async #onAddDocPage() {
    const page = this.document.pages.get(this.#selected);
    if ( !page || !canEditPage(page) ) return;
    const pages = this.#docPages(page);
    pages.splice(this.#docPage + 1, 0, "");
    this.#docPage += 1;
    await page.update({ "system.pages": pages });
  }

  /** Remove the page shown (asking first if it has text). A document keeps at least one page. */
  static async #onRemoveDocPage() {
    const page = this.document.pages.get(this.#selected);
    if ( !page || !canEditPage(page) ) return;
    const pages = this.#docPages(page);
    if ( pages.length < 2 ) return;
    const index = this.#docPage;
    if ( plainText(pages[index]).trim() ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("Document.RemovePage") },
        content: `<p>${t("Document.RemoveConfirm", { n: index + 1 })}</p>`
      });
      if ( !ok ) return;
    }
    pages.splice(index, 1);
    this.#docPage = Math.min(index, pages.length - 1);
    await page.update({ "system.pages": pages });
  }

  /** Open a board: the only one straight away, or pick from a menu when there are several. */
  static #onOpenBoard(event, target) {
    const boards = this.#boards();
    if ( !boards.length ) return;
    if ( boards.length === 1 ) return boards[0].view();
    const r = target.getBoundingClientRect();
    showMenu(r.left, r.bottom + 2, menuItems(boards.map(s => ({
      action: "board", data: { scene: s.id }, icon: "fa-chalkboard", active: s === canvas.scene,
      label: foundry.utils.escapeHTML(s.name)
    }))), (action, button) => game.scenes.get(button.dataset.scene)?.view());
  }

  static #onPlace() {
    const page = this.document.pages.get(this.#selected);
    if ( page ) placeOnBoard(page);
  }

  static #onJump(event, target) {
    const scene = game.scenes.get(target.dataset.sceneId);
    if ( scene ) focusCard(scene, target.dataset.cardId);
  }

  static #onToggleHidden() {
    const page = this.document.pages.get(this.#selected);
    if ( page ) setPageHidden(page, page.ownership.default !== 0);
  }

  static #onOpenImage() {
    this.#openImage(this.document.pages.get(this.#selected));
  }

  static #onZoomIn() { this.#stage.zoomIn(); }

  static #onZoomOut() { this.#stage.zoomOut(); }

  static #onFit() { this.#stage.fit(); }

  static #onActual() { this.#stage.actual(); }

  static #onOpenLink(event, target) {
    if ( target.dataset.uuid ) openLinked(target.dataset.uuid);
  }

  /** The journal button: the other journals, making this one the default, a new journal. */
  static #onJournals(event, target) {
    const r = target.getBoundingClientRect();
    const esc = foundry.utils.escapeHTML;
    const isDefault = isDefaultJournal(this.document);
    const journals = evidenceJournals();
    showMenu(r.left, r.bottom + 4, menuItems([
      { heading: t("Journal.Journals") },
      ...journals.map(j => ({
        action: "switch", data: { journal: j.id }, active: j === this.document,
        icon: isDefaultJournal(j) ? "fa-star" : (j.ownership.default > 0 ? "fa-book" : "fa-user-lock"),
        label: esc(j.name)
      })),
      { separator: true },
      !isDefault && canEditJournal(this.document) && { action: "default", icon: "fa-star", label: t("Journal.MakeDefault") },
      { action: "new", icon: "fa-book-medical", label: t("Journal.New") }
    ]), (action, button) => {
      if ( action === "switch" ) return this.#switchTo(game.journal.get(button.dataset.journal));
      if ( action === "default" ) return setDefaultJournal(this.document);
      if ( action === "new" ) return promptNewJournal();
    });
  }

  static #onMakeDefault() {
    setDefaultJournal(this.document);
  }
}
