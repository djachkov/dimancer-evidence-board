import { MODULE_ID } from "./constants.mjs";
import { DIVIDER_RULE, SLASH_ITEMS, filterSlashItems, markRuleFor, slashQuery } from "./editor-rules.mjs";

/**
 * The Evidence Journal's text editor: Foundry's own ProseMirror engine (so content links, dropped
 * documents, secrets, pasted images and undo all keep working) with a writing-first interface in
 * place of Foundry's menubar and edit/save toggle:
 *
 * - always editable: click into the text and type; it saves itself a moment after you stop, and
 *   when you leave the field (Ctrl+S saves at once);
 * - a small toolbar floats over selected text (bold, italic, underline, strikethrough, headings,
 *   quote, lists, link, secret);
 * - "/" at the start of a line (or after a space) opens a menu of blocks to insert, filtered as you
 *   type, chosen with the arrow keys and Enter;
 * - Markdown-style shortcuts format as you type: **bold**, *italic*, ~~strike~~, `code`, and a
 *   line of --- becomes a divider (Foundry already turns "# ", "- ", "1. " and "> " into blocks).
 *
 * Any <prose-mirror data-mb-editor> gets it: the element asks for its plugins with a "plugins"
 * event as it starts, which this answers. `data-placeholder` is shown while it's empty.
 */

const MARKER = "data-mb-editor";
const SAVE_DELAY = 900;

const t = key => game.i18n.localize(`DIMANCER_BOARD.Editor.${key}`);

/** Answer every journal editor's request for plugins (once, at init). */
export function registerJournalEditor() {
  document.addEventListener("plugins", onPlugins, { capture: true });
}

function onPlugins(event) {
  const el = event.target;
  if ( !(el instanceof HTMLElement) || !el.hasAttribute(MARKER) ) return;
  const plugins = event.plugins;
  // Foundry merges these over its default plugins, so the menubar is replaced, not just left out.
  plugins.menu = new ProseMirror.Plugin({});
  // Foundry merges these over its defaults, keeping the defaults' order; "chatInput" is the slot it
  // reserves ahead of its keymaps, so the "/" menu sees Enter, Escape and the arrows first.
  plugins.chatInput = slashPlugin();
  plugins.mbRules = rulesPlugin();
  plugins.mbDivider = dividerCursorPlugin();
  plugins.mbToolbar = toolbarPlugin();
  plugins.mbAutosave = autosavePlugin(el);
  plugins.mbPlaceholder = placeholderPlugin(el.dataset.placeholder ?? "");
}

/* -------------------------------------------- */
/*  Commands                                    */
/* -------------------------------------------- */

const schema = () => ProseMirror.defaultSchema;

