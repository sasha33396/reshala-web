# Reshala Web

Веб-интерфейс управления флотом VPN-серверов поверх существующего bash-фреймворка **Решала**.

- **Backend** — NestJS + SSH (ssh2) + WebSocket (Socket.io)
- **Frontend** — Next.js 14 App Router + TailwindCSS + shadcn/ui + Recharts + xterm.js
- **Монорепо** — Turborepo (npm workspaces)

---

## Содержание

1. [Требования](#требования)
2. [Быстрый старт (разработка)](#быстрый-старт-разработка)
3. [Деплой через Docker Compose](#деплой-через-docker-compose)
4. [Настройка Nginx](#настройка-nginx)
5. [Переменные окружения](#переменные-окружения)
6. [Генерация пароля администратора](#генерация-пароля-администратора)
7. [Структура проекта](#структура-проекта)
8. [Команды](#команды)
9. [Архитектура](#архитектура)
10. [Решение проблем](#решение-проблем)

---

## Требования

| Инструмент | Минимальная версия | Для чего |
|---|---|---|
| Node.js | 20 LTS | Разработка и сборка |
| npm | 10+ | Управление пакетами |
| Docker | 24+ | Продакшн деплой |
| Docker Compose | v2 | Продакшн деплой |
| Nginx | любая | Reverse proxy (продакшн) |

**На сервере должен быть установлен оригинальный Решала:**
- Файл флота: `~/.reshala_fleet`
- SSH-ключи: `~/.ssh/id_ed25519_reshala_node_*`
- Плагины: `/opt/reshala/plugins/skynet_commands/`

---

## Быстрый старт (разработка)

### 1. Клонировать / распаковать проект

```bash
cd reshala-web
```

### 2. Установить зависимости

```bash
npm install
```

Turborepo установит зависимости для всех воркспейсов (`apps/backend`, `apps/frontend`, `packages/shared`).

### 3. Создать файл окружения

```bash
cp .env.example .env
```

Заполнить `.env` (см. раздел [Переменные окружения](#переменные-окружения)).

Обязательные поля для разработки:

```env
JWT_SECRET=любая-длинная-случайная-строка
ADMIN_PASSWORD_HASH=<bcrypt-хеш-пароля>   # см. раздел ниже
```

### 4. Сгенерировать хеш пароля

```bash
node -e "require('bcrypt').hash('ВАШ_ПАРОЛЬ', 10).then(h => console.log(h))"
```

> Если `bcrypt` ещё не установлен: `npm install bcrypt` в папке `apps/backend`.

Скопировать вывод в `.env`:

```env
ADMIN_PASSWORD_HASH=$2b$10$...полный-хеш...
```

### 5. Запустить в режиме разработки

```bash
npm run dev
```

Turborepo запустит параллельно:
- **Backend** → `http://localhost:3001`
- **Frontend** → `http://localhost:3000`

Открыть браузер: **http://localhost:3000**

> При первом запуске Next.js выполнит компиляцию — это займёт ~30 секунд.

---

## Деплой через Docker Compose

### 1. Подготовить `.env` на сервере

```bash
cp .env.example .env
nano .env
```

Минимальная конфигурация для продакшна:

```env
FLEET_DB_PATH=/app/fleet_db
SSH_KEYS_DIR=/app/ssh_keys
PLUGINS_DIR=/app/plugins
PROMETHEUS_URL=http://localhost:9090
JWT_SECRET=сгенерируйте-через-openssl-rand-hex-32
JWT_EXPIRES_IN=24h
ADMIN_PASSWORD_HASH=$2b$10$...
```

### 2. Сгенерировать JWT_SECRET

```bash
openssl rand -hex 32
```

### 3. Сгенерировать хеш пароля (на сервере)

```bash
node -e "const b=require('bcryptjs');b.hash('МОЙ_ПАРОЛЬ',10).then(h=>console.log(h))"
# или через Docker:
docker run --rm node:20-alpine node -e "require('bcrypt').hash('МОЙ_ПАРОЛЬ',10).then(h=>console.log(h))"
```

### 4. Собрать и запустить

```bash
# Первый запуск (сборка образов):
docker compose up -d --build

# Посмотреть логи:
docker compose logs -f

# Остановить:
docker compose down
```

### 5. Проверить работоспособность

```bash
# Backend health:
curl http://localhost:3001/api/auth/me

# Frontend:
curl -I http://localhost:3000
```

---

## Настройка Nginx

Скопировать шаблон конфига:

```bash
cp nginx.conf /etc/nginx/sites-available/reshala-web
```

Отредактировать домен:

```nginx
server {
    server_name manage.yourdomain.com;   # ← заменить

    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket для SSH терминала и плагинов
    location /socket.io {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Активировать и перезагрузить:

```bash
ln -s /etc/nginx/sites-available/reshala-web /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Получить SSL через Certbot:

```bash
certbot --nginx -d manage.yourdomain.com
```

---

## Переменные окружения

### Backend

| Переменная | По умолчанию | Описание |
|---|---|---|
| `FLEET_DB_PATH` | `~/.reshala_fleet` | Путь к файлу флота Решалы |
| `SSH_KEYS_DIR` | `~/.ssh` | Директория с SSH-ключами |
| `PLUGINS_DIR` | `/opt/reshala/plugins` | Директория с плагинами |
| `PROMETHEUS_URL` | `http://localhost:9090` | URL Prometheus для метрик |
| `JWT_SECRET` | **обязательно** | Секрет для подписи JWT-токенов |
| `JWT_EXPIRES_IN` | `24h` | Время жизни токена |
| `ADMIN_PASSWORD_HASH` | **обязательно** | bcrypt-хеш пароля администратора |
| `BACKEND_PORT` | `3001` | Порт backend-сервера |
| `FRONTEND_URL` | `http://localhost:3000` | URL фронтенда (для CORS) |

### Frontend

| Переменная | По умолчанию | Описание |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/api` | URL для API-запросов |
| `NEXT_PUBLIC_WS_URL` | *(пусто)* | URL для WebSocket. Пусто = тот же хост (через Nginx). В разработке: `http://localhost:3001` |

---

## Генерация пароля администратора

**Способ 1 — через Node.js (если установлен):**

```bash
node -e "require('bcrypt').hash('МОЙ_ПАРОЛЬ', 10).then(h => console.log(h))"
```

**Способ 2 — через Docker (без Node.js на машине):**

```bash
docker run --rm node:20-alpine sh -c \
  "npm install -g bcryptjs && node -e \"require('bcryptjs').hash('МОЙ_ПАРОЛЬ',10).then(h=>console.log(h))\""
```

**Способ 3 — Python (почти везде есть):**

```bash
python3 -c "import bcrypt; print(bcrypt.hashpw(b'МОЙ_ПАРОЛЬ', bcrypt.gensalt(10)).decode())"
```

Результат выглядит так: `$2b$10$XxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXx`

---

## Структура проекта

```
reshala-web/
├── apps/
│   ├── backend/                      # NestJS API
│   │   └── src/
│   │       ├── auth/                 # JWT авторизация
│   │       │   ├── auth.module.ts
│   │       │   ├── auth.service.ts   # bcrypt + JWT
│   │       │   ├── auth.controller.ts # POST /api/auth/login|logout
│   │       │   ├── jwt.strategy.ts   # JWT из httpOnly cookie
│   │       │   └── jwt-auth.guard.ts
│   │       ├── fleet/                # Управление флотом
│   │       │   ├── fleet.service.ts  # Чтение/запись ~/.reshala_fleet
│   │       │   └── fleet.controller.ts # GET/POST/PATCH/DELETE /api/fleet
│   │       ├── plugins/              # Плагины
│   │       │   ├── executor.service.ts  # SFTP upload + SSH exec → Observable
│   │       │   ├── plugins.service.ts   # Сканер /opt/reshala/plugins/
│   │       │   ├── plugins.controller.ts # GET /api/plugins
│   │       │   └── plugins.gateway.ts   # WS /plugins — стриминг вывода
│   │       ├── terminal/             # SSH терминал
│   │       │   ├── terminal.gateway.ts  # WS /terminal — интерактивный shell
│   │       │   └── terminal.module.ts
│   │       ├── metrics/              # Метрики из Prometheus
│   │       │   ├── metrics.service.ts   # Запросы к Prometheus HTTP API
│   │       │   └── metrics.controller.ts # GET /api/metrics/:name
│   │       └── common/
│   │           └── ssh.utils.ts      # Общий SSH connect config
│   │
│   └── frontend/                     # Next.js 14 App Router
│       ├── app/
│       │   ├── page.tsx              # Главная — флот по странам
│       │   ├── login/page.tsx        # Страница входа
│       │   ├── server/[name]/
│       │   │   ├── page.tsx          # Детали сервера + метрики + плагины
│       │   │   └── terminal/page.tsx # SSH терминал (xterm.js)
│       │   ├── wizard/node-setup/
│       │   │   └── page.tsx          # 5-шаговый визард настройки ноды
│       │   └── import/page.tsx       # Импорт флота из файла
│       ├── components/
│       │   ├── ui/                   # Примитивы (Button, Card, Input…)
│       │   ├── server-card.tsx       # Карточка сервера с мини-барами
│       │   ├── fleet-grid.tsx        # Сетка серверов по странам
│       │   ├── plugin-runner.tsx     # Запуск плагинов с live-выводом
│       │   ├── metrics-chart.tsx     # Recharts LineChart (CPU/RAM/Network)
│       │   └── ssh-terminal.tsx      # xterm.js терминал
│       ├── lib/
│       │   ├── api.ts                # Fetch-клиент для всех API
│       │   └── socket.ts             # Socket.io фабрики
│       └── middleware.ts             # Редирект на /login без токена
│
├── packages/
│   └── shared/                       # Общие TypeScript типы
│       └── src/types.ts              # Server, Plugin, MetricData…
│
├── docker-compose.yml
├── nginx.conf
├── turbo.json
└── .env.example
```

---

## Команды

### Разработка

```bash
# Запустить всё (backend + frontend с hot reload)
npm run dev

# Только backend
npm run dev --filter=@reshala-web/backend

# Только frontend
npm run dev --filter=@reshala-web/frontend
```

### Сборка

```bash
# Собрать всё
npm run build

# Проверка типов
npm run type-check

# Линтер
npm run lint

# Очистить dist/.next
npm run clean
```

### Docker

```bash
# Собрать и запустить
docker compose up -d --build

# Пересобрать только backend
docker compose up -d --build backend

# Логи в реальном времени
docker compose logs -f backend
docker compose logs -f frontend

# Перезапустить
docker compose restart backend

# Остановить и удалить контейнеры
docker compose down

# Остановить и удалить вместе с volumes
docker compose down -v
```

---

## Архитектура

```
Browser
  │
  ├── HTTPS  → Nginx → :3000  Frontend (Next.js)
  │                      │
  │                      └── fetch /api/*  ──────────────┐
  │                      └── WebSocket /socket.io  ──────┤
  │                                                       ↓
  └──────────────────────────────────────────────── :3001 Backend (NestJS)
                                                          │
                               ┌──────────────────────────┤
                               │                          │
                          ~/.reshala_fleet         Prometheus
                          ~/.ssh/keys                     │
                          /opt/reshala/plugins            │
                               │                          │
                          SSH → VPN серверы (190+)  node_exporter
```

### Авторизация

- Единственный пользователь — `admin`
- Пароль хранится как bcrypt-хеш в `ADMIN_PASSWORD_HASH`
- После успешного входа JWT записывается в **httpOnly cookie** `access_token` (24 часа)
- Все API-роуты кроме `POST /api/auth/login` защищены `JwtAuthGuard`
- WebSocket гейтвеи проверяют JWT из cookie в `handleConnection`
- Middleware Next.js редиректит на `/login` если cookie отсутствует

### SSH-исполнение плагинов

```
1. SFTP: загрузить плагин в /tmp/reshala_plugin_{ts}_{rand}.sh
2. exec: {ENV_VARS} bash /tmp/reshala_plugin_*.sh; rm -f /tmp/reshala_plugin_*.sh
3. stdout/stderr → построчно → Observable → Socket.io emit('output')
```

### Формат файла флота

```
name|user|ip|port|key_path|sudo_pass
de-0-waicore|root|213.176.77.3|22|/root/.ssh/id_ed25519_reshala_node_de-0-waicore_213_176_77_3|
```

### Импорт флота (формат файла)

Файл с табуляцией в качестве разделителя:

```
de-1-example	1.2.3.4	sudo_password
nl-0-example	5.6.7.8
```

---

## Решение проблем

### `ADMIN_PASSWORD_HASH not configured`

Переменная `ADMIN_PASSWORD_HASH` не задана в `.env`. Сгенерируйте хеш (см. раздел выше) и добавьте в `.env`.

### SSH: `Error: Cannot parse privateKey`

Файл ключа не найден по пути `keyPath` в записи флота. Проверьте:
- в разработке: ключи должны лежать там, куда указывает `SSH_KEYS_DIR`
- в Docker: volume `/root/.ssh:/app/ssh_keys:ro` должен быть примонтирован

### WebSocket не подключается

В разработке установите в `.env` фронтенда:

```env
NEXT_PUBLIC_WS_URL=http://localhost:3001
```

В продакшне через Nginx — оставьте пустым, Nginx проксирует `/socket.io` на backend.

### Метрики не показываются

1. Проверьте, что Prometheus доступен по `PROMETHEUS_URL`
2. Убедитесь, что node_exporter установлен на VPN-серверах
3. Проверьте формат instance-лейблов: `ip:9100`

### `Cannot find module '@reshala-web/shared'`

Нужно собрать shared-пакет:

```bash
cd packages/shared && npm run build
```

Или запустите `npm run build` из корня — Turborepo сделает это автоматически в правильном порядке.

### Порт 3001 уже занят

```bash
lsof -i :3001
# или
ss -tlnp | grep 3001
```

Поменяйте порт через `BACKEND_PORT=3002` в `.env`.
