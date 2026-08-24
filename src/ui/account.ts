// Маленький чип с аккаунтом в шапке сайдбара — показывает, кто залогинен,
// и даёт выйти / перейти на страницу аккаунта (admin.html: смена пароля,
// а для админов — ещё и управление пользователями). Появляется только
// когда есть подтверждённая сессия от бэкенда (server/app.py) — см.
// main.ts/checkAuth.

import { icon } from "./icons";
import { closeFloatingPanel, isFloatingPanelOpen, openFloatingPanel } from "./floatingPanel";

export function buildAccountChip(username: string, isAdmin: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "account-picker";

  const btn = document.createElement("button");
  btn.className = "icon-btn";
  btn.title = `Аккаунт: ${username}`;
  btn.innerHTML = icon("person");

  const panel = document.createElement("div");
  panel.className = "account-panel";
  panel.style.display = "none";

  const nameEl = document.createElement("div");
  nameEl.className = "account-panel-name";
  nameEl.textContent = username + (isAdmin ? " · админ" : "");
  panel.appendChild(nameEl);

  const accountLink = document.createElement("a");
  accountLink.href = "/admin.html";
  accountLink.className = "account-panel-link";
  accountLink.textContent = isAdmin ? "Пользователи и аккаунт" : "Сменить пароль";
  panel.appendChild(accountLink);

  const logoutBtn = document.createElement("button");
  logoutBtn.className = "account-panel-logout";
  logoutBtn.textContent = "Выйти";
  logoutBtn.onclick = async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      location.href = "/login.html";
    }
  };
  panel.appendChild(logoutBtn);

  btn.onclick = () => {
    if (isFloatingPanelOpen(panel)) closeFloatingPanel(panel);
    else openFloatingPanel(btn, panel);
  };
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target as Node)) closeFloatingPanel(panel);
  });

  wrap.appendChild(btn);
  wrap.appendChild(panel);
  return wrap;
}
