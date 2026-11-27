import { hashString, tornEdge } from "./styles.mjs";
import { cardLook, HOLO_ACCENT } from "./render/card-look.mjs";

/**
 * The Evidence Journal's cards and contents, as plain data for its templates: evidence drawn the
 * way the board draws it (a polaroid, an A4 sheet with a clip, a torn parchment, a holo panel), its
 * sections, and paging through it. Pure (no Foundry, no DOM), so it's tested under Node.
 */

const CARD_STYLE_IDS = ["classic", "parchment", "holo"];

/** 0xRRGGBB → "#rrggbb". */
export const cssColor = n => `#${(Number(n) >>> 0).toString(16).padStart(6, "0").slice(-6)}`;

/**
 * A card's small, stable tilt in degrees (the same card always leans the same way), like cards
 * pinned by hand on the board.
 * @param {string} id
 * @param {number} [max=2.5]
 */
export function cardTilt(id, max = 2.5) {
  const h = hashString(String(id));
  const t = ((h % 2001) / 1000) - 1;   // -1 … 1
  return Math.round(t * max * 10) / 10;
}

/** A parchment card's torn outline as a CSS clip-path (the board's edge for the same card). */
export function tornClipPath(id) {
  const pts = tornEdge(hashString(String(id)));
  const pairs = [];
  for ( let i = 0; i < pts.length; i += 2 ) pairs.push(`${round(pts[i] * 100)}% ${round(pts[i + 1] * 100)}%`);
  return `polygon(${pairs.join(", ")})`;
}

const round = v => Math.round(v * 100) / 100;

/**
 * The start of a text, cut at a word boundary.
 * @param {string} text
 * @param {number} [max=260]
 */
export function excerpt(text, max = 260) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if ( clean.length <= max ) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** CSS custom properties for a card style's fonts and colours (set once on the journal). */
export function styleVars(style) {
  const look = cardLook(style);
  const vars = {
    "--mb-card-paper": cssColor(look.paper),
    "--mb-card-edge": cssColor(look.paperEdge),
    "--mb-card-doc": cssColor(look.docPaper),
    "--mb-card-doc-edge": cssColor(look.docEdge),
    "--mb-card-under-1": cssColor(look.under[0]),
    "--mb-card-under-2": cssColor(look.under[1]),
    "--mb-card-photo-tint": cssColor(look.photoTint),
    "--mb-card-doc-tint": cssColor(look.docTint),
    "--mb-card-title": cssColor(look.colors.title),
    "--mb-card-doc-title": cssColor(look.colors.docTitle),
    "--mb-card-doc-body": cssColor(look.colors.docBody),
    "--mb-card-doc-foot": cssColor(look.colors.docFoot),
    "--mb-card-font-title": look.fonts.title,
    "--mb-card-font-doc-title": look.fonts.docTitle,
    "--mb-card-font-doc-body": look.fonts.docBody,
    "--mb-card-font-foot": look.fonts.docFoot
  };
  return Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join("; ");
}

/**
 * What a template needs to draw one piece of evidence as a card.
 * @param {object} item                 A journal item (journal-pages.mjs pageItem)
 * @param {object} [options]
 * @param {string} [options.style]      The card style (classic, parchment, holo)
 * @param {{name: string, color: string, icon?: string}|null} [options.category]
 * @param {string} [options.text]       A text document's plain text (for its excerpt)
 * @param {string} [options.untitled]   The label of a piece without a title
 */
export function cardView(item, { style = "classic", category = null, text = "", untitled = "" } = {}) {
  if ( !CARD_STYLE_IDS.includes(style) ) style = "classic";
  const pdf = (item.kind === "document") && !!item.src;
  const kind = pdf ? "pdf" : (item.kind === "document" ? "document" : "photo");
  const look = cardLook(style);
  const pages = kind === "document" ? Math.max(1, item.docPages?.length ?? 0) : 1;
  const accent = category?.color || cssColor(HOLO_ACCENT);
  return {
    id: item.id,
    kind,
    isPhoto: kind === "photo",
    isDocument: kind === "document",
    isPdf: pdf,
    style,
    title: item.title || untitled,
    untitled: !item.title,
    src: item.src || "",
    hidden: !!item.hidden,
    placed: item.placements?.length ?? 0,
    pages,
    stacked: pages > 1,
    tilt: cardTilt(item.id),
    clip: style === "parchment" ? tornClipPath(item.id) : null,
    accent,
    seal: category?.color || cssColor(look.seal ?? 0x8e1b1b),
    excerpt: kind === "document" ? excerpt(text) : "",
    category
  };
}

/**
 * The contents as sections for the contact sheet: one per group (folder or category, in list
 * order, nested folders after their parent), each with its cards, and the loose cards (in no
 * folder) last. Takes organize.mjs listRows() output.
 * @returns {Array<{key: string, group: object|null, depth: number, ancestors: string[], cards: object[]}>}
 */
export function contentSections(rows) {
  const sections = [];
  const byKey = new Map();
  const section = (key, group, depth, ancestors) => {
    const s = { key, group, depth, ancestors, cards: [] };
    sections.push(s);
    byKey.set(key, s);
    return s;
  };
  for ( const r of rows ) {
    if ( r.type === "group" ) {
      section(r.id, r, r.depth, r.ancestors);
      continue;
    }
    const parent = r.ancestors.at(-1) ?? "";
    (byKey.get(parent) ?? section(parent, null, 0, [])).cards.push(r);
  }
  // Loose cards read best after the folders.
  const loose = byKey.get("");
  if ( loose ) sections.push(sections.splice(sections.indexOf(loose), 1)[0]);
  return sections;
}

/**
 * Where a piece sits when paging through the evidence in order.
 * @param {string[]} ids   The evidence in reading order
 * @param {string} id
 * @returns {{index: number, total: number, prev: string|null, next: string|null}}
 */
export function pageTurn(ids, id) {
  const index = ids.indexOf(id);
  if ( index < 0 ) return { index: -1, total: ids.length, prev: null, next: null };
  return { index, total: ids.length, prev: ids[index - 1] ?? null, next: ids[index + 1] ?? null };
}

/** Does a lower-cased search text contain every word of the query? */
export function matchesQuery(search, query) {
  const words = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every(w => search.includes(w));
}
