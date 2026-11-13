import { TEMPLATES, t } from "./constants.mjs";
import { cardUpdate } from "./cards.mjs";
import {
  CATEGORY_ICONS, iconLabel, categoryList, categoriesUpdate, canNest, folderCreate, folderDelete,
  folderList, folderUpdate, nextFolderSort
} from "./organize.mjs";
import { THREAD_COLORS } from "./links.mjs";
import { boardCards, boardCategoriesRaw, boardFolders, canEditBoard, canEditCard, getCard } from "./permissions.mjs";
import { menuItems, showMenu } from "./menu.mjs";

const { DialogV2 } = foundry.applications.api;
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/* -------------------------------------------- */
/*  Organizers                                  */
/* -------------------------------------------- */

/**
 * Folders and categories work the same on a board and on the Evidence Journal: both keep them in
 * `flags.dimancer_board.folders` / `.categories` of their document. What differs is the items being
 * filed (cards in the Scene's flags, or journal pages) and who may edit. An organizer hides that.
 *
 * Every function below takes either a board Scene (the organizer is built for it) or an organizer.
 *
 * @typedef {object} Organizer
 * @property {true} organizer
 * @property {foundry.abstract.Document} doc              Holds the folder and category flags
 * @property {() => boolean} canEdit                     May this user file and organise?
 * @property {() => Array<{id: string, category: string|null, folder: string|null}>} items
 * @property {(id: string) => object|null} getItem
 * @property {(item: object) => boolean} canEditItem
 * @property {(docUpdate: object, patches: Map<string, object>) => Promise<unknown>} commit
 *   Write a flag update to the document plus per-item {category?, folder?} patches.
 */

/** The organizer of a board: cards in the Scene's flags, written in one Scene update. */
export function sceneOrganizer(scene) {
  return {
    organizer: true,
    doc: scene,
    canEdit: () => canEditBoard(scene),
    items: () => Object.entries(boardCards(scene)).filter(([, c]) => c && (typeof c === "object")).map(([id, c]) => ({ ...c, id: c.id ?? id })),
    getItem: id => getCard(scene, id),
    canEditItem: card => canEditCard(scene, card),
    commit: async (docUpdate, patches) => {
      const update = { ...docUpdate };
      for ( const [id, patch] of patches ) Object.assign(update, cardUpdate(id, patch));
      if ( !foundry.utils.isEmpty(update) ) await scene.update(update);
    }
  };
}

const organizerOf = target => (target?.organizer ? target : sceneOrganizer(target));

/** The categories of a board or journal (defaults until customised). */
export const categoriesOf = target => categoryList(boardCategoriesRaw(organizerOf(target).doc));

/* -------------------------------------------- */
/*  Items                                       */
/* -------------------------------------------- */

/** Patch several items in one write, skipping the ones this user may not change. */
async function patchItems(target, ids, patch) {
  const org = organizerOf(target);
  const patches = new Map();
  for ( const id of ids ) {
    const item = org.getItem(id);
    if ( item && org.canEditItem(item) ) patches.set(id, patch);
  }
  if ( patches.size ) await org.commit({}, patches);
}

export function setCardCategory(target, ids, categoryId) {
  return patchItems(target, ids, { category: categoryId || null });
}

export function moveCardsToFolder(target, ids, folderId) {
  return patchItems(target, ids, { folder: folderId || null });
}

/**
 * The category picker for a card, at client coordinates: every category, "None", and (for
 * editors) "Manage categories…".
 */
export function openCategoryPicker(scene, cardId, x, y) {
  const org = organizerOf(scene);
  const card = org.getItem(cardId);
  if ( !card || !org.canEditItem(card) ) return;
  const cats = categoriesOf(org);
  const html = `<p class="mb-menu-heading">${t("Category.Pick")}</p>` + menuItems([
    ...cats.map(c => ({ action: "set", data: { id: c.id }, icon: c.icon, color: c.color, label: esc(c.name), active: card.category === c.id })),
    { action: "set", data: { id: "" }, icon: "fa-ban", label: t("Category.None"), active: !cats.some(c => c.id === card.category) },
    { action: "manage", icon: "fa-gear", label: t("Category.Manage") }
  ]);
  showMenu(x, y, html, (action, button) => {
    if ( action === "set" ) return setCardCategory(scene, [cardId], button.dataset.id);
    if ( action === "manage" ) return openCategoryManager(scene);
  });
}

