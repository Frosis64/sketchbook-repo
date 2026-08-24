// Основные типы данных приложения.
// Иерархия: Notebook (блокнот) -> Section (раздел) -> Page (страница).
// Каждая страница хранит вектор штрихов (strokes), что позволяет
// перерисовывать их в любом масштабе без потери качества (в отличие от растра).

export interface Notebook {
  id: string;
  name: string;
  color: string; // акцентный цвет корешка блокнота
  sectionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Section {
  id: string;
  notebookId: string;
  name: string;
  color: string;
  pageIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Page {
  id: string;
  sectionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  // Размер холста страницы в логических пикселях (не зависит от DPR экрана)
  width: number;
  height: number;
  background: PageBackground;
  // Цвет самой бумаги страницы — независим от темы интерфейса (см. style.css).
  // Отсутствует у страниц, созданных до появления этой функции — трактуется
  // как "white" (см. background.ts/normalizePaperColor).
  paperColor?: PaperColor;
}

// Цвет бумаги страницы: белый (по умолчанию), тёмно-серый или чёрный.
// Узоры фона (линия/клетка/точки) при этом перекрашиваются в контрастный
// к бумаге цвет — см. backgroundPattern() в background.ts.
export type PaperColor = "white" | "dark" | "black";

// Фон страницы: "чистый" или один из узоров (линия/клетка/точки) с одним
// из трёх шагов сетки. Старые значения "ruled"/"grid"/"dotted" без размера
// (из более ранней версии) по-прежнему поддерживаются как алиас среднего
// размера — см. background.ts.
export type BackgroundSize = "s" | "m" | "l";
export type PageBackground =
  | "blank"
  | "ruled"
  | "grid"
  | "dotted"
  | `ruled-${BackgroundSize}`
  | `grid-${BackgroundSize}`
  | `dotted-${BackgroundSize}`;

// "cursor" — универсальный инструмент "рука/курсор": двигать и менять
// размер и текстовых блоков, и вставленных картинок (в отличие от "select",
// который выделяет и трансформирует нарисованные пером/маркером штрихи).
export type ToolType = "pen" | "highlighter" | "eraser" | "text" | "select" | "cursor";

// Настройка одного из слотов пера — у каждого свой цвет и толщина,
// которые запоминаются и переключаются клавишами 1..N.
export interface PenPreset {
  color: string;
  size: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number; // 0..1 (0.5 по умолчанию для мыши/без давления)
  tiltX?: number;
  tiltY?: number;
  t: number; // timestamp относительно начала штриха, мс
}

export interface Stroke {
  id: string;
  pageId: string;
  tool: ToolType;
  color: string;
  baseWidth: number; // базовая толщина в лог. пикселях при pressure=1
  opacity: number; // 0..1
  points: StrokePoint[];
  createdAt: number;
}

// Текстовый блок — как в Word/Google Docs, но плавающий поверх страницы
// (можно перетаскивать и менять размер), с форматированием через
// contenteditable + execCommand (bold/italic/underline/размер/цвет).
export interface TextBlock {
  id: string;
  pageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  html: string;
  createdAt: number;
  updatedAt: number;
}

// Вставленное изображение — как в Word/OneNote: плавает поверх страницы,
// можно перетаскивать и менять масштаб за уголок (с сохранением пропорций).
// Вставляется через Ctrl+V (из буфера обмена) или кнопкой в тулбаре (выбор
// файла) — поддерживается любой формат изображения, который понимает браузер
// (png/jpg/gif/webp/svg/bmp и т.д.), хранится как data URL прямо в IndexedDB.
export interface ImageBlock {
  id: string;
  pageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  createdAt: number;
  updatedAt: number;
}
