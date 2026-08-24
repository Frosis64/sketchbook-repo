import type { BackgroundSize, PageBackground, PaperColor } from "../types";

type Kind = "blank" | "ruled" | "grid" | "dotted";

const RULED_STEP: Record<BackgroundSize, number> = { s: 28, m: 40, l: 56 };
const GRID_STEP: Record<BackgroundSize, number> = { s: 22, m: 32, l: 46 };
const DOTTED_STEP: Record<BackgroundSize, number> = { s: 20, m: 28, l: 40 };

// Цвет бумаги + подобранные под него контрастные цвета линий/точек.
// Тёмная и чёрная бумага получают заметно более светлые (не просто чуть
// светлее фона) линии — иначе сетка/линовка на тёмном фоне была бы почти
// не видна, как на белой бумаге со светло-серыми линиями.
export const PAPER_COLORS: { id: PaperColor; label: string; fill: string; line: string; dot: string }[] = [
  { id: "white", label: "Белая", fill: "#ffffff", line: "#e3e6ef", dot: "#d7dbe8" },
  { id: "dark", label: "Тёмно-серая", fill: "#2b2d33", line: "#565a66", dot: "#6b707d" },
  { id: "black", label: "Чёрная", fill: "#101012", line: "#45454e", dot: "#5a5a66" },
];

export function paperColorInfo(color: PaperColor | undefined) {
  return PAPER_COLORS.find((p) => p.id === color) ?? PAPER_COLORS[0];
}

export const BACKGROUND_PRESETS: { id: PageBackground; kind: Kind; size: BackgroundSize; label: string }[] = [
  { id: "blank", kind: "blank", size: "m", label: "Чистый" },
  { id: "ruled-s", kind: "ruled", size: "s", label: "Линия · мелкая" },
  { id: "ruled-m", kind: "ruled", size: "m", label: "Линия · обычная" },
  { id: "ruled-l", kind: "ruled", size: "l", label: "Линия · крупная" },
  { id: "grid-s", kind: "grid", size: "s", label: "Клетка · мелкая" },
  { id: "grid-m", kind: "grid", size: "m", label: "Клетка · обычная" },
  { id: "grid-l", kind: "grid", size: "l", label: "Клетка · крупная" },
  { id: "dotted-s", kind: "dotted", size: "s", label: "Точки · мелкие" },
  { id: "dotted-m", kind: "dotted", size: "m", label: "Точки · обычные" },
  { id: "dotted-l", kind: "dotted", size: "l", label: "Точки · крупные" },
];

/** Разбирает PageBackground (включая старые значения без размера) на вид+размер. */
function parseBackground(bg: PageBackground): { kind: Kind; size: BackgroundSize } {
  if (bg === "blank") return { kind: "blank", size: "m" };
  // старые значения из более ранней версии — без суффикса размера
  if (bg === "ruled" || bg === "grid" || bg === "dotted") return { kind: bg, size: "m" };
  const [kind, size] = bg.split("-") as [Kind, BackgroundSize];
  return { kind, size };
}

export function backgroundPattern(bg: PageBackground, paperColor?: PaperColor) {
  const { kind, size } = parseBackground(bg);
  const paper = paperColorInfo(paperColor);
  return {
    pattern(ctx: CanvasRenderingContext2D, w: number, h: number) {
      ctx.save();
      ctx.fillStyle = paper.fill;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = paper.line;
      ctx.lineWidth = 1;

      if (kind === "ruled") {
        const step = RULED_STEP[size];
        for (let y = step; y < h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(w, y + 0.5);
          ctx.stroke();
        }
      } else if (kind === "grid") {
        const step = GRID_STEP[size];
        for (let x = step; x < w; x += step) {
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, h);
          ctx.stroke();
        }
        for (let y = step; y < h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(w, y + 0.5);
          ctx.stroke();
        }
      } else if (kind === "dotted") {
        const step = DOTTED_STEP[size];
        ctx.fillStyle = paper.dot;
        for (let x = step; x < w; x += step) {
          for (let y = step; y < h; y += step) {
            ctx.beginPath();
            ctx.arc(x, y, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    },
  };
}
