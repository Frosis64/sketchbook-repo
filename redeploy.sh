#!/usr/bin/env bash
# Обновление сервера одной командой: подтягивает свежий код из git,
# собирает фронтенд и разворачивает через deploy/update.sh.
#
# Запускать НА СЕРВЕРЕ, из папки с клоном репозитория:
#   bash redeploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Подтягиваю свежий код (git pull)…"
git pull

echo "==> Ставлю зависимости и собираю фронтенд…"
npm ci
npm run build
rm -rf frontend
cp -r dist frontend

echo "==> Разворачиваю на сервере (нужен sudo)…"
sudo bash deploy/update.sh

echo "Готово."
