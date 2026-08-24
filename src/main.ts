import "./style.css";
import { db } from "./db/db";
import { applyTheme, getStoredTheme } from "./ui/theme";
import { Sidebar } from "./ui/sidebar";
import { buildToolbar } from "./ui/toolbar";
import { TextLayer } from "./ui/textLayer";
import { SelectionLayer } from "./ui/selectionLayer";
import { ImageLayer } from "./ui/imageLayer";
import { buildAccountChip } from "./ui/account";
import { icon } from "./ui/icons";
import { CanvasController } from "./draw/CanvasController";
import { paperColorInfo } from "./draw/background";
import type { ImageBlock, Notebook, Page, PageBackground, PaperColor, Section, Stroke } from "./types";

// Применяем тему синхронно, до первой отрисовки — иначе на миг мелькнёт светлая.
applyTheme(getStoredTheme());

type AuthResult =
  | { mode: "authenticated"; username: string; isAdmin: boolean }
  | { mode: "standalone" } // бэкенда логина нет вовсе (локальная сборка/dev-сервер без server/app.py) — работаем как раньше, без входа
  | { mode: "unauthenticated" }; // бэкенд есть, но сессии нет — нужно на /login.html

/** Спрашивает бэкенд (server/app.py), кто мы — см. типы AuthResult выше. */
async function checkAuth(): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch("/api/me", { credentials: "same-origin" });
  } catch {
    return { mode: "standalone" };
  }
  if (res.status === 401) return { mode: "unauthenticated" };
  if (!res.ok) return { mode: "standalone" };
  const data = (await res.json()) as { username: string; is_admin: boolean };
  return { mode: "authenticated", username: data.username, isAdmin: !!data.is_admin };
}

/**
 * Весь остальной код модуля обёрнут в async-функцию, чтобы ни строчки
 * приложения (включая чтение IndexedDB) не выполнилось раньше, чем мы
 * узнаем от сервера, кто залогинен — иначе на миг мелькнули бы чужие
 * данные из ненамespace-нутой базы, и пришлось бы гонять редирект после
 * того, как интерфейс уже частично построен.
 */
