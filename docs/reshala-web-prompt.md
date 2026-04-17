# Claude Code — Промт для разработки Reshala Web

## Контекст проекта

Ты разрабатываешь **Reshala Web** — веб-интерфейс управления флотом VPN-серверов (190+ нод).
Проект является веб-обёрткой над существующим bash-фреймворком **Решала** (CLI-инструмент).

### Что такое Решала (оригинальный проект)
- TUI bash-фреймворк для управления Linux-серверами
- Хранит флот серверов в файле `~/.reshala_fleet` (pipe-delimited: `name|user|ip|port|key_path|sudo_pass`)
- Выполняет команды на удалённых серверах через SSH: SCP плагина → `bash /tmp/reshala_plugin.sh`
- Плагины лежат в `/opt/reshala/plugins/skynet_commands/` (standalone bash-скрипты)
- SSH ключи в `~/.ssh/id_ed25519_reshala_node_*` (уникальный ключ на каждый сервер)

### Что строим
Веб-интерфейс который делает то же самое что Решала, но через браузер.
**Не переписываем Решалу** — переиспользуем fleet DB, SSH ключи и плагины как есть.

---

## Стек

- **Монорепо**: Turborepo
- **Backend**: NestJS + TypeScript
- **SSH**: библиотека `ssh2` (SCP + exec + interactive shell)
- **WebSocket**: `@nestjs/websockets` + Socket.io
- **Frontend**: Next.js 14 (App Router) + React + TypeScript
- **UI**: shadcn/ui + TailwindCSS
- **Графики**: Recharts
- **SSH терминал**: xterm.js + socket.io-client
- **Data fetching**: TanStack Query (React Query)
- **Auth**: `@nestjs/jwt` + `passport-local`, JWT в httpOnly cookie
- **Deploy**: Docker Compose + Nginx reverse proxy

---

## Структура проекта

```
reshala-web/
├── apps/
│   ├── backend/
│   │   └── src/
│   │       ├── fleet/
│   │       ├── plugins/
│   │       ├── terminal/
│   │       ├── metrics/
│   │       └── auth/
│   └── frontend/
│       └── app/
│           ├── page.tsx
│           ├── server/[name]/
│           ├── plugins/
│           ├── wizard/node-setup/
│           └── import/
├── packages/
│   └── shared/          # Общие TypeScript типы
├── docker-compose.yml
└── turbo.json
```

---

## Модуль 1 — Инициализация монорепо и boilerplate

**Задача**: Создать базовую структуру проекта.

```
1. Инициализировать Turborepo: `npx create-turbo@latest reshala-web`
2. Настроить apps/backend: NestJS (`nest new backend --strict`)
3. Настроить apps/frontend: Next.js (`create-next-app frontend --typescript --tailwind --app`)
4. Создать packages/shared с общими типами
5. Настроить turbo.json pipeline: build, dev, lint
6. Добавить корневой .env.example
```

**Общие TypeScript типы** (`packages/shared/src/types.ts`):
```typescript
export interface Server {
  name: string
  user: string
  ip: string
  port: number
  keyPath: string
  sudoPass?: string
  status?: 'online' | 'offline' | 'checking'
  country?: string
}

export interface Plugin {
  id: string
  title: string
  category: string
  path: string
  hidden: boolean
}

export interface PluginRunPayload {
  pluginId: string
  serverName?: string   // если не указан — весь флот
  envVars?: Record<string, string>
}

export interface MetricData {
  cpu: number
  ram: number
  disk: number
  uptime: number
  networkIn: number
  networkOut: number
  speedtestDown?: number
  speedtestUp?: number
}
```

---

## Модуль 2 — Backend: Fleet Service

**Файл**: `apps/backend/src/fleet/fleet.service.ts`

**Задача**: Читать и писать файл `~/.reshala_fleet`.

Формат файла (pipe-delimited, без заголовка):
```
name|user|ip|port|key_path|sudo_pass
de-0-waicore|root|213.176.77.3|22|/root/.ssh/id_ed25519_reshala_node_de-0-waicore_213_176_77_3|
```

**Методы**:
```typescript
getAll(): Server[]
getByName(name: string): Server | null
add(server: Server): void
update(name: string, data: Partial<Server>): void
remove(name: string): void
```

