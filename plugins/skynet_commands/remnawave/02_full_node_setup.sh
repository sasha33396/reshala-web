#!/bin/bash
# TITLE: Полная настройка новой ноды Remnawave
# SKYNET_HIDDEN: true
# ==============================================================================
# SKYNET ПЛАГИН: Полная настройка сервера под ноду Remnawave
# Выполняется на УДАЛЁННОМ сервере через Skynet (_skynet_run_plugin_on_server_with_env).
#
# Ожидаемые переменные окружения (base64 для значений со спецсимволами):
#   REMNA_SECRET_KEY_B64  — SECRET_KEY для remnanode (base64)
#   SNI_DOMAIN_B64        — домен для xray-sni (base64)
#   CF_API_TOKEN_B64      — Cloudflare API Token для xray-sni (base64)
#   COPY_CERT             — y/n: копировать сертификат с другой ноды
#   CERT_SOURCE_IP        — IP ноды-источника сертификата (если COPY_CERT=y)
#   PANEL_API_IP          — IP панели Remnawave (UFW порт 2222, default: 178.128.249.68)
#   METRICS_IP            — IP сервера метрик (UFW порты 9100/9200, default: 188.225.56.179)
# ==============================================================================

set -uo pipefail

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
log()  { echo "[INFO]  $(date '+%H:%M:%S') $*"; }
err()  { echo "[ERROR] $(date '+%H:%M:%S') $*" >&2; }
ok()   { echo "[OK]    $(date '+%H:%M:%S') $*"; }
warn() { echo "[WARN]  $(date '+%H:%M:%S') $*"; }

on_error() {
    local cmd="$1" line="$2" code="$3"
    err "Команда завершилась с ошибкой (код $code) на строке $line: $cmd"
    exit "$code"
}
trap 'on_error "$BASH_COMMAND" "$LINENO" "$?"' ERR

require_root() {
    if [[ $EUID -ne 0 ]]; then
        err "Скрипт должен запускаться от root."
        exit 1
    fi
}

b64d() {
    printf '%s' "$1" | base64 -d
}

# ------------------------------------------------------------------------------
# 0. Валидация и декодирование параметров
# ------------------------------------------------------------------------------
require_root

if [[ -z "${REMNA_SECRET_KEY_B64:-}" || -z "${SNI_DOMAIN_B64:-}" || -z "${CF_API_TOKEN_B64:-}" ]]; then
    err "Обязательные переменные REMNA_SECRET_KEY_B64, SNI_DOMAIN_B64, CF_API_TOKEN_B64 не заданы."
    err "Этот плагин должен вызываться только из Решалы через визард 'Полная настройка ноды'."
    exit 1
fi

REMNA_SECRET_KEY=$(b64d "$REMNA_SECRET_KEY_B64")
SNI_DOMAIN=$(b64d "$SNI_DOMAIN_B64")
CF_API_TOKEN=$(b64d "$CF_API_TOKEN_B64")
COPY_CERT="${COPY_CERT:-n}"
CERT_SOURCE_IP="${CERT_SOURCE_IP:-}"
PANEL_API_IP="${PANEL_API_IP:-178.128.249.68}"
METRICS_IP="${METRICS_IP:-188.225.56.179}"

log "Параметры получены:"
log "  SNI_DOMAIN    : ${SNI_DOMAIN}"
log "  COPY_CERT     : ${COPY_CERT}"
log "  PANEL_API_IP  : ${PANEL_API_IP}"
log "  METRICS_IP    : ${METRICS_IP}"
echo ""

# ==============================================================================
# 1. Обновление системы и базовые пакеты
# ==============================================================================
log "=== 1/11  Обновление системы ==="
apt update && apt upgrade -y
apt install -y mc htop btop iftop curl wget git

# ==============================================================================
# 2. Часовой пояс
# ==============================================================================
log "=== 2/11  Часовой пояс ==="
timedatectl set-timezone Europe/Moscow
timedatectl

# ==============================================================================
# 3. Docker
# ==============================================================================
log "=== 3/11  Docker ==="
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    ok "Docker установлен."
else
    ok "Docker уже установлен: $(docker --version)"
fi

