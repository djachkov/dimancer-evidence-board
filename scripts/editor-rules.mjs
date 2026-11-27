/**
 * The journal editor's rules, pure so they're tested under Node: which blocks the "/" menu offers
 * and how it filters them, when typing opens it, and the Markdown-style shortcuts that format
 * text as it's typed. scripts/journal-editor.mjs turns these into ProseMirror plugins.
 */

/**
 * Blocks the "/" menu inserts. Labels: DIMANCER_BOARD.Editor.Block.<id>; `keywords` match too.
 * @type {ReadonlyArray<{id: string, icon: string, keywords: string[]}>}
 */
export const SLASH_ITEMS = Object.freeze([
  { id: "paragraph", icon: "fa-paragraph", keywords: ["text", "plain", "p"] },
  { id: "heading1", icon: "fa-heading", keywords: ["h1", "title", "heading"] },
  { id: "heading2", icon: "fa-heading", keywords: ["h2", "subtitle", "heading"] },
  { id: "heading3", icon: "fa-heading", keywords: ["h3", "heading"] },
  { id: "bullet", icon: "fa-list-ul", keywords: ["ul", "list", "bullet", "unordered"] },
  { id: "ordered", icon: "fa-list-ol", keywords: ["ol", "list", "numbered", "ordered"] },
  { id: "quote", icon: "fa-quote-left", keywords: ["blockquote", "quote", "citation"] },
  { id: "secret", icon: "fa-user-secret", keywords: ["secret", "gm", "hidden"] },
  { id: "divider", icon: "fa-minus", keywords: ["hr", "rule", "line", "separator", "divider"] },
  { id: "code", icon: "fa-code", keywords: ["pre", "code", "monospace"] }
].map(i => Object.freeze({ ...i, keywords: Object.freeze(i.keywords) })));

/**
 * The "/" menu's items for what's been typed after the slash: labels that start with it first,
 * then labels or keywords that contain it.
 * @param {ReadonlyArray<{id: string, keywords: string[]}>} items
 * @param {string} query
 * @param {(item: object) => string} labelOf   The item's (localised) label
 */
export function filterSlashItems(items, query, labelOf) {
  const q = String(query ?? "").trim().toLowerCase();
  if ( !q ) return [...items];
  const starts = [];
  const contains = [];
  for ( const item of items ) {
    const label = String(labelOf(item) ?? "").toLowerCase();
    if ( label.startsWith(q) || item.keywords.some(k => k.startsWith(q)) ) starts.push(item);
    else if ( label.includes(q) || item.keywords.some(k => k.includes(q)) ) contains.push(item);
  }
  return [...starts, ...contains];
}

/**
 * What's been typed after a "/" that opens the menu, or null. The slash opens it at the start of
 * a block or after a space (so "and/or" or a URL doesn't), and the query is one word at most.
 * @param {string} textBefore   The block's text up to the cursor
 * @returns {string|null}
 */
export function slashQuery(textBefore) {
  const m = /(?:^|\s)\/([\p{L}\p{N}-]{0,20})$/u.exec(String(textBefore ?? ""));
  return m ? m[1] : null;
}

/**
 * Markdown-style marks applied as the closing delimiter is typed: **bold**, *italic*, _italic_,
 * ~~strikethrough~~ and `code`. Group 1 is the text that gets the mark. A delimiter can't open
 * right after a letter or the same character, so snake_case and 2*3*4 are left alone.
 * @type {ReadonlyArray<{mark: string, re: RegExp}>}
 */
export const MARK_RULES = Object.freeze([
  { mark: "strong", re: /(?<![\p{L}\p{N}*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/u },
  { mark: "em", re: /(?<![\p{L}\p{N}*])\*([^*\s](?:[^*]*[^*\s])?)\*$/u },
  { mark: "em", re: /(?<![\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_$/u },
  { mark: "strikethrough", re: /(?<![\p{L}\p{N}~])~~([^~\s](?:[^~]*[^~\s])?)~~$/u },
  { mark: "code", re: /(?<![\p{L}\p{N}`])`([^`\s](?:[^`]*[^`\s])?)`$/u }
].map(r => Object.freeze(r)));

/** A divider typed on a line of its own: ---, *** or ___. */
export const DIVIDER_RULE = /^(?:---|\*\*\*|___)$/;

/**
 * The mark rule that a block's text (up to and including the character just typed) completes.
 * @param {string} text
 * @returns {{mark: string, match: RegExpExecArray}|null}
 */
export function markRuleFor(text) {
  for ( const rule of MARK_RULES ) {
    const match = rule.re.exec(text);
    if ( match ) return { mark: rule.mark, match };
  }
  return null;
}