**Парсинг страны из имени сервера**:
```typescript
const COUNTRY_MAP: Record<string, string> = {
  ru: '🇷🇺 Russia',
  de: '🇩🇪 Germany',
  fl: '🇫🇮 Finland',
  nl: '🇳🇱 Netherlands',
  pl: '🇵🇱 Poland',
  lt: '🇱🇹 Lithuania',
  se: '🇸🇪 Sweden',
  un: '🌐 Untagged',
  auto: '🤖 Auto',
}
// Парсить префикс: "de-0-waicore" → "de" → Germany
```

**REST контроллер** (`fleet.controller.ts`):
```
GET    /api/fleet           — список всех серверов с группировкой по странам
GET    /api/fleet/:name     — один сервер
POST   /api/fleet           — добавить сервер
PATCH  /api/fleet/:name     — обновить
DELETE /api/fleet/:name     — удалить
POST   /api/fleet/import    — импорт из multipart txt файла
```

---

## Модуль 3 — Backend: SSH Executor Service

**Файл**: `apps/backend/src/plugins/executor.service.ts`

**Задача**: Аналог `modules/skynet/executor.sh` — копировать плагин на сервер и выполнять.

```typescript
import { Client } from 'ssh2'
import { Observable } from 'rxjs'

@Injectable()
export class ExecutorService {
  // Неинтерактивный запуск плагина (аналог _skynet_run_plugin_on_server_with_env)
  // 1. SFTP: загружает файл плагина в /tmp/reshala_plugin_{timestamp}.sh
  // 2. SSH exec: "{envVars} bash /tmp/reshala_plugin_{timestamp}.sh; rm -f ..."
  // 3. Стримит stdout/stderr построчно через Observable
  runPlugin(
    pluginPath: string,
    server: Server,
    envVars?: Record<string, string>
  ): Observable<{ type: 'stdout' | 'stderr' | 'exit', data: string }>

  // Проверка доступности сервера (аналог auto-scan в Решале)
  // Таймаут 3 секунды, BatchMode=yes
  checkOnline(server: Server): Promise<boolean>
}
```

**Важно**:
- SSH подключение через приватный ключ из `server.keyPath`
- `StrictHostKeyChecking: false` (как в оригинале)
- ConnectTimeout: 5 секунд
- Временный файл плагина: `/tmp/reshala_plugin_${Date.now()}_${Math.random()}.sh`
- Автоудаление после выполнения

---

## Модуль 4 — Backend: Plugin Scanner Service

**Файл**: `apps/backend/src/plugins/plugins.service.ts`

**Задача**: Сканировать директорию `/opt/reshala/plugins/skynet_commands/` как это делает `_run_fleet_command` в Решале.

```typescript
@Injectable()
export class PluginsService {
  // Сканирует директорию рекурсивно, парсит метаданные из заголовков bash-скриптов:
  // # TITLE: Название плагина
  // # SKYNET_HIDDEN: true/false
  // Категория = имя родительской папки (diagnostics, security, remnawave, system)
  scanPlugins(): Plugin[]

  getById(id: string): Plugin | null
}
```

---

## Модуль 5 — Backend: Plugins Gateway (WebSocket)

**Файл**: `apps/backend/src/plugins/plugins.gateway.ts`

**Задача**: Запускать плагины и стримить вывод в реальном времени через Socket.io.

```typescript
@WebSocketGateway({ namespace: '/plugins', cors: true })
export class PluginsGateway {
  @SubscribeMessage('run')
  async handleRun(client: Socket, payload: PluginRunPayload) {
    const servers = payload.serverName
      ? [this.fleetService.getByName(payload.serverName)]
      : this.fleetService.getAll()

    for (const server of servers) {
      client.emit('server-start', { server: server.name })
      
      this.executor.runPlugin(plugin.path, server, payload.envVars)
        .subscribe({
          next: (line) => client.emit('output', { server: server.name, ...line }),
          complete: () => client.emit('server-done', { server: server.name }),
          error: (err) => client.emit('server-error', { server: server.name, error: err.message }),
        })
    }
  }
}
```

---

## Модуль 6 — Backend: Terminal Gateway (WebSocket)

**Файл**: `apps/backend/src/terminal/terminal.gateway.ts`

**Задача**: Интерактивный SSH shell в браузере через xterm.js.