/** Does the selection (or the cursor's stored marks) carry this mark? */
function markActive(state, type) {
  const { from, $from, to, empty } = state.selection;
  if ( empty ) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** The depth of the nearest ancestor of the cursor of this node type, or -1. */
function ancestorDepth(state, type) {
  const { $from } = state.selection;
  for ( let d = $from.depth; d > 0; d-- ) if ( $from.node(d).type === type ) return d;
  return -1;
}

const headingActive = (state, level) => {
  const parent = state.selection.$from.parent;
  return (parent.type === schema().nodes.heading) && (parent.attrs.level === level);
};

/** Lift the cursor's block out of its nearest wrapper of this type, or wrap it in one. */
function toggleWrap(type, attrs) {
  return (state, dispatch) => {
    const { commands } = ProseMirror;
    if ( ancestorDepth(state, type) >= 0 ) return commands.lift(state, dispatch);
    return commands.wrapIn(type, typeof attrs === "function" ? attrs() : attrs)(state, dispatch);
  };
}

function toggleList(type) {
  return (state, dispatch) => {
    const { list } = ProseMirror;
    const s = schema();
    const depth = ancestorDepth(state, type);
    if ( depth >= 0 ) return list.liftListItem(s.nodes.list_item)(state, dispatch);
    // In the other kind of list: switch that list's type.
    const other = type === s.nodes.bullet_list ? s.nodes.ordered_list : s.nodes.bullet_list;
    const otherDepth = ancestorDepth(state, other);
    if ( otherDepth >= 0 ) {
      if ( dispatch ) dispatch(state.tr.setNodeMarkup(state.selection.$from.before(otherDepth), type));
      return true;
    }
    return list.wrapInList(type)(state, dispatch);
  };
}

function toggleHeading(level) {
  return (state, dispatch) => {
    const { commands } = ProseMirror;
    const s = schema();
    if ( headingActive(state, level) ) return commands.setBlockType(s.nodes.paragraph)(state, dispatch);
    return commands.setBlockType(s.nodes.heading, { level })(state, dispatch);
  };
}

/** A divider after the cursor's block, then a paragraph to keep writing in. */
function insertDivider(state, dispatch) {
  const s = schema();
  const { $from } = state.selection;
  const pos = $from.depth ? $from.after(1) : $from.pos;
  if ( dispatch ) {
    const tr = state.tr.insert(pos, [s.nodes.horizontal_rule.create(), s.nodes.paragraph.create()]);
    tr.setSelection(ProseMirror.TextSelection.near(tr.doc.resolve(pos + 2)));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

const secretAttrs = () => ({ id: `secret-${foundry.utils.randomID()}` });

/** Ask for a link's address; an empty one removes the link. */
async function editLink(view) {
  const s = schema();
  const type = s.marks.link;
  const { state } = view;
  let href = "";
  state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
    href ||= node.marks.find(m => m.type === type)?.attrs.href ?? "";
  });
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("Link") },
    content: `<input type="url" name="href" value="${foundry.utils.escapeHTML(href)}" placeholder="https://" autofocus>`,
    ok: { label: t("LinkApply"), callback: (event, button) => button.form.elements.href.value.trim() },
    rejectClose: false
  });
  view.focus();
  if ( value === null || value === undefined ) return;
  const { from, to } = view.state.selection;
  let tr = view.state.tr.removeMark(from, to, type);
  if ( value ) tr = tr.addMark(from, to, type.create({ href: value }));
  view.dispatch(tr);
}

/** Blocks the "/" menu inserts, by SLASH_ITEMS id. */
function blockCommand(id) {
  const s = schema();
  const { commands } = ProseMirror;
  switch ( id ) {
    case "paragraph": return commands.setBlockType(s.nodes.paragraph);
    case "heading1": return commands.setBlockType(s.nodes.heading, { level: 1 });
    case "heading2": return commands.setBlockType(s.nodes.heading, { level: 2 });
    case "heading3": return commands.setBlockType(s.nodes.heading, { level: 3 });
    case "bullet": return ProseMirror.list.wrapInList(s.nodes.bullet_list);
    case "ordered": return ProseMirror.list.wrapInList(s.nodes.ordered_list);
    case "quote": return commands.wrapIn(s.nodes.blockquote);
    case "secret": return (state, dispatch) => commands.wrapIn(s.nodes.secret, secretAttrs())(state, dispatch);
    case "divider": return insertDivider;
    case "code": return commands.setBlockType(s.nodes.code_block);
  }
  return () => false;
}

/* -------------------------------------------- */
/*  Floating toolbar                            */
/* -------------------------------------------- */

/** The toolbar's buttons: [id, icon, label key, run, isActive]. `null` is a separator. */
function toolbarButtons() {
  const s = schema();
  const { commands } = ProseMirror;
  const mark = type => [state => markActive(state, type), commands.toggleMark(type)];
  return [
    ["bold", "fa-bold", "Bold", ...mark(s.marks.strong)],
    ["italic", "fa-italic", "Italic", ...mark(s.marks.em)],
    ["underline", "fa-underline", "Underline", ...mark(s.marks.underline)],
    ["strike", "fa-strikethrough", "Strike", ...mark(s.marks.strikethrough)],
    null,
    ["h2", "fa-heading", "Heading", state => headingActive(state, 2), toggleHeading(2)],
    ["h3", "fa-h", "Subheading", state => headingActive(state, 3), toggleHeading(3)],
    ["quote", "fa-quote-left", "Quote", state => ancestorDepth(state, s.nodes.blockquote) >= 0, toggleWrap(s.nodes.blockquote)],
    ["bullet", "fa-list-ul", "Bullets", state => ancestorDepth(state, s.nodes.bullet_list) >= 0, toggleList(s.nodes.bullet_list)],
    ["ordered", "fa-list-ol", "Numbered", state => ancestorDepth(state, s.nodes.ordered_list) >= 0, toggleList(s.nodes.ordered_list)],
    null,
    ["link", "fa-link", "Link", state => markActive(state, s.marks.link), "link"],
    ["secret", "fa-user-secret", "Secret", state => ancestorDepth(state, s.nodes.secret) >= 0, toggleWrap(s.nodes.secret, secretAttrs)]
  ];
}

