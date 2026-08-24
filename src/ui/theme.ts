// Тема оформления интерфейса (не самой страницы — бумага всегда белая,
// см. пояснение в style.css). Хранится в localStorage, а не в IndexedDB —
// чтение синхронное, поэтому тема применяется до первой отрисовки, без
// "мигания" светлой темой перед переключением на тёмную.

export type Theme = "light" | "dark" | "black";

const STORAGE_KEY = "sketchbook-theme";

export const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: "light", label: "Светлая", swatch: "#f4f5f9" },
  { id: "dark", label: "Тёмно-серая", swatch: "#2a2c32" },
  { id: "black", label: "Чёрная", swatch: "#0c0c0e" },
];

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "black") return v;
  } catch {
    // localStorage может быть недоступен (приватный режим и т.п.) — используем светлую по умолчанию
  }
  return "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.remove("theme-light", "theme-dark", "theme-black");
  document.documentElement.classList.add(`theme-${theme}`);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // игнорируем — тема просто не переживёт перезагрузку
  }
}
