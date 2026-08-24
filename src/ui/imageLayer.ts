// Слой вставленных изображений поверх страницы — как картинки в OneNote/Word:
// вставляются через Ctrl+V или кнопку в тулбаре, плавают над страницей,
// перетаскиваются мышью/пером прямо за саму картинку и масштабируются за
// уголок с сохранением пропорций (чтобы изображение не "плющило").

import type { ImageBlock, Page } from "../types";

export interface ImageLayerCallbacks {
  onChange: (block: ImageBlock) => void;
  onDelete: (id: string) => void;
}

const MIN_SIZE = 30;

export class ImageLayer {
  private container: HTMLElement;
  private page: Page;
  private cb: ImageLayerCallbacks;
  private blocks = new Map<string, { block: ImageBlock; el: HTMLElement }>();

  constructor(container: HTMLElement, page: Page, cb: ImageLayerCallbacks) {
    this.container = container;
    this.page = page;
    this.cb = cb;
    this.container.className = "image-layer";
  }

  setToolActive(active: boolean) {
    this.container.classList.toggle("tool-active", active);
  }

  setPage(page: Page, blocks: ImageBlock[]) {
    this.page = page;
    this.container.innerHTML = "";
    this.blocks.clear();
    for (const b of blocks) this.renderBlock(b);
  }

  /** Добавляет новый блок изображения (после вставки из буфера/файла) и уведомляет о создании. */
  addBlock(block: ImageBlock) {
    this.renderBlock(block);
  }

  private renderBlock(block: ImageBlock) {
    const el = document.createElement("div");
    el.className = "image-block";
    el.style.left = `${block.x}px`;
    el.style.top = `${block.y}px`;
    el.style.width = `${block.width}px`;
    el.style.height = `${block.height}px`;

    const img = document.createElement("img");
    img.src = block.src;
    img.draggable = false;
    img.alt = "";

    const resize = document.createElement("div");
    resize.className = "image-block-resize";
    resize.title = "Изменить размер (пропорции сохраняются)";

    const del = document.createElement("button");
    del.className = "image-block-delete";
    del.textContent = "×";
    del.title = "Удалить изображение";
    del.onpointerdown = (e) => e.stopPropagation();
    del.onclick = () => {
      el.remove();
      this.blocks.delete(block.id);
      this.cb.onDelete(block.id);
    };

    el.appendChild(img);
    el.appendChild(resize);
    el.appendChild(del);
    this.container.appendChild(el);
    this.blocks.set(block.id, { block, el });

    this.makeDraggable(el, block);
    this.makeResizable(resize, el, block);
  }

  /** Перетаскивание — клик прямо по картинке (не по уголку/крестику удаления). */
  private makeDraggable(el: HTMLElement, block: ImageBlock) {
    el.addEventListener("pointerdown", (e) => {
      // Клики по ручке изменения размера/кнопке удаления обрабатываются
      // их собственными обработчиками — сюда не должны попадать.
      if (e.target !== el && !(e.target as HTMLElement).matches("img")) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
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
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.classList.remove("dragging");
        block.updatedAt = Date.now();
        this.cb.onChange(block);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
    });
  }

  /** Изменение размера за уголок — пропорции всегда сохраняются, чтобы картинка не искажалась. */
  private makeResizable(handle: HTMLElement, el: HTMLElement, block: ImageBlock) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = block.width;
      const startH = block.height;
      const aspect = startW / startH || 1;
      const rect = this.container.getBoundingClientRect();
      const scaleX = this.page.width / rect.width;

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) * scaleX;
        let newW = Math.max(MIN_SIZE, startW + dx);
        let newH = newW / aspect;
        if (newH < MIN_SIZE) {
          newH = MIN_SIZE;
          newW = newH * aspect;
        }
        block.width = newW;
        block.height = newH;
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
}
