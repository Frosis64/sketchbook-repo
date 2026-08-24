// Слой текстовых блоков поверх страницы — как надписи в OneNote/Google Docs:
// можно кликнуть текстовым инструментом в любом месте страницы, появится
// редактируемый блок с всплывающей панелью форматирования (жирный, курсив,
// подчёркнутый, размер, цвет, заголовок). Блок можно перетаскивать за
// "ручку" и менять размер за уголок.

import type { Page, TextBlock } from "../types";

export interface TextLayerCallbacks {
  onChange: (block: TextBlock) => void;
  onDelete: (id: string) => void;
  onCreate: (block: TextBlock) => void;
}

// "off" — инструмент не активен, слой полностью прозрачен для кликов
//   (не мешает рисованию/другим инструментам).
// "edit" — активен инструмент "Текст": клик по пустому месту страницы
//   создаёт новый блок, существующие блоки перетаскиваются/редактируются.
// "interact" — активен инструмент "Курсор": клик по пустому месту НИЧЕГО
//   не создаёт и проваливается ниже (к картинкам/холсту), но уже
//   существующие текстовые блоки по-прежнему можно двигать/менять размер/
//   редактировать — как и в режиме "edit".
type Mode = "off" | "edit" | "interact";

const MIN_WIDTH = 120;
const MIN_HEIGHT = 36;

export class TextLayer {
  private container: HTMLElement;
  private page: Page;
  private cb: TextLayerCallbacks;
  private blocks = new Map<string, { block: TextBlock; el: HTMLElement; content: HTMLElement }>();
  private mode: Mode = "off";
  private saveTimers = new Map<string, number>();
  private toolbar: HTMLElement;

  constructor(container: HTMLElement, page: Page, cb: TextLayerCallbacks) {
    this.container = container;
    this.page = page;
    this.cb = cb;
    this.container.className = "text-layer";
    this.container.addEventListener("pointerdown", this.handleContainerPointerDown);
    this.toolbar = this.buildToolbar();
    document.body.appendChild(this.toolbar);
  }

  setMode(mode: Mode) {
    this.mode = mode;
    this.container.classList.toggle("editable", mode === "edit");
    this.container.classList.toggle("interactive", mode === "interact");
  }

  setPage(page: Page, blocks: TextBlock[]) {
    this.page = page;
    this.container.innerHTML = "";
    this.blocks.clear();
    this.hideToolbar();
    for (const b of blocks) this.renderBlock(b);
  }