```typescript
@WebSocketGateway({ namespace: '/terminal', cors: true })
export class TerminalGateway {
  @SubscribeMessage('connect-ssh')
  handleConnect(client: Socket, payload: { serverName: string }) {
    // 1. Открыть ssh2 shell на сервере
    // 2. ssh.stdout → client.emit('data', chunk)
    // 3. client on 'input' → ssh.stdin.write(data)
    // 4. client on 'resize' → ssh.setWindow(cols, rows)
    // 5. При disconnect — закрыть SSH соединение
  }
}
```

---

## Модуль 7 — Backend: Metrics Service

**Файл**: `apps/backend/src/metrics/metrics.service.ts`

**Задача**: Проксировать запросы к существующему Prometheus.

```typescript
@Injectable()
export class MetricsService {
  // Получить метрики одного сервера по IP
  async getServerMetrics(ip: string): Promise<MetricData> {
    // Запросы к Prometheus HTTP API:
    // cpu:    100 - avg(rate(node_cpu_seconds_total{mode="idle", instance=~"IP:.*"}[5m])) * 100
    // ram:    (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100
    // disk:   (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100
    // uptime: node_time_seconds - node_boot_time_seconds
    // net:    rate(node_network_receive_bytes_total[5m]), rate(node_network_transmit_bytes_total[5m])
  }

  // Speedtest последний результат
  async getSpeedtest(ip: string): Promise<{ down: number, up: number } | null>

  // Статус онлайн/оффлайн для всего флота (bulk)
  async getFleetStatus(ips: string[]): Promise<Record<string, boolean>>
}
```

**REST**:
```
GET /api/metrics/:name        — метрики одного сервера
GET /api/metrics/fleet/status — статус всего флота (для главной страницы)
```

---

## Модуль 8 — Backend: Auth Module

**Файл**: `apps/backend/src/auth/`

**Задача**: Простая JWT авторизация (один admin пользователь).

```typescript
// POST /api/auth/login  { password: string } → { access_token: string }
// JWT в httpOnly cookie, срок 24 часа
// Пароль в env: ADMIN_PASSWORD_HASH (bcrypt)
// Все остальные роуты и gateway защищены JwtAuthGuard
```

---

## Модуль 9 — Frontend: Главная страница (Fleet Overview)

**Файл**: `apps/frontend/app/page.tsx`

**Задача**: Отобразить все серверы сгруппированные по странам.

**Компонент `FleetGrid`**:
- Заголовок группы с флагом страны
- `ServerCard` для каждого сервера:
  - Цветной индикатор статуса (зелёный/красный/серый)
  - Имя и IP
  - Мини-бары CPU и RAM (Recharts или CSS)
  - Аптайм
  - Клик → `/server/[name]`
- Обновление статусов каждые 30 секунд (TanStack Query `refetchInterval`)
- Поиск/фильтр по имени

---

## Модуль 10 — Frontend: Страница сервера

**Файл**: `apps/frontend/app/server/[name]/page.tsx`

**Задача**: Детальная информация и управление одним сервером.

**Секции**:

1. **Метрики** (Recharts LineChart, данные за последние 30 минут из Prometheus):
   - CPU%, RAM%, Disk%, Network in/out
   - Speedtest Down/Up (последнее значение)

2. **Плагины** (компонент `PluginRunner`):
   - Список плагинов по категориям (из `/api/plugins`)
   - Кнопка "Запустить" → Socket.io соединение → live-вывод в `<pre>` блоке
   - Индикатор выполнения

3. **Быстрые действия**:
   - Кнопка "SSH Терминал" → открывает `/server/[name]/terminal`
   - Кнопка "Настроить ноду" → открывает `/wizard/node-setup?server=[name]`

---

## Модуль 11 — Frontend: SSH Терминал

**Файл**: `apps/frontend/app/server/[name]/terminal/page.tsx`

**Задача**: Браузерный SSH терминал.

```typescript
// Компонент SshTerminal:
// 1. Инициализировать xterm.js Terminal
// 2. Подключиться к /terminal namespace через socket.io
// 3. Emit 'connect-ssh' { serverName }
// 4. terminal.onData(data => socket.emit('input', data))
// 5. socket.on('data', chunk => terminal.write(chunk))
// 6. ResizeObserver → socket.emit('resize', { cols, rows })
// Использовать @xterm/xterm + @xterm/addon-fit
```

---

## Модуль 12 — Frontend: Визард настройки ноды

**Файл**: `apps/frontend/app/wizard/node-setup/page.tsx`

**Задача**: Веб-форма для `_sm_setup_full_node` визарда из Решалы.

