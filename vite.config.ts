import { defineConfig } from "vite";

// Проксируем запросы к бэкенду (server/app.py) в dev-режиме, чтобы
// `npm run dev` работал против локально поднятого Flask (см. README) —
// заметки теперь хранятся на сервере, без бэкенда приложение не работает
// даже в разработке.
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8091",
      "/login.html": "http://127.0.0.1:8091",
      "/login.css": "http://127.0.0.1:8091",
      "/login.js": "http://127.0.0.1:8091",
      "/admin.html": "http://127.0.0.1:8091",
      "/admin.css": "http://127.0.0.1:8091",
      "/admin.js": "http://127.0.0.1:8091",
    },
  },
});