  private handleContainerPointerDown = (e: PointerEvent) => {
    if (this.mode !== "edit") return; // создание новых блоков — только в режиме инструмента "Текст"
    if (e.target !== this.container) return; // клик по существующему блоку — не создаём новый
    const rect = this.container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.page.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.page.height;
    const block: TextBlock = {
      id: crypto.randomUUID(),
      pageId: this.page.id,
      x: Math.max(0, x - 100),
      y: Math.max(0, y - 18),
      width: 220,
      height: 44,
      html: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.renderBlock(block);
    this.cb.onCreate(block);
    const entry = this.blocks.get(block.id);
    entry?.content.focus();
  };

  private renderBlock(block: TextBlock) {
    const el = document.createElement("div");
    el.className = "text-block";
    el.style.left = `${block.x}px`;
    el.style.top = `${block.y}px`;
    el.style.width = `${block.width}px`;
    el.style.height = `${block.height}px`;

    const grip = document.createElement("div");
    grip.className = "text-block-grip";
    grip.textContent = "⠿";
    grip.title = "Переместить";

    const content = document.createElement("div");
    content.className = "text-block-content";
    content.contentEditable = "true";
    content.spellcheck = false;
    content.innerHTML = block.html;

    const resize = document.createElement("div");
    resize.className = "text-block-resize";

    const del = document.createElement("button");
    del.className = "text-block-delete";
    del.textContent = "×";
    del.title = "Удалить текстовый блок";
    del.onmousedown = (e) => e.preventDefault();
    del.onclick = () => {
      el.remove();
      this.blocks.delete(block.id);
      this.cb.onDelete(block.id);
      this.hideToolbar();
    };

    el.appendChild(grip);
    el.appendChild(content);
    el.appendChild(resize);
    el.appendChild(del);
    this.container.appendChild(el);
    this.blocks.set(block.id, { block, el, content });

    content.addEventListener("focus", () => this.showToolbarFor(block.id));
    content.addEventListener("input", () => {
      block.html = content.innerHTML;
      block.updatedAt = Date.now();
      this.scheduleSave(block);
    });
    content.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!this.toolbar.contains(document.activeElement)) this.hideToolbar();
      }, 120);
    });

    this.makeDraggable(grip, el, block);
    this.makeResizable(resize, el, block);
  }

  private scheduleSave(block: TextBlock) {
    const prev = this.saveTimers.get(block.id);
    if (prev) window.clearTimeout(prev);
    const timer = window.setTimeout(() => {
      this.cb.onChange(block);
      this.saveTimers.delete(block.id);
    }, 300);
    this.saveTimers.set(block.id, timer);
  }

  private makeDraggable(grip: HTMLElement, el: HTMLElement, block: TextBlock) {
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = block.x;
      const startTop = block.y;
      const rect = this.container.getBoundingClientRect();
      const scaleX = this.page.width / rect.width;
      const scaleY = this.page.height / rect.height;

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) * scaleX;
        const dy = (ev.clientY - startY) * scaleY;
        block.x = Math.max(0, startLeft + dx);
        block.y = Math.max(0, startTop + dy);
        el.style.left = `${block.x}px`;
        el.style.top = `${block.y}px`;
      };
      const onUp = () => {
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        block.updatedAt = Date.now();
        this.cb.onChange(block);
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
    });
  }

  private makeResizable(handle: HTMLElement, el: HTMLElement, block: TextBlock) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = block.width;
      const startH = block.height;
      const rect = this.container.getBoundingClientRect();
      const scaleX = this.page.width / rect.width;
      const scaleY = this.page.height / rect.height;

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) * scaleX;
        const dy = (ev.clientY - startY) * scaleY;
        block.width = Math.max(MIN_WIDTH, startW + dx);
        block.height = Math.max(MIN_HEIGHT, startH + dy);
        el.style.width = `${block.width}px`;
        el.style.height = `${block.height}px`;
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        block.updatedAt = Date.now();
        this.cb.onChange(block);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  }

  private buildToolbar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "text-format-toolbar";

    const mkBtn = (label: string, title: string, run: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.onmousedown = (e) => e.preventDefault(); // не терять фокус/выделение в contenteditable
      b.onclick = run;
      return b;
    };

    bar.appendChild(mkBtn("B", "Жирный", () => document.execCommand("bold")));
    bar.appendChild(mkBtn("I", "Курсив", () => document.execCommand("italic")));
    bar.appendChild(mkBtn("U", "Подчёркнутый", () => document.execCommand("underline")));
    bar.appendChild(
      mkBtn("H", "Заголовок / обычный текст", () => {
        const isHeading = document.queryCommandValue("formatBlock").toLowerCase() === "h2";
        document.execCommand("formatBlock", false, isHeading ? "p" : "h2");
      })
    );

    const sizeSelect = document.createElement("select");
    sizeSelect.title = "Размер текста";
    [
      ["2", "Мелкий"],
      ["3", "Обычный"],
      ["5", "Крупный"],
      ["7", "Огромный"],
    ].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      sizeSelect.appendChild(opt);
    });
    sizeSelect.value = "3";
    sizeSelect.onmousedown = (e) => e.stopPropagation();
    sizeSelect.onchange = () => document.execCommand("fontSize", false, sizeSelect.value);
    bar.appendChild(sizeSelect);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.title = "Цвет текста";
    colorInput.value = "#1f2430";
    colorInput.onmousedown = (e) => e.stopPropagation();
    colorInput.oninput = () => document.execCommand("foreColor", false, colorInput.value);
    bar.appendChild(colorInput);

    return bar;
  }

  private showToolbarFor(blockId: string) {
    const entry = this.blocks.get(blockId);
    if (!entry) return;
    // Панель закреплена по центру, сразу под основной панелью инструментов
    // (а не рядом с блоком) — так её проще найти и она никогда не улетает
    // за край экрана, если блок у самого верха или края страницы.
    const mainToolbar = document.getElementById("toolbar");
    const top = mainToolbar ? mainToolbar.getBoundingClientRect().bottom + 8 : 54;
    this.toolbar.style.display = "flex";
    this.toolbar.style.top = `${top}px`;
  }

  private hideToolbar() {
    this.toolbar.style.display = "none";
  }
}
