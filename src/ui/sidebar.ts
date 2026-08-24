// Боковая панель: дерево Блокноты -> Разделы -> Страницы.
// Простая императивная отрисовка в DOM (без фреймворка) — достаточно для
// объёма UI этого приложения и не тянет лишних зависимостей.

import { db } from "../db/db";
import * as repo from "../db/repo";
import { applyTheme, getStoredTheme, THEMES } from "./theme";
import { icon } from "./icons";
import { closeFloatingPanel, isFloatingPanelOpen, openFloatingPanel } from "./floatingPanel";
import type { Notebook, Page, Section } from "../types";

export interface SidebarCallbacks {
  onOpenPage: (page: Page, section: Section, notebook: Notebook) => void;
}

export class Sidebar {
  private el: HTMLElement;
  private listEl: HTMLElement;
  private notebooks: Notebook[] = [];
  private sectionsByNotebook = new Map<string, Section[]>();
  private pagesBySection = new Map<string, Page[]>();
  private expandedNotebooks = new Set<string>();
  private expandedSections = new Set<string>();
  private activePageId: string | null = null;
  private cb: SidebarCallbacks;

  constructor(el: HTMLElement, cb: SidebarCallbacks) {
    this.el = el;
    this.cb = cb;
    this.listEl = document.createElement("div");
    this.listEl.className = "nb-list";
    this.buildHeader();
    this.el.appendChild(this.listEl);
  }

  /** Статичная шапка (название + кнопки) создаётся один раз и не пересоздаётся при каждом render(). */
  private buildHeader() {
    const header = document.createElement("div");
    header.className = "sidebar-header";

    const brand = document.createElement("span");
    brand.className = "brand";
    brand.innerHTML = `${icon("notebook")} Скетчбук`;
    header.appendChild(brand);

    const actions = document.createElement("div");
    actions.className = "sidebar-header-actions";

    // ---------- Тема оформления ----------
    const themeWrap = document.createElement("div");
    themeWrap.className = "theme-picker";
    const themeBtn = document.createElement("button");
    themeBtn.className = "icon-btn";
    themeBtn.title = "Тема оформления";
    themeBtn.innerHTML = icon("theme");
    const themePanel = document.createElement("div");
    themePanel.className = "theme-panel";
    themePanel.style.display = "none";
    for (const t of THEMES) {
      const b = document.createElement("button");
      b.className = "theme-swatch";
      b.style.background = t.swatch;
      b.title = t.label;
      b.dataset.theme = t.id;
      b.onclick = () => {
        applyTheme(t.id);
        refreshThemeActive();
        closeFloatingPanel(themePanel);
      };
      themePanel.appendChild(b);
    }
    function refreshThemeActive() {
      const current = getStoredTheme();
      themePanel.querySelectorAll<HTMLButtonElement>(".theme-swatch").forEach((b) => {
        b.classList.toggle("active", b.dataset.theme === current);
      });
    }
    themeBtn.onclick = () => {
      if (isFloatingPanelOpen(themePanel)) {
        closeFloatingPanel(themePanel);
      } else {
        openFloatingPanel(themeBtn, themePanel);
        refreshThemeActive();
      }
    };
    document.addEventListener("click", (e) => {
      if (!themeWrap.contains(e.target as Node)) closeFloatingPanel(themePanel);
    });
    themeWrap.appendChild(themeBtn);
    themeWrap.appendChild(themePanel);
    actions.appendChild(themeWrap);

    const addBtn = document.createElement("button");
    addBtn.className = "icon-btn";
    addBtn.title = "Новый блокнот";
    addBtn.innerHTML = icon("plus");
    addBtn.onclick = async () => {
      const name = prompt("Название блокнота:", "Новый блокнот");
      if (!name) return;
      await repo.createNotebook(name);
      await this.load();
    };
    actions.appendChild(addBtn);

    header.appendChild(actions);
    this.el.appendChild(header);
  }

  async load() {
    this.notebooks = (await db.getAllNotebooks()).sort((a, b) => a.createdAt - b.createdAt);
    for (const nb of this.notebooks) {
      const sections = (await db.getSectionsByNotebook(nb.id)).sort(
        (a, b) => a.createdAt - b.createdAt
      );
      this.sectionsByNotebook.set(nb.id, sections);
      for (const s of sections) {
        const pages = (await db.getPagesBySection(s.id)).sort((a, b) => a.createdAt - b.createdAt);
        this.pagesBySection.set(s.id, pages);
      }
    }
    if (this.notebooks.length === 0) {
      await repo.createNotebook("Мой блокнот");
      await this.load();
      return;
    }
    this.expandedNotebooks.add(this.notebooks[0].id);
    const firstSections = this.sectionsByNotebook.get(this.notebooks[0].id) || [];
    if (firstSections[0]) this.expandedSections.add(firstSections[0].id);
    this.render();

    // открыть первую страницу первого раздела по умолчанию
    const firstSection = firstSections[0];
    const firstPage = firstSection ? this.pagesBySection.get(firstSection.id)?.[0] : undefined;
    if (firstSection && firstPage) {
      this.setActivePage(firstPage.id);
      this.cb.onOpenPage(firstPage, firstSection, this.notebooks[0]);
    }
  }

  setActivePage(pageId: string) {
    this.activePageId = pageId;
    this.render();
  }

  private render() {
    this.listEl.innerHTML = "";
    for (const nb of this.notebooks) {
      this.listEl.appendChild(this.renderNotebook(nb));
    }
  }

