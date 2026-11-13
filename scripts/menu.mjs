/**
 * A small floating HTML menu, used by the board (cards, threads) and the evidence list (rows,
 * folders). One menu is open at a time; it closes on an outside click, Esc, or the canvas wheel.
 */

let current = null;
let lastPos = { x: 100, y: 100 };

/** A menu item list as HTML. Items: {action, icon, label, danger?, data?} */
export function menuItems(items) {
  return `<ol>${items.filter(Boolean).map(i => {
    const data = Object.entries(i.data ?? {}).map(([k, v]) => ` data-${k}="${foundry.utils.escapeHTML(String(v))}"`).join("");
    const swatch = i.color ? `<span class="mb-menu-dot" style="--swatch: ${i.color}"></span>` : "";
    const icon = i.icon ? `<i class="fa-solid ${i.icon} fa-fw" inert></i>` : "";
    return `<li><button type="button" data-action="${i.action}"${data}${i.danger ? ' class="danger"' : ""}${i.active ? ' aria-pressed="true"' : ""}>
      ${swatch}${icon}<span>${i.label}</span>${i.active ? '<i class="fa-solid fa-check mb-menu-check" inert></i>' : ""}</button></li>`;
  }).join("")}</ol>`;
}

/**
 * Show a menu at client coordinates.
 * @param {number} x
 * @param {number} y
 * @param {string} html
 * @param {(action: string, button: HTMLButtonElement) => unknown} onAction
 */
export function showMenu(x, y, html, onAction) {
  closeMenu();
  lastPos = { x, y };
  const menu = document.createElement("nav");
  menu.id = "dimancer-board-menu";
  menu.className = "dimancer-board-menu";
  menu.innerHTML = html;
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 8))}px`;

  menu.addEventListener("click", ev => {
    const button = ev.target.closest("button[data-action]");
    if ( !button ) return;
    closeMenu();
    onAction(button.dataset.action, button);
  });
  menu.addEventListener("contextmenu", ev => ev.preventDefault());
  const outside = ev => {
    if ( !menu.contains(ev.target) ) closeMenu();
  };
  const escape = ev => {
    if ( ev.key === "Escape" ) {
      ev.stopPropagation();
      closeMenu();
    }
  };
  // Defer so the click that opened the menu doesn't close it straight away.
  setTimeout(() => {
    if ( current?.menu !== menu ) return;
    document.addEventListener("pointerdown", outside, { capture: true });
    document.addEventListener("keydown", escape, { capture: true });
    canvas.app?.view?.addEventListener("wheel", outside, { passive: true });
  });
  current = {
    menu, x, y,
    cleanup: () => {
      document.removeEventListener("pointerdown", outside, { capture: true });
      document.removeEventListener("keydown", escape, { capture: true });
      canvas.app?.view?.removeEventListener("wheel", outside);
    }
  };
  return menu;
}

export function closeMenu() {
  if ( !current ) return;
  current.cleanup();
  current.menu.remove();
  current = null;
}

/** Where the last menu was opened, so a follow-up menu (e.g. a picker) can open in the same place. */
export function lastMenuPosition() {
  return { ...lastPos };
}
