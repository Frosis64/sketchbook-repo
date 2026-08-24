// Слой выделения поверх canvas — как в большинстве векторных редакторов:
// рамкой можно выделить один или несколько штрихов, затем двигать (клик
// внутри рамки), менять размер/пропорции (8 хэндлов по краям — искажает
// пропорции, а не только пропорционально уменьшает), вращать (ручка над
// рамкой) или удалить (крестик у рамки / клавиша Delete).
//
// Упрощение: каждая новая трансформация (новый жест перетаскивания
// хэндла) считается от ТЕКУЩЕГО осевого габаритного прямоугольника
// выделения. Поэтому после поворота рамка на экране снова "выпрямляется"
// в осевой прямоугольник, охватывающий повёрнутый рисунок — сам рисунок
// при этом остаётся повёрнутым, меняется только форма служебной рамки.
// Полноценный трекинг угла поворота между независимыми жестами — гораздо
// более сложная задача, вне разумного объёма этой правки.

import type { CanvasController, SelectionBounds } from "../draw/CanvasController";
import type { Page } from "../types";

interface Point {
  x: number;
  y: number;
}

const HANDLE_POSITIONS = ["nw", "ne", "sw", "se", "n", "s", "e", "w"] as const;
type HandlePos = (typeof HANDLE_POSITIONS)[number];

function handleKind(pos: HandlePos): "corner" | "edge-x" | "edge-y" {
  if (pos === "n" || pos === "s") return "edge-y";
  if (pos === "e" || pos === "w") return "edge-x";
  return "corner";
}

const SVG_NS = "http://www.w3.org/2000/svg";

export class SelectionLayer {
  private container: HTMLElement;
  private getController: () => CanvasController | null;
  private page: Page;
  private toolActive = false;

  private box: HTMLElement;
  private lassoSvg: SVGSVGElement;
  private lassoPolygon: SVGPolygonElement;
  private handles: Partial<Record<HandlePos | "rotate", HTMLElement>> = {};
  private deleteBtn: HTMLButtonElement;

  constructor(container: HTMLElement, getController: () => CanvasController | null, page: Page) {
    this.container = container;
    this.getController = getController;
    this.page = page;
    this.container.className = "selection-layer";

    // Лассо рисуется пером по произвольной траектории — выделяем всё, что
    // попало внутрь. SVG <polygon> сам замыкает незамкнутый путь прямой
    // линией от последней точки к первой, что и даёт "сокращение
    // недостающего" — ровно то же самое замыкание используется и для
    // подсчёта попадания точек штрихов внутрь фигуры (см. strokesInPolygon).
    this.lassoSvg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    this.lassoSvg.setAttribute("class", "sel-lasso-svg");
    this.lassoSvg.setAttribute("preserveAspectRatio", "none");
    this.lassoPolygon = document.createElementNS(SVG_NS, "polygon") as SVGPolygonElement;
    this.lassoPolygon.setAttribute("class", "sel-lasso-shape");
    this.lassoSvg.appendChild(this.lassoPolygon);
    this.lassoSvg.style.display = "none";
    this.updateLassoViewBox();
    this.container.appendChild(this.lassoSvg);

    this.box = document.createElement("div");
    this.box.className = "sel-box";
    this.box.style.display = "none";
    this.box.addEventListener("pointerdown", (e) => {
      if (e.target !== this.box) return; // клики по хэндлам/кнопке обрабатываются отдельно
      this.startMove(e);
    });

    const stem = document.createElement("div");
    stem.className = "sel-rotate-stem";
    this.box.appendChild(stem);

    const rotate = document.createElement("div");
    rotate.className = "sel-rotate";
    rotate.title = "Вращать";
    rotate.addEventListener("pointerdown", (e) => this.startRotate(e));
    this.box.appendChild(rotate);
    this.handles.rotate = rotate;

    for (const pos of HANDLE_POSITIONS) {
      const h = document.createElement("div");
      h.className = `sel-handle sel-handle-${pos}`;
      h.addEventListener("pointerdown", (e) => this.startScale(e, pos));
      this.box.appendChild(h);
      this.handles[pos] = h;
    }

    this.deleteBtn = document.createElement("button");
    this.deleteBtn.className = "sel-delete";
    this.deleteBtn.textContent = "×";
    this.deleteBtn.title = "Удалить выделенное";
    this.deleteBtn.onmousedown = (e) => e.preventDefault();
    this.deleteBtn.onclick = () => this.getController()?.deleteSelected();
    this.box.appendChild(this.deleteBtn);

    this.container.appendChild(this.box);
    this.container.addEventListener("pointerdown", this.handleContainerPointerDown);
  }