class Toolbar {
  constructor(view) {
    this.view = view;
    this.buttons = toolbarButtons();
    const dom = this.dom = document.createElement("div");
    dom.className = "mb-editor-toolbar";
    dom.setAttribute("role", "toolbar");
    dom.hidden = true;
    dom.innerHTML = this.buttons.map((b, i) => b
      ? `<button type="button" data-index="${i}" data-tooltip="${t(b[2])}" aria-label="${t(b[2])}"><i class="fa-solid ${b[1]}" inert></i></button>`
      : '<span class="mb-editor-sep"></span>').join("");
    // Keep the selection: pressing a button mustn't take focus from the text.
    dom.addEventListener("mousedown", ev => ev.preventDefault());
    dom.addEventListener("click", ev => {
      const button = ev.target.closest("button[data-index]");
      if ( !button ) return;
      const [, , , , run] = this.buttons[Number(button.dataset.index)];
      if ( run === "link" ) return editLink(this.view);
      run(this.view.state, this.view.dispatch);
      this.view.focus();
    });
    document.body.append(dom);
    this.onBlur = () => setTimeout(() => {
      if ( !this.view.hasFocus() ) this.hide();
    }, 0);
    this.onFocus = () => this.update(this.view);
    view.dom.addEventListener("blur", this.onBlur);
    view.dom.addEventListener("focus", this.onFocus);
  }

  hide() {
    this.dom.hidden = true;
  }

  update(view) {
    const { state } = view;
    const sel = state.selection;
    if ( !view.editable || !view.hasFocus() || sel.empty || !(sel instanceof ProseMirror.TextSelection) ) return this.hide();
    for ( const button of this.dom.querySelectorAll("button[data-index]") ) {
      const active = this.buttons[Number(button.dataset.index)][3](state);
      button.classList.toggle("active", !!active);
      button.setAttribute("aria-pressed", String(!!active));
    }
    this.dom.hidden = false;
    const start = view.coordsAtPos(sel.from);
    const end = view.coordsAtPos(sel.to);
    const r = this.dom.getBoundingClientRect();
    const mid = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
    const left = Math.max(6, Math.min(mid - (r.width / 2), window.innerWidth - r.width - 6));
    let top = Math.min(start.top, end.top) - r.height - 8;
    if ( top < 6 ) top = Math.max(start.bottom, end.bottom) + 8;
    this.dom.style.left = `${left}px`;
    this.dom.style.top = `${top}px`;
  }

  destroy() {
    this.view.dom.removeEventListener("blur", this.onBlur);
    this.view.dom.removeEventListener("focus", this.onFocus);
    this.dom.remove();
  }
}

function toolbarPlugin() {
  return new ProseMirror.Plugin({ view: view => new Toolbar(view) });
}

/* -------------------------------------------- */
/*  "/" menu                                    */
/* -------------------------------------------- */

const slashKey = new ProseMirror.PluginKey("mbSlash");
const slashLabel = item => t(`Block.${item.id}`);

