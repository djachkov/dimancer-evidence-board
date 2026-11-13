# Dimancer's Evidence Board

A system-agnostic Foundry VTT v14 module for investigation and conspiracy boards. Pin evidence
(pictures and text documents) on a board, move it around together with your players, and keep every
piece in a shared Evidence Journal with notes.

## Using it

**Make a board** (GM): click **Create Board** in the Scenes sidebar, or right-click an existing
scene → **Turn into Evidence Board**. A new board is a gridless scene that shows in the navigation
bar. Players can edit it (its Accessibility is *Owner*).

**Choose its look** when you create it. Pick a surface from the list: cork (fine, classic or coarse),
whiteboard, chalkboard, green or burgundy felt, kraft paper, or a plain colour of your own. Then pick a
size (small 2400×1800, medium 4000×3000, large 6000×4500, huge 8000×6000, or custom), the border
colour (left empty, it follows the surface; ↺ resets it), and the colour around the board. The preview shows the framed board on that colour, and the dialog remembers what you
chose last. Every board sits in a frame that suits its surface (wood around cork, aluminium around the
whiteboard), with a soft shadow on the surrounding colour. Afterwards, change the surface, a plain
board's colour and the border colour (empty for the surface's own) in the board's scene configuration, and the surrounding
colour as its **Background Color**. A background image set there is drawn on top of the surface,
inside the frame, so use that for a picture of your own and clear it to get the surface back.
Whiteboard, chalkboard and felt are generated in code, so each board gets its own variation. The
cork and paper images are CC0 textures from ambientCG (see `assets/surfaces/SOURCES.md`).

**Pin evidence** while the board is open. Any of these works:

| Source | How |
|---|---|
| A file or URL | **Pin evidence** (image button) in the board's toolbar. A PDF becomes a document. |
| A text document | **New text document** (page button) in the board's toolbar: pinned on the board and opened in the Evidence Journal to write |
| Files from your computer | Drop images or PDFs onto the board |
| The file browser | Drag an image out of it onto the board |
| Actors, Items, Journal entries/pages | Drag them from the sidebar; the card links back to the document. A text page, or an entry made of text pages, becomes a text document (a copy of its pages); a PDF page becomes a PDF document. |
| The clipboard | Ctrl+V an image, or an image URL, while the board is active. Any other text becomes a sticky note at the mouse. |

**On the board:**

| To… | Do this |
|---|---|
| Move a card | Drag it. Everyone sees it move live. |
| Resize it | Select it, then drag the orange corner handle |
| Open it in the Evidence Journal | Double-click |
| Rename, change order, delete; hide or lock (GM) | Right-click |
| Delete the selected card | Delete key |

**Threads** connect evidence pin to pin, like yarn on a corkboard:

| To… | Do this |
|---|---|
| Connect two cards | Right-click one → **Connect to…**, then click the other (Esc or a click on the empty board cancels) |
| Connect several, quickly | Pick the **Connect** tool (link icon) in the board toolbar, then click one card and then another, or drag from one onto the other |
| Recolour or cut a thread | Right-click the thread |
| Remove all of a card's threads | Right-click the card → **Remove threads** |

Threads follow cards as they move, including while someone else is dragging. A pair of cards can
only be connected once, and deleting a card cuts its threads. Threads to a hidden card are hidden
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
to it. Stickers live on the board only: they aren't in the Evidence Journal.

**Categories** are a property of each card, shown as a coloured tab on the polaroid. A board starts
with Person, Place, Object, Document and Event until someone customises them. Set a card's category
from its right-click menu (**Category…**, which also offers **Manage categories…**) or the Pin
dialog. The Evidence Journal has its own categories.

**Text documents** are evidence made of writing: a letter, a dossier, a page torn from a diary.
On the board one shows as a sheet of A4 paper with its title and the start of its first page.
A document of several pages is a stack, with the sheets underneath peeking out askew, a paper clip
and a page count. Write it in the Evidence Journal, one page at a time: ‹ › turn the pages, and the
page buttons add a page after the one shown or remove it. Threads, categories, ink, hiding and
locking work as for pictures.