  setPage(page: Page) {
    this.page = page;
    this.hideBox();
    this.updateLassoViewBox();
  }

  private updateLassoViewBox() {
    this.lassoSvg.setAttribute("viewBox", `0 0 ${this.page.width} ${this.page.height}`);
  }

  setToolActive(active: boolean) {
    this.toolActive = active;
    this.container.classList.toggle("tool-active", active);
    if (!active) {
      this.getController()?.clearSelection();
      this.hideBox();
    }
  }

  /** Вызывается контроллером при изменении выделения (в т.ч. после commitTransform). */
  refresh() {
    const bounds = this.getController()?.getSelectionBounds() ?? null;
    if (!bounds) {
      this.hideBox();
      return;
    }
    this.showBoxAt(bounds);
  }

  private hideBox() {
    this.box.style.display = "none";
  }

  private showBoxAt(b: SelectionBounds) {
    this.box.style.display = "block";
    this.box.style.left = `${b.x}px`;
    this.box.style.top = `${b.y}px`;
    this.box.style.width = `${b.w}px`;
    this.box.style.height = `${b.h}px`;
  }

  private toLocal(clientX: number, clientY: number): Point {
    const rect = this.container.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.page.width,
      y: ((clientY - rect.top) / rect.height) * this.page.height,
    };
  }

  private handleContainerPointerDown = (e: PointerEvent) => {
    if (!this.toolActive) return;
    if (e.target !== this.container) return; // клики по рамке/хэндлам не должны запускать рамку выделения
    const c = this.getController();
    if (!c) return;
    const local = this.toLocal(e.clientX, e.clientY);
    const hitId = c.hitTestStroke(local.x, local.y);
    if (hitId) {
      c.setSelection([hitId]);
      this.refresh();
      this.startMove(e);
      return;
    }
    c.clearSelection();
    this.hideBox();
    this.startLasso(e);
  };

  /**
   * Выделение произвольной area пером: ведём путь за пальцем/пером, при
   * отпускании незамкнутый конец автоматически "дорисовывается" прямой
   * линией обратно к началу (это делает сам SVG <polygon>), и всё, что
   * попало внутрь получившейся фигуры, выделяется.
   */
  private startLasso(e: PointerEvent) {
    const points: Point[] = [this.toLocal(e.clientX, e.clientY)];
    this.lassoSvg.style.display = "block";
    this.updateLassoShape(points);
    this.container.setPointerCapture(e.pointerId);

    const MIN_STEP = 2.5; // лог. пикселей — не копим точку на каждый микро-сдвиг
    const onMove = (ev: PointerEvent) => {
      const p = this.toLocal(ev.clientX, ev.clientY);
      const last = points[points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= MIN_STEP) {
        points.push(p);
        this.updateLassoShape(points);
      }
    };
    const onUp = () => {
      this.container.removeEventListener("pointermove", onMove);
      this.container.removeEventListener("pointerup", onUp);
      this.lassoSvg.style.display = "none";
      const c = this.getController();
      if (c && points.length >= 3) {
        const ids = c.strokesInPolygon(points);
        if (ids.length) c.setSelection(ids);
      }
      this.refresh();
    };
    this.container.addEventListener("pointermove", onMove);
    this.container.addEventListener("pointerup", onUp);
  }

  private updateLassoShape(points: Point[]) {
    this.lassoPolygon.setAttribute("points", points.map((p) => `${p.x},${p.y}`).join(" "));
  }

  private startMove(e: PointerEvent) {
    const c = this.getController();
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    const bounds = c.getSelectionBounds();
    if (!bounds) return;
    c.beginTransform();
    const start = this.toLocal(e.clientX, e.clientY);
    this.box.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const cur = this.toLocal(ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      c.applyTransform((p) => ({ x: p.x + dx, y: p.y + dy }));
      this.showBoxAt({ x: bounds.x + dx, y: bounds.y + dy, w: bounds.w, h: bounds.h });
    };
    const onUp = () => {
      this.box.removeEventListener("pointermove", onMove);
      this.box.removeEventListener("pointerup", onUp);
      c.commitTransform();
      this.refresh();
    };
    this.box.addEventListener("pointermove", onMove);
    this.box.addEventListener("pointerup", onUp);
  }

  private startScale(e: PointerEvent, pos: HandlePos) {
    const c = this.getController();
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    const bounds = c.getSelectionBounds();
    if (!bounds) return;
    c.beginTransform();

    const kind = handleKind(pos);
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const anchor: Point = {
      x: pos.includes("w") ? bounds.x + bounds.w : pos.includes("e") ? bounds.x : cx,
      y: pos.includes("n") ? bounds.y + bounds.h : pos.includes("s") ? bounds.y : cy,
    };
    const startPoint: Point = {
      x: pos.includes("w") ? bounds.x : pos.includes("e") ? bounds.x + bounds.w : cx,
      y: pos.includes("n") ? bounds.y : pos.includes("s") ? bounds.y + bounds.h : cy,
    };

    const handle = this.handles[pos]!;
    handle.setPointerCapture(e.pointerId);
    const MIN_SCALE = 0.06;

    const onMove = (ev: PointerEvent) => {
      const cur = this.toLocal(ev.clientX, ev.clientY);
      let sx = 1;
      let sy = 1;
      if (kind !== "edge-y") {
        const denom = startPoint.x - anchor.x;
        sx = Math.abs(denom) < 1 ? 1 : (cur.x - anchor.x) / denom;
        if (Math.abs(sx) < MIN_SCALE) sx = MIN_SCALE * (sx < 0 ? -1 : 1);
      }
      if (kind !== "edge-x") {
        const denom = startPoint.y - anchor.y;
        sy = Math.abs(denom) < 1 ? 1 : (cur.y - anchor.y) / denom;
        if (Math.abs(sy) < MIN_SCALE) sy = MIN_SCALE * (sy < 0 ? -1 : 1);
      }
      c.applyTransform((p) => ({
        x: anchor.x + (p.x - anchor.x) * sx,
        y: anchor.y + (p.y - anchor.y) * sy,
      }));

      const corners = [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.w, y: bounds.y },
        { x: bounds.x, y: bounds.y + bounds.h },
        { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
      ].map((p) => ({ x: anchor.x + (p.x - anchor.x) * sx, y: anchor.y + (p.y - anchor.y) * sy }));
      const minX = Math.min(...corners.map((p) => p.x));
      const maxX = Math.max(...corners.map((p) => p.x));
      const minY = Math.min(...corners.map((p) => p.y));
      const maxY = Math.max(...corners.map((p) => p.y));
      this.showBoxAt({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      c.commitTransform();
      this.refresh();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  private startRotate(e: PointerEvent) {
    const c = this.getController();
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    const bounds = c.getSelectionBounds();
    if (!bounds) return;
    c.beginTransform();

    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const start = this.toLocal(e.clientX, e.clientY);
    const startAngle = Math.atan2(start.y - cy, start.x - cx);
    const handle = this.handles.rotate!;
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const cur = this.toLocal(ev.clientX, ev.clientY);
      const angle = Math.atan2(cur.y - cy, cur.x - cx) - startAngle;
      c.applyTransform((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        return {
          x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
          y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
        };
      });
      this.box.style.transform = `rotate(${angle}rad)`;
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      this.box.style.transform = "";
      c.commitTransform();
      this.refresh();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }
}