/** The menu's state for an editor state: where the "/…" is, what it matches, which is chosen. */
function slashState(state, prev, meta) {
  const sel = state.selection;
  if ( !sel.empty || !sel.$from.parent.isTextblock || (sel.$from.parent.type === schema().nodes.code_block) ) return null;
  const $from = sel.$from;
  const query = slashQuery($from.parent.textBetween(0, $from.parentOffset, null, "￼"));
  if ( query === null ) return null;
  const from = $from.pos - query.length - 1;
  // Esc closes the menu until the slash is gone.
  if ( meta?.close || (prev?.closed && (prev.from === from)) ) return { from, to: $from.pos, query, closed: true, items: [], index: 0 };
  const items = filterSlashItems(SLASH_ITEMS, query, slashLabel);
  const sameQuery = prev && !prev.closed && (prev.from === from) && (prev.query === query);
  let index = meta?.index ?? (sameQuery ? prev.index : 0);
  index = items.length ? ((index % items.length) + items.length) % items.length : 0;
  return { from, to: $from.pos, query, closed: false, items, index };
}

function applySlash(view, item) {
  const s = slashKey.getState(view.state);
  if ( !s ) return;
  view.dispatch(view.state.tr.delete(s.from, s.to));
  blockCommand(item.id)(view.state, view.dispatch);
  view.focus();
}

class SlashMenu {
  constructor(view) {
    this.view = view;
    const dom = this.dom = document.createElement("div");
    dom.className = "mb-editor-slash";
    dom.setAttribute("role", "listbox");
    dom.hidden = true;
    dom.addEventListener("mousedown", ev => ev.preventDefault());
    dom.addEventListener("click", ev => {
      const button = ev.target.closest("button[data-index]");
      const s = slashKey.getState(this.view.state);
      if ( button && s ) applySlash(this.view, s.items[Number(button.dataset.index)]);
    });
    document.body.append(dom);
    this.onBlur = () => setTimeout(() => {
      if ( !this.view.hasFocus() ) this.dom.hidden = true;
    }, 0);
    view.dom.addEventListener("blur", this.onBlur);
  }

  update(view) {
    const s = slashKey.getState(view.state);
    if ( !s || s.closed || !s.items.length || !view.hasFocus() ) {
      this.dom.hidden = true;
      return;
    }
    const key = `${s.query}|${s.items.map(i => i.id).join()}`;
    if ( key !== this.key ) {
      this.key = key;
      this.dom.innerHTML = `<p class="mb-editor-slash-hint">${t("SlashHint")}</p>${s.items.map((item, i) => `
        <button type="button" role="option" data-index="${i}">
          <i class="fa-solid ${item.icon} fa-fw" inert></i><span>${slashLabel(item)}</span>
        </button>`).join("")}`;
    }
    this.dom.querySelectorAll("button[data-index]").forEach((b, i) => {
      b.classList.toggle("active", i === s.index);
      b.setAttribute("aria-selected", String(i === s.index));
      if ( i === s.index ) b.scrollIntoView({ block: "nearest" });
    });
    this.dom.hidden = false;
    const at = view.coordsAtPos(s.from);
    const r = this.dom.getBoundingClientRect();
    let top = at.bottom + 6;
    if ( top + r.height > window.innerHeight - 6 ) top = at.top - r.height - 6;
    this.dom.style.left = `${Math.max(6, Math.min(at.left, window.innerWidth - r.width - 6))}px`;
    this.dom.style.top = `${Math.max(6, top)}px`;
  }

  destroy() {
    this.view.dom.removeEventListener("blur", this.onBlur);
    this.dom.remove();
  }
}

function slashPlugin() {
  return new ProseMirror.Plugin({
    key: slashKey,
    state: {
      init: (config, state) => slashState(state, null, null),
      apply: (tr, prev, oldState, newState) => slashState(newState, prev, tr.getMeta(slashKey))
    },
    view: view => new SlashMenu(view),
    props: {
      handleKeyDown(view, event) {
        const s = slashKey.getState(view.state);
        if ( !s || s.closed || !s.items.length ) return false;
        const move = step => view.dispatch(view.state.tr.setMeta(slashKey, { index: s.index + step }));
        switch ( event.key ) {
          case "ArrowDown": move(1); return true;
          case "ArrowUp": move(-1); return true;
          case "Enter":
          case "Tab": applySlash(view, s.items[s.index]); return true;
          case "Escape":
            view.dispatch(view.state.tr.setMeta(slashKey, { close: true }));
            event.stopPropagation();
            return true;
        }
        return false;
      }
    }
  });
}

