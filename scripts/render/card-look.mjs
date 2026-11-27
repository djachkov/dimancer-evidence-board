/**
 * How each card style looks (fonts, ink and paper colours), shared by the board's canvas painters
 * (scripts/render/cards-*.mjs) and the Evidence Journal's HTML cards (scripts/journal-cards.mjs),
 * so a card reads the same in both places. Pure data: no PIXI, no DOM.
 *
 * Colours are 0xRRGGBB numbers, as PIXI takes them; journal-cards.mjs turns them into CSS.
 */

const SANS = "Signika, sans-serif";
const DOC_SERIF = "Georgia, 'Times New Roman', serif";
const SERIF = "Amiri, Georgia, serif";
const DISPLAY_SERIF = "'Modesto Condensed', Georgia, serif";
const DISPLAY_SCI = "'Bruno Ace', Signika, sans-serif";
const MONO = "'Courier New', Courier, monospace";

/** The default neon of a holo card without a category (the board's node pins use it too). */
export const HOLO_ACCENT = 0x00e5ff;

export const CARD_LOOKS = Object.freeze({
  classic: Object.freeze({
    fonts: Object.freeze({ title: SANS, badge: SANS, tab: SANS, note: SANS, docTitle: DOC_SERIF, docBody: DOC_SERIF, docFoot: SANS }),
    colors: Object.freeze({ title: 0x2b2b2b, badge: 0x8a6d3b, note: 0x2b2b2b, docTitle: 0x161616, docBody: 0x2e2e2e, docFoot: 0x8a8478 }),
    /** The polaroid frame and its edge */
    paper: 0xf7f3ea,
    paperEdge: 0xd8d0bf,
    /** A document's sheet, its edge, and the sheets underneath (top first) */
    docPaper: 0xfbfaf5,
    docEdge: 0xd3ccba,
    under: Object.freeze([0xf1eee4, 0xe9e5d9]),
    photoTint: 0xffffff,
    docTint: 0xffffff
  }),
  parchment: Object.freeze({
    fonts: Object.freeze({ title: DISPLAY_SERIF, badge: SERIF, tab: DISPLAY_SERIF, note: SERIF, docTitle: DISPLAY_SERIF, docBody: SERIF, docFoot: SERIF }),
    colors: Object.freeze({ title: 0x3a2814, badge: 0x7a4a1a, note: 0x2a1c10, docTitle: 0x24170b, docBody: 0x3a2a18, docFoot: 0x6b5232 }),
    paper: 0xead9b8,
    paperEdge: 0x7a5426,
    docPaper: 0xead9b8,
    docEdge: 0x7a5426,
    under: Object.freeze([0xe8d8b8, 0xd8c6a0]),
    photoTint: 0xf2dfc4,
    docTint: 0xf2e2c8,
    /** The wax that seals a stack of pages without a category colour */
    seal: 0x8e1b1b
  }),
  holo: Object.freeze({
    fonts: Object.freeze({ title: DISPLAY_SCI, badge: MONO, tab: DISPLAY_SCI, note: MONO, docTitle: DISPLAY_SCI, docBody: MONO, docFoot: MONO }),
    colors: Object.freeze({ title: 0xd6f6ff, badge: 0x7fdcff, note: 0xd6f6ff, docTitle: 0xd6f6ff, docBody: 0x8fe3ff, docFoot: 0x5fb8d6 }),
    /** The dark panel of a picture or note, and of a document's terminal window */
    paper: 0x07101a,
    paperEdge: HOLO_ACCENT,
    docPaper: 0x060c14,
    docEdge: HOLO_ACCENT,
    under: Object.freeze([0x07101a, 0x07101a]),
    photoTint: 0xc4ecff,
    docTint: 0xcfefff
  })
});

/** The look of a card style (classic for an unknown one). */
export const cardLook = style => CARD_LOOKS[style] ?? CARD_LOOKS.classic;
