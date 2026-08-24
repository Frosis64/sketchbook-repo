"""
Flask-бэкенд для Скетчбука: логин + администрирование пользователей (как в
File Browser) + хранение самих заметок на сервере (как в Google Docs —
раньше блокноты/страницы/штрихи лежали в IndexedDB браузера, теперь в
SQLite на сервере, у каждого пользователя — свои, по user_id). Задачи:
  - гейтит доступ к статике SPA (никто без логина не увидит и не откроет
    приложение — редиректит на /login.html);
  - /api/login, /api/logout, /api/me — сессия на cookie (никаких паролей
    в localStorage/URL);
  - /api/admin/users* — CRUD пользователей, доступно только is_admin=1;
  - /api/change-password — сменить свой пароль (обязательно после первого
    входа под сгенерированным паролем администратора);
  - /api/<entity>/... — универсальный CRUD для notebooks/sections/pages/
    strokes/text_blocks/image_blocks (см. ENTITY_CONFIG ниже) + /api/meta —
    хранение самих заметок.

Хранилище: SQLite-файл users.db рядом со скриптом (создаётся сам при
первом запуске, вместе с учёткой admin со случайным паролем — пароль
один раз печатается в лог и сохраняется в INITIAL_ADMIN_CREDENTIALS.txt).
Заметки хранятся в том же файле — каждая запись целиком как JSON в колонке
data (ровно та же форма объекта, что использует фронтенд, см. src/types.ts),
плюс отдельная колонка с id родителя для быстрой выборки списком. Это
специально сделано без ORM/схемы под каждое поле, чтобы фронтенд и бэкенд
не приходилось синхронно держать в лок-степе при каждом новом поле в
Stroke/Page/итд.
"""

import json
import os
import secrets
import sqlite3
from datetime import timedelta
from pathlib import Path

from flask import Flask, jsonify, redirect, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = (BASE_DIR.parent / "frontend").resolve()
DB_PATH = BASE_DIR / "users.db"
SECRET_FILE = BASE_DIR / ".flask_secret_key"
CRED_FILE = BASE_DIR / "INITIAL_ADMIN_CREDENTIALS.txt"

app = Flask(__name__, static_folder=None)
# Вставленные картинки идут как base64 в JSON — поднимаем лимит тела запроса
# (по умолчанию у Flask лимита нет, но выставим разумный потолок против
# случайных/вредоносных гигантских запросов). См. также client_max_body_size
# в конфиге nginx (deploy/deploy.sh) — его тоже нужно поднять вместе с этим.
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

# Секрет сессии — генерируется один раз и сохраняется в файл (0600), а не
# перегенерируется на каждый рестарт (иначе все сессии слетали бы при
# каждом деплое/рестарте systemd-юнита).
if SECRET_FILE.exists():
    app.secret_key = SECRET_FILE.read_text().strip()
else:
    app.secret_key = secrets.token_hex(32)
    SECRET_FILE.write_text(app.secret_key)
    os.chmod(SECRET_FILE, 0o600)

app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# За nginx с Let's Encrypt cookie должна быть Secure; для локального теста
# по http выставьте переменную окружения NOTES_APP_INSECURE_COOKIE=1.
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("NOTES_APP_INSECURE_COOKIE") != "1"


# entity (URL/имя таблицы) -> поле в JSON-теле, содержащее id родителя, и
# имя колонки, в которую его сохраняем для быстрой выборки списком по
# родителю. None у notebooks — у них родителя нет, они привязаны только
# к user_id (весь список принадлежит текущему пользователю).
ENTITY_CONFIG = {
    "notebooks": None,
    "sections": ("notebookId", "notebook_id"),
    "pages": ("sectionId", "section_id"),
    "strokes": ("pageId", "page_id"),
    "text_blocks": ("pageId", "page_id"),
    "image_blocks": ("pageId", "page_id"),
}


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    for entity, parent in ENTITY_CONFIG.items():
        parent_col_def = f"{parent[1]} TEXT," if parent else ""
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {entity} (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                {parent_col_def}
                data TEXT NOT NULL
            )
            """
        )
        if parent:
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{entity}_{parent[1]} ON {entity}({parent[1]}, user_id)"
            )
        else:
            conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{entity}_user ON {entity}(user_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            user_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            PRIMARY KEY (user_id, key)
        )
        """
    )
    conn.commit()
    # gunicorn поднимает несколько воркеров одновременно, и каждый импортирует
    # этот модуль (а значит, вызывает init_db()) параллельно — раньше здесь
    # была проверка "COUNT(*) == 0" с последующим INSERT, и при одновременном
    # первом запуске второй воркер падал с UNIQUE constraint failed (гонка
    # между проверкой и вставкой). INSERT OR IGNORE атомарен на уровне SQL,
    # так гонки быть не может: вставится только одна запись, независимо от
    # того, сколько воркеров сюда одновременно попадут.
    generated_password = None
    count_before = conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
    if count_before == 0:
        generated_password = secrets.token_urlsafe(9)
        cur = conn.execute(
            "INSERT OR IGNORE INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
            ("admin", generate_password_hash(generated_password)),
        )
        conn.commit()
        if cur.rowcount == 0:
            # другой воркер уже создал admin первым — наш сгенерированный
            # пароль ни к чему не относится, файл с ним писать не нужно.
            generated_password = None
    conn.close()
    if generated_password:
        CRED_FILE.write_text(
            "Первичная учётка администратора Скетчбука\n"
            "=========================================\n"
            "логин:  admin\n"
            f"пароль: {generated_password}\n\n"
            "Смените пароль после первого входа (кнопка с логином в шапке →\n"
            "«Сменить пароль»), а этот файл можно удалить.\n"
        )
        os.chmod(CRED_FILE, 0o600)
        print(f"[notes-app] создан администратор admin / {generated_password}")
        print(f"[notes-app] пароль сохранён в {CRED_FILE}")


