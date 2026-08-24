// Панель администрирования пользователей — как в File Browser: список,
// добавление, смена пароля/роли, удаление. Сервер сам отклонит запрос,
// если текущий пользователь не админ (403) — на этот случай просто
// уводим на страницу входа.

let me = null;

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401 || res.status === 403) {
    location.href = "/login.html";
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function fmtDate(s) {
  try {
    return new Date(s.replace(" ", "T") + "Z").toLocaleDateString("ru-RU");
  } catch {
    return s;
  }
}

async function loadUsers() {
  const users = await api("/api/admin/users");
  const body = document.getElementById("users-body");
  body.innerHTML = "";
  for (const u of users) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = u.username;
    tr.appendChild(nameTd);

    const roleTd = document.createElement("td");
    if (u.is_admin) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "админ";
      roleTd.appendChild(badge);
    } else {
      roleTd.textContent = "пользователь";
    }
    tr.appendChild(roleTd);

    const dateTd = document.createElement("td");
    dateTd.textContent = fmtDate(u.created_at);
    tr.appendChild(dateTd);

    const actionsTd = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = u.is_admin ? "Снять админа" : "Сделать админом";
    toggleBtn.onclick = async () => {
      try {
        await api(`/api/admin/users/${u.id}`, {
          method: "PUT",
          body: JSON.stringify({ is_admin: !u.is_admin }),
        });
        await loadUsers();
      } catch (e) {
        alert(e.message);
      }
    };
    actions.appendChild(toggleBtn);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Сбросить пароль";
    resetBtn.onclick = async () => {
      const pw = prompt(`Новый пароль для «${u.username}» (мин. 6 символов):`);
      if (!pw) return;
      try {
        await api(`/api/admin/users/${u.id}`, {
          method: "PUT",
          body: JSON.stringify({ password: pw }),
        });
        alert("Пароль обновлён");
      } catch (e) {
        alert(e.message);
      }
    };
    actions.appendChild(resetBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "Удалить";
    delBtn.className = "danger";
    delBtn.onclick = async () => {
      if (!confirm(`Удалить пользователя «${u.username}»?`)) return;
      try {
        await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
        await loadUsers();
      } catch (e) {
        alert(e.message);
      }
    };
    actions.appendChild(delBtn);

    actionsTd.appendChild(actions);
    tr.appendChild(actionsTd);
    body.appendChild(tr);
  }
}

document.getElementById("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("create-error");
  errorEl.hidden = true;
  const username = document.getElementById("new-username").value.trim();
  const password = document.getElementById("new-password").value;
  const is_admin = document.getElementById("new-is-admin").checked;
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, password, is_admin }),
    });
    e.target.reset();
    await loadUsers();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

document.getElementById("change-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("password-error");
  const okEl = document.getElementById("password-ok");
  errorEl.hidden = true;
  okEl.hidden = true;
  const old_password = document.getElementById("old-password").value;
  const new_password = document.getElementById("new-own-password").value;
  try {
    await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({ old_password, new_password }),
    });
    e.target.reset();
    okEl.hidden = false;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

document.getElementById("logout-btn").onclick = async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login.html";
};

(async () => {
  try {
    me = await api("/api/me");
    if (me.is_admin) {
      document.getElementById("page-title").textContent = "Пользователи и аккаунт";
      document.getElementById("admin-only-create").hidden = false;
      document.getElementById("admin-only-list").hidden = false;
      await loadUsers();
    }
  } catch {
    // api() уже перенаправил на /login.html при 401/403
  }
})();
