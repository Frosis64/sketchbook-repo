// Набор нарисованных вручную line-иконок (взамен эмодзи) — единый стиль:
// stroke=currentColor (наследует цвет текста кнопки, работает в любой теме
// без доп. правил), viewBox 24×24, скруглённые концы линий. Используется
// через icon("name") — возвращает готовую строку разметки SVG для
// присвоения в innerHTML.

const ICONS = {
  // Блокнот (шапка сайдбара и страница логина)
  notebook: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="12.5" y1="8.5" x2="16.5" y2="8.5"/><line x1="12.5" y1="12.5" x2="16.5" y2="12.5"/><line x1="12.5" y1="16.5" x2="16.5" y2="16.5"/></svg>`,

  // Аккаунт (силуэт человека)
  person: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.3"/><path d="M5 20c0-4 3-6.6 7-6.6s7 2.6 7 6.6"/></svg>`,

  // Переключатель темы — полумесяц
  theme: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none"><path d="M20.2 14.7A8.5 8.5 0 1 1 9.3 3.8a6.6 6.6 0 0 0 10.9 10.9z"/></svg>`,

  // Раздел (иконка перед названием раздела в дереве)
  section: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>`,

  // Страница (иконка перед названием страницы в дереве)
  page: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h7l4 4v13a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13.5 3v4h4"/><line x1="8.5" y1="12.5" x2="15" y2="12.5"/><line x1="8.5" y1="16" x2="15" y2="16"/></svg>`,

  // Инструмент "Курсор" — стрелка указателя
  cursor: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round"><path d="M5 3.5v16l4.3-4.1 2.6 5.6 2.4-1.1-2.6-5.6h6.1z"/></svg>`,

  // Инструмент "Выделение" — пунктирная рамка
  select: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3.2"/></svg>`,

  // Инструмент "Маркер" — скошенное перо + подчёркивание
  highlighter: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5l5 5-9 9H5.5v-5z"/><line x1="4" y1="20" x2="9.5" y2="20" stroke-width="2.4"/></svg>`,

  // Инструмент "Ластик"
  eraser: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.6 4.6l4 4a1.5 1.5 0 0 1 0 2.1l-8 8H7.4L3.5 14.8a1.5 1.5 0 0 1 0-2.1l9.9-9.9a1.5 1.5 0 0 1 2.1 0z"/><line x1="9.3" y1="15.9" x2="15.2" y2="10"/><line x1="6.5" y1="20" x2="19" y2="20"/></svg>`,

  // Вставка изображения — рамка с "горами"
  image: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="8" cy="9" r="1.4" fill="currentColor" stroke="none"/><path d="M4.5 16.5l4-4.2 2.6 2.6 4-4.8 5.4 6.4"/></svg>`,

  // Фон страницы — сетка 2×2
  grid: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>`,

  undo: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7L3 11l4 4"/><path d="M3 11h11a6 6 0 0 1 0 12h-2"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7l4 4-4 4"/><path d="M21 11H10a6 6 0 0 0 0 12h2"/></svg>`,

  trash: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,

  download: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="14.5"/><path d="M7 10l5 5 5-5"/><line x1="4.5" y1="20" x2="19.5" y2="20"/></svg>`,

  // Раскрывающий треугольник у блокнотов/разделов
  chevron: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,

  // Скрыть/показать боковую панель
  panelHide: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 6l-6 6 6 6"/><path d="M17 6l-6 6 6 6"/></svg>`,
  panelShow: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6l6 6-6 6"/><path d="M7 6l6 6-6 6"/></svg>`,

  // Стрелка "назад" (страница аккаунта)
  back: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><path d="M11 6l-6 6 6 6"/></svg>`,

  plus: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): string {
  return ICONS[name];
}
