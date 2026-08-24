#!/usr/bin/env bash
# Быстрое обновление уже развёрнутого приложения (без переустановки
# nginx/certbot) — например, после того как я пришлю новую сборку.
# Запускать НА СЕРВЕРЕ, из корня нового распакованного архива:
#   sudo bash deploy/update.sh

set -euo pipefail

APP_DIR="/opt/notes-app"
SERVICE_NAME="notes-app"
RUN_USER="www-data"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Запустите через sudo: sudo bash deploy/update.sh" >&2
  exit 1
fi

echo "==> Обновляю frontend…"
rsync -a --delete "$SCRIPT_DIR/frontend/" "$APP_DIR/frontend/"

echo "==> Обновляю server (сохраняя users.db и секрет сессии)…"
rsync -a --exclude 'users.db' --exclude '.flask_secret_key' --exclude 'INITIAL_ADMIN_CREDENTIALS.txt' --exclude 'venv' \
  "$SCRIPT_DIR/server/" "$APP_DIR/server/"
"$APP_DIR/server/venv/bin/pip" install --quiet -r "$APP_DIR/server/requirements.txt"

chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

echo "==> Перезапускаю сервис…"
systemctl restart "$SERVICE_NAME"
systemctl --no-pager status "$SERVICE_NAME" | head -n 5
echo "Готово."
