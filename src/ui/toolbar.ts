import { db } from "../db/db";
import { BACKGROUND_PRESETS, PAPER_COLORS } from "../draw/background";
import type { CanvasController } from "../draw/CanvasController";
import { icon, type IconName } from "./icons";
import type { PageBackground, PaperColor, PenPreset, ToolType } from "../types";

const COLORS = ["#1f2430", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#ffffff"];

const DEFAULT_PRESETS: PenPreset[] = [
  { color: "#1f2430", size: 3 },
  { color: "#e03131", size: 3 },
  { color: "#1971c2", size: 4 },
  { color: "#2f9e44", size: 2 },
  { color: "#f08c00", size: 6 },
];

const PEN_PRESETS_KEY = "penPresets";
const SMOOTHING_KEY = "inkSmoothing";
const DEFAULT_SMOOTHING = 45; // 0..100, применяется как settings.smoothing/100

async function loadSmoothing(): Promise<number> {
  const meta = await db.getMeta(SMOOTHING_KEY);
  const v = meta?.value;
  return typeof v === "number" && v >= 0 && v <= 100 ? v : DEFAULT_SMOOTHING;
}

function saveSmoothing(v: number) {
  void db.setMeta(SMOOTHING_KEY, v);
}

// Мини-превью паттерна фона для кнопок в поповере — приблизительно
// повторяет реальный паттерн страницы (см. background.ts), но с меньшим
// шагом, чтобы влезть в маленькую иконку 26×26.
const PREVIEW_STEP: Record<string, number> = { s: 6, m: 9, l: 13 };
function previewStyle(kind: string, size: string): Partial<CSSStyleDeclaration> {
  const step = PREVIEW_STEP[size] ?? 9;
  if (kind === "blank") return {};
  if (kind === "ruled") {
    return {
      backgroundImage: `repeating-linear-gradient(0deg, #c7cbdd 0px, #c7cbdd 1px, transparent 1px, transparent ${step}px)`,
    };
  }
  if (kind === "grid") {
    return {
      backgroundImage: [
        `repeating-linear-gradient(0deg, #c7cbdd 0px, #c7cbdd 1px, transparent 1px, transparent ${step}px)`,
        `repeating-linear-gradient(90deg, #c7cbdd 0px, #c7cbdd 1px, transparent 1px, transparent ${step}px)`,
      ].join(", "),
    };
  }
  if (kind === "dotted") {
    return {
      backgroundImage: `radial-gradient(#c7cbdd 1px, transparent 1.4px)`,
      backgroundSize: `${step}px ${step}px`,
    };
  }
  return {};
}

async function loadPenPresets(): Promise<PenPreset[]> {
  const meta = await db.getMeta(PEN_PRESETS_KEY);
  const stored = meta?.value as PenPreset[] | undefined;
  if (stored && Array.isArray(stored) && stored.length === DEFAULT_PRESETS.length) return stored;
  return DEFAULT_PRESETS.map((p) => ({ ...p }));
}

function savePenPresets(presets: PenPreset[]) {
  void db.setMeta(PEN_PRESETS_KEY, presets);
}

export function buildToolbar(
  el: HTMLElement,
  getController: () => CanvasController | null,
  onExport: () => void,
  onToolChange: (tool: ToolType) => void,
  onBackgroundChange: (bg: PageBackground) => void,
  getBackground: () => PageBackground,
  onPaperColorChange: (color: PaperColor) => void,
  getPaperColor: () => PaperColor,
  onInsertImages: (files: File[]) => Promise<void>
) {
  el.innerHTML = "";

  let presets: PenPreset[] = DEFAULT_PRESETS.map((p) => ({ ...p }));
  let activeKind: ToolType = "pen";
  let activeSlot = 0;

  // ---------- Слоты пера ----------
  const penGroup = document.createElement("div");
  penGroup.className = "tool-group pen-slots";
  const slotButtons: HTMLButtonElement[] = [];

  function refreshSlotVisuals() {
    presets.forEach((p, i) => {
      const b = slotButtons[i];
      b.style.background = p.color;
      b.style.borderWidth = `${Math.min(5, 1.5 + p.size / 4)}px`;
    });
  }

  function setActiveButton(btn: HTMLElement | null) {
    document.querySelectorAll(".tool-btn.active, .pen-slot.active").forEach((b) => b.classList.remove("active"));
    btn?.classList.add("active");
  }

  function applyPenSlot(idx: number) {
    const c = getController();
    if (!c) return;
    activeKind = "pen";
    activeSlot = idx;
    c.settings.tool = "pen";
    c.settings.color = presets[idx].color;
    c.settings.size = presets[idx].size;
    setActiveButton(slotButtons[idx]);
    syncSharedControls();
    onToolChange("pen");
  }

  for (let i = 0; i < DEFAULT_PRESETS.length; i++) {
    const b = document.createElement("button");
    b.className = "pen-slot";
    b.title = `Перо ${i + 1} (клавиша ${i + 1}) — клик выбирает, цвет/толщину справа можно менять под это перо`;
    const num = document.createElement("span");
    num.className = "pen-slot-num";
    num.textContent = String(i + 1);
    b.appendChild(num);
    b.onclick = () => applyPenSlot(i);
    slotButtons.push(b);
    penGroup.appendChild(b);
  }

  // ---------- Остальные инструменты ----------
  const toolGroup = document.createElement("div");
  toolGroup.className = "tool-group";
  const otherTools: { id: ToolType; icon: IconName | null; text?: string; label: string; className?: string }[] = [
    { id: "cursor", icon: "cursor", label: "Курсор: двигать / менять размер текстовых блоков и картинок" },
    { id: "select", icon: "select", label: "Выделение: двигать / изменять размер / искажать / вращать / удалять (для штрихов пера)" },
    { id: "highlighter", icon: "highlighter", label: "Маркер" },
    { id: "eraser", icon: "eraser", label: "Ластик (стирает штрих целиком)" },
    { id: "text", icon: null, text: "T", label: "Текст: создать новый текстовый блок", className: "tool-btn-text" },
  ];
  const otherButtons: Record<string, HTMLButtonElement> = {};

  function selectTool(tool: ToolType) {
    const c = getController();
    if (!c) return;
    activeKind = tool;
    c.settings.tool = tool;
    setActiveButton(otherButtons[tool] ?? null);
    syncSharedControls();
    onToolChange(tool);
  }

  for (const t of otherTools) {
    const b = document.createElement("button");
    b.className = "tool-btn" + (t.className ? ` ${t.className}` : "");
    b.title = t.label;
    if (t.icon) b.innerHTML = icon(t.icon);
    else b.textContent = t.text ?? "";
    b.onclick = () => selectTool(t.id);
    otherButtons[t.id] = b;
    toolGroup.appendChild(b);
  }

  // ---------- Изображения (вставка через Ctrl+V или кнопку + перетаскивание/масштаб) ----------
  const imgBtn = document.createElement("button");
  imgBtn.className = "tool-btn";
  imgBtn.title = "Вставить изображение (любой формат) — или Ctrl+V из буфера обмена";
  imgBtn.innerHTML = icon("image");
  const imgFileInput = document.createElement("input");
  imgFileInput.type = "file";
  imgFileInput.accept = "image/*";
  imgFileInput.multiple = true;
  imgFileInput.style.display = "none";
  imgBtn.onclick = () => imgFileInput.click();
  imgFileInput.onchange = async () => {
    const files = imgFileInput.files;
    if (files && files.length > 0) {
      await onInsertImages(Array.from(files));
      // Сразу переключаем на "Курсор" — им же двигают и текстовые блоки, и
      // картинки — чтобы вставленную картинку можно было тут же подвинуть.
      selectTool("cursor");
    }
    imgFileInput.value = "";
  };
  toolGroup.appendChild(imgBtn);
  toolGroup.appendChild(imgFileInput);

  // ---------- Цвет (правит активный слот пера или текущий инструмент) ----------
  const colorGroup = document.createElement("div");
  colorGroup.className = "tool-group colors";
  const colorButtons: HTMLButtonElement[] = [];

  function applyColor(color: string) {
    const c = getController();
    if (!c) return;
    c.settings.color = color;
    if (activeKind === "pen") {
      presets[activeSlot].color = color;
      savePenPresets(presets);
      refreshSlotVisuals();
    }
    syncColorHighlight(color);
  }

  function syncColorHighlight(color: string) {
    colorButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.color === color));
  }

  for (const color of COLORS) {
    const b = document.createElement("button");
    b.className = "color-btn";
    b.dataset.color = color;
    b.style.background = color;
    if (color === "#ffffff") b.style.border = "1px solid #d0d3de";
    b.onclick = () => applyColor(color);
    colorButtons.push(b);
    colorGroup.appendChild(b);
  }

  const customColor = document.createElement("input");
  customColor.type = "color";
  customColor.className = "color-custom";
  customColor.value = "#1f2430";
  customColor.oninput = () => applyColor(customColor.value);
  colorGroup.appendChild(customColor);

  // ---------- Толщина ----------
  const sizeGroup = document.createElement("div");
  sizeGroup.className = "tool-group";
  const sizeLabel = document.createElement("span");
  sizeLabel.className = "size-label";
  sizeLabel.textContent = "Толщина";
  const sizeSlider = document.createElement("input");
  sizeSlider.type = "range";
  sizeSlider.min = "1";
  sizeSlider.max = "20";
  sizeSlider.value = "3";
  sizeSlider.oninput = () => {
    const c = getController();
    if (!c) return;
    const size = Number(sizeSlider.value);
    c.settings.size = size;
    if (activeKind === "pen") {
      presets[activeSlot].size = size;
      savePenPresets(presets);
      refreshSlotVisuals();
    }
  };
  sizeGroup.appendChild(sizeLabel);
  sizeGroup.appendChild(sizeSlider);

  function syncSharedControls() {
    const c = getController();
    if (!c) return;
    sizeSlider.value = String(c.settings.size);
    syncColorHighlight(c.settings.color);
  }

  // ---------- Сглаживание (как ink smoothing в Whiteboard) ----------
  let smoothingValue = DEFAULT_SMOOTHING;
  const smoothGroup = document.createElement("div");
  smoothGroup.className = "tool-group";
  const smoothLabel = document.createElement("span");
  smoothLabel.className = "size-label";
  smoothLabel.textContent = "Сглаживание";
  const smoothSlider = document.createElement("input");
  smoothSlider.type = "range";
  smoothSlider.min = "0";
  smoothSlider.max = "100";
  smoothSlider.value = String(DEFAULT_SMOOTHING);
  smoothSlider.title = "Сглаживание линии пера/маркера — гасит дрожание руки, как в Microsoft Whiteboard";
  smoothSlider.oninput = () => {
    smoothingValue = Number(smoothSlider.value);
    const c = getController();
    if (c) c.settings.smoothing = smoothingValue / 100;
    saveSmoothing(smoothingValue);
  };
  smoothGroup.appendChild(smoothLabel);
  smoothGroup.appendChild(smoothSlider);

  loadSmoothing().then((loaded) => {
    smoothingValue = loaded;
    smoothSlider.value = String(loaded);
    const c = getController();
    if (c) c.settings.smoothing = loaded / 100;
  });

  // ---------- Фон страницы ----------
  const bgGroup = document.createElement("div");
  bgGroup.className = "tool-group";
  const bgBtn = document.createElement("button");
  bgBtn.className = "tool-btn";
  bgBtn.title = "Фон страницы: линия, клетка, точки";
  bgBtn.innerHTML = icon("grid");
  const bgPanel = document.createElement("div");
  bgPanel.className = "bg-panel";
  bgPanel.style.display = "none";

  const KIND_LABEL: Record<string, string> = { blank: "Чистый", ruled: "Линия", grid: "Клетка", dotted: "Точки" };
  const rows = new Map<string, HTMLElement>();
  for (const preset of BACKGROUND_PRESETS) {
    let row = rows.get(preset.kind);
    if (!row) {
      row = document.createElement("div");
      row.className = "bg-row";
      const label = document.createElement("span");
      label.className = "bg-row-label";
      label.textContent = KIND_LABEL[preset.kind] ?? preset.kind;
      row.appendChild(label);
      rows.set(preset.kind, row);
      bgPanel.appendChild(row);
    }
    const swatch = document.createElement("button");
    swatch.className = "bg-swatch";
    swatch.title = preset.label;
    Object.assign(swatch.style, previewStyle(preset.kind, preset.size));
    swatch.onclick = () => {
      onBackgroundChange(preset.id);
      bgPanel.style.display = "none";
      refreshBgActive();
    };
    swatch.dataset.bg = preset.id;
    row.appendChild(swatch);
  }
  function refreshBgActive() {
    const current = getBackground();
    bgPanel.querySelectorAll<HTMLButtonElement>(".bg-swatch").forEach((s) => {
      s.classList.toggle("active", s.dataset.bg === current);
    });
  }

  // ---- Цвет бумаги (белая/тёмно-серая/чёрная) — отдельная строка в том же
  // поповере, независимая от узора фона выше. ----
  const paperSep = document.createElement("div");
  paperSep.className = "bg-panel-sep";
  bgPanel.appendChild(paperSep);
  const paperRow = document.createElement("div");
  paperRow.className = "bg-row";
  const paperLabel = document.createElement("span");
  paperLabel.className = "bg-row-label";
  paperLabel.textContent = "Бумага";
  paperRow.appendChild(paperLabel);
  for (const p of PAPER_COLORS) {
    const swatch = document.createElement("button");
    swatch.className = "paper-swatch";
    swatch.title = p.label;
    swatch.style.background = p.fill;
    swatch.dataset.paper = p.id;
    swatch.onclick = () => {
      onPaperColorChange(p.id);
      refreshPaperActive();
    };
    paperRow.appendChild(swatch);
  }
  bgPanel.appendChild(paperRow);
  function refreshPaperActive() {
    const current = getPaperColor();
    bgPanel.querySelectorAll<HTMLButtonElement>(".paper-swatch").forEach((s) => {
      s.classList.toggle("active", s.dataset.paper === current);
    });
  }

  bgBtn.onclick = () => {
    const willOpen = bgPanel.style.display === "none";
    bgPanel.style.display = willOpen ? "block" : "none";
    if (willOpen) {
      refreshBgActive();
      refreshPaperActive();
    }
  };
  document.addEventListener("click", (e) => {
    if (!bgGroup.contains(e.target as Node)) bgPanel.style.display = "none";
  });
  bgGroup.style.position = "relative";
  bgGroup.appendChild(bgBtn);
  bgGroup.appendChild(bgPanel);

  // ---------- Действия ----------
  const actionGroup = document.createElement("div");
  actionGroup.className = "tool-group";

  const undoBtn = document.createElement("button");
  undoBtn.className = "tool-btn";
  undoBtn.title = "Отменить (Ctrl+Z)";
  undoBtn.innerHTML = icon("undo");
  undoBtn.onclick = () => getController()?.undo();

  const redoBtn = document.createElement("button");
  redoBtn.className = "tool-btn";
  redoBtn.title = "Повторить (Ctrl+Y)";
  redoBtn.innerHTML = icon("redo");
  redoBtn.onclick = () => getController()?.redo();

  const clearBtn = document.createElement("button");
  clearBtn.className = "tool-btn";
  clearBtn.title = "Очистить страницу";
  clearBtn.innerHTML = icon("trash");
  clearBtn.onclick = () => {
    if (confirm("Очистить всю страницу?")) getController()?.clear();
  };

  const exportBtn = document.createElement("button");
  exportBtn.className = "tool-btn";
  exportBtn.title = "Экспорт в PNG";
  exportBtn.innerHTML = icon("download");
  exportBtn.onclick = onExport;

  actionGroup.appendChild(undoBtn);
  actionGroup.appendChild(redoBtn);
  actionGroup.appendChild(clearBtn);
  actionGroup.appendChild(exportBtn);

  el.appendChild(penGroup);
  el.appendChild(toolGroup);
  el.appendChild(colorGroup);
  el.appendChild(sizeGroup);
  el.appendChild(smoothGroup);
  el.appendChild(bgGroup);
  el.appendChild(actionGroup);

  // Загружаем сохранённые пресеты перьев (или дефолтные) и применяем первый.
  // getController() в момент вызова buildToolbar ещё может возвращать null
  // (контроллер холста создаётся позже, после того как откроется первая
  // страница) — applyPenSlot в этом случае просто выходит, ничего не
  // применив к (ещё не существующему) контроллеру. Поэтому main.ts после
  // создания контроллера обязан вызвать onControllerReady(), чтобы
  // применить активный слот пера уже по факту.
  loadPenPresets().then((loaded) => {
    presets = loaded;
    refreshSlotVisuals();
    applyPenSlot(activeSlot);
  });

  // Горячие клавиши: используем e.code (физическая клавиша), а не e.key —
  // e.key на русской раскладке для той же клавиши даёт другой символ,
  // из-за чего сочетания не срабатывали. code не зависит от раскладки.
  //
  // Ctrl+Z/Y отдаются нативному редактору текста только пока реально
  // активен инструмент "Текст" или "Курсор" (в обоих можно печатать в
  // текстовом блоке) — иначе залипший в текстовом блоке фокус блокировал
  // отмену рисования (см. main.ts — при смене на другой инструмент фокус
  // с текстового блока снимается автоматически).
  const DIGIT_CODES = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"];
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const isTypingField = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    const tool = getController()?.settings.tool;
    const isEditingTextBlock = !!target && target.isContentEditable && (tool === "text" || tool === "cursor");
    if (isTypingField || isEditingTextBlock) return;

    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !e.shiftKey) {
      e.preventDefault();
      getController()?.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.code === "KeyY" || (e.shiftKey && e.code === "KeyZ"))) {
      e.preventDefault();
      getController()?.redo();
      return;
    }
    const digitIdx = DIGIT_CODES.indexOf(e.code);
    if (digitIdx >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      applyPenSlot(digitIdx);
      return;
    }
    if ((e.code === "Delete" || e.code === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const c = getController();
      if (c && c.settings.tool === "select") {
        e.preventDefault();
        c.deleteSelected();
      }
    }
  });

  return {
    /**
     * main.ts вызывает это сразу после создания CanvasController (который
     * появляется позже, чем сам тулбар — только когда открылась первая
     * страница). До этого момента applyPenSlot() не может применить
     * активный пресет, потому что getController() ещё возвращает null.
     */
    onControllerReady() {
      const c = getController();
      if (c) c.settings.smoothing = smoothingValue / 100;
      if (activeKind === "pen") applyPenSlot(activeSlot);
      else if (c) c.settings.tool = activeKind;
    },
    /**
     * Переключить активный инструмент извне (например, после вставки
     * картинки из буфера обмена Ctrl+V — main.ts переключает на "cursor",
     * чтобы новую картинку сразу можно было потянуть/смасштабировать).
     */
    selectTool,
  };
}