# ==============================================================================
# 4. Параметры ядра (sysctl)
# nf_conntrack загружается до sysctl -p, т.к. net.netfilter.nf_conntrack_max
# требует активного модуля.
# ==============================================================================
log "=== 4/11  Параметры ядра ==="

modprobe nf_conntrack
if ! grep -q "nf_conntrack" /etc/modules-load.d/conntrack.conf 2>/dev/null; then
    echo "nf_conntrack" >> /etc/modules-load.d/conntrack.conf
fi

if ! grep -q "VPN Optimization" /etc/sysctl.conf; then
    cat >> /etc/sysctl.conf << 'EOF'

# VPN Optimization
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1
net.netfilter.nf_conntrack_max = 262144
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
fi

sysctl -p

# ==============================================================================
# 5. Лимиты файловых дескрипторов
# ==============================================================================
log "=== 5/11  Лимиты файловых дескрипторов ==="

if ! grep -q "300000" /etc/security/limits.conf 2>/dev/null; then
    cat >> /etc/security/limits.conf << 'EOF'
* soft nofile 300000
* hard nofile 300000
root soft nofile 300000
root hard nofile 300000
EOF
fi

mkdir -p /etc/systemd/system.conf.d/
cat > /etc/systemd/system.conf.d/limits.conf << 'EOF'
[Manager]
DefaultLimitNOFILE=300000
EOF

systemctl daemon-reload

# ==============================================================================
# 6. UFW Firewall
# ==============================================================================
log "=== 6/11  UFW ==="
apt install -y ufw

# Allow
ufw allow 22/tcp comment 'SSH'
ufw allow 443/tcp comment 'VLESS Reality'
ufw allow from "${PANEL_API_IP}" to any port 2222 proto tcp comment 'Remnanode API'
ufw allow from "${METRICS_IP}" to any port 9100 proto tcp comment 'Node Metrics'
ufw allow from "${METRICS_IP}" to any port 9200 proto tcp comment 'Speedtest Metrics'

# Deny inbound — abuse/scanner networks
ufw deny from 178.162.203.0/24
ufw deny from 45.159.79.0/24
ufw deny from 85.17.155.0/24
ufw deny from 185.221.222.0/24
ufw deny from 89.150.57.0/24
ufw deny from 46.165.199.0/24
ufw deny from 178.162.202.0/24
ufw deny from 85.17.70.0/24
ufw deny from 64.62.203.0/24

# Deny outbound — same networks + SMTP
ufw deny out to 178.162.203.0/24
ufw deny out to 45.159.79.0/24
ufw deny out to 85.17.155.0/24
ufw deny out to 185.221.222.0/24
ufw deny out to 89.150.57.0/24
ufw deny out to 46.165.199.0/24
ufw deny out to 178.162.202.0/24
ufw deny out to 85.17.70.0/24
ufw deny out to 64.62.203.0/24
ufw deny out 25

ufw --force enable
ufw status

# ==============================================================================
# 7. Fail2ban
# ==============================================================================
log "=== 7/11  Fail2ban ==="
apt install -y fail2ban
cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
systemctl enable fail2ban
systemctl restart fail2ban
systemctl status fail2ban --no-pager

# ==============================================================================
# 8. Remnanode (Docker Compose)
# ==============================================================================
log "=== 8/11  Remnanode ==="

mkdir -p /opt/remnanode
mkdir -p /var/log/remnanode

cat > /opt/remnanode/docker-compose.yml << COMPOSE
services:
  remnanode:
    container_name: remnanode
    hostname: remnanode
    image: remnawave/node:2.6.1
    network_mode: host
    restart: always
    ulimits:
      nofile:
        soft: 1048576
        hard: 1048576
    environment:
      - NODE_PORT=2222
      - SECRET_KEY=${REMNA_SECRET_KEY}
    volumes:
      - /var/log/remnanode:/var/log/remnanode
COMPOSE

cd /opt/remnanode
docker compose up -d
log "Статус контейнера remnanode:"
docker compose ps

# ==============================================================================
# 9. Node Exporter
# ==============================================================================
log "=== 9/11  Node Exporter ==="

NODE_EXPORTER_VERSION="1.8.2"
cd /tmp