async function boot() {
  const auth = await checkAuth();
  if (auth.mode === "unauthenticated") {
    location.href = "/login.html?next=" + encodeURIComponent(location.pathname + location.search);
    return;
  }
const SIDEBAR_COLLAPSED_KEY = "sketchbook-sidebar-collapsed";
// Читаем состояние синхронно и сразу вписываем класс в разметку — иначе на
// миг мелькнула бы развёрнутая панель перед тем, как JS её схлопнёт.
let sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="layout${sidebarCollapsed ? " sidebar-collapsed" : ""}">
    <aside id="sidebar" class="sidebar"></aside>
    <main class="main">
      <header id="toolbar" class="toolbar"></header>
      <div class="page-title-bar">
        <input id="page-title" class="page-title-input" spellcheck="false" />
        <span id="save-indicator" class="save-indicator">Сохранено</span>
      </div>
      <div class="canvas-scroll">
        <div class="canvas-shadow">
          <canvas id="page-bg-canvas"></canvas>
          <div id="image-layer"></div>
          <canvas id="page-canvas"></canvas>
          <div id="text-layer"></div>
          <div id="selection-layer"></div>
        </div>
      </div>
    </main>
  </div>
  <button id="sidebar-expand" class="sidebar-expand-handle" title="Показать панель" type="button">${icon("panelShow")}</button>
`;

const layoutEl = document.querySelector<HTMLElement>(".layout")!;
const sidebarExpandBtn = document.querySelector<HTMLButtonElement>("#sidebar-expand")!;

function setSidebarCollapsed(collapsed: boolean) {
  sidebarCollapsed = collapsed;
  layoutEl.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
}

sidebarExpandBtn.addEventListener("click", () => setSidebarCollapsed(false));

const sidebarEl = document.querySelector<HTMLElement>("#sidebar")!;
const toolbarEl = document.querySelector<HTMLElement>("#toolbar")!;
const canvasShadowEl = document.querySelector<HTMLElement>(".canvas-shadow")!;
const bgCanvasEl = document.querySelector<HTMLCanvasElement>("#page-bg-canvas")!;
const canvasEl = document.querySelector<HTMLCanvasElement>("#page-canvas")!;
const textLayerEl = document.querySelector<HTMLElement>("#text-layer")!;
const imageLayerEl = document.querySelector<HTMLElement>("#image-layer")!;
const selectionLayerEl = document.querySelector<HTMLElement>("#selection-layer")!;
const titleInput = document.querySelector<HTMLInputElement>("#page-title")!;
const saveIndicator = document.querySelector<HTMLElement>("#save-indicator")!;

let controller: CanvasController | null = null;
let textLayer: TextLayer | null = null;
let selectionLayer: SelectionLayer | null = null;
let imageLayer: ImageLayer | null = null;
let currentPage: Page | null = null;
let currentSection: Section | null = null;
let saveTimer: number | undefined;

function markSaving() {
  saveIndicator.textContent = "Сохранение…";
  saveIndicator.classList.add("busy");
}
function markSaved() {
  saveIndicator.textContent = "Сохранено";
  saveIndicator.classList.remove("busy");
}

async function persistStrokes(strokes: Stroke[]) {
  markSaving();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    // Всегда перезаписываем (upsert) — не только новые штрихи, но и уже
    // существующие: их точки могли измениться (перемещение/масштаб/поворот
    // через инструмент "Выделение"). db.putStroke — upsert по id. Запросы к
    // серверу независимы друг от друга, поэтому шлём их параллельно.
    await Promise.all(strokes.map((s) => db.putStroke(s)));
    // удаляем из хранилища штрихи, которых больше нет на странице (undo/clear/ластик/удаление)
    if (currentPage) {
      const stored = await db.getStrokesByPage(currentPage.id);
      const liveIds = new Set(strokes.map((s) => s.id));
      const toDelete = stored.filter((st) => !liveIds.has(st.id));
      await Promise.all(toDelete.map((st) => db.deleteStroke(st.id)));
    }
    markSaved();
  }, 250);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImageDims(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
    img.src = src;
  });
}

// Каждая следующая вставленная за один раз картинка чуть смещена по
// диагонали от предыдущей — иначе при вставке нескольких файлов подряд
// они легли бы друг на друга ровно в одной точке.
let insertCursor = 0;

async function insertImageFromDataUrl(dataUrl: string) {
  if (!currentPage || !imageLayer) return;
  let dims: { width: number; height: number };
  try {
    dims = await loadImageDims(dataUrl);
  } catch {
    return;
  }
  // Вписываем крупные изображения в страницу (не крупнее ~55% ширины/высоты),
  // маленькие вставляем как есть — не растягиваем.
  const maxW = currentPage.width * 0.55;
  const maxH = currentPage.height * 0.55;
  const scale = Math.min(1, maxW / dims.width, maxH / dims.height);
  const width = Math.round(dims.width * scale);
  const height = Math.round(dims.height * scale);
  const offset = (insertCursor % 6) * 24;
  insertCursor++;
  const block: ImageBlock = {
    id: crypto.randomUUID(),
    pageId: currentPage.id,
    x: Math.max(0, Math.round((currentPage.width - width) / 2) + offset),
    y: Math.max(0, Math.round((currentPage.height - height) / 2) + offset),
    width,
    height,
    src: dataUrl,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  imageLayer.addBlock(block);
  await db.putImageBlock(block);
  // Сразу переключаем на инструмент "Курсор", чтобы новую картинку
  // можно было без лишних кликов подвинуть/смасштабировать.
  toolbarApi.selectTool("cursor");
}

async function insertImageFiles(files: File[]) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const dataUrl = await readFileAsDataUrl(file);
    await insertImageFromDataUrl(dataUrl);
  }
}

// Вставка изображения из буфера обмена (Ctrl+V) — работает в любом месте
// страницы независимо от активного инструмента. Если в буфере не картинка
// (а обычный текст), событие не перехватывается — обычная вставка текста
// в текстовые блоки продолжает работать как раньше.
document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items || !currentPage) return;
  const imageFiles: File[] = [];
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length === 0) return;
  e.preventDefault();
  void insertImageFiles(imageFiles);
});

async function openPage(page: Page, section: Section, _notebook: Notebook) {
  currentPage = page;
  currentSection = section;
  titleInput.value = page.title;
  // Фон под сам canvas (виден по скруглённым углам и на миг при пересоздании
  // холста) — держим синхронным с цветом бумаги, а не хардкодим белый.
  canvasShadowEl.style.background = paperColorInfo(page.paperColor).fill;

  const [strokes, textBlocks, imageBlocks] = await Promise.all([
    db.getStrokesByPage(page.id),
    db.getTextBlocksByPage(page.id),
    db.getImageBlocksByPage(page.id),
  ]);

  if (!controller) {
    controller = new CanvasController(canvasEl, bgCanvasEl, page, strokes);
    controller.onChange((s) => persistStrokes(s));
    toolbarApi.onControllerReady();
  } else {
    controller.setPage(page, strokes);
  }

  if (!textLayer) {
    textLayer = new TextLayer(textLayerEl, page, {
      onCreate: (b) => db.putTextBlock(b),
      onChange: (b) => db.putTextBlock(b),
      onDelete: (id) => db.deleteTextBlock(id),
    });
  }
  textLayer.setPage(page, textBlocks);

  if (!imageLayer) {
    imageLayer = new ImageLayer(imageLayerEl, page, {
      onChange: (b) => db.putImageBlock(b),
      onDelete: (id) => db.deleteImageBlock(id),
    });
  }
  imageLayer.setPage(page, imageBlocks);

  if (!selectionLayer) {
    selectionLayer = new SelectionLayer(selectionLayerEl, () => controller, page);
    controller.onSelectionChange(() => selectionLayer?.refresh());
  }
  selectionLayer.setPage(page);

  await db.setMeta("lastPageId", page.id);
}

titleInput.addEventListener("change", async () => {
  if (!currentPage) return;
  const title = titleInput.value.trim() || "Без названия";
  currentPage.title = title;
  currentPage.updatedAt = Date.now();
  await db.putPage(currentPage);
  await sidebar.load();
});

const sidebar = new Sidebar(sidebarEl, { onOpenPage: openPage });

{
  const actions = sidebarEl.querySelector<HTMLElement>(".sidebar-header-actions");
  if (actions) {
    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "icon-btn";
    collapseBtn.title = "Скрыть панель";
    collapseBtn.innerHTML = icon("panelHide");
    collapseBtn.addEventListener("click", () => setSidebarCollapsed(true));
    actions.insertBefore(collapseBtn, actions.firstChild);
  }
}

  if (auth.mode === "authenticated") {
    const actions = sidebarEl.querySelector<HTMLElement>(".sidebar-header-actions");
    actions?.insertBefore(buildAccountChip(auth.username, auth.isAdmin), actions.firstChild);
  }

const toolbarApi = buildToolbar(
  toolbarEl,
  () => controller,
  () => {
    if (!controller || !currentPage) return;
    const url = controller.exportPNG();
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentPage.title || "page"}.png`;
    a.click();
  },
  (tool) => {
    // "Текст" — создаёт новые блоки кликом по пустому месту ("edit");
    // "Курсор" — только двигает/меняет размер уже существующих текстовых
    // блоков и картинок, не создавая новых ("interact").
    textLayer?.setMode(tool === "text" ? "edit" : tool === "cursor" ? "interact" : "off");
    selectionLayer?.setToolActive(tool === "select");
    imageLayer?.setToolActive(tool === "cursor");
    // Видимый canvas рисования лежит в DOM НАД слоем изображений (чтобы
    // перо/маркер были видны поверх картинок — см. пояснение в
    // CanvasController). Значит, пока активен инструмент "Курсор", canvas
    // должен пропускать клики "сквозь" себя к самим картинкам — иначе их
    // было бы не двигать/масштабировать.
    canvasEl.style.pointerEvents = tool === "cursor" ? "none" : "auto";
    canvasEl.style.cursor =
      tool === "text"
        ? "text"
        : tool === "eraser"
          ? "cell"
          : tool === "select" || tool === "cursor"
            ? "default"
            : "crosshair";
    // Уводим фокус из текстового блока при переключении на инструмент, где
    // редактирование текста недоступно ("Текст" и "Курсор" — исключения:
    // в обоих можно печатать/редактировать) — иначе фокус "залипал" в
    // contenteditable и мешал горячим клавишам (Ctrl+Z и т.п.) управлять
    // холстом.
    if (tool !== "text" && tool !== "cursor") {
      const active = document.activeElement as HTMLElement | null;
      if (active && active.isContentEditable) active.blur();
    }
  },
  (bg: PageBackground) => {
    if (!controller || !currentPage) return;
    controller.setBackground(bg);
    void db.putPage(currentPage);
  },
  () => currentPage?.background ?? "blank",
  (color: PaperColor) => {
    if (!controller || !currentPage) return;
    currentPage.paperColor = color;
    controller.setPaperColor(color);
    canvasShadowEl.style.background = paperColorInfo(color).fill;
    void db.putPage(currentPage);
  },
  () => currentPage?.paperColor ?? "white",
  (files: File[]) => insertImageFiles(files)
);

sidebar.load();

void currentSection;
}

void boot();
