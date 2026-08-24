// Репозиторий: бизнес-логика над IndexedDB — создание/удаление/переименование
// блокнотов, разделов и страниц с поддержанием ссылочной целостности.

import { db } from "./db";
import type { Notebook, Section, Page, PageBackground, PaperColor } from "../types";

function uid(): string {
  return crypto.randomUUID();
}

const ACCENTS = ["#7c5cff", "#ff6b6b", "#22c1a1", "#f5a623", "#4f8cff", "#e854a0"];
let accentCursor = 0;
export function nextAccent(): string {
  const c = ACCENTS[accentCursor % ACCENTS.length];
  accentCursor++;
  return c;
}

export async function createNotebook(name: string): Promise<Notebook> {
  const now = Date.now();
  const nb: Notebook = {
    id: uid(),
    name,
    color: nextAccent(),
    sectionIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.putNotebook(nb);
  // у каждого нового блокнота сразу создаём раздел и страницу по умолчанию
  const section = await createSection(nb, "Раздел 1");
  await createPage(section, "Страница 1");
  return nb;
}

export async function renameNotebook(nb: Notebook, name: string) {
  nb.name = name;
  nb.updatedAt = Date.now();
  await db.putNotebook(nb);
}

export async function deleteNotebook(nb: Notebook) {
  const sections = await db.getSectionsByNotebook(nb.id);
  for (const s of sections) {
    await deleteSection(s, false);
  }
  await db.deleteNotebook(nb.id);
}

export async function createSection(nb: Notebook, name: string): Promise<Section> {
  const now = Date.now();
  const section: Section = {
    id: uid(),
    notebookId: nb.id,
    name,
    color: nb.color,
    pageIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.putSection(section);
  nb.sectionIds.push(section.id);
  nb.updatedAt = now;
  await db.putNotebook(nb);
  return section;
}

export async function renameSection(section: Section, name: string) {
  section.name = name;
  section.updatedAt = Date.now();
  await db.putSection(section);
}

export async function deleteSection(section: Section, updateNotebook = true) {
  const pages = await db.getPagesBySection(section.id);
  for (const p of pages) {
    await deletePage(p, false);
  }
  await db.deleteSection(section.id);
  if (updateNotebook) {
    const notebooks = await db.getAllNotebooks();
    const nb = notebooks.find((n) => n.id === section.notebookId);
    if (nb) {
      nb.sectionIds = nb.sectionIds.filter((id) => id !== section.id);
      nb.updatedAt = Date.now();
      await db.putNotebook(nb);
    }
  }
}

export async function createPage(
  section: Section,
  title: string,
  background: PageBackground = "blank",
  paperColor: PaperColor = "white"
): Promise<Page> {
  const now = Date.now();
  const page: Page = {
    id: uid(),
    sectionId: section.id,
    title,
    createdAt: now,
    updatedAt: now,
    width: 1600,
    height: 2200,
    background,
    paperColor,
  };
  await db.putPage(page);
  section.pageIds.push(page.id);
  section.updatedAt = now;
  await db.putSection(section);
  return page;
}

export async function renamePage(page: Page, title: string) {
  page.title = title;
  page.updatedAt = Date.now();
  await db.putPage(page);
}

export async function deletePage(page: Page, updateSection = true) {
  const strokes = await db.getStrokesByPage(page.id);
  await db.deleteStrokesByIds(strokes.map((s) => s.id));
  const textBlocks = await db.getTextBlocksByPage(page.id);
  await db.deleteTextBlocksByIds(textBlocks.map((t) => t.id));
  const imageBlocks = await db.getImageBlocksByPage(page.id);
  await db.deleteImageBlocksByIds(imageBlocks.map((i) => i.id));
  await db.deletePage(page.id);
  if (updateSection) {
    const section = await db.getSection(page.sectionId);
    if (section) {
      section.pageIds = section.pageIds.filter((id) => id !== page.id);
      section.updatedAt = Date.now();
      await db.putSection(section);
    }
  }
}
