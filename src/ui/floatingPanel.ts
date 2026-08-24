// Общая утилита для всплывающих панелей (аккаунт, тема в шапке сайдбара).
//
// Раньше эти панели были position: absolute с right: 0 внутри узкой шапки
// сайдбара — расчёт держался на том, что кнопка-триггер была последней (то
// есть самой правой) в ряду иконок. После того как слева от неё добавились
// другие кнопки (скрыть панель и т.п.), триггер сместился левее, и правый
// край панели "right: 0" стал якориться не туда — панель растягивалась
// влево от кнопки и вылезала за левый край экрана. Дополнительно у #sidebar
// стоит overflow-y: auto, из-за чего по правилам CSS Overflow браузер
// неявно клипает и overflow-x — то есть даже без выхода за экран панель
// могла бы просто обрезаться контейнером сайдбара.
//
// Чтобы больше не зависеть ни от порядка кнопок, ни от ширины сайдбара,
// позиционируем панель через position: fixed с координатами, посчитанными
// в момент открытия по фактическому месту кнопки на экране и прижатыми к
// границам окна — это гарантированно не даёт панели вылезти ни за какой
// край, независимо от того, что происходит в остальной вёрстке.
export function openFloatingPanel(trigger: HTMLElement, panel: HTMLElement, display = "flex") {
  const margin = 8;
  panel.style.visibility = "hidden";
  panel.style.display = display;
  panel.style.position = "fixed";
  panel.style.left = "0px";
  panel.style.top = "0px";
  panel.style.right = "auto";

  const btnRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();

  let left = btnRect.left;
  left = Math.min(left, window.innerWidth - panelRect.width - margin);
  left = Math.max(left, margin);

  let top = btnRect.bottom + 6;
  top = Math.min(top, window.innerHeight - panelRect.height - margin);
  top = Math.max(top, margin);

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.visibility = "visible";
}

export function closeFloatingPanel(panel: HTMLElement) {
  panel.style.display = "none";
}

export function isFloatingPanelOpen(panel: HTMLElement): boolean {
  return panel.style.display !== "none" && panel.style.display !== "";
}
