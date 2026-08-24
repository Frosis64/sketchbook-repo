#!/usr/bin/env bash
# Разворачивает Скетчбук на notes.frosis.kz: копирует frontend+server в
# /opt/notes-app, ставит python-зависимости в venv, поднимает systemd-сервис
# с gunicorn, настраивает nginx-сайт и выпускает HTTPS через certbot.
#
# Запускать НА СЕРВЕРЕ (frosis.kz), с правами root, из корня распакованного
# архива — то есть там, где лежат папки frontend/ и server/ рядом с этим
# скриптом:
#   sudo bash deploy/deploy.sh
#
# Скрипт идемпотентен — можно запускать повторно после обновления сборки
# (просто замените содержимое frontend/, см. README.md "Обновление").

set -euo pipefail

DOMAIN="notes.frosis.kz"
APP_DIR="/opt/notes-app"
PORT="8091"
SERVICE_NAME="notes-app"
RUN_USER="www-data"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Запустите через sudo: sudo bash deploy/deploy.sh" >&2
  exit 1
fi

if [[ ! -d "$SCRIPT_DIR/frontend" || ! -d "$SCRIPT_DIR/server" ]]; then
  echo "Не вижу frontend/ и server/ рядом со скриптом — запускайте из корня распакованного архива." >&2
  exit 1
fi

echo "==> Устанавливаю системные пакеты (python3, venv, nginx, certbot)…"
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip nginx certbot python3-certbot-nginx

echo "==> Копирую приложение в $APP_DIR…"
mkdir -p "$APP_DIR"
rsync -a --delete "$SCRIPT_DIR/frontend/" "$APP_DIR/frontend/"
# server/ копируем БЕЗ --delete и не трогаем users.db/.flask_secret_key при
# повторных запусках — иначе каждый деплой сбрасывал бы пользователей.
mkdir -p "$APP_DIR/server"
rsync -a --exclude 'users.db' --exclude '.flask_secret_key' --exclude 'INITIAL_ADMIN_CREDENTIALS.txt' --exclude 'venv' \
  "$SCRIPT_DIR/server/" "$APP_DIR/server/"

echo "==> Настраиваю Python venv и зависимости…"
if [[ ! -d "$APP_DIR/server/venv" ]]; then
  python3 -m venv "$APP_DIR/server/venv"
fi
"$APP_DIR/server/venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/server/venv/bin/pip" install --quiet -r "$APP_DIR/server/requirements.txt"

chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

echo "==> Создаю systemd-сервис $SERVICE_NAME…"
cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Sketchbook notes app (Flask + gunicorn)
After=network.target

[Service]
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$APP_DIR/server
ExecStart=$APP_DIR/server/venv/bin/gunicorn --workers 2 --bind 127.0.0.1:$PORT app:app
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "==> Настраиваю nginx-сайт для $DOMAIN…"
cat > "/etc/nginx/sites-available/$DOMAIN" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 55m;  # заметки+картинки идут как JSON в теле запросов (см. MAX_CONTENT_LENGTH в server/app.py)

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t
systemctl reload nginx

echo "==> Настраиваю HTTPS (certbot)…"
# ВАЖНО: блок nginx-сайта выше мы каждый раз перезаписываем с нуля (для
# идемпотентности — чтобы новые настройки вроде client_max_body_size всегда
# доезжали), а значит на каждом повторном запуске стираем и SSL-блок,
# который certbot когда-то дописал в этот файл. Раньше при уже существующем
# сертификате certbot вообще не вызывался — и сайт оставался без HTTPS до
# следующего вызова certbot вручную. Теперь мы ВСЕГДА прогоняем certbot:
# если валидного сертификата ещё нет — выпускаем новый и настраиваем nginx;
# если уже есть — не переиздаём его, а только заново прогоняем шаг установки
# (`certbot install`), который допишет SSL-блок и редирект в nginx-конфиг.
if ! certbot certificates 2>/dev/null | grep -q "Domains: $DOMAIN"; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect -m "admin@$DOMAIN" || \
    echo "certbot не смог выпустить сертификат автоматически — проверьте, что DNS-запись $DOMAIN уже указывает на этот сервер, и запустите вручную: certbot --nginx -d $DOMAIN"
else
  echo "Сертификат для $DOMAIN уже есть — не переиздаю, но обновляю HTTPS-конфиг nginx под него…"
  certbot install --cert-name "$DOMAIN" --nginx --non-interactive --redirect || \
    echo "certbot install не смог настроить nginx — запустите вручную: certbot install --cert-name $DOMAIN --nginx"
fi

echo
echo "==> Готово. Проверка статуса сервиса:"
systemctl --no-pager status "$SERVICE_NAME" | head -n 5

if [[ -f "$APP_DIR/server/INITIAL_ADMIN_CREDENTIALS.txt" ]]; then
  echo
  echo "==> Первый запуск — учётка администратора:"
  cat "$APP_DIR/server/INITIAL_ADMIN_CREDENTIALS.txt"
fi

echo
echo "Приложение должно быть доступно на https://$DOMAIN"
