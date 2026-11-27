# Dimancer's Evidence Board

A system-agnostic Foundry VTT v14 module for investigation and conspiracy boards. Pin evidence
(pictures and text documents) on a board, move it around together with your players, and file it in
evidence journals (shared or private, each in its own style) with notes.

## Using it

**Make a board** (GM): click **Create Board** in the Scenes sidebar, or right-click an existing
scene → **Turn into Evidence Board**. A new board is a gridless scene that shows in the navigation
bar. Players can edit it (its Accessibility is *Owner*).

**Thumbnails.** A board's surface is drawn by the module, not as a scene background, so core can't
make a sidebar thumbnail of it. A board made from scratch, or from a scene without a background
image, gets a default cork-board thumbnail. A scene with a background keeps its own thumbnail when
you turn it into a board (one is made if it had none), and core's **Generate Thumbnail** works on it
as usual. When a board gets a background image later, its default thumbnail is replaced with core's
thumbnail of that background. Removing the board clears the default thumbnail.

**Choose its look** when you create it. Pick a surface from the list: cork (fine, classic or coarse),
whiteboard, chalkboard, green or burgundy felt, kraft paper, wooden planks (a quest board), a cyber
grid, or a plain colour of your own. Then pick a
size (small 2400×1800, medium 4000×3000, large 6000×4500, huge 8000×6000, or custom), the border
colour (left empty, it follows the surface; ↺ resets it), and the colour around the board. The preview shows the framed board on that colour, and the dialog remembers what you
chose last. Every board sits in a frame that suits its surface (wood around cork, aluminium around the
whiteboard), with a soft shadow on the surrounding colour. Afterwards, change the surface, a plain
board's colour and the border colour (empty for the surface's own) in the board's scene configuration, and the surrounding
colour as its **Background Color**. A background image set there is drawn on top of the surface,
inside the frame, so use that for a picture of your own and clear it to get the surface back.
Whiteboard, chalkboard, felt and the cyber grid are generated in code, so each board gets its own
variation. The cork, paper and plank images are CC0 textures from ambientCG (see
`assets/surfaces/SOURCES.md`).

**Styles** set how the cards, pins and threads look, each on its own (Create dialog and scene
configuration). Picking a surface switches all three to its theme, and you can mix them afterwards:

| | Classic | Medieval (planks) | Cyberpunk (cyber grid) |
|---|---|---|---|
| Cards | Polaroids, A4 sheets with a paper clip, sticky notes | Torn parchment, a wax seal on a stack of pages, tinted scraps for notes, ribbons for categories | Dark holo panels lit in the category colour, scanlines over pictures, documents as terminal windows |
| Pins | Red push-pins | Forged nails | Glowing nodes |
| Threads | Yarn | Twisted twine, looped round the nail | Neon data lines routed like circuit traces |

