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
import {
  boardPlacements, canEditJournal, canEditPage, canSeePage, createEvidencePage, deleteEvidence, journalItems,
  journalOrganizer, placeOnBoard, setPageHidden
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

/**
 * The Evidence Journal (POC): the world's evidence as a case file, browsable from any scene.
 *
 * Left: every feature of the board's evidence list (Folders / Categories / All, sorting, search,
 * collapsing, drag-to-file, folder menus, the category manager), plus a placement filter. Right:
 * the selected evidence: its picture (zoomable) or its text document (A4 pages, written in place),
 * title, category, notes, Hidden/Revealed (GM), and the boards it's pinned on, each a jump to the
 * card. Rows can be dragged onto a board to pin them there. Double-clicking evidence on a board
 * opens it here.
 *
 * Shown for the JournalEntry flagged as the evidence journal (pinned via flags.core.sheetClass).
 */
export default class EvidenceJournalSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {
  constructor(options) {
    super(options);
    const p = prefs.get(this.document.id);
    this.#mode = MODES.includes(p.mode) ? p.mode : "folders";
    this.#sort = SORTS.includes(p.sort) ? p.sort : "board";
    this.#placement = PLACEMENTS.includes(p.placement) ? p.placement : "all";
    this.#collapsed = new Set(Array.isArray(p.collapsed) ? p.collapsed : []);
    this.#stageHeight = Number.isFinite(p.stageHeight) ? p.stageHeight : null;
  }

  static DEFAULT_OPTIONS = {
    classes: ["dimancer-board-list", "dimancer-board-journal"],
    tag: "div",
    window: { icon: "fa-solid fa-magnifying-glass", resizable: true },
    position: { width: 780, height: 620 },
    actions: {
      select: EvidenceJournalSheet.#onSelect,
      toggle: EvidenceJournalSheet.#onToggle,
      mode: EvidenceJournalSheet.#onMode,
      newFolder: EvidenceJournalSheet.#onNewFolder,
      manageCategories: EvidenceJournalSheet.#onManageCategories,
      groupMenu: EvidenceJournalSheet.#onGroupMenu,
      clearSearch: EvidenceJournalSheet.#onClearSearch,
      addEvidence: EvidenceJournalSheet.#onAddEvidence,
      addDocument: EvidenceJournalSheet.#onAddDocument,
      prevDocPage: EvidenceJournalSheet.#onPrevDocPage,
      nextDocPage: EvidenceJournalSheet.#onNextDocPage,
      addDocPage: EvidenceJournalSheet.#onAddDocPage,
      removeDocPage: EvidenceJournalSheet.#onRemoveDocPage,
      showPlayers: EvidenceJournalSheet.#onShowPlayers,
      jumpEveryone: EvidenceJournalSheet.#onJumpEveryone,
      openBoard: EvidenceJournalSheet.#onOpenBoard,
      addPdf: EvidenceJournalSheet.#onAddPdf,
      place: EvidenceJournalSheet.#onPlace,
      jump: EvidenceJournalSheet.#onJump,
      toggleHidden: EvidenceJournalSheet.#onToggleHidden,
      deleteEvidence: EvidenceJournalSheet.#onDelete,
      openImage: EvidenceJournalSheet.#onOpenImage,
      zoomIn: EvidenceJournalSheet.#onZoomIn,
      zoomOut: EvidenceJournalSheet.#onZoomOut,
      fit: EvidenceJournalSheet.#onFit,
      actual: EvidenceJournalSheet.#onActual,
      openLink: EvidenceJournalSheet.#onOpenLink
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.evidenceJournal }
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
  #selected = null;
  /** Which page of the selected text document is shown (0-based). */
  #docPage = 0;
  #pending = false;
  #scrollTop = 0;
  #searchFocus = null;
  /** The picture's height, as the user last dragged it (null: the stylesheet's default). */
  #stageHeight;
  /** The zoomable picture; it outlives re-renders, so zoom and pan survive live updates. */
  #stage = new ImageStage({
    onResize: height => {
      this.#stageHeight = Math.round(height);
      this.#savePrefs();
    }
  });

  /** Watches the document paper's height (dragged like the picture's, and stored with it). */
  #paperObserver = null;
  #paperTimer = null;

  #watchPaper(paper) {
    this.#paperObserver?.disconnect();
    this.#paperObserver = null;
    if ( !paper ) return;
    let height = paper.offsetHeight;
    this.#paperObserver = new ResizeObserver(() => {
      const h = paper.offsetHeight;
      if ( !h || (h === height) ) return;
      height = h;
      clearTimeout(this.#paperTimer);
      this.#paperTimer = setTimeout(() => {
        this.#stageHeight = h;
        this.#savePrefs();
      }, 300);
    });
    this.#paperObserver.observe(paper);
  }

  #savePrefs() {
    prefs.set(this.document.id, {
      mode: this.#mode, sort: this.#sort, placement: this.#placement, collapsed: [...this.#collapsed],
      stageHeight: this.#stageHeight
    });
  }

  /** Is the user typing in the sheet (a re-render would throw their edit away)? */
  #isBusy() {
    const el = this.element;
    if ( !el ) return false;
    if ( el.querySelector("prose-mirror[open]") ) return true;
    const active = document.activeElement;
    // The search box doesn't count (it keeps its text and focus across a re-render), nor do selects
    // (they save the moment they change).
    return !!active && el.contains(active) && active.matches("input[type=text], textarea");
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

  /** @override */
  async _prepareContext(options) {
    const entry = this.document;
    const gm = game.user.isGM;
    const editable = canEditJournal(entry);
    const index = boardPlacements();
    let items = journalItems(entry, index).filter(i => gm || canSeePage(entry.pages.get(i.id)));
    if ( this.#placement === "placed" ) items = items.filter(i => i.placements.length);
    else if ( this.#placement === "unplaced" ) items = items.filter(i => !i.placements.length);
    const cats = categoriesOf(this.organizer);
    const catById = new Map(cats.map(c => [c.id, c]));

    const rows = listRows({
      items, folders: boardFolders(entry), categories: boardCategoriesRaw(entry),
      mode: this.#mode, sort: this.#sort, includeHidden: true
    }).map(r => {
      const collapsedAbove = r.ancestors.some(a => this.#collapsed.has(a));
      if ( r.type === "group" ) {
        const g = r.group;
        return {
          ...r, isGroup: true, collapsed: this.#collapsed.has(r.id), collapsedAbove,
          name: g.name ?? t("Category.Uncategorized"), color: g.color,
          icon: r.kind === "category" ? g.icon : (this.#collapsed.has(r.id) ? "fa-folder" : "fa-folder-open"),
          menu: editable && (r.kind === "folder"),
          draggable: editable && (r.kind === "folder")
        };
      }
      const c = r.card;
      const cat = catById.get(c.category);
      return {
        ...r, isGroup: false, collapsedAbove,
        src: c.src,
        isDocument: (c.kind === "document") && !c.src,
        isPdf: isPdfDocument(c),
        title: c.title || t(c.kind === "document" ? "Document.Untitled" : "Card.Untitled"),
        untitled: !c.title,
        hidden: c.hidden,
        placed: c.placements.length,
        catColor: (this.#mode !== "categories") ? cat?.color : null,
        catName: cat?.name ?? "",
        current: c.id === this.#selected,
        search: `${c.title} ${plainText(c.notes)} ${plainText(c.docPages.join(" "))} ${cat?.name ?? ""}`.toLowerCase()
      };
    });

    const visibleIds = new Set(items.map(i => i.id));
    const selectedPage = entry.pages.get(this.#selected);
    const selected = (selectedPage && (gm || canSeePage(selectedPage)))
      ? await this.#detailContext(selectedPage, journalItems(entry, index).find(i => i.id === selectedPage.id), catById, cats)
      : null;

    return {
      rows, editable, gm, selected,
      boards: this.#boards().map(s => ({ id: s.id, name: s.name, current: s === canvas.scene })),
      stageHeight: this.#stageHeight,
      count: rows.filter(r => !r.isGroup).length,
      filteredOut: !!selected && !visibleIds.has(selected.id),
      query: this.#query,
      modes: MODES.map(m => ({ id: m, label: t(`List.Mode.${m}`), active: m === this.#mode })),
      sorts: SORTS.map(s => ({ id: s, label: t(s === "board" ? "Journal.SortOrder" : `List.Sort.${s}`), selected: s === this.#sort })),
      placements: PLACEMENTS.map(p => ({ id: p, label: t(`Journal.Placement.${p}`), selected: p === this.#placement })),
      isFolders: this.#mode === "folders",
      isCategories: this.#mode === "categories"
    };
  }

  /** The right-hand pane for one page. */
  async #detailContext(page, item, catById, cats) {
    const editable = canEditPage(page);
    const board = canvas.scene;
    const onCurrent = item.placements.find(p => p.sceneId === board?.id);
    const link = item.link ? fromUuidSync(item.link, { strict: false }) : null;
    const TE = foundry.applications.ux.TextEditor.implementation;
    // A PDF shows its first page like a picture (zoomable; ⧉ reads the whole file).
    const isPdf = isPdfDocument(item);
    const pdf = isPdf ? await pdfPreview(item.src) : null;
    const isDocument = (item.kind === "document") && !isPdf;
    const docPages = isDocument ? (item.docPages.length ? item.docPages : [""]) : [];
    if ( isDocument ) this.#docPage = Math.clamp(this.#docPage, 0, docPages.length - 1);
    // Pages aren't cleaned by the server (it only cleans single HTML fields), so clean them here,
    // both for showing and for the editor's starting value.
    const docPageRaw = isDocument ? foundry.utils.cleanHTML(docPages[this.#docPage] ?? "") : "";
    return {
      isDocument,
      isPdf,
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
      src: item.src,
      notes: item.notes,
      notesHTML: await TE.enrichHTML(item.notes, { secrets: editable, relativeTo: page }),
      hasNotes: !!item.notes.trim(),
      editable,
      hidden: item.hidden,
      category: catById.get(item.category) ?? null,
      categories: cats.map(c => ({ id: c.id, name: c.name, selected: c.id === item.category })),
      placements: item.placements.map(p => ({ ...p, current: p.sceneId === board?.id })),
      // Where "take everyone there" goes: this board if it's here, else the first board it's on.
      gmJump: onCurrent ?? item.placements[0] ?? null,
      canPlace: isBoard(board) && canEditBoard(board) && !onCurrent,
      onCurrent: !!onCurrent,
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
    // Deferred live updates land once the user leaves the field they were typing in. (The root
    // element outlives re-renders, so this is wired once.)
    this.element.addEventListener("focusout", () => setTimeout(() => {
      if ( this.#pending && !this.#isBusy() ) this.render();
    }, 0));
  }

  /** @override */
  _preRender(context, options) {
    this.#scrollTop = this.element?.querySelector(".mb-list-rows")?.scrollTop ?? 0;
    const search = this.element?.querySelector("input[name=search]");
    this.#searchFocus = (search && (document.activeElement === search)) ? [search.selectionStart, search.selectionEnd] : null;
    return super._preRender(context, options);
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const rowsEl = el.querySelector(".mb-list-rows");
    if ( rowsEl ) rowsEl.scrollTop = this.#scrollTop;
    if ( this.#searchFocus ) {
      const search = el.querySelector("input[name=search]");
      search?.focus();
      search?.setSelectionRange(...this.#searchFocus);
    }

    el.querySelector("input[name=search]")?.addEventListener("input", ev => {
      this.#query = ev.target.value;
      this.#filter();
    });
    el.querySelector("select[name=sort]")?.addEventListener("change", ev => {
      this.#sort = ev.target.value;
      this.#savePrefs();
      ev.target.blur();
      this.render();
    });
    el.querySelector("select[name=placement]")?.addEventListener("change", ev => {
      this.#placement = ev.target.value;
      this.#savePrefs();
      ev.target.blur();
      this.render();
    });

    for ( const row of el.querySelectorAll(".mb-list-row[data-card-id]") ) {
      row.addEventListener("dblclick", () => this.#openOrJump(row.dataset.cardId));
      row.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        this.#itemMenu(row.dataset.cardId, ev.clientX, ev.clientY);
      });
    }
    for ( const row of el.querySelectorAll(".mb-list-group[data-kind=folder]") ) {
      row.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        openFolderMenu(this.organizer, row.dataset.groupId, ev.clientX, ev.clientY);
      });
    }
    this.#activateDragDrop(el, context.editable);
    this.#activateDetail(el);
    this.#stage.attach(el.querySelector(".mb-journal-detail [data-stage]"), `${this.#selected}|${context.selected?.src ?? ""}`);
    this.#watchPaper(el.querySelector(".mb-journal-detail [data-doc-paper]"));
    this.#filter();
  }

  /** @override */
  _preClose(options) {
    this.#stage.detach();
    this.#watchPaper(null);
    return super._preClose(options);
  }

  /** The detail pane's fields save as they change. */
  #activateDetail(el) {
    const page = this.document.pages.get(this.#selected);
    if ( !page ) return;
    el.querySelector(".mb-journal-detail input[name=title]")?.addEventListener("change", ev => {
      const name = ev.target.value.trim();
      if ( name && (name !== page.name) ) page.update({ name });
    });
    el.querySelector(".mb-journal-detail select[name=category]")?.addEventListener("change", ev => {
      setCardCategory(this.organizer, [page.id], ev.target.value || null);
    });
    el.querySelector(".mb-journal-detail prose-mirror[name=notes]")?.addEventListener("change", ev => {
      page.update({ "system.notes": ev.target.value ?? "" });
    });
    // A text document's page: the whole list of pages is written back with this one replaced.
    el.querySelector(".mb-journal-detail prose-mirror[name=docPage]")?.addEventListener("change", ev => {
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

  /* -------------------------------------------- */
  /*  Search and collapsing                       */
  /* -------------------------------------------- */

  #filter() {
    const el = this.element;
    const q = this.#query.trim().toLowerCase();
    const words = q ? q.split(/\s+/) : [];
    const rows = [...el.querySelectorAll(".mb-list-rows > li")];
    const shownGroups = new Set();
    let matches = 0;
    for ( const row of rows ) {
      if ( row.dataset.cardId === undefined ) continue;
      const match = words.every(w => row.dataset.search.includes(w));
      const ancestors = row.dataset.ancestors ? row.dataset.ancestors.split(" ").filter(Boolean) : [];
      row.hidden = !match || (!q && ancestors.some(a => this.#collapsed.has(a)));
      if ( match ) {
        matches++;
        ancestors.forEach(a => shownGroups.add(a));
      }
    }
    for ( const row of rows ) {
      if ( row.dataset.groupKey === undefined ) continue;
      const ancestors = row.dataset.ancestors ? row.dataset.ancestors.split(" ").filter(Boolean) : [];
      if ( q ) row.hidden = !shownGroups.has(row.dataset.groupKey);
      else row.hidden = ancestors.some(a => this.#collapsed.has(a));
      row.classList.toggle("collapsed", !q && this.#collapsed.has(row.dataset.groupKey));
    }
    const nomatch = el.querySelector(".mb-list-nomatch");
    if ( nomatch ) nomatch.hidden = !q || (matches > 0);
    const clear = el.querySelector("[data-action=clearSearch]");
    if ( clear ) clear.hidden = !q;
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /**
   * Rows drag in two ways at once: onto a folder or category here (filing), and onto a board
   * canvas (Foundry's own JournalEntryPage drop data, which pins the page there).
   */
  #activateDragDrop(el, editable) {
    const list = el.querySelector(".mb-list-rows");
    if ( !list ) return;
    list.addEventListener("dragstart", ev => {
      const row = ev.target.closest("[draggable=true]");
      if ( !row ) return;
      if ( row.dataset.cardId ) {
        const page = this.document.pages.get(row.dataset.cardId);
        ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: "card", id: row.dataset.cardId }));
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "JournalEntryPage", uuid: page.uuid }));
        ev.dataTransfer.effectAllowed = "copyMove";
      } else {
        ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: "folder", id: row.dataset.groupId }));
        ev.dataTransfer.effectAllowed = "move";
      }
      row.classList.add("dragging");
    });
    list.addEventListener("dragend", ev => ev.target.closest?.(".dragging")?.classList.remove("dragging"));
    if ( !editable ) return;

    const targetOf = ev => {
      const row = ev.target.closest("li");
      if ( row?.dataset.groupKey !== undefined ) return { el: row, kind: row.dataset.kind, id: row.dataset.groupId };
      if ( row?.dataset.cardId !== undefined ) {
        const parent = (row.dataset.ancestors || "").split(" ").filter(Boolean).at(-1);
        const groupRow = parent ? list.querySelector(`li[data-group-key="${parent}"]`) : null;
        if ( groupRow ) return { el: groupRow, kind: groupRow.dataset.kind, id: groupRow.dataset.groupId };
      }
      return { el: list, kind: this.#mode === "folders" ? "folder" : (this.#mode === "categories" ? "category" : null), id: "" };
    };
    const clearHighlight = () => el.querySelectorAll(".drop-target").forEach(e => e.classList.remove("drop-target"));
    list.addEventListener("dragover", ev => {
      if ( !ev.dataTransfer.types.includes(DRAG_TYPE) ) return;
      const target = targetOf(ev);
      if ( !target.kind ) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      clearHighlight();
      target.el.classList.add("drop-target");
    });
    list.addEventListener("dragleave", ev => {
      if ( !list.contains(ev.relatedTarget) ) clearHighlight();
    });
    list.addEventListener("drop", async ev => {
      clearHighlight();
      let payload;
      try {
        payload = JSON.parse(ev.dataTransfer.getData(DRAG_TYPE));
      } catch(err) {
        return;
      }
      const target = targetOf(ev);
      if ( !target.kind ) return;
      ev.preventDefault();
      const org = this.organizer;
      if ( payload.type === "folder" ) {
        if ( target.kind === "folder" ) await moveFolder(org, payload.id, target.id || null);
        return;
      }
      if ( target.kind === "folder" ) await moveCardsToFolder(org, [payload.id], target.id || null);
      else if ( target.kind === "category" ) await setCardCategory(org, [payload.id], target.id || null);
    });
  }

  /* -------------------------------------------- */
  /*  Menus and actions                           */
  /* -------------------------------------------- */

  /** The boards this user can open (every board for a GM), in navigation order. */
  #boards() {
    return game.scenes.filter(s => isBoard(s) && (game.user.isGM || s.visible))
      .sort((a, b) => (a.navOrder - b.navOrder) || a.name.localeCompare(b.name));
  }

  #select(pageId) {
    if ( pageId !== this.#selected ) this.#docPage = 0;
    this.#selected = pageId;
    this.render();
  }

  /** Double-click: go to where it's pinned (this board first), or look at the image. */
  #openOrJump(pageId) {
    const page = this.document.pages.get(pageId);
    if ( !page ) return;
    const placements = boardPlacements().get(page.uuid) ?? [];
    const here = placements.find(p => p.sceneId === canvas.scene?.id) ?? placements[0];
    if ( here ) return focusCard(game.scenes.get(here.sceneId), here.cardId);
    if ( page.src ) return this.#openImage(page);
    this.#select(pageId);
  }

  #openImage(page) {
    if ( !page?.src ) return;
    if ( isPdfDocument({ kind: page.system.kind, src: page.src }) ) {
      return PdfViewer.open({ src: page.src, title: page.name, key: page.id });
    }
    new foundry.applications.apps.ImagePopout({ src: page.src, uuid: page.uuid, window: { title: page.name } }).render({ force: true });
  }

  #itemMenu(pageId, x, y) {
    const page = this.document.pages.get(pageId);
    if ( !page ) return;
    this.#selected = pageId;
    const editable = canEditPage(page);
    const placements = boardPlacements().get(page.uuid) ?? [];
    const board = canvas.scene;
    const canPlace = isBoard(board) && canEditBoard(board) && !placements.some(p => p.sceneId === board.id);
    showMenu(x, y, menuItems([
      canPlace && { action: "place", icon: "fa-thumbtack", label: t("Journal.PlaceHere") },
      ...placements.map(p => ({ action: "jump", data: { scene: p.sceneId, card: p.cardId }, icon: "fa-location-crosshairs", label: t("Journal.JumpTo", { name: foundry.utils.escapeHTML(p.sceneName) }) })),
      page.src && ((page.system.kind === "document")
        ? { action: "image", icon: "fa-file-pdf", label: t("Journal.ReadPdf") }
        : { action: "image", icon: "fa-image", label: t("Journal.ViewImage") }),
      game.user.isGM && { action: "show", icon: "fa-users-viewfinder", label: t("Journal.ShowPlayers") },
      ...(game.user.isGM ? placements.map(p => ({ action: "jumpAll", data: { scene: p.sceneId, card: p.cardId }, icon: "fa-people-arrows", label: t("Journal.JumpEveryone", { name: foundry.utils.escapeHTML(p.sceneName) }) })) : []),
      editable && { action: "category", icon: "fa-tag", label: t("Category.Set") },
      editable && page.system.folder && { action: "unfile", icon: "fa-arrow-turn-up", label: t("Folder.ToRoot") },
      game.user.isGM && { action: "hide", icon: page.ownership.default === 0 ? "fa-eye" : "fa-eye-slash", label: t(page.ownership.default === 0 ? "Journal.Reveal" : "Journal.Hide") },
      editable && { action: "delete", icon: "fa-trash", label: t("Journal.Delete"), danger: true }
    ]), (action, button) => {
      switch ( action ) {
        case "place": return placeOnBoard(page);
        case "jump": return focusCard(game.scenes.get(button.dataset.scene), button.dataset.card);
        case "image": return this.#openImage(page);
        case "show": return this.#showPlayers(page);
        case "jumpAll": return focusCardForEveryone(game.scenes.get(button.dataset.scene), button.dataset.card);
        case "category": return openCategoryPicker(this.organizer, pageId, x, y);
        case "unfile": return moveCardsToFolder(this.organizer, [pageId], null);
        case "hide": return setPageHidden(page, page.ownership.default !== 0);
        case "delete": return this.#confirmDelete(page);
      }
    });
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

  static #onSelect(event, target) {
    const id = target.closest("[data-card-id]")?.dataset.cardId;
    if ( id && (id !== this.#selected) ) this.#select(id);
  }

  static #onToggle(event, target) {
    if ( event.target.closest("[data-action=groupMenu]") ) return;
    const key = target.closest("[data-group-key]")?.dataset.groupKey;
    if ( !key ) return;
    if ( this.#collapsed.has(key) ) this.#collapsed.delete(key);
    else this.#collapsed.add(key);
    this.#savePrefs();
    const icon = target.closest("li").querySelector(".mb-group-icon.is-folder");
    if ( icon ) icon.className = `mb-group-icon is-folder fa-solid ${this.#collapsed.has(key) ? "fa-folder" : "fa-folder-open"} fa-fw`;
    this.#filter();
  }

  static #onMode(event, target) {
    const mode = target.dataset.mode;
    if ( !mode || (mode === this.#mode) ) return;
    this.#mode = mode;
    this.#savePrefs();
    this.render();
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

  static async #onAddEvidence() {
    const page = await openAddEvidence({ target: "journal", categories: categoriesOf(this.organizer) });
    if ( page?.id ) this.#select(page.id);
  }

  static async #onAddDocument() {
    const page = await createEvidencePage({ kind: "document", title: t("Document.Untitled") }, { hidden: game.user.isGM });
    if ( page?.id ) this.#select(page.id);
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

  /**
   * GM: open this evidence for the players, with Foundry's own "Show Players" dialog (everyone or
   * chosen players, optionally even while it's hidden from them). It opens in their Evidence Journal.
   */
  #showPlayers(page) {
    if ( page && game.user.isGM ) foundry.documents.collections.Journal.showDialog(page, { parent: this });
  }

  static #onShowPlayers() {
    this.#showPlayers(this.document.pages.get(this.#selected));
  }

  /** GM: take everyone to this evidence on a board it's pinned on. */
  static #onJumpEveryone(event, target) {
    const scene = game.scenes.get(target.dataset.sceneId);
    if ( scene ) focusCardForEveryone(scene, target.dataset.cardId);
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

  static async #onAddPdf() {
    const page = await openAddEvidence({ target: "journal", kind: "pdf", categories: categoriesOf(this.organizer) });
    if ( page?.id ) this.#select(page.id);
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

  static #onDelete() {
    const page = this.document.pages.get(this.#selected);
    if ( page ) this.#confirmDelete(page);
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
}
