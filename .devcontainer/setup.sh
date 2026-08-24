#!/usr/bin/env bash
# Выполняется один раз при создании Codespace (см. postCreateCommand в
# devcontainer.json). Собирает фронтенд и готовит venv для Flask-бэкенда,
# чтобы после этого достаточно было запустить `npm run preview:full`.
set -euo pipefail

echo "==> Устанавливаю npm-зависимости и собираю фронтенд…"
npm install
npm run build

# server/app.py ищет собранный фронтенд в соседней папке "frontend" (так же
# устроен деплой-пакет — см. deploy/README.md). В самом репозитории сборка
# лежит в dist/, поэтому просто делаем symlink.
rm -rf frontend
ln -s dist frontend

echo "==> Готовлю Python venv для бэкенда…"
python3 -m venv server/venv
server/venv/bin/pip install --quiet --upgrade pip
server/venv/bin/pip install --quiet -r server/requirements.txt

echo "==> Готово. Запустите: npm run preview:full"