wget -q "https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz"
tar xf "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz"
mv "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64/node_exporter" /usr/local/bin/
rm -rf "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64" \
       "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz"

if ! id node_exporter &>/dev/null; then
    useradd -rs /bin/false node_exporter
fi

tee /etc/systemd/system/node_exporter.service > /dev/null << 'EOF'
[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable node_exporter
systemctl start node_exporter
systemctl status node_exporter --no-pager

# ==============================================================================
# 10. Speedtest Exporter (Docker Compose)
# ==============================================================================
log "=== 10/11  Speedtest Exporter ==="

mkdir -p /root/speedtest-exporter

cat > /root/speedtest-exporter/docker-compose.yml << 'COMPOSE'
services:
  speedtest-exporter:
    image: kutovoys/speedtest-exporter
    environment:
      - SERVER_IDS=32983
      - UPDATE_INTERVAL=60
      - METRICS_PROTECTED=false
      - METRICS_USERNAME=custom_user
      - METRICS_PASSWORD=custom_password
    ports:
      - "9200:9090"
COMPOSE

cd /root/speedtest-exporter
docker compose up -d
log "Статус Speedtest Exporter:"
docker compose ps

# ==============================================================================
# 11. Logrotate для remnanode
# ==============================================================================
log "=== 11/11  Logrotate ==="
apt install -y logrotate

cat > /etc/logrotate.d/remnanode << 'EOF'
/var/log/remnanode/*.log {
    size 50M
    rotate 5
    compress
    missingok
    notifempty
    copytruncate
}
EOF

logrotate -vf /etc/logrotate.d/remnanode

# ==============================================================================
# Post-install: xray-sni
# NOTE: Только клонирует репозиторий и создаёт .env.
#       Запуск сервиса — вручную после проверки.
# ==============================================================================
log "=== Post-install  xray-sni ==="

cd /root
if [[ -d /root/xray-sni ]]; then
    warn "Директория /root/xray-sni уже существует. Пропускаю клонирование."
else
    git clone https://github.com/locklance/xray-sni.git
fi

cat > /root/xray-sni/.env << EOF
SNI_DOMAIN="${SNI_DOMAIN}"
SNI_PORT="9443"
CF_API_TOKEN="${CF_API_TOKEN}"
EOF

if [[ "${COPY_CERT}" == "y" && -n "${CERT_SOURCE_IP}" ]]; then
    log "Копирую сертификат с ${CERT_SOURCE_IP}..."

    CERT_SRC_PATH="/var/lib/docker/volumes/xray-sni_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${SNI_DOMAIN}"
    CERT_DST_PATH="/var/lib/docker/volumes/xray-sni_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${SNI_DOMAIN}"

    # Volume создаётся только после первого docker compose up
    cd /root/xray-sni
    docker compose up -d
    sleep 3
    docker compose down

    mkdir -p "$CERT_DST_PATH"

    scp -o StrictHostKeyChecking=no \
        "root@${CERT_SOURCE_IP}:${CERT_SRC_PATH}/${SNI_DOMAIN}.crt" \
        "${CERT_DST_PATH}/"

    scp -o StrictHostKeyChecking=no \
        "root@${CERT_SOURCE_IP}:${CERT_SRC_PATH}/${SNI_DOMAIN}.key" \
        "${CERT_DST_PATH}/"

    # metadata файл — опционально
    scp -o StrictHostKeyChecking=no \
        "root@${CERT_SOURCE_IP}:${CERT_SRC_PATH}/${SNI_DOMAIN}.json" \
        "${CERT_DST_PATH}/" 2>/dev/null || true

    log "Сертификат скопирован с ${CERT_SOURCE_IP}. Caddy использует существующий сертификат при старте."
else
    log "Новый домен — Caddy запросит сертификат через DNS-01 при старте."
fi

log "xray-sni клонирован в /root/xray-sni. Файл .env записан."
log "Для запуска вручную: cd /root/xray-sni && docker compose up -d"

# ==============================================================================
log ""
ok "=== Установка завершена ==="
log "UFW правила: Remnanode API от ${PANEL_API_IP}:2222, Метрики от ${METRICS_IP}:9100/9200"
log "Для запуска xray-sni: cd /root/xray-sni && docker compose up -d"