/* -------------------------------------------- */
/*  Markdown-style shortcuts                    */
/* -------------------------------------------- */

function rulesPlugin() {
  const { InputRule, inputRules } = ProseMirror.input;
  const s = schema();
  // One rule for every mark delimiter: it finds which (if any) the typed text completes.
  const marks = new InputRule(/(?:\*\*|\*|_|~~|`)$/, (state, match, start, end) => {
    const $end = state.doc.resolve(end);
    if ( $end.parent.type === s.nodes.code_block ) return null;
    // The block's text with the character just typed (the last of the match; it isn't in the doc yet).
    const before = $end.parent.textBetween(0, $end.parentOffset, null, "￼") + match[0].slice(-1);
    const found = markRuleFor(before);
    const type = found && s.marks[found.mark];
    if ( !type ) return null;
    const from = end - (found.match[0].length - 1);
    if ( from < $end.start() ) return null;
    const tr = state.tr.replaceWith(from, end, s.text(found.match[1], [...$end.marks(), type.create()]));
    return tr.removeStoredMark(type);
  });
  const divider = new InputRule(/^(?:--|\*\*|__)[-*_]$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    if ( ($start.depth !== 1) || ($start.parent.type !== s.nodes.paragraph) ) return null;
    if ( !DIVIDER_RULE.test($start.parent.textContent + match[0].slice(-1)) ) return null;
    const pos = $start.before();
    const tr = state.tr.replaceWith(pos, $start.after(), [s.nodes.horizontal_rule.create(), s.nodes.paragraph.create()]);
    return tr.setSelection(ProseMirror.TextSelection.near(tr.doc.resolve(pos + 2)));
  });
  return inputRules({ rules: [divider, marks] });
}

/**
 * Foundry's own "---" rule leaves the new divider selected, so the next key replaces it. After a
 * divider is typed, carry on writing in a paragraph below it instead.
 */
function dividerCursorPlugin() {
  return new ProseMirror.Plugin({
    appendTransaction(trs, oldState, state) {
      const sel = state.selection;
      if ( !trs.some(tr => tr.docChanged) || !(sel instanceof ProseMirror.state.NodeSelection) ) return null;
      const s = schema();
      if ( sel.node.type !== s.nodes.horizontal_rule ) return null;
      const after = sel.to;
      const tr = state.tr;
      const next = state.doc.resolve(after).nodeAfter;
      if ( !next?.isTextblock ) tr.insert(after, s.nodes.paragraph.create());
      return tr.setSelection(ProseMirror.TextSelection.near(tr.doc.resolve(after + 1)));
    }
  });
}

/* -------------------------------------------- */
/*  Saving and placeholder                      */
/* -------------------------------------------- */

/**
 * Save a moment after typing stops, and at once when the text loses focus. The element's
 * `data-save-state` ("pending", then "saved") lets the page show it.
 */
function autosavePlugin(el) {
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if ( el.dataset.saveState !== "pending" ) return;
    try {
      el.save();
    } catch(err) {
      console.error(`${MODULE_ID} | editor save`, err);
    }
    el.dataset.saveState = "saved";
  };
  return new ProseMirror.Plugin({
    view: () => ({
      update(view, prev) {
        if ( view.state.doc.eq(prev.doc) ) return;
        el.dataset.saveState = "pending";
        clearTimeout(timer);
        timer = setTimeout(flush, SAVE_DELAY);
      },
      destroy: flush
    }),
    props: {
      handleDOMEvents: {
        blur: () => {
          flush();
          return false;
        }
      }
    }
  });
}

/** Show the placeholder (CSS, from data-placeholder) while the document is one empty paragraph. */
function placeholderPlugin(text) {
  const sync = view => {
    const doc = view.state.doc;
    const empty = (doc.childCount === 1) && doc.firstChild.isTextblock && !doc.firstChild.content.size;
    view.dom.classList.toggle("mb-empty-doc", empty);
  };
  return new ProseMirror.Plugin({
    view: view => {
      if ( text ) view.dom.dataset.placeholder = text;
      sync(view);
      return { update: sync };
    }
  });
}