Note paper, ink and thread colours follow the style too. The quest board's timber frame can carry a
**sign** (the board's name, or text of your own), a **shingle roof** and **lanterns**; the cyber
frame a **header** and **corner brackets**. They sit in the space around the board and are left out
where there's no room. **Animate** (off by default) moves packets along data lines, pulses node
pins, flickers the lanterns and sweeps a scanline down a cyber board.

**Pin evidence** while the board is open. Any of these works:

| Source | How |
|---|---|
| A file or URL | **Pin evidence** (image button) in the board's toolbar. A PDF becomes a document. |
| A text document | **New text document** (page button) in the board's toolbar: pinned on the board and opened in your default journal to write |
| Files from your computer | Drop images or PDFs onto the board |
| The file browser | Drag an image out of it onto the board |
| Actors, Items, Journal entries/pages | Drag them from the sidebar; the card links back to the document. A text page, or an entry made of text pages, becomes a text document (a copy of its pages); a PDF page becomes a PDF document. |
| The clipboard | Ctrl+V an image, or an image URL, while the board is active. Any other text becomes a sticky note at the mouse. |

**On the board:**

| To… | Do this |
|---|---|
| Move a card | Drag it. Everyone sees it move live. |
| Resize it | Select it, then drag the orange corner handle |
| Open it in its journal | Double-click (evidence that isn't in a journal yet is filed in your default journal first) |
| Rename, change order, delete; hide or lock (GM) | Right-click |
| Take the selected card off the board | Delete key, or right-click → **Remove from the Board** |
| Select several cards | Shift-click (or Ctrl-click) each one, or drag a box on the empty board: it picks the cards whose centre is inside. Shift + box adds to the selection. Ctrl+A selects every card you can edit; Esc or a click on the empty board lets go |
| Move several at once | Drag any of the selected cards: the rest follow, keep their places relative to each other and come to the front. Locked cards stay put |
| Act on several at once | Right-click one of the selected cards: category, front/back, hide or lock (GM), and **Remove from the Board** for all of them. Delete removes them too |

**Threads** connect evidence pin to pin, like yarn on a corkboard:

| To… | Do this |
|---|---|
| Connect two cards | Right-click one → **Connect to…**, then click the other (Esc or a click on the empty board cancels) |
| Connect several, quickly | Pick the **Connect** tool (link icon) in the board toolbar, then click one card and then another, or drag from one onto the other |
| Recolour or cut a thread | Right-click the thread |
| Remove all of a card's threads | Right-click the card → **Remove threads** |
| Move a pin | Drag the pin (Select tool; it's ringed under the pointer when it can move). Its threads follow |
| Merge two pins | Drag one onto another on the same card (both ringed green): one pin holds both pins' threads |
| Tie to an existing pin | Click (or drop) on the pin: the thread snaps to it, ringed |
| Tie to a new pin | Click (or drop) anywhere else on the card: a pin is pushed in right there |
| Move a thread's end | Drag the yarn: the end nearer where you grabbed comes off its pin. Drop it on a pin, or anywhere on a card for a new pin (not on the card at its other end); dropped elsewhere it springs back |

A card's own pin sits top centre until moved. Starting a thread with **Connect to…** uses the pin
you right-clicked, or the card's own pin. Pins made for threads go away when their last thread is
cut or moved away. A locked card's pins don't move, and only someone who can edit a card can add a
pin to it (otherwise the thread takes its own pin). Near a pin, the yarn lets the pin take the mouse.

Threads follow cards as they move, including while someone else is dragging. A pair of cards can
only be connected once, and removing a card cuts its threads. Threads to a hidden card are hidden
from players too.

**Stickers** are for your own thinking on the board: sticky notes with text, and freehand drawing.
They move, resize, take threads and categories, and can be hidden or locked, like evidence.

| To… | Do this |
|---|---|
| Stick a note | Pick the **Note** tool (sticky-note icon), choose a paper colour in the bar at the top, click the board, and type. Enter adds a line; Ctrl+Enter or a click elsewhere saves; Esc discards the typing. A new note stays even if you leave it empty. |
| Paste text as a note | Ctrl+V with the mouse over the board. Longer text gets a bigger note (up to twice the size). |
| Write on a note again | Double-click it, or right-click → **Edit text** |
| Draw | Pick the **Draw** tool (pen icon), choose ink colour and pen width in the bar, and draw. Strokes drawn close together become one sketch, which grows as you go. A click leaves a dot. |
| Draw on a note or evidence | Start the stroke on it. The ink stays on its paper and moves, resizes and turns with it. |
| Undo a stroke | Ctrl+Z, or ↶ in the bar (your own strokes, newest first) |
| Recolour | Right-click a note for paper colours, or a sketch for ink colours. **Clear drawing** (right-click) wipes the ink off a note or a piece of evidence. |

A sketch is grabbed by its ink, so its empty corners never cover the evidence underneath. Once
selected it can be dragged and resized from anywhere in its box. It gets a pin when a thread is tied
to it. Stickers live on the board only: they aren't in any journal.

**Categories** are a property of each card, shown as a coloured tab on the polaroid. A board starts
with Person, Place, Object, Document and Event until someone customises them. Set a card's category
from its right-click menu (**Category…**, which also offers **Manage categories…**) or the Pin
dialog. Each journal has its own categories.

**Text documents** are evidence made of writing: a letter, a dossier, a page torn from a diary.
On the board one shows as a sheet of A4 paper with its title and the start of its first page.
A document of several pages is a stack, with the sheets underneath peeking out askew, a paper clip
and a page count. Write it in its journal, right on the sheet, one page at a time: ‹ › under
it turn the pages, and the page buttons add a page after the one shown or remove it. Threads, categories, ink, hiding and
locking work as for pictures.

**PDF documents** are documents whose pages are a PDF file: add one with the journal's PDF button,
the Pin dialog, or by dropping a PDF file (or a Foundry PDF page) on a board. Boards and the journal
only show its first page, as a picture rendered once per file per session, so even a long PDF stays
light. Several pages show as a stack, like a written document. In the journal the book button reads
the whole PDF in its own window (Foundry's PDF viewer): **Read all N pages** under its preview, or
**Read the whole PDF** in the right-click menu of its card (on a board or in the journal).

**Evidence journals** are the case files: evidence, whether it's on a board or not, browsable from
any scene, laid out as an open notebook. Double-clicking evidence on a board opens it in its journal.
(They replaced the per-board evidence list, kept on the `evidence-list` git branch, and, on the
`text-documents` branch, the separate evidence viewer.)
- **As many journals as you like.** Anyone, GM or player, starts one with **New journal…** under the
  journal button in a journal's bar, or the Journal sidebar's **New Evidence Journal** button. The dialog
  asks for a name, the **style** (Classic, Quest board or Cyberpunk, shown as a sample card in each;
  it can't be changed later) and who can use it: **Shared with everyone** (every player can read it,
  add evidence and file into it) or **Only me** (only its creator and the GM). Players can't create
  journal entries in Foundry by default (it's a Trusted permission), so a player's journal is created
  by a connected GM's client on their behalf: a GM must be online.
- **Your default journal.** Each user marks one journal as their default: **Make it my default
  journal** at the foot of its contents, under the journal button, in the dialog when creating it,
  or in the Journal sidebar's right-click menu. It has a ★ (in the bar and in the sidebar). Evidence
  you take off a board is filed there. Without a mark, the first journal you can add to is your
  default; with none at all, you're asked to create one.
- **Filed when it comes off a board.** Evidence pinned straight onto a board lives on the board only
  until someone takes it off (**Remove from the Board** or the Delete key): then it's filed in *their*
  default journal. Evidence placed from a journal is already there and stays where it is.
  **Add to …** in a card's right-click menu files it now, keeping it on the board. Evidence that
  can't be filed (no journal you can add to) is deleted for good, so you're asked first.
  **Deleting a journal** (or a piece of evidence in it) keeps its cards on the boards, unfiled
  again, so they can go into another journal.
- **Switch journals** with the journal button at the start of the bar: it lists the journals you can
  open (★ your default, a lock for private ones) and opens the one you pick in the same spot.
  **Move to …** in a card's menu moves evidence into another journal you can add to: its cards on
  boards stay pinned and follow it (on boards you can edit; a GM's, all of them). It leaves its
  folder behind and keeps its category if the new journal has it.
- **Two spreads.** The **contents**: on the left page the table of contents (**Folders**, your own
  nested filing; **Categories**; or **All**), each chapter with its count; on the right a contact
  sheet of the evidence, chapter by chapter. Click a chapter to scroll to it. Click a card to
  **read** it: the left page shows it large (a zoomable picture in its frame, a document's sheet, a
  PDF's first page), the right page its title, category and notes, with the boards it's on and who
  added it at the foot. **‹ Contents** (or Esc) goes back; ‹ › (or ← →) turn to the previous or next
  piece, in the contents' order and search. A narrow window shows one page at a time.
- **Cards look as they do on a board**, in the journal's style (classic polaroids and paper,
  quest-board parchment, cyberpunk holo panels): the same paper, fonts, torn edges, paper clips, wax
  seals and category tabs. The book itself takes the style's mood: warmer paper for parchment, a dark
  terminal for holo. A journal from before styles existed is classic.
- **The bar over the book:** search (`/` jumps to it) over titles, notes, document text and category
  names; **Filter** (sort by journal order, name or newest; show all evidence, only what's on a
  board, or only what isn't); **Add** (an image, a text document or a PDF); and **Open board**, which
  goes straight to the only board or offers a list (the one you're on is ticked). While reading,
  **⋯** holds the rest: place on this board, go to it on a board, open the picture in its own window,
  and for a GM **Show to players**, **Everyone to the board** and Hide/Reveal; set its category,
  take it out of its folder, delete it. Right-clicking a card in the contents opens the same menu.
- **Two directions.** Evidence added in a journal is *not* put on a board. A GM's starts **Hidden**;
  a player's is visible.
- **Back and forth.** Drag a card from the journal onto a board, or use **Place on …** at the foot of
  its page, to pin it there (the same evidence, not a copy). **Remove from the Board** (or the Delete
  key) only takes evidence off the board: it stays in its journal, and evidence that wasn't in one
  yet is filed in your default journal. Evidence is deleted for good only from a journal. Stickers aren't evidence, so
  removing one deletes it.
- **Find it on its boards.** The foot of its page lists the boards it's pinned on. Click one (or
  double-click its card in the contents) to go there: the board opens and the card is selected and
  flashes.
- **Access is one switch** (GM): the **Hidden from players / Revealed to players** chip under the
  title. Hidden evidence disappears from players' journal and its cards disappear from boards, and
  the server refuses their edits. Like everything in Foundry, its data still reaches players'
  browsers, so it isn't secret from someone who digs in the console.
- **Filing:** drag cards onto a chapter (in the contents or its heading on the contact sheet) to
  file them, drag a folder onto another to nest it, the chevrons collapse chapters, and right-click
  (or ⋯) a folder to rename, recolour, add a sub-folder or delete it (its contents move up).
  **New folder** and **Manage categories** are under the contents. View, sort, filter and collapsed
  chapters are remembered in your browser. The journal's folders and categories are its own,
  separate from a board's card categories.
- **The picture** (or a PDF's first page) zooms and pans: wheel zooms at the cursor (the point
  under it stays put; the picture only has to keep covering the middle of the box), drag pans,
  double-click toggles Fit and a close-up, and − + Fit 1:1 do the same. ⧉ opens it in its own window.
- **Writing** (notes, a document's pages, the title) happens in place: click into the text and type.
  It saves itself a moment after you stop and when you click away (Ctrl+S saves at once); the foot
  of the page says *Saving…* / *Saved*. There's no edit button and no menubar:
  - select text for a small toolbar: bold, italic, underline, strikethrough, heading, subheading,
    quote, bulleted and numbered lists, link, and secret (a block only owners see);
  - type **/** at the start of a line (or after a space) for a menu of blocks to insert (text,
    headings, lists, quote, secret, divider, code), filtered as you type, picked with ↑ ↓ and Enter;
  - Markdown-style shortcuts format as you type: `**bold**`, `*italic*` or `_italic_`,
    `~~strikethrough~~`, `` `code` ``, `# ` to `###### ` for headings, `- ` or `1. ` for lists, `> `
    for a quote, and `---` for a divider.
  It's Foundry's own editor underneath, so dragging an Actor, Item or page in still makes a link,
  `@UUID[…]` links and secrets work, pasted images upload, and Ctrl+Z undoes.
- **GM actions** (in ⋯ and the right-click menu):
  - **Show to players** is Foundry's own Show Players: everyone or chosen players, optionally even
    while it's hidden from them. It opens in its journal for them (it stays hidden on boards, and
    in their list after a reload). Players who can't open that journal (someone else's private one)
    can't see it.
  - **Everyone to the board** takes every connected player to the evidence on its board (this board
    if it's here, else the first it's on), regardless of their scene permission, and pans and
    flashes it there. Each board under **On boards** has the same button. A hidden card isn't shown
    to them, so the GM is warned.
- A title, image, notes or hidden change on either side (a card or its page) is copied to the other
  by whoever made it, on the boards they can edit.

## Who can do what

| | GM | Player (board Accessibility *Owner*) | Player (*Observer*) |
|---|---|---|---|
| See cards | all, hidden ones faded | all but hidden | all but hidden |
| Pin, move, resize, rename, delete | ✓ (locked cards can't be moved or resized) | ✓, except locked cards | – |
| Connect, recolour and cut threads | ✓ | ✓ | – |
| Hide/reveal, lock/unlock a card | ✓ | – | – |
| Lock the whole board | ✓ (toolbar lock, or Scene config) | – | – |
| Open evidence in its journal | ✓ | ✓ | ✓ |
| Create a journal (shared or private), pick a default journal | ✓ | ✓ (a GM must be online) | ✓ (a GM must be online) |
| Show evidence to players, take everyone to it on a board | ✓ | – | – |

**Uploading** (Add dialog, dropped files, pasted images) needs the core permission **Upload New
Files**, which players don't have by default. Grant it under Game Settings → Configure Permissions,
or pin images by path or URL instead. Uploads go to `worlds/<world>/dimancer-board/`.

Images from other websites only show on the canvas if the site allows cross-origin use. Otherwise
the card shows a grey placeholder (journals still show them), so upload those instead.

## How it works

- **An evidence journal is a JournalEntry flagged `flags.dimancer_board.evidenceJournal`**
  (`{version: 2, style}`), pinned to the module's `EvidenceJournalSheet` (via `flags.core.sheetClass`).
  A shared one is `ownership {default: OWNER}`; a private one `{default: NONE, <creator>: OWNER}`.
  A user's default journal is the User flag `flags.dimancer_board.defaultJournal` (an entry id),
  checked against what they can still add to (`pickDefaultJournal`). A player without the Create
  Journal Entries permission sends `createJournal` over the module socket; the active GM's client
  creates it and replies with `journalCreated`. Each piece of
  evidence is a page of the module's `dimancer_board.evidence` type (image in `src`, title as the
  name, `system.notes/category/folder/link/author/created`). Hidden is page ownership
  `{default: NONE}` (replaced whole, so no per-user entries remain); revealed inherits OWNER from
  the journal. A card that shows a page stores its UUID in `card.page`. Placements aren't stored on
  pages: they're found by scanning boards for cards that point at the page.
- **A text document is an evidence page with `system.kind: "document"`** and its pages in
  `system.pages` (HTML, one string per sheet; at least one). A card showing it has `kind:
  "document"` and a mirrored copy in `docPages`, which the board reads as plain text only. The
  server only cleans single HTML fields, so the journal runs each page through `cleanHTML` before
  showing or editing it. Changing a page writes the whole list, so two people writing different
  pages of one document at the same moment can lose one edit.
- **A PDF document is a document with a `src`** (the PDF) and no written pages. `pdf-preview.mjs`
  renders its first page with Foundry's bundled pdf.js (`scripts/pdfjs/build/pdf.mjs`), once per file
  per session, shared as a texture by cards and as a blob URL by the journal. A card takes the
  page's shape at A4 height. The full file opens in `PdfViewer`, an iframe on Foundry's
  `scripts/pdfjs/web/viewer.html`, kept across re-renders so the reader keeps their place.
- **The journal's cards are HTML**, not pictures of the canvas: `journal-cards.mjs` turns a page into
  a card description (kind, tilt from its id, the torn parchment outline from the board's own
  `tornEdge`, accent and seal colours) and `templates/journal-card.hbs` draws it with
  `styles/journal.css`. The fonts and colours of each card style live in `render/card-look.mjs`,
  which both the canvas painters and the journal read, so the two can't drift apart. The parchment
  texture is the board's, turned into a CSS image once per session.
- **The journal editor** (`journal-editor.mjs`) is Foundry's `<prose-mirror>` element (not toggled,
  so always editable) whose `plugins` event it answers: Foundry's menubar plugin is replaced by an
  empty one, and it adds a floating selection toolbar, the "/" menu (in the `chatInput` slot,
  which Foundry orders ahead of its keymaps so the menu gets Enter, Esc and the arrows first), mark
  input rules, autosave (`el.save()` debounced and on blur, shown through `data-save-state`) and
  a placeholder. Any `<prose-mirror data-mb-editor>` gets it. The pure rules (slash items, Markdown
  patterns) are in `editor-rules.mjs`. The sheet doesn't re-render while someone is typing or a save
  is pending; live updates land when they leave the field.
- **Everyone to the board** is a module socket message `{op: "focus", sceneId, cardId, users}`,
  honoured only from a GM (optionally for some user ids).

- **A board is a Scene with `flags.dimancer_board.board` set.** v14 Scenes have no subtypes, so
  board behaviour switches on that flag. The module adds a `board` canvas layer and toolbar
  control, both inert on other scenes.
- **Cards live in the Scene's flags (`flags.dimancer_board.cards.<id>`), not as Tiles.** Foundry only
  lets GMs create or change Tiles, Drawings by their authors, and Notes by their authors and
  trusted players, and the server enforces this. Anyone who owns a Scene can update its flags,
  though, so players edit the board directly and no GM has to be online.
  - Each write is a per-field dotted key, so two people editing different cards don't overwrite
    each other.
  - Flag changes don't redraw the canvas.
- **Live dragging** goes over the module socket (`"socket": true`). Only the drop writes to the
  Scene.
- **Hidden cards** are only drawn for GMs, but their data still reaches every client, the same as
  core's hidden Tiles. Don't hide spoilers someone could read from the browser console.

- **Styles are drawing only.** `scripts/styles.mjs` holds the registries (themes, palettes,
  decorations); `scripts/render/` draws them: card painters (`cards-classic/parchment/holo.mjs`),
  `pins.mjs`, `threads.mjs` (a painter knows a thread's path, for its hit area, and draws it),
  `decor.mjs` (frames and decorations) and one throttled ticker (`animation.mjs`). A style never
  changes a card's paper box, so pins, hit areas and threads stay put when it changes. A board
  stores `board.style = {cards, pins, threads}` and `board.decor = {sign, roof, lanterns, hud,
  brackets, animate, signText}`; without them it takes its surface's theme.

Card data shape (`scripts/cards.mjs`) and thread data shape (`scripts/links.mjs`, stored under
`flags.dimancer_board.links.<id>`):

```js
{ id, src, x, y, width, height, rotation, sort, title, notes, hidden, locked, link, author, created, pins }
{ id, from, to, fromPin, toPin, color, author, created }   // undirected; one per pair of cards
// pins: { [pinId]: { x, y } } as fractions (0–1) of the card's paper; "main" is the card's own pin
// (top centre when absent). A thread's fromPin/toPin name a pin on each end ("main" by default).
```

Cards also have a `kind`: `"image"` (evidence), `"note"` or `"sketch"` (`scripts/stickers.mjs`). A
note has `text` and a paper `color`. Notes and sketches carry ink as vector strokes in the card's own
view box, so moving or resizing never rewrites them:

```js
view    = { x, y, w, h }                                   // stroke space the card shows
strokes = { <id>: { color, width, points: [x0, y0, …], sort, author } }
```

A sketch's view box starts as the board area where it was drawn, and grows (with the card's
x/y/size adjusted to match) when ink goes past its edge. Strokes are keyed by id, so two people
drawing on one sketch at once don't overwrite each other.

Cards also carry `category` and `folder` ids. Categories and folders live next to the cards
(`scripts/organize.mjs`), in the same shape on each evidence journal's JournalEntry, whose pages
carry them in `system`. A board's folders have no UI since the board list was removed (the
`evidence-list` branch); its categories still drive the cards' coloured tabs:

```js
flags.dimancer_board.categories.<id> = { id, name, color, icon, sort }   // absent = default set
flags.dimancer_board.folders.<id>    = { id, name, color, parent, sort } // parent null = top level
```

`game.modules.get("dimancer_board").api` exposes `createBoard`, `convertToBoard`,
`openAddEvidence`, `openCategoryManager`, `getEvidenceJournal`, `openEvidenceJournal`,
`createEvidenceJournal`, `linkBoardToJournal` and `newDocument`.

## Development

```
node --test test/*.test.mjs    # pure card, thread, organisation, journal, editor-rule and viewport logic
```

GitHub Actions runs these tests on every push to `main` and on pull requests (`test.yml`).

**Releasing:** push a version tag, e.g. `git tag v0.2.0 && git push origin v0.2.0`. `release.yml`
runs the tests, writes the version and download URL from the tag into `module.json`, and attaches
`module.json` and `module.zip` to a GitHub release. Foundry installs and updates from
`releases/latest/download/module.json`. The version in the repo's `module.json` is a placeholder.
A release can be rebuilt for an existing tag from the Actions tab.

Planned next: labels on threads.