**PDF documents** are documents whose pages are a PDF file: add one with the journal's PDF button,
the Pin dialog, or by dropping a PDF file (or a Foundry PDF page) on a board. Boards and the journal
only show its first page, as a picture rendered once per file per session, so even a long PDF stays
light. Several pages show as a stack, like a written document. In the journal the book button reads
the whole PDF in its own window (Foundry's PDF viewer): **Read the PDF** under its preview, the
book button in the zoom bar, or **Read the whole PDF** in the card's right-click menu on a board.

**The Evidence Journal** is the world's case file: all evidence, whether it's on a board or not,
browsable from any scene. Double-clicking evidence on a board opens it here. (It replaced the
per-board evidence list, kept on the `evidence-list` git branch, and, on the `text-documents`
branch, the separate evidence viewer.)
- **Open board** at the top of the list goes to a board: straight there when there's one, or pick
  from a list when there are several (the one you're on is ticked).
- **Open it** from the Journal sidebar (**Evidence Journal**; a GM's first click creates it), the
  book button in the board toolbar, or a card's right-click → **Show in Evidence Journal**.
- **Two directions.** Evidence pinned on a board also appears in the journal. Evidence added in the
  journal (image and page buttons) is *not* put on a board. A GM's starts **Hidden**; a player's is
  visible.
- **Back and forth.** Drag a row from the journal onto a board, or use **Place on …**, to pin it
  there (the same evidence, not a copy). A card's right-click → **Move to journal** takes it off the
  board and leaves it in the journal. Deleting a linked card asks whether to only take it off the
  board or delete the evidence everywhere.
- **Find it on its boards.** Each item lists the boards it's pinned on. Click one (or double-click
  the row) to go there: the board opens and the card is selected and flashes.
- **Access is one switch** (GM): **Hidden from players / Revealed to players**. Hidden evidence
  disappears from players' journal and its cards disappear from boards, and the server refuses
  their edits. Like everything in Foundry, its data still reaches players' browsers, so it isn't
  secret from someone who digs in the console.
- **The list:** **Folders** (your own nested filing), **Categories** or **All**; sort by journal
  order, name or newest; search over titles, notes and category names; and a filter for all
  evidence, on a board, or not on a board. Drag rows onto a folder or category to file them, drag a
  folder onto another to nest it, click a folder to collapse it, and right-click (or ⋯) a folder to
  rename, recolour, add a sub-folder or delete it (its contents move up). ⚙ opens the category
  manager. View, sort, filter and collapsed folders are remembered in your browser. The journal's
  folders and categories are its own, separate from a board's card categories.
- **The picture** (or a PDF's first page) zooms and pans: wheel zooms at the cursor (the point
  under it stays put; the picture only has to keep covering the middle of the box), drag pans,
  double-click toggles Fit and a close-up, and − + Fit 1:1 do the same. Drag its bottom-right corner
  to make it taller (remembered). ⧉ opens it in its own window.
- **A text document** shows one page at a time on paper; anyone who can edit the evidence writes on
  it with the pencil button. The paper's corner drags like the picture's.
- **GM buttons** under the title:
  - **Show to players** is Foundry's own Show Players: everyone or chosen players, optionally even
    while it's hidden from them. It opens in their Evidence Journal (it stays hidden on boards, and
    in their list after a reload).
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
| Pin, move, resize, rename, delete | ✓ | ✓, except locked cards | – |
| Connect, recolour and cut threads | ✓ | ✓ | – |
| Hide/reveal, lock/unlock a card | ✓ | – | – |
| Lock the whole board | ✓ (toolbar lock, or Scene config) | – | – |
| Open evidence in the Evidence Journal | ✓ | ✓ | ✓ |
| Show evidence to players, take everyone to it on a board | ✓ | – | – |

**Uploading** (Add dialog, dropped files, pasted images) needs the core permission **Upload New
Files**, which players don't have by default. Grant it under Game Settings → Configure Permissions,
or pin images by path or URL instead. Uploads go to `worlds/<world>/dimancer-board/`.

Images from other websites only show on the canvas if the site allows cross-origin use. Otherwise
the card shows a grey placeholder (the Evidence Journal still shows them), so upload those instead.

## How it works

- **The Evidence Journal is a JournalEntry flagged `flags.dimancer_board.evidenceJournal`**, pinned to
  the module's `EvidenceJournalSheet` (via `flags.core.sheetClass`). Players own it. Each piece of
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

Card data shape (`scripts/cards.mjs`) and thread data shape (`scripts/links.mjs`, stored under
`flags.dimancer_board.links.<id>`):

```js
{ id, src, x, y, width, height, rotation, sort, title, notes, hidden, locked, link, author, created }
{ id, from, to, color, author, created }   // undirected; one per pair of cards
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
(`scripts/organize.mjs`), in the same shape on the Evidence Journal's JournalEntry, whose pages
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
node --test test/*.test.mjs    # pure card, thread, organisation, journal and viewport logic
```

GitHub Actions runs these tests on every push to `main` and on pull requests (`test.yml`).

**Releasing:** push a version tag, e.g. `git tag v0.2.0 && git push origin v0.2.0`. `release.yml`
runs the tests, writes the version and download URL from the tag into `module.json`, and attaches
`module.json` and `module.zip` to a GitHub release. Foundry installs and updates from
`releases/latest/download/module.json`. The version in the repo's `module.json` is a placeholder.
A release can be rebuilt for an existing tag from the Actions tab.

Planned next: labels on threads.
