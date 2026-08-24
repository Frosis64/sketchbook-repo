// Отрисовка штрихов на canvas 2D.
//
// История багов, из-за которых этот файл выглядит именно так:
// 1) Если обводить каждый маленький сегмент штриха отдельным stroke() с
//    полупрозрачностью — на стыках сегментов альфа-канал складывается,
//    получаются тёмные "бусины" вместо ровной линии (особенно заметно
//    у маркера).
// 2) Если вместо этого объединить все "штампы" (кружки в точках) и
//    прямоугольники между точками в ОДИН Path2D и залить его одним
//    вызовом fill() — соседние фигуры могут иметь разное направление
//    обхода контура (winding direction), и там, где они пересекаются,
//    правило заливки "non-zero" может дать winding number = 0 —
//    получаются белые дыры именно на стыках (особенно заметно при
//    быстром движении, когда точки штриха расположены редко).
//
// Решение: каждая фигура (кружок/сегмент) заливается ОТДЕЛЬНЫМ вызовом
// fill(), но всегда полностью непрозрачным (alpha = 1) одним и тем же
// цветом — наложение одинакового непрозрачного цвета самого на себя не
// даёт ни потемнения, ни дыр. Итоговая прозрачность штриха (для маркера)
// применяется один раз при компоновке уже готового непрозрачного
// изображения штриха поверх страницы (см. CanvasController).

import type { Stroke, StrokePoint } from "../types";

export function widthForPoint(baseWidth: number, tool: Stroke["tool"], pressure: number): number {
  if (tool === "eraser") return baseWidth;
  // лёгкая нелинейность — перо ощущается более отзывчивым на слабом нажатии
  const p = Math.max(0.05, Math.min(1, pressure));
  const shaped = Math.pow(p, 0.7);
  return baseWidth * (0.25 + 0.95 * shaped);
}

function paintDot(ctx: CanvasRenderingContext2D, p: StrokePoint, stroke: Stroke) {
  const w = widthForPoint(stroke.baseWidth, stroke.tool, p.pressure);
  const r = Math.max(0.5, w / 2);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function paintSegment(ctx: CanvasRenderingContext2D, p0: StrokePoint, p1: StrokePoint, stroke: Stroke) {
  const w0 = Math.max(0.5, widthForPoint(stroke.baseWidth, stroke.tool, p0.pressure));
  const w1 = Math.max(0.5, widthForPoint(stroke.baseWidth, stroke.tool, p1.pressure));
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const r0 = w0 / 2;
  const r1 = w1 / 2;
  ctx.beginPath();
  ctx.moveTo(p0.x + nx * r0, p0.y + ny * r0);
  ctx.lineTo(p1.x + nx * r1, p1.y + ny * r1);
  ctx.lineTo(p1.x - nx * r1, p1.y - ny * r1);
  ctx.lineTo(p0.x - nx * r0, p0.y - ny * r0);
  ctx.closePath();
  ctx.fill();
}

/** Рисует штрих целиком, непрозрачным (alpha снаружи не задан — считается 1). */
export function paintStrokeOpaque(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points;
  if (pts.length === 0) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = stroke.color;
  for (const p of pts) paintDot(ctx, p, stroke);
  for (let i = 1; i < pts.length; i++) paintSegment(ctx, pts[i - 1], pts[i], stroke);
  ctx.restore();
}

/**
 * Рисует только "прирост" штриха начиная с индекса fromIndex — используется
 * во время живого рисования, чтобы не перерисовывать весь штрих на каждое
 * движение пера (иначе O(n^2) на длинных штрихах).
 */
export function paintStrokeIncrement(ctx: CanvasRenderingContext2D, stroke: Stroke, fromIndex: number) {
  const pts = stroke.points;
  if (pts.length === 0) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = stroke.color;
  for (let i = Math.max(0, fromIndex); i < pts.length; i++) {
    paintDot(ctx, pts[i], stroke);
    if (i > 0) paintSegment(ctx, pts[i - 1], pts[i], stroke);
  }
  ctx.restore();
}
