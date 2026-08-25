// Контроллер холста: обрабатывает Pointer Events (в т.ч. давление/наклон
// пера графического планшета), ведёт текущий штрих, историю действий
// для undo/redo, выделение объектов с трансформацией, и уведомляет
// вызывающий код об изменениях для автосохранения.
//
// Схема рендера (все canvas — одинакового пиксельного размера):
//  - bgCanvas — ТОЛЬКО фон страницы (цвет бумаги + сетка/линия/точки).
//    Отдельный элемент под слоем изображений в DOM (main.ts), перерисовывается
//    лишь при смене фона/цвета бумаги/размера страницы.
//  - baseCanvas — зафиксированные штрихи (прозрачный фон!), пересчитывается
//    только при commit/undo/redo/clear/смене страницы.
//  - scratchCanvas — временный буфер: сюда штрих красится ПОЛНОСТЬЮ
//    непрозрачным (см. render.ts), а затем одним drawImage переносится
//    либо на baseCanvas, либо на видимый canvas — уже с нужной
//    прозрачностью. Это даёт корректную прозрачность (без сложения альфы)
//    и высокую производительность (дорисовывается только новый кусочек).
//  - canvas (видимый) — на каждый кадр: base + (в зависимости от режима)
//    текущий рисуемый штрих ИЛИ живой предпросмотр трансформации выделения.
//    Он прозрачен там, где нет штрихов — это специально: видимый canvas
//    в DOM размещён НАД слоем вставленных изображений (image-layer), а
//    bgCanvas со сплошной заливкой — под ним. Так перо/маркер видимо рисуют
//    поверх картинок, а сама бумага/сетка остаются под картинками.
//
// Сглаживание пера (как в Whiteboard): входящие "сырые" координаты пера
// перед добавлением в штрих проходят через экспоненциальный фильтр
// (exponential moving average) — чем выше settings.smoothing, тем сильнее
// линия "не успевает" за резкими движениями руки и тем она глаже.

import type { Page, Stroke, StrokePoint, ToolType } from "../types";
import { backgroundPattern } from "./background";
import { paintStrokeIncrement, paintStrokeOpaque } from "./render";
import { smoothStrokePoints } from "./curve";

export interface ToolSettings {
  tool: ToolType;
  color: string;
  size: number; // базовая толщина в лог. пикселях
  opacity: number;
  smoothing: number; // 0..1 — сила сглаживания линии пера/маркера
}

export interface SelectionBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

type ChangeListener = (strokes: Stroke[]) => void;
type SelectionListener = () => void;

type Action =
  | { type: "add"; stroke: Stroke }
  | { type: "erase"; strokes: Stroke[] }
  | { type: "clear"; strokes: Stroke[] }
  | { type: "transform"; before: Map<string, StrokePoint[]>; after: Map<string, StrokePoint[]> };

const PALM_REJECTION_WINDOW_MS = 700;

function pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export class CanvasController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bgCanvas: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private baseCanvas: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private scratchCanvas: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
  private page: Page;
  private dpr = Math.max(1, window.devicePixelRatio || 1);

  private strokes: Stroke[] = [];
  private history: Action[] = [];
  private future: Action[] = [];

  private current: Stroke | null = null;
  private paintedCount = 0;
  private lastRawPoint: StrokePoint | null = null;
  private activePointerId: number | null = null;
  private lastPenTime = 0;

  private erasing = false;
  private erasedThisDrag: Stroke[] = [];

  // ---- Выделение и трансформация ----
  private selectedIds = new Set<string>();
  private transformSnapshot: Map<string, StrokePoint[]> | null = null;
  private transforming = false;
  private dragBaseCanvas: HTMLCanvasElement | null = null;
  private dragBaseCtx: CanvasRenderingContext2D | null = null;

  private listeners: ChangeListener[] = [];
  private selectionListeners: SelectionListener[] = [];

  settings: ToolSettings = { tool: "pen", color: "#1f2430", size: 3, opacity: 1, smoothing: 0.45 };

  constructor(canvas: HTMLCanvasElement, bgCanvas: HTMLCanvasElement, page: Page, initialStrokes: Stroke[]) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not available");
    this.ctx = ctx;

    this.bgCanvas = bgCanvas;
    const bgCtx = bgCanvas.getContext("2d");
    if (!bgCtx) throw new Error("2D context not available");
    this.bgCtx = bgCtx;

    this.baseCanvas = document.createElement("canvas");
    const baseCtx = this.baseCanvas.getContext("2d");
    if (!baseCtx) throw new Error("2D context not available");
    this.baseCtx = baseCtx;

    this.scratchCanvas = document.createElement("canvas");
    const scratchCtx = this.scratchCanvas.getContext("2d");
    if (!scratchCtx) throw new Error("2D context not available");
    this.scratchCtx = scratchCtx;

    this.page = page;
    this.strokes = initialStrokes;

    this.resizeCanvas();
    this.attachEvents();
    this.paintBackground();
    this.rebuildBase();
    this.render();
  }

  onChange(fn: ChangeListener) {
    this.listeners.push(fn);
  }

  private emitChange() {
    for (const l of this.listeners) l(this.strokes);
  }

  onSelectionChange(fn: SelectionListener) {
    this.selectionListeners.push(fn);
  }

  private emitSelectionChange() {
    for (const l of this.selectionListeners) l();
  }

  setPage(page: Page, strokes: Stroke[]) {
    this.page = page;
    this.strokes = strokes;
    this.history = [];
    this.future = [];
    this.current = null;
    this.paintedCount = 0;
    this.selectedIds.clear();
    this.transformSnapshot = null;
    this.transforming = false;
    this.dragBaseCanvas = null;
    this.resizeCanvas();
    this.paintBackground();
    this.rebuildBase();
    this.render();
    this.emitSelectionChange();
  }

  /** Меняет фон текущей страницы (сетка/линия/точки + размер) без сброса штрихов. */
  setBackground(background: Page["background"]) {
    this.page.background = background;
    this.paintBackground();
  }

  /** Меняет цвет бумаги страницы (белая/тёмно-серая/чёрная) без сброса штрихов. */
  setPaperColor(paperColor: Page["paperColor"]) {
    this.page.paperColor = paperColor;
    this.paintBackground();
  }

  private resizeCanvas() {
    const { width, height } = this.page;
    const pw = Math.round(width * this.dpr);
    const ph = Math.round(height * this.dpr);

    for (const [cv, ctx] of [
      [this.canvas, this.ctx],
      [this.bgCanvas, this.bgCtx],
      [this.baseCanvas, this.baseCtx],
      [this.scratchCanvas, this.scratchCtx],
    ] as const) {
      cv.width = pw;
      cv.height = ph;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.bgCanvas.style.width = `${width}px`;
    this.bgCanvas.style.height = `${height}px`;
  }

  /** Перерисовывает отдельный canvas фона страницы (бумага + сетка/линия/точки). */
  private paintBackground() {
    this.bgCtx.save();
    this.bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.bgCtx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
    this.bgCtx.restore();
    backgroundPattern(this.page.background, this.page.paperColor).pattern(this.bgCtx, this.page.width, this.page.height);
  }

  /** Очищает scratch-буфер (в device-пикселях, независимо от текущей трансформации). */
  private clearScratch() {
    this.scratchCtx.save();
    this.scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.scratchCtx.clearRect(0, 0, this.scratchCanvas.width, this.scratchCanvas.height);
    this.scratchCtx.restore();
  }

  /** Один в один (без трансформаций) переносит содержимое scratch на dest с заданной альфой. */
  private compositeScratchOnto(destCtx: CanvasRenderingContext2D, opacity: number) {
    destCtx.save();
    destCtx.setTransform(1, 0, 0, 1, 0, 0);
    destCtx.globalAlpha = opacity;
    destCtx.globalCompositeOperation = "source-over";
    destCtx.drawImage(this.scratchCanvas, 0, 0);
    destCtx.restore();
  }

  /** Рисует список штрихов "с нуля" на прозрачном фоне (используется и для base, и для drag-base). */
  private paintStrokesInto(destCtx: CanvasRenderingContext2D, destCanvas: HTMLCanvasElement, list: Stroke[]) {
    destCtx.save();
    destCtx.setTransform(1, 0, 0, 1, 0, 0);
    destCtx.clearRect(0, 0, destCanvas.width, destCanvas.height);
    destCtx.restore();

    for (const s of list) {
      this.clearScratch();
      paintStrokeOpaque(this.scratchCtx, s);
      this.compositeScratchOnto(destCtx, s.opacity);
    }
    this.clearScratch();
  }

  private rebuildBase() {
    this.paintStrokesInto(this.baseCtx, this.baseCanvas, this.strokes);
  }

  private attachEvents() {
    const c = this.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.handlePointerDown);
    c.addEventListener("pointermove", this.handlePointerMove);
    c.addEventListener("pointerup", this.handlePointerUp);
    c.addEventListener("pointercancel", this.handlePointerUp);
  }

  destroy() {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.handlePointerDown);
    c.removeEventListener("pointermove", this.handlePointerMove);
    c.removeEventListener("pointerup", this.handlePointerUp);
    c.removeEventListener("pointercancel", this.handlePointerUp);
  }

  private toLocalPoint(e: PointerEvent): StrokePoint {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.page.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.page.height;
    let pressure = e.pressure;
    if (!pressure || pressure === 0) {
      pressure = 0.5; // мышь/трекпад без давления
    }
    return {
      x,
      y,
      pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      t: performance.now(),
    };
  }

  /**
   * Экспоненциальное сглаживание (как ink smoothing в Microsoft Whiteboard):
   * новая точка подтягивается к предыдущей уже сглаженной точке. При
   * smoothing=0 — точка не меняется (сырой ввод); при smoothing→1 линия
   * сильно "запаздывает" за пером, сглаживая дрожание руки.
   */
  private smoothPoint(raw: StrokePoint): StrokePoint {
    if (!this.current || this.current.points.length === 0) return raw;
    const smoothing = Math.max(0, Math.min(1, this.settings.smoothing));
    const alpha = 1 - smoothing * 0.88;
    const prev = this.current.points[this.current.points.length - 1];
    return {
      x: prev.x + (raw.x - prev.x) * alpha,
      y: prev.y + (raw.y - prev.y) * alpha,
      pressure: prev.pressure + (raw.pressure - prev.pressure) * alpha,
      tiltX: raw.tiltX,
      tiltY: raw.tiltY,
      t: raw.t,
    };
  }

  private shouldRejectAsPalm(e: PointerEvent): boolean {
    // Простое отклонение касаний ладонью: если недавно рисовали пером,
    // игнорируем одновременные touch-события в течение короткого окна.
    if (e.pointerType === "pen") {
      this.lastPenTime = performance.now();
      return false;
    }
    if (e.pointerType === "touch") {
      return performance.now() - this.lastPenTime < PALM_REJECTION_WINDOW_MS;
    }
    return false;
  }

  private handlePointerDown = (e: PointerEvent) => {
    // Текстовым тулом управляет text-layer, инструментом "Выделение" —
    // selection-layer, инструментом "Курсор" — image-layer/text-layer.
    if (this.settings.tool === "text" || this.settings.tool === "select" || this.settings.tool === "cursor") return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (this.shouldRejectAsPalm(e)) return;
    if (this.activePointerId !== null) return;

    this.activePointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);

    if (this.settings.tool === "eraser") {
      this.erasing = true;
      this.erasedThisDrag = [];
      this.eraseAt(this.toLocalPoint(e));
      e.preventDefault();
      return;
    }

    const { tool, color, size, opacity } = this.settings;
    const first = this.toLocalPoint(e);
    this.lastRawPoint = first;
    this.current = {
      id: crypto.randomUUID(),
      pageId: this.page.id,
      tool,
      color,
      baseWidth: tool === "highlighter" ? size * 3.2 : size,
      opacity: tool === "highlighter" ? 0.35 : opacity,
      points: [first],
      createdAt: Date.now(),
    };
    this.clearScratch();
    paintStrokeIncrement(this.scratchCtx, this.current, 0);
    this.paintedCount = 1;
    this.render();
    e.preventDefault();
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointerId) return;

    if (this.erasing) {
      this.eraseAt(this.toLocalPoint(e));
      e.preventDefault();
      return;
    }

    if (!this.current) return;
    const raw = this.toLocalPoint(e);
    this.lastRawPoint = raw;
    this.current.points.push(this.smoothPoint(raw));
    paintStrokeIncrement(this.scratchCtx, this.current, this.paintedCount);
    this.paintedCount = this.current.points.length;
    this.render();
    e.preventDefault();
  };

  private eraseRadius(): number {
    return Math.max(8, this.settings.size * 4);
  }

  private eraseAt(point: StrokePoint) {
    const radius = this.eraseRadius();
    const remaining: Stroke[] = [];
    for (const s of this.strokes) {
      let hit = false;
      for (const p of s.points) {
        if (Math.hypot(p.x - point.x, p.y - point.y) <= radius + s.baseWidth / 2) {
          hit = true;
          break;
        }
      }
      if (hit) this.erasedThisDrag.push(s);
      else remaining.push(s);
    }
    if (remaining.length !== this.strokes.length) {
      this.strokes = remaining;
      this.rebuildBase();
      this.render();
      this.emitChange();
    }
  }

  private finishStroke() {
    if (this.erasing) {
      this.erasing = false;
      if (this.erasedThisDrag.length > 0) {
        this.history.push({ type: "erase", strokes: this.erasedThisDrag });
        this.future = [];
      }
      this.erasedThisDrag = [];
      this.activePointerId = null;
      return;
    }

    if (!this.current) return;
    // Сглаженная линия чуть "запаздывает" за реальным положением пера —
    // довешиваем последнюю сырую точку без сглаживания, чтобы штрих
    // заканчивался ровно там, где подняли перо, а не немного не доходя.
    if (this.lastRawPoint) {
      const last = this.current.points[this.current.points.length - 1];
      if (Math.hypot(last.x - this.lastRawPoint.x, last.y - this.lastRawPoint.y) > 0.5) {
        this.current.points.push(this.lastRawPoint);
        paintStrokeIncrement(this.scratchCtx, this.current, this.paintedCount);
        this.paintedCount = this.current.points.length;
      }
    }
    if (this.current.points.length >= 1) {
      // Насыщаем штрих промежуточными точками по сплайну Catmull-Rom —
      // иначе быстро нарисованная кривая (например, окружность от руки)
      // выглядит гранёной: pointermove срабатывает тем реже, чем быстрее
      // движение, и прямые отрезки между редкими точками становятся
      // заметны на изгибах (см. curve.ts). Пересчитываем один раз по
      // завершении штриха и перерисовываем scratch заново уже плотными
      // точками — во время самого рисования используется более редкая
      // "сырая" трасса ради отзывчивости.
      this.current.points = smoothStrokePoints(this.current.points);
      this.strokes.push(this.current);
      this.history.push({ type: "add", stroke: this.current });
      this.future = [];
      this.clearScratch();
      paintStrokeOpaque(this.scratchCtx, this.current);
      this.compositeScratchOnto(this.baseCtx, this.current.opacity);
      this.emitChange();
    }
    this.clearScratch();
    this.current = null;
    this.paintedCount = 0;
    this.lastRawPoint = null;
    this.activePointerId = null;
    this.render();
  }

  private handlePointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointerId) return;
    this.finishStroke();
  };

  render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.transforming && this.dragBaseCanvas) {
      ctx.drawImage(this.dragBaseCanvas, 0, 0);
      for (const s of this.getSelectedStrokes()) {
        this.clearScratch();
        paintStrokeOpaque(this.scratchCtx, s); // текущие (уже трансформированные) точки
        this.compositeScratchOnto(ctx, s.opacity);
      }
    } else {
      ctx.drawImage(this.baseCanvas, 0, 0);
      if (this.current) {
        ctx.globalAlpha = this.current.opacity;
        ctx.drawImage(this.scratchCanvas, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  undo() {
    const a = this.history.pop();
    if (!a) return;
    if (a.type === "add") {
      const idx = this.strokes.findIndex((s) => s.id === a.stroke.id);
      if (idx >= 0) this.strokes.splice(idx, 1);
    } else if (a.type === "transform") {
      for (const [id, pts] of a.before) {
        const s = this.strokes.find((x) => x.id === id);
        if (s) s.points = pts.map((p) => ({ ...p }));
      }
    } else {
      this.strokes.push(...a.strokes);
    }
    this.future.push(a);
    this.rebuildBase();
    this.render();
    this.emitChange();
  }

  redo() {
    const a = this.future.pop();
    if (!a) return;
    if (a.type === "add") {
      this.strokes.push(a.stroke);
    } else if (a.type === "transform") {
      for (const [id, pts] of a.after) {
        const s = this.strokes.find((x) => x.id === id);
        if (s) s.points = pts.map((p) => ({ ...p }));
      }
    } else {
      const ids = new Set(a.strokes.map((s) => s.id));
      this.strokes = this.strokes.filter((s) => !ids.has(s.id));
    }
    this.history.push(a);
    this.rebuildBase();
    this.render();
    this.emitChange();
  }

  clear() {
    if (this.strokes.length === 0) return;
    this.history.push({ type: "clear", strokes: [...this.strokes] });
    this.future = [];
    this.strokes = [];
    this.selectedIds.clear();
    this.rebuildBase();
    this.render();
    this.emitChange();
    this.emitSelectionChange();
  }

  getStrokes() {
    return this.strokes;
  }

  /**
   * Экспорт в PNG: видимый canvas сам по себе прозрачный там, где нет
   * штрихов (см. пояснение в шапке файла), поэтому для экспорта собираем
   * фон страницы + штрихи в отдельный офскрин-canvas. Вставленные картинки
   * (отдельный DOM-слой поверх/под canvas) в экспорт не попадают — как и
   * раньше, когда фон и штрихи были в одном canvas.
   */
  exportPNG(): string {
    const out = document.createElement("canvas");
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const outCtx = out.getContext("2d")!;
    outCtx.drawImage(this.bgCanvas, 0, 0);
    outCtx.drawImage(this.canvas, 0, 0);
    return out.toDataURL("image/png");
  }

  // =====================================================================
  // Выделение объектов и трансформация (двигать / масштабировать-искажать
  // / вращать / удалять) — используется selection-layer (UI поверх canvas).
  // =====================================================================

  getSelectedStrokes(): Stroke[] {
    return this.strokes.filter((s) => this.selectedIds.has(s.id));
  }

  /** Ближайший штрих к точке (в лог. координатах страницы) в пределах небольшого допуска, либо null. */
  hitTestStroke(x: number, y: number): string | null {
    const threshold = 10;
    let best: { id: string; dist: number } | null = null;
    for (const s of this.strokes) {
      for (const p of s.points) {
        const d = Math.hypot(p.x - x, p.y - y) - s.baseWidth / 2;
        if (d <= threshold && (!best || d < best.dist)) best = { id: s.id, dist: d };
      }
    }
    return best?.id ?? null;
  }

  /** Все штрихи, у которых хотя бы одна точка попадает в прямоугольник (для рамки выделения). */
  strokesInRect(x0: number, y0: number, x1: number, y1: number): string[] {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const ids: string[] = [];
    for (const s of this.strokes) {
      if (s.points.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)) {
        ids.push(s.id);
      }
    }
    return ids;
  }

  /**
   * Все штрихи, у которых хотя бы одна точка попадает внутрь произвольного
   * многоугольника — используется инструментом "лассо" (выделение
   * произвольной area, как обводка пером; незамкнутый путь замыкается
   * прямой линией от конца к началу перед вызовом этого метода).
   * Точка-в-многоугольнике — стандартный алгоритм трассировки луча.
   */
  strokesInPolygon(polygon: { x: number; y: number }[]): string[] {
    if (polygon.length < 3) return [];
    const ids: string[] = [];
    for (const s of this.strokes) {
      if (s.points.some((p) => pointInPolygon(p.x, p.y, polygon))) {
        ids.push(s.id);
      }
    }
    return ids;
  }

  setSelection(ids: string[]) {
    this.selectedIds = new Set(ids);
    this.emitSelectionChange();
  }

  clearSelection() {
    if (this.selectedIds.size === 0) return;
    this.selectedIds.clear();
    this.emitSelectionChange();
  }

  /** Габаритный (не повёрнутый) прямоугольник выделения в лог. координатах страницы, с учётом толщины линий. */
  getSelectionBounds(): SelectionBounds | null {
    const sel = this.getSelectedStrokes();
    if (sel.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of sel) {
      const pad = s.baseWidth / 2;
      for (const p of s.points) {
        minX = Math.min(minX, p.x - pad);
        maxX = Math.max(maxX, p.x + pad);
        minY = Math.min(minY, p.y - pad);
        maxY = Math.max(maxY, p.y + pad);
      }
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  deleteSelected() {
    if (this.selectedIds.size === 0) return;
    const removed = this.strokes.filter((s) => this.selectedIds.has(s.id));
    if (removed.length === 0) return;
    this.strokes = this.strokes.filter((s) => !this.selectedIds.has(s.id));
    this.history.push({ type: "erase", strokes: removed });
    this.future = [];
    this.selectedIds.clear();
    this.rebuildBase();
    this.render();
    this.emitChange();
    this.emitSelectionChange();
  }

  /** Начинает интерактивную трансформацию: снимок точек + кэш фона без выделенных штрихов. */
  beginTransform() {
    const sel = this.getSelectedStrokes();
    if (sel.length === 0) return;
    this.transformSnapshot = new Map(sel.map((s) => [s.id, s.points.map((p) => ({ ...p }))]));

    if (!this.dragBaseCanvas) {
      this.dragBaseCanvas = document.createElement("canvas");
      this.dragBaseCtx = this.dragBaseCanvas.getContext("2d");
    }
    this.dragBaseCanvas.width = this.baseCanvas.width;
    this.dragBaseCanvas.height = this.baseCanvas.height;
    this.dragBaseCtx!.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const rest = this.strokes.filter((s) => !this.selectedIds.has(s.id));
    this.paintStrokesInto(this.dragBaseCtx!, this.dragBaseCanvas, rest);

    this.transforming = true;
  }

  /** Применяет матрицу преобразования к исходным (на момент beginTransform) точкам выделенных штрихов. */
  applyTransform(matrixFn: (p: { x: number; y: number }) => { x: number; y: number }) {
    if (!this.transformSnapshot) return;
    for (const s of this.strokes) {
      const snap = this.transformSnapshot.get(s.id);
      if (!snap) continue;
      s.points = snap.map((p) => {
        const t = matrixFn({ x: p.x, y: p.y });
        return { ...p, x: t.x, y: t.y };
      });
    }
    this.render();
  }

  /** Завершает трансформацию: пишет в историю undo и пересобирает базовый слой. */
  commitTransform() {
    if (!this.transformSnapshot) return;
    const before = this.transformSnapshot;
    const after = new Map<string, StrokePoint[]>();
    let changed = false;
    for (const [id, pts] of before) {
      const s = this.strokes.find((st) => st.id === id);
      if (!s) continue;
      after.set(id, s.points.map((p) => ({ ...p })));
      if (
        s.points.length !== pts.length ||
        s.points.some((p, i) => Math.abs(p.x - pts[i].x) > 0.01 || Math.abs(p.y - pts[i].y) > 0.01)
      ) {
        changed = true;
      }
    }
    if (changed) {
      this.history.push({ type: "transform", before, after });
      this.future = [];
    }
    this.transformSnapshot = null;
    this.transforming = false;
    this.rebuildBase();
    this.render();
    if (changed) this.emitChange();
  }

  /** Отменяет незафиксированную трансформацию (например, при Escape). */
  cancelTransform() {
    if (!this.transformSnapshot) return;
    for (const [id, pts] of this.transformSnapshot) {
      const s = this.strokes.find((st) => st.id === id);
      if (s) s.points = pts.map((p) => ({ ...p }));
    }
    this.transformSnapshot = null;
    this.transforming = false;
    this.rebuildBase();
    this.render();
  }
}
