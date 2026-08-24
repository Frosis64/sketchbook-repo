// Слой персистентности — HTTP-клиент к серверному REST API (server/app.py).
// Раньше здесь была IndexedDB; теперь все данные хранятся на сервере (SQLite),
// а этот файл сохраняет ТОЧНО ТАКУЮ ЖЕ форму экспортируемого объекта `db`,
// поэтому repo.ts/main.ts/textLayer.ts/imageLayer.ts/sidebar.ts не меняются.

import type { Notebook, Section, Page, Stroke, TextBlock, ImageBlock } from "../types";

async function apiGet<T>(path: string): Promise<T | undefined> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function apiGetList<T>(path: string): Promise<T[]> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T[];
}

async function apiPut(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}`);
}

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${path} -> ${res.status}`);
}

async function deleteMany(entity: string, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => apiDelete(`/api/${entity}/${encodeURIComponent(id)}`)));
}

export const db = {
  // Notebooks
  putNotebook: (n: Notebook) => apiPut(`/api/notebooks/${encodeURIComponent(n.id)}`, n),
  getNotebook: (id: string) => apiGet<Notebook>(`/api/notebooks/${encodeURIComponent(id)}`),
  getAllNotebooks: () => apiGetList<Notebook>(`/api/notebooks`),
  deleteNotebook: (id: string) => apiDelete(`/api/notebooks/${encodeURIComponent(id)}`),

  // Sections
  putSection: (s: Section) => apiPut(`/api/sections/${encodeURIComponent(s.id)}`, s),
  getSection: (id: string) => apiGet<Section>(`/api/sections/${encodeURIComponent(id)}`),
  getSectionsByNotebook: (notebookId: string) =>
    apiGetList<Section>(`/api/sections?parent=${encodeURIComponent(notebookId)}`),
  deleteSection: (id: string) => apiDelete(`/api/sections/${encodeURIComponent(id)}`),

  // Pages
  putPage: (p: Page) => apiPut(`/api/pages/${encodeURIComponent(p.id)}`, p),
  getPage: (id: string) => apiGet<Page>(`/api/pages/${encodeURIComponent(id)}`),
  getPagesBySection: (sectionId: string) =>
    apiGetList<Page>(`/api/pages?parent=${encodeURIComponent(sectionId)}`),
  deletePage: (id: string) => apiDelete(`/api/pages/${encodeURIComponent(id)}`),

  // Strokes
  putStroke: (st: Stroke) => apiPut(`/api/strokes/${encodeURIComponent(st.id)}`, st),
  getStrokesByPage: (pageId: string) =>
    apiGetList<Stroke>(`/api/strokes?parent=${encodeURIComponent(pageId)}`),
  deleteStroke: (id: string) => apiDelete(`/api/strokes/${encodeURIComponent(id)}`),
  deleteStrokesByIds: (ids: string[]) => deleteMany("strokes", ids),

  // Text blocks
  putTextBlock: (tb: TextBlock) => apiPut(`/api/text_blocks/${encodeURIComponent(tb.id)}`, tb),
  getTextBlocksByPage: (pageId: string) =>
    apiGetList<TextBlock>(`/api/text_blocks?parent=${encodeURIComponent(pageId)}`),
  deleteTextBlock: (id: string) => apiDelete(`/api/text_blocks/${encodeURIComponent(id)}`),
  deleteTextBlocksByIds: (ids: string[]) => deleteMany("text_blocks", ids),

  // Image blocks
  putImageBlock: (ib: ImageBlock) => apiPut(`/api/image_blocks/${encodeURIComponent(ib.id)}`, ib),
  getImageBlocksByPage: (pageId: string) =>
    apiGetList<ImageBlock>(`/api/image_blocks?parent=${encodeURIComponent(pageId)}`),
  deleteImageBlock: (id: string) => apiDelete(`/api/image_blocks/${encodeURIComponent(id)}`),
  deleteImageBlocksByIds: (ids: string[]) => deleteMany("image_blocks", ids),

  // Meta (последняя открытая страница и т.п.)
  getMeta: async (key: string): Promise<{ key: string; value: unknown } | undefined> => {
    const res = await fetch(`/api/meta/${encodeURIComponent(key)}`, { credentials: "same-origin" });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`GET /api/meta/${key} -> ${res.status}`);
    const json = (await res.json()) as { key: string; value: unknown };
    return json;
  },
  setMeta: (key: string, value: unknown) => apiPut(`/api/meta/${encodeURIComponent(key)}`, { value }),
};