/* -------------------------------------------- */
/*  Folders                                     */
/* -------------------------------------------- */

async function askName(title, value = "") {
  const name = await DialogV2.prompt({
    window: { title },
    content: `<div class="form-group"><label>${t("Folder.Name")}</label>
      <input type="text" name="name" value="${esc(value)}" autofocus></div>`,
    ok: { label: t("Card.Save"), callback: (event, button) => button.form.elements.name.value.trim() },
    rejectClose: false
  });
  return (typeof name === "string") && name ? name : null;
}

export async function createFolder(scene, parent = null) {
  const org = organizerOf(scene);
  if ( !org.canEdit() ) return null;
  const name = await askName(t("Folder.Create"), t("Folder.DefaultName"));
  if ( !name ) return null;
  const folder = { id: foundry.utils.randomID(), name, color: null, parent, sort: nextFolderSort(boardFolders(org.doc), parent) };
  await org.commit(folderCreate(folder), new Map());
  return folder;
}

export async function renameFolder(scene, id) {
  const org = organizerOf(scene);
  const folder = folderList(boardFolders(org.doc)).find(f => f.id === id);
  if ( !folder || !org.canEdit() ) return;
  const name = await askName(t("Folder.Rename"), folder.name);
  if ( name ) await org.commit(folderUpdate(id, { name }), new Map());
}

export async function moveFolder(scene, id, parent) {
  const org = organizerOf(scene);
  if ( !org.canEdit() || (id === parent) ) return;
  const folders = boardFolders(org.doc);
  if ( !canNest(folders, id, parent) ) return ui.notifications.warn(t("Folder.NoCycle"));
  await org.commit(folderUpdate(id, { parent: parent || null, sort: nextFolderSort(folders, parent) }), new Map());
}

export async function deleteFolder(scene, id) {
  const org = organizerOf(scene);
  const folders = boardFolders(org.doc);
  const folder = folderList(folders).find(f => f.id === id);
  if ( !folder || !org.canEdit() ) return;
  const ok = await DialogV2.confirm({
    window: { title: t("Folder.Delete") },
    content: `<p>${t("Folder.DeleteConfirm", { name: esc(folder.name) })}</p>`
  });
  if ( !ok ) return;
  // Sub-folders and contents move up to the folder's parent, so nothing is lost.
  const patches = new Map();
  for ( const item of org.items() ) if ( item.folder === id ) patches.set(item.id, { folder: folder.parent ?? null });
  await org.commit(folderDelete(folders, {}, id, _del), patches);
}

/** The menu of a folder row: rename, colour, new sub-folder, delete. */
export function openFolderMenu(scene, id, x, y) {
  const org = organizerOf(scene);
  if ( !org.canEdit() ) return;
  const folder = folderList(boardFolders(org.doc)).find(f => f.id === id);
  if ( !folder ) return;
  const swatches = [{ color: null, key: "none" }, ...THREAD_COLORS].map(c => `<button type="button" class="swatch${(c.color ?? null) === folder.color ? " active" : ""}"
    data-action="color" data-color="${c.color ?? ""}" style="--swatch: ${c.color ?? "transparent"}"
    aria-label="${t(c.color ? `Thread.Color.${c.key}` : "Folder.NoColor")}" data-tooltip="${t(c.color ? `Thread.Color.${c.key}` : "Folder.NoColor")}"></button>`).join("");
  const html = `<div class="dimancer-board-swatches">${swatches}</div>` + menuItems([
    { action: "rename", icon: "fa-pen", label: t("Folder.Rename") },
    { action: "sub", icon: "fa-folder-plus", label: t("Folder.CreateSub") },
    folder.parent && { action: "root", icon: "fa-arrow-turn-up", label: t("Folder.ToRoot") },
    { action: "delete", icon: "fa-trash", label: t("Folder.Delete"), danger: true }
  ]);
  showMenu(x, y, html, (action, button) => {
    switch ( action ) {
      case "color": return org.commit(folderUpdate(id, { color: button.dataset.color || null }), new Map());
      case "rename": return renameFolder(scene, id);
      case "sub": return createFolder(scene, id);
      case "root": return moveFolder(scene, id, null);
      case "delete": return deleteFolder(scene, id);
    }
  });
}

/* -------------------------------------------- */
/*  Category manager                            */
/* -------------------------------------------- */

