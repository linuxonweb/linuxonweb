// Toolbar menu: keyboard navigation and dismissal stay independent of booting.
export function createMoreMenu({ toggle, menu, launch, action, canOpen = () => true }) {
  const menuItems = [...menu.querySelectorAll('[role="menuitem"]')];
  const availableItems = () => menuItems.filter(item => !item.hidden && !item.disabled);
  function open(value, index = 0) {
    if (value && !canOpen()) return;
    menu.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value) {
      // Align with the button, then keep the popover inside narrow viewports.
      const bounds = menu.getBoundingClientRect(), anchor = toggle.getBoundingClientRect();
      menu.style.left = `${Math.max(14, Math.min(anchor.left, innerWidth - 14 - bounds.width))}px`;
      menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, innerHeight - bounds.height - 8))}px`;
      availableItems()[index]?.focus();
    }
  }
  toggle.addEventListener('click', () => open(menu.hidden));
  toggle.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    open(true, event.key === 'ArrowUp' ? availableItems().length - 1 : 0);
  });
  menu.addEventListener('keydown', event => {
    const items = availableItems(), index = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== undefined) { event.preventDefault(); items[next].focus(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      open(false);
      toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target) && !toggle.contains(event.target)) open(false);
  });
  document.addEventListener('focusin', event => {
    if (!menu.contains(event.target) && !toggle.contains(event.target)) open(false);
  });
  for (const item of menuItems) item.addEventListener('click', event => {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); event.stopPropagation();
    open(false);
    toggle.focus();
    if (item.dataset.action || !item.href) action?.(item);
    else launch(new URL(item.href));
  });
  return { open };
}