init_db()


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    conn = get_db()
    row = conn.execute("SELECT id, username, is_admin FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return dict(row) if row else None


def require_admin():
    user = current_user()
    if not user or not user["is_admin"]:
        return None
    return user


# ------------------------------------------------------------------ auth --

@app.post("/api/login")
def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "Неверный логин или пароль"}), 401
    session.clear()
    session.permanent = True
    session["uid"] = row["id"]
    return jsonify({"username": row["username"], "is_admin": bool(row["is_admin"])})


@app.post("/api/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def api_me():
    user = current_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    return jsonify({"username": user["username"], "is_admin": bool(user["is_admin"])})


@app.post("/api/change-password")
def api_change_password():
    user = current_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    old_password = data.get("old_password") or ""
    new_password = data.get("new_password") or ""
    if len(new_password) < 6:
        return jsonify({"error": "Новый пароль — минимум 6 символов"}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    if not check_password_hash(row["password_hash"], old_password):
        conn.close()
        return jsonify({"error": "Старый пароль неверен"}), 400
    conn.execute(
        "UPDATE users SET password_hash=? WHERE id=?",
        (generate_password_hash(new_password), user["id"]),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# --------------------------------------------------------- администрирование --

@app.get("/api/admin/users")
def admin_list_users():
    if not require_admin():
        return jsonify({"error": "forbidden"}), 403
    conn = get_db()
    rows = conn.execute(
        "SELECT id, username, is_admin, created_at FROM users ORDER BY id"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.post("/api/admin/users")
def admin_create_user():
    if not require_admin():
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    is_admin = bool(data.get("is_admin"))
    if not username or len(password) < 6:
        return jsonify({"error": "Логин обязателен, пароль — минимум 6 символов"}), 400
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
            (username, generate_password_hash(password), int(is_admin)),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "Такой логин уже существует"}), 409
    conn.close()
    return jsonify({"ok": True}), 201


@app.put("/api/admin/users/<int:user_id>")
def admin_update_user(user_id):
    admin = require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404

    fields, params = [], []
    if data.get("password"):
        if len(data["password"]) < 6:
            conn.close()
            return jsonify({"error": "Пароль — минимум 6 символов"}), 400
        fields.append("password_hash=?")
        params.append(generate_password_hash(data["password"]))
    if "is_admin" in data:
        new_is_admin = bool(data["is_admin"])
        if row["id"] == admin["id"] and not new_is_admin:
            # нельзя разжаловать самого себя, если ты последний админ
            admin_count = conn.execute(
                "SELECT COUNT(*) c FROM users WHERE is_admin=1"
            ).fetchone()["c"]
            if admin_count <= 1:
                conn.close()
                return jsonify({"error": "Нельзя снять права последнего администратора"}), 400
        fields.append("is_admin=?")
        params.append(int(new_is_admin))
    if not fields:
        conn.close()
        return jsonify({"error": "Нечего обновлять"}), 400

    params.append(user_id)
    conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id=?", params)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/admin/users/<int:user_id>")
def admin_delete_user(user_id):
    admin = require_admin()
    if not admin:
        return jsonify({"error": "forbidden"}), 403
    if user_id == admin["id"]:
        return jsonify({"error": "Нельзя удалить самого себя"}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if row and row["is_admin"]:
        admin_count = conn.execute(
            "SELECT COUNT(*) c FROM users WHERE is_admin=1"
        ).fetchone()["c"]
        if admin_count <= 1:
            conn.close()
            return jsonify({"error": "Нельзя удалить последнего администратора"}), 400
    conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------- данные заметок --
# Универсальный CRUD для notebooks/sections/pages/strokes/text_blocks/
# image_blocks — каждая запись хранится целиком как JSON (см. ENTITY_CONFIG
# и пояснение в шапке файла). Один и тот же набор роутов обслуживает все
# сущности через <entity> с белым списком допустимых имён (ниже), поэтому
# имя таблицы в SQL всегда безопасно (не приходит от клиента напрямую в
# запрос) — значения по-прежнему параметризуются.

ENTITY_NAMES = ",".join(ENTITY_CONFIG.keys())


def require_login():
    return current_user()


@app.get(f"/api/<any({ENTITY_NAMES}):entity>")
def list_entities(entity):
    user = require_login()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    parent = ENTITY_CONFIG[entity]
    conn = get_db()
    if parent:
        parent_id = request.args.get("parent")
        if not parent_id:
            conn.close()
            return jsonify({"error": "parent обязателен для " + entity}), 400
        rows = conn.execute(
            f"SELECT data FROM {entity} WHERE user_id=? AND {parent[1]}=?",
            (user["id"], parent_id),
        ).fetchall()
    else:
        rows = conn.execute(f"SELECT data FROM {entity} WHERE user_id=?", (user["id"],)).fetchall()
    conn.close()
    return jsonify([json.loads(r["data"]) for r in rows])


@app.get(f"/api/<any({ENTITY_NAMES}):entity>/<item_id>")
def get_entity(entity, item_id):
    user = require_login()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    conn = get_db()
    row = conn.execute(
        f"SELECT data FROM {entity} WHERE id=? AND user_id=?", (item_id, user["id"])
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify(json.loads(row["data"]))


@app.put(f"/api/<any({ENTITY_NAMES}):entity>/<item_id>")
def put_entity(entity, item_id):
    user = require_login()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "invalid body"}), 400

    conn = get_db()
    existing = conn.execute(f"SELECT user_id FROM {entity} WHERE id=?", (item_id,)).fetchone()
    if existing and existing["user_id"] != user["id"]:
        conn.close()
        return jsonify({"error": "forbidden"}), 403

    parent = ENTITY_CONFIG[entity]
    data_json = json.dumps(body)
    if parent:
        parent_val = body.get(parent[0])
        conn.execute(
            f"INSERT INTO {entity} (id, user_id, {parent[1]}, data) VALUES (?, ?, ?, ?) "
            f"ON CONFLICT(id) DO UPDATE SET {parent[1]}=excluded.{parent[1]}, data=excluded.data",
            (item_id, user["id"], parent_val, data_json),
        )
    else:
        conn.execute(
            f"INSERT INTO {entity} (id, user_id, data) VALUES (?, ?, ?) "
            f"ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            (item_id, user["id"], data_json),
        )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete(f"/api/<any({ENTITY_NAMES}):entity>/<item_id>")
def delete_entity(entity, item_id):
    user = require_login()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    conn = get_db()
    existing = conn.execute(f"SELECT user_id FROM {entity} WHERE id=?", (item_id,)).fetchone()
    if existing and existing["user_id"] != user["id"]:
        conn.close()
        return jsonify({"error": "forbidden"}), 403
    conn.execute(f"DELETE FROM {entity} WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.get("/api/meta/<key>")
def get_meta(key):
    user = require_login()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    conn = get_db()
    row = conn.execute(
        "SELECT value FROM meta WHERE user_id=? AND key=?", (user["id"], key)
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify({"key": key, "value": json.loads(row["value"])})


@app.put("/api/meta/<key>")
def put_meta(key):
    user = require_login()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    body = request.get_json(silent=True) or {}
    conn = get_db()
    conn.execute(
        "INSERT INTO meta (user_id, key, value) VALUES (?, ?, ?) "
        "ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value",
        (user["id"], key, json.dumps(body.get("value"))),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- статика --

@app.route("/login.html")
def login_page():
    return send_from_directory(FRONTEND_DIR, "login.html")


@app.route("/login.css")
def login_css():
    return send_from_directory(FRONTEND_DIR, "login.css")


@app.route("/login.js")
def login_js():
    return send_from_directory(FRONTEND_DIR, "login.js")


@app.route("/admin.html")
def admin_page():
    # Доступна любому залогиненному (там же смена собственного пароля) —
    # раздел управления пользователями admin.js сам скрывает, если
    # текущий пользователь не администратор; сами admin-эндпоинты API
    # всё равно защищены require_admin() на сервере.
    if not current_user():
        return redirect("/login.html")
    return send_from_directory(FRONTEND_DIR, "admin.html")


@app.route("/admin.css")
def admin_css():
    return send_from_directory(FRONTEND_DIR, "admin.css")


@app.route("/admin.js")
def admin_js():
    return send_from_directory(FRONTEND_DIR, "admin.js")


@app.route("/assets/<path:filename>")
def assets(filename):
    # Сами по себе JS/CSS сборки не содержат чужих данных, но всё равно
    # отдаём их только залогиненным — чтобы посторонние не видели даже
    # структуру приложения.
    if not current_user():
        return redirect("/login.html")
    return send_from_directory(FRONTEND_DIR / "assets", filename)


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path):
    if not current_user():
        return redirect("/login.html")
    return send_from_directory(FRONTEND_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8091)