**Шаги формы** (stepper):
1. **Выбор сервера** — dropdown из флота
2. **Параметры Remnanode** — поле SECRET_KEY (тип password)
3. **Параметры xray-sni** — SNI_DOMAIN, CF_API_TOKEN, копировать серт (toggle), IP источника
4. **UFW правила** — IP панели (default: 178.128.249.68), IP метрик (default: 188.225.56.179)
5. **Подтверждение** — сводка параметров + кнопка "Запустить"

После запуска: Socket.io соединение, live-вывод установки в терминальный блок.

Значения передаются через base64 (как в `_sm_setup_full_node` в menu.sh):
```typescript
const envVars = {
  REMNA_SECRET_KEY_B64: btoa(secretKey),
  SNI_DOMAIN_B64: btoa(sniDomain),
  CF_API_TOKEN_B64: btoa(cfToken),
  COPY_CERT: copyCert ? 'y' : 'n',
  CERT_SOURCE_IP: certSourceIp,
  PANEL_API_IP: panelApiIp,
  METRICS_IP: metricsIp,
}
```

---

## Модуль 13 — Frontend: Импорт флота

**Файл**: `apps/frontend/app/import/page.tsx`

**Задача**: Загрузка файла `servers.txt` и массовый импорт.

Формат файла (TAB-разделитель): `имя\tIP\tпароль`

- Drag & drop или file picker
- Preview таблица перед импортом
- POST `/api/fleet/import` (multipart)
- Прогресс бар, результат: добавлено / пропущено / ошибок

---

## Модуль 14 — Docker и деплой

**Файл**: `docker-compose.yml` в корне `reshala-web/`

```yaml
services:
  backend:
    build: ./apps/backend
    restart: unless-stopped
    volumes:
      - /root/.reshala_fleet:/app/fleet_db
      - /root/.ssh:/app/ssh_keys:ro
      - /opt/reshala/plugins:/app/plugins:ro
    environment:
      - NODE_ENV=production
      - PROMETHEUS_URL=${PROMETHEUS_URL}
      - JWT_SECRET=${JWT_SECRET}
      - ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH}
    ports:
      - "127.0.0.1:3001:3001"

  frontend:
    build: ./apps/frontend
    restart: unless-stopped
    environment:
      - NEXT_PUBLIC_API_URL=/api
      - NEXT_PUBLIC_WS_URL=/
    ports:
      - "127.0.0.1:3000:3000"
```

Nginx конфиг:
```nginx
server {
    server_name manage.yourdomain.com;

    location /api { proxy_pass http://127.0.0.1:3001; }
    location /socket.io {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    location / { proxy_pass http://127.0.0.1:3000; }
}
```

---

## Порядок разработки

```
Модуль 1  → Monorepo setup
Модуль 8  → Auth (нужен для всех защищённых роутов)
Модуль 2  → Fleet Service (основа всего)
Модуль 3  → SSH Executor
Модуль 4  → Plugin Scanner
Модуль 7  → Metrics Service
Модуль 5  → Plugins Gateway (WebSocket)
Модуль 6  → Terminal Gateway (WebSocket)
Модуль 9  → Frontend: Fleet Overview
Модуль 10 → Frontend: Server Detail
Модуль 11 → Frontend: SSH Terminal
Модуль 12 → Frontend: Node Setup Wizard
Модуль 13 → Frontend: Fleet Import
Модуль 14 → Docker deploy
```

---

## Переменные окружения (.env)

```env
# Backend
FLEET_DB_PATH=/app/fleet_db
SSH_KEYS_DIR=/app/ssh_keys
PLUGINS_DIR=/app/plugins
PROMETHEUS_URL=http://prometheus:9090
JWT_SECRET=your-secret-here
JWT_EXPIRES_IN=24h
ADMIN_PASSWORD_HASH=$2b$10$...   # bcrypt hash пароля

# Frontend
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_WS_URL=/
```

---

## Правила разработки

- Все API роуты защищены `JwtAuthGuard` (кроме `/api/auth/login`)
- Обрабатывать ошибки SSH gracefully — сервер недоступен не должен крашить весь запрос
- SSH соединения закрывать в `finally` / при disconnect WebSocket
- Fleet DB читать при каждом запросе (файл может меняться через CLI Решалы)
- CORS настроить только на домен фронтенда
- Логировать все SSH операции (NestJS Logger)
