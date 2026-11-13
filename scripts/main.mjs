import { MODULE_ID, TEMPLATES } from "./constants.mjs";
import { isBoard } from "./permissions.mjs";
import BoardLayer from "./board-layer.mjs";
import { openCategoryManager } from "./organize-actions.mjs";
import { registerSceneHooks, createBoard, convertToBoard } from "./board-scene.mjs";
import { openAddEvidence, pinFiles, titleFromPath } from "./add-evidence.mjs";
import { registerSocket, onSocket } from "./socket.mjs";
import { DOCUMENT_TYPES, pinDocument, registerPaste } from "./sources.mjs";
import { registerEvidencePageType } from "./evidence-page-data.mjs";
import EvidenceJournalSheet from "./evidence-journal-sheet.mjs";
import { registerJournalSync } from "./journal-sync.mjs";
import { focusCard } from "./focus.mjs";
import { createEvidenceJournal, getEvidenceJournal, linkBoardToJournal, newDocument, openEvidenceJournal } from "./journal-store.mjs";

Hooks.once("init", () => {
  // Always registered; on a scene that isn't a board it draws nothing and has no controls.
  CONFIG.Canvas.layers.board = { layerClass: BoardLayer, group: "interface" };
  registerSceneHooks();

  // Evidence Journal (POC): the "evidence" page type, the journal's own sheet (pinned to the
  // evidence journal by flag, never the default), and the card <-> page sync.
  registerEvidencePageType();
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, EvidenceJournalSheet, {
    makeDefault: false,
    label: () => game.i18n.localize("DIMANCER_BOARD.Journal.SheetLabel")
  });
  registerJournalSync();
});

Hooks.once("ready", () => {
  // Templates come over the socket; fetch them now so the first dialog opens without a wait.
  foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
  registerSocket();
  registerPaste();
  onSocket("drag", ({ sceneId, cardId, x, y, width, height }) => {
    if ( canvas.scene?.id === sceneId ) canvas.board?.onRemoteDrag(cardId, { x, y, width, height });
  });
  onSocket("dragEnd", ({ sceneId, cardId }) => {
    if ( canvas.scene?.id === sceneId ) canvas.board?.onRemoteDrag(cardId, null);
  });
  onSocket("focus", ({ sceneId, cardId, users }, senderId) => {
    if ( !game.users.get(senderId)?.isGM ) return;
    if ( Array.isArray(users) && !users.includes(game.user.id) ) return;
    const scene = game.scenes.get(sceneId);
    if ( scene ) focusCard(scene, cardId, { select: false });
  });
  game.modules.get(MODULE_ID).api = {
    createBoard, convertToBoard, openAddEvidence, openCategoryManager,
    getEvidenceJournal, openEvidenceJournal, createEvidenceJournal, linkBoardToJournal, newDocument
  };
});

/** Remember what the layer was drawn as, so turning a scene into a board (or back) redraws it. */
let drawnAsBoard = false;

Hooks.on("canvasReady", () => {
  drawnAsBoard = isBoard(canvas.scene);
  // Core has already rebuilt the scene controls for this scene (and activated the token layer)
  // by the time canvasReady fires, so the board control exists and can be switched to.
  if ( drawnAsBoard ) canvas.board.activate({ tool: "select" });
});

Hooks.on("updateScene", (scene, changed) => {
  const boardChanged = ("flags" in changed) || ("ownership" in changed);
  if ( !boardChanged ) return;
  if ( scene === canvas.scene ) {
    if ( isBoard(scene) !== drawnAsBoard ) {
      canvas.draw();
    } else if ( drawnAsBoard ) {
      canvas.board.refreshCards();
      const lockChanged = foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.board`);
      if ( lockChanged || ("ownership" in changed) ) ui.controls.render({ reset: true });
    }
  }
});

/**
 * Leaving a board's canvas: hand the controls to Tokens first. If the next canvas is blank (the
 * board was deleted while being viewed), core re-renders the controls with the remembered "board"
 * control, which no longer exists, and SceneControls throws. A next board re-activates its own
 * control on canvasReady.
 */
Hooks.on("canvasTearDown", () => {
  if ( drawnAsBoard && (ui.controls.control?.name === "board") && ui.controls.controls.tokens ) {
    ui.controls.activate({ control: "tokens" });
  }
});

// Thread thickness follows the zoom level.
Hooks.on("canvasPan", () => {
  if ( drawnAsBoard ) canvas.board?.queueThreads();
});

/**
 * On a board, drops become evidence cards: image files from the operating system, images dragged
 * out of the file picker (instead of Tiles), and Actors, Items and Journal entries or pages
 * (instead of tokens and map notes), which stay linked to their document.
 */
Hooks.on("dropCanvasData", (cnv, data, event) => {
  if ( !isBoard(canvas.scene) ) return;
  const files = [...(event?.dataTransfer?.files ?? [])];
  if ( files.length ) {
    pinFiles(files, { x: data.x, y: data.y });
    return false;
  }
  if ( (data.type === "Tile") && data.texture?.src ) {
    canvas.board.addCard({ src: data.texture.src, x: data.x, y: data.y, title: titleFromPath(data.texture.src) });
    return false;
  }
  if ( DOCUMENT_TYPES.has(data.type) && data.uuid ) {
    pinDocument(data.uuid, { x: data.x, y: data.y });
    return false;
  }
});