  private renderNotebook(nb: Notebook): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "notebook";

    const row = document.createElement("div");
    row.className = "nb-row";
    row.style.setProperty("--accent", nb.color);
    const expanded = this.expandedNotebooks.has(nb.id);
    row.innerHTML = `<span class="chevron ${expanded ? "open" : ""}">${icon("chevron")}</span><span class="dot"></span><span class="nb-name">${escapeHtml(nb.name)}</span>`;
    row.onclick = () => {
      if (expanded) this.expandedNotebooks.delete(nb.id);
      else this.expandedNotebooks.add(nb.id);
      this.render();
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      this.showMenu(e, [
        {
          label: "Переименовать",
          action: async () => {
            const name = prompt("Новое название:", nb.name);
            if (name) {
              await repo.renameNotebook(nb, name);
              await this.load();
            }
          },
        },
        {
          label: "Новый раздел",
          action: async () => {
            const name = prompt("Название раздела:", "Новый раздел");
            if (name) {
              await repo.createSection(nb, name);
              this.expandedNotebooks.add(nb.id);
              await this.load();
            }
          },
        },
        {
          label: "Удалить блокнот",
          danger: true,
          action: async () => {
            if (confirm(`Удалить блокнот «${nb.name}» со всем содержимым?`)) {
              await repo.deleteNotebook(nb);
              await this.load();
            }
          },
        },
      ]);
    };
    wrap.appendChild(row);

    if (expanded) {
      const sections = this.sectionsByNotebook.get(nb.id) || [];
      const sectionList = document.createElement("div");
      sectionList.className = "section-list";
      for (const s of sections) {
        sectionList.appendChild(this.renderSection(nb, s));
      }
      wrap.appendChild(sectionList);
    }

    return wrap;
  }

  private renderSection(nb: Notebook, section: Section): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "section";

    const row = document.createElement("div");
    row.className = "sec-row";
    row.style.setProperty("--accent", section.color);
    const expanded = this.expandedSections.has(section.id);
    row.innerHTML = `<span class="chevron ${expanded ? "open" : ""}">${icon("chevron")}</span><span class="row-icon">${icon("section")}</span><span class="sec-name">${escapeHtml(section.name)}</span>`;
    row.onclick = () => {
      if (expanded) this.expandedSections.delete(section.id);
      else this.expandedSections.add(section.id);
      this.render();
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      this.showMenu(e, [
        {
          label: "Переименовать",
          action: async () => {
            const name = prompt("Новое название:", section.name);
            if (name) {
              await repo.renameSection(section, name);
              await this.load();
            }
          },
        },
        {
          label: "Новая страница",
          action: async () => {
            const page = await repo.createPage(section, `Страница ${(this.pagesBySection.get(section.id)?.length || 0) + 1}`);
            this.expandedSections.add(section.id);
            await this.load();
            this.setActivePage(page.id);
            this.cb.onOpenPage(page, section, nb);
          },
        },
        {
          label: "Удалить раздел",
          danger: true,
          action: async () => {
            if (confirm(`Удалить раздел «${section.name}» со всеми страницами?`)) {
              await repo.deleteSection(section);
              await this.load();
            }
          },
        },
      ]);
    };
    wrap.appendChild(row);

    if (expanded) {
      const pages = this.pagesBySection.get(section.id) || [];
      const pageList = document.createElement("div");
      pageList.className = "page-list";
      for (const p of pages) {
        const pageRow = document.createElement("div");
        pageRow.className = "page-row" + (p.id === this.activePageId ? " active" : "");
        pageRow.innerHTML = `<span class="row-icon">${icon("page")}</span><span class="page-title">${escapeHtml(p.title)}</span>`;
        pageRow.onclick = (e) => {
          e.stopPropagation();
          this.setActivePage(p.id);
          this.cb.onOpenPage(p, section, nb);
        };
        pageRow.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.showMenu(e, [
            {
              label: "Переименовать",
              action: async () => {
                const name = prompt("Новое название:", p.title);
                if (name) {
                  await repo.renamePage(p, name);
                  await this.load();
                }
              },
            },
            {
              label: "Удалить страницу",
              danger: true,
              action: async () => {
                if (confirm(`Удалить страницу «${p.title}»?`)) {
                  await repo.deletePage(p);
                  await this.load();
                }
              },
            },
          ]);
        };
        pageList.appendChild(pageRow);
      }
      const addPageBtn = document.createElement("div");
      addPageBtn.className = "page-row add-page";
      addPageBtn.innerHTML = `<span class="row-icon">${icon("plus")}</span>Новая страница`;
      addPageBtn.onclick = async (e) => {
        e.stopPropagation();
        const page = await repo.createPage(section, `Страница ${pages.length + 1}`);
        await this.load();
        this.setActivePage(page.id);
        this.cb.onOpenPage(page, section, nb);
      };
      pageList.appendChild(addPageBtn);
      wrap.appendChild(pageList);
    }

    return wrap;
  }

  private showMenu(e: MouseEvent, items: { label: string; action: () => void; danger?: boolean }[]) {
    const existing = document.querySelector(".ctx-menu");
    if (existing) existing.remove();
    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    for (const item of items) {
      const b = document.createElement("button");
      b.textContent = item.label;
      if (item.danger) b.className = "danger";
      b.onclick = () => {
        menu.remove();
        item.action();
      };
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const closeOnClickAway = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener("click", closeOnClickAway);
      }
    };
    setTimeout(() => document.addEventListener("click", closeOnClickAway), 0);
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