/** Edit the board's categories: names, colours, icons, order; add and remove. */
export async function openCategoryManager(scene) {
  const org = organizerOf(scene);
  if ( !org.canEdit() ) return ui.notifications.warn(t("Notify.NoEdit"));
  const cats = categoriesOf(org);
  const counts = {};
  for ( const c of org.items() ) if ( c?.category ) counts[c.category] = (counts[c.category] ?? 0) + 1;
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.categoryManager, {
    categories: cats.map(c => ({ ...c, count: counts[c.id] ?? 0 })),
    icons: CATEGORY_ICONS.map(i => ({ value: i, label: iconLabel(i) }))
  });
  const result = await DialogV2.wait({
    window: { title: t("Category.ManageTitle"), icon: "fa-solid fa-tags" },
    classes: ["dimancer-board-categories"],
    position: { width: 460 },
    content,
    buttons: [{
      action: "save", label: t("Card.Save"), icon: "fa-solid fa-floppy-disk", default: true,
      callback: (event, button) => [...button.form.querySelectorAll(".mb-cat-list .mb-cat-row")].map(row => ({
        id: row.dataset.id || foundry.utils.randomID(),
        name: row.querySelector("[name=name]").value.trim() || t("Category.Unnamed"),
        color: row.querySelector("[name=color]").value,
        icon: row.querySelector("[name=icon]").value
      }))
    }, { action: "cancel", label: t("Add.Cancel"), icon: "fa-solid fa-xmark" }],
    rejectClose: false,
    render: (event, dialog) => activateCategoryManager(dialog.element)
  });
  if ( !Array.isArray(result) ) return;
  const previous = boardCategoriesRaw(org.doc);
  const removed = new Set(cats.map(c => c.id).filter(id => !result.some(r => r.id === id)));
  // Items whose category no longer exists lose it.
  const patches = new Map();
  for ( const item of org.items() ) if ( item.category && removed.has(item.category) ) patches.set(item.id, { category: null });
  await org.commit(categoriesUpdate(result, previous, _del), patches);
}

/** Wire the manager's add / remove / reorder buttons and live icon previews. */
function activateCategoryManager(root) {
  const list = root.querySelector(".mb-cat-list");
  // New rows are built here: dialog content is sanitised, which strips <template> elements.
  const newRow = () => {
    const li = document.createElement("li");
    li.className = "mb-cat-row";
    li.dataset.id = "";
    const options = CATEGORY_ICONS.map(i => `<option value="${i}"${i === "fa-tag" ? " selected" : ""}>${iconLabel(i)}</option>`).join("");
    li.innerHTML = `<i class="mb-cat-preview fa-solid fa-tag fa-fw" inert></i>
      <input type="color" name="color" value="#6b7280" aria-label="${t("Category.Color")}">
      <select name="icon" aria-label="${t("Category.Icon")}">${options}</select>
      <input type="text" name="name" value="" placeholder="${t("Category.NewName")}" aria-label="${t("Category.Name")}">
      <span class="mb-cat-count">0</span>
      <button type="button" class="icon fa-solid fa-chevron-up" data-cat="up" aria-label="${t("Category.Up")}"></button>
      <button type="button" class="icon fa-solid fa-chevron-down" data-cat="down" aria-label="${t("Category.Down")}"></button>
      <button type="button" class="icon fa-solid fa-trash" data-cat="remove" aria-label="${t("Category.Remove")}"></button>`;
    return li;
  };
  const wireRow = row => {
    const icon = row.querySelector("[name=icon]");
    const preview = row.querySelector(".mb-cat-preview");
    const color = row.querySelector("[name=color]");
    const sync = () => {
      preview.className = `mb-cat-preview fa-solid ${icon.value} fa-fw`;
      preview.style.color = color.value;
    };
    icon.addEventListener("change", sync);
    color.addEventListener("input", sync);
    sync();
    row.querySelector("[data-cat=remove]").addEventListener("click", () => row.remove());
    row.querySelector("[data-cat=up]").addEventListener("click", () => row.previousElementSibling?.before(row));
    row.querySelector("[data-cat=down]").addEventListener("click", () => row.nextElementSibling?.after(row));
  };
  list.querySelectorAll(".mb-cat-row").forEach(wireRow);
  root.querySelector("[data-cat=add]").addEventListener("click", () => {
    const row = newRow();
    list.append(row);
    wireRow(row);
    row.querySelector("[name=name]").focus();
  });
}
