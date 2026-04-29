# Reshala-Web — AI Context

Web-панель управления флотом 160+ VPS серверов с нодами Remnawave VPN.

## Стек

| Слой | Технология |
|---|---|
| Frontend | Next.js 14 App Router, React, TailwindCSS, shadcn/ui, React Query, socket.io-client |
| Backend | NestJS, socket.io, ssh2, CLI ssh/sshpass |
| Shared types | `packages/shared/src/types.ts` — импортируется и там, и там |
| Proxy | Caddy 2 (HTTPS + WebSocket) |
| Deployment | Docker Compose, `docker-compose.yml` в корне `reshala-web/` |
| Domain | `reshala.xendroweb.com` |
| Git | `https://github.com/sasha33396/reshala-web.git` |
| Server | `root@nl-vmnano`, путь `/root/reshala-web/reshala-web/` |

## Структура проекта

```
reshala-web/
├── apps/
│   ├── backend/src/
│   │   ├── fleet/          # CRUD флота, SSH provisioning, cert read, bulk SSH
│   │   ├── remnawave/      # Интеграция с панелью Remnawave (nodes, hosts)
│   │   ├── metrics/        # node_exporter + Prometheus scrape
│   │   ├── plugins/        # WebSocket runner для .sh плагинов
│   │   ├── terminal/       # SSH terminal через WebSocket
│   │   ├── docker/         # Docker container management
│   │   ├── alerts/         # Telegram alerts по порогам
│   │   └── auth/           # JWT cookie auth
│   └── frontend/app/
│       ├── page.tsx              # Главный дашборд (флот)
│       ├── server/[name]/        # Страница сервера
│       ├── wizard/node-setup/    # Визард настройки ноды (5 шагов)
│       ├── bulk/                 # Bulk операции (UFW + плагины)
│       ├── analytics/            # Топ по ресурсам
│       └── alerts/               # Настройка Telegram алертов
├── packages/shared/src/types.ts  # Общие типы (Server, FleetGroup, PanelNode, PanelHost, ...)
├── plugins/skynet_commands/      # Bash-плагины, volume-mounted в backend (см. ниже)
└── docker-compose.yml
```

## Fleet DB

Плоский текстовый файл `name|user|ip|port|keyPath|sudoPass`, путь задаётся `FLEET_DB_PATH` в `.env`.

Группировка серверов:
- **По стране** (`GET /fleet`) — по префиксу имени: `de-` → Germany, `fl-` → Finland, и т.д.
- **По хостеру** (`GET /fleet?groupBy=provider`) — по суффиксу имени: `de-0-waicore` → Waicore. Алгоритм: берёт последний сегмент после `-`; если числовой → предпоследний; удаляет `(xx)` модификаторы.

## Remnawave Panel Integration

Переменные окружения: `REMNAWAVE_URL`, `REMNAWAVE_API_KEY` (Bearer JWT).

```
GET /api/remnawave/nodes   # PanelNode[] — все ноды панели
GET /api/remnawave/hosts   # PanelHost[] — хосты (домены), только enabled
```

**Матчинг:**
- Нода ↔ сервер флота: `panelNode.address === server.ip`
- Хост ↔ нода: `host.nodes[]` содержит `node.uuid`
- Каждая нода имеет ровно один хост; каждый хост — несколько нод

**Что показывается на карточке сервера:**
- Бейдж: `no panel` / `disabled` / `connecting…` / `panel offline` / `👤N ●`
  - Точка: зелёная = SSH ok, красная = нет SSH, серая = неизвестно
- Домен хоста под IP: `lt-modx.nodexphere.net:443` (из `/api/remnawave/hosts`)
- `trafficLimitBytes: 0` = безлимит, карточка скрывается

**"Not in fleet" секция** на дашборде: ноды панели, чей IP не найден во флоте. Кнопка `+ Add to fleet` предзаполняет форму.

## Плагины

**Расположение:** `reshala-web/plugins/skynet_commands/` (в репозитории).
**Volume mount:** `./plugins:/app/plugins:ro` → backend видит их как `/app/plugins/`.
**Обновление:** `git pull` — достаточно, rebuild не нужен.

Основной плагин: `plugins/skynet_commands/remnawave/setup_full_node.sh` — полная установка VPN-ноды (apt, Docker, UFW, remnanode, node_exporter, speedtest, xray-sni, cert copy).

## Деплой

```bash
# На сервере: root@nl-vmnano:/root/reshala-web/reshala-web/
git pull

# Если изменился backend:
docker compose up -d --build backend

# Если изменился frontend:
docker compose up -d --build frontend

# Если только плагины (.sh) — git pull достаточно
```

docker-compose.yml портативный — все пути через env vars (`FLEET_DB_HOST_PATH`, `SSH_KEYS_HOST_PATH`, `PLUGINS_HOST_PATH`).

## Auth

Cookie-based JWT. Все API-эндпоинты защищены `JwtAuthGuard`. Фронтенд автоматически редиректит на `/login` при 401.

## SSH

Backend использует `ssh2` для метрик/команд и CLI `ssh`/`sshpass` для provisioning.
SOCKS5 прокси опционально через `SOCKS5_HOST` в `.env`.
SSH-ключи хранятся в `/app/ssh_keys/{servername}` (ed25519).

## Node Setup Wizard (5 шагов)

1. Server — выбор из флота
2. Remnanode — SECRET_KEY + Docker Hub (default user: `lmybjt`)
3. xray-sni — **SNI dropdown из панели Remnawave** (`/api/remnawave/hosts`) или ввод вручную, CF API Token, опция копирования cert с существующей ноды
4. UFW rules — Panel API IP (порт 2222), Metrics IP (порт 9100/9200)
5. Confirm → запуск плагина через WebSocket

**Cert copy:** `GET /api/fleet/read-cert?serverName=X&sniDomain=Y` → SSH на источник → читает `/var/lib/docker/volumes/xray-sni_caddy_data/.../{domain}.{crt,key,json}` → base64 → env vars `CERT_CRT_B64`/`CERT_KEY_B64`/`CERT_JSON_B64`.

## Ключевые конвенции

- **Shared types** — любой новый тип данных между backend и frontend → в `packages/shared/src/types.ts`.
- **NestJS routes** — статичные пути (`@Get('read-cert')`) должны быть ДО параметрических (`@Get(':name')`), иначе NestJS перехватит.
- **React Query** — `queryFn` должна быть `() => fetchSomething()`, не `fetchSomething` напрямую (TypeScript конфликт с QueryFunctionContext).
- **панель Remnawave** — `trafficLimitBytes: 0` = безлимит (не null!). API возвращает `{ response: [...] }` wrapper.
- **Click-to-copy** — на карточках флота имя/IP/домен копируются кликом (`useCopy` hook в server-card.tsx, `UntrackedCard` компонент в page.tsx).

## .env на сервере

```env
ADMIN_PASSWORD=...
JWT_SECRET=...
FLEET_DB_PATH=/app/fleet_db/.reshala_fleet
SSH_KEYS_DIR=/app/ssh_keys
REMNAWAVE_URL=https://hitpanel.waveforge.org
REMNAWAVE_API_KEY=<bearer jwt>
# Опционально:
SOCKS5_HOST=...
SOCKS5_PORT=...
FLEET_DB_HOST_PATH=/root/.reshala_fleet
SSH_KEYS_HOST_PATH=/root/.ssh
PLUGINS_HOST_PATH=./plugins
```
