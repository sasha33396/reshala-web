#!/bin/bash
# TITLE: Setup Full Node
# SKYNET_HIDDEN: false
#
# Non-interactive server setup script.
# All parameters are injected as environment variables by the Reshala wizard.
#
# Required env vars:
#   REMNA_SECRET_KEY_B64  – base64(remnanode SECRET_KEY)
#   SNI_DOMAIN_B64        – base64(xray-sni SNI_DOMAIN)
#   CF_API_TOKEN_B64      – base64(Cloudflare API token)
#   COPY_CERT             – "y" or "n"
#   PANEL_API_IP          – IP of the Remnawave panel (allowed on port 2222)
#   METRICS_IP            – IP of the metrics scraper (allowed on 9100, 9200)
#
# When COPY_CERT=y the backend pre-fetches the cert and injects:
#   CERT_CRT_B64          – base64 of .crt file
#   CERT_KEY_B64          – base64 of .key file
#   CERT_JSON_B64         – base64 of .json file (optional)

set -uo pipefail

log()  { echo "[INFO]  $(date '+%H:%M:%S') $*"; }
err()  { echo "[ERROR] $(date '+%H:%M:%S') $*" >&2; }

# Decode base64 parameters
REMNA_SECRET_KEY=$(echo "${REMNA_SECRET_KEY_B64:-}" | base64 -d 2>/dev/null || echo "")
SNI_DOMAIN=$(echo "${SNI_DOMAIN_B64:-}" | base64 -d 2>/dev/null || echo "")
CF_API_TOKEN=$(echo "${CF_API_TOKEN_B64:-}" | base64 -d 2>/dev/null || echo "")
COPY_CERT="${COPY_CERT:-n}"
PANEL_API_IP="${PANEL_API_IP:-178.128.249.68}"
METRICS_IP="${METRICS_IP:-31.192.111.182}"

# Validate required
[[ -z "$REMNA_SECRET_KEY" ]] && { err "REMNA_SECRET_KEY_B64 is missing or empty."; exit 1; }
[[ -z "$SNI_DOMAIN" ]]       && { err "SNI_DOMAIN_B64 is missing or empty."; exit 1; }
[[ -z "$CF_API_TOKEN" ]]     && { err "CF_API_TOKEN_B64 is missing or empty."; exit 1; }

log "Parameters:"
log "  SNI_DOMAIN   = $SNI_DOMAIN"
log "  COPY_CERT    = $COPY_CERT"
log "  PANEL_API_IP = $PANEL_API_IP"
log "  METRICS_IP   = $METRICS_IP"
echo ""

# Docker pull with retry (handles DockerHub rate limits)
docker_pull() {
  local image="$1"
  for attempt in 1 2 3; do
    log "Pulling $image (attempt $attempt/3)…"
    if docker pull "$image"; then
      return 0
    fi
    [[ $attempt -lt 3 ]] && { log "Pull failed, retrying in 20s…"; sleep 20; }
  done
  err "Failed to pull $image after 3 attempts."
  return 1
}

# ==============================================================================
# 1. System update & base packages
# ==============================================================================
log "=== 1/11  System update & base packages ==="
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mc htop btop iftop curl wget git
log "Base packages installed."

# ==============================================================================
# 2. Timezone
# ==============================================================================
log "=== 2/11  Timezone ==="
timedatectl set-timezone Europe/Moscow
log "Timezone: $(timedatectl | grep 'Time zone' | awk '{print $3}')"

# ==============================================================================
# 3. Docker
# ==============================================================================
log "=== 3/11  Docker ==="
if command -v docker &>/dev/null; then
  log "Docker already installed: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
  log "Docker installed: $(docker --version)"
fi

# ==============================================================================
# 4. Kernel parameters
# ==============================================================================
log "=== 4/11  Kernel parameters ==="
modprobe nf_conntrack || true
grep -qxF 'nf_conntrack' /etc/modules-load.d/conntrack.conf 2>/dev/null || \
  echo "nf_conntrack" >> /etc/modules-load.d/conntrack.conf

if ! grep -qF '# VPN Optimization — reshala' /etc/sysctl.conf; then
cat >> /etc/sysctl.conf << 'EOF'

# VPN Optimization — reshala
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
sysctl -p 2>/dev/null | tail -5
log "Kernel parameters applied."

# ==============================================================================
# 5. File descriptor limits
# ==============================================================================
log "=== 5/11  File descriptor limits ==="
if ! grep -qF '# reshala limits' /etc/security/limits.conf; then
cat >> /etc/security/limits.conf << 'EOF'
# reshala limits
* soft nofile 300000
* hard nofile 300000
root soft nofile 300000
root hard nofile 300000
EOF
fi
mkdir -p /etc/systemd/system.conf.d/
cat > /etc/systemd/system.conf.d/reshala-limits.conf << 'EOF'
[Manager]
DefaultLimitNOFILE=300000
EOF
systemctl daemon-reload
log "FD limits applied."

# ==============================================================================
# 6. UFW firewall
# ==============================================================================
log "=== 6/11  UFW ==="
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw

ufw allow 22/tcp    comment 'SSH'
ufw allow 443/tcp   comment 'VLESS Reality'
ufw allow from "${PANEL_API_IP}" to any port 2222 proto tcp comment 'Remnanode API'
ufw allow from "${METRICS_IP}"   to any port 9100 proto tcp comment 'Node Metrics'
ufw allow from "${METRICS_IP}"   to any port 9200 proto tcp comment 'Speedtest Metrics'

for net in \
  178.162.203.0/24 45.159.79.0/24 85.17.155.0/24 185.221.222.0/24 \
  89.150.57.0/24 46.165.199.0/24 178.162.202.0/24 85.17.70.0/24 64.62.203.0/24
do
  ufw deny from "$net" 2>/dev/null || true
  ufw deny out  to   "$net" 2>/dev/null || true
done
ufw deny out 25

echo "y" | ufw enable
ufw status verbose
log "UFW configured."

# ==============================================================================
# 7. Fail2ban
# ==============================================================================
log "=== 7/11  Fail2ban ==="
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban
cp -n /etc/fail2ban/jail.conf /etc/fail2ban/jail.local 2>/dev/null || true
systemctl enable fail2ban
systemctl restart fail2ban
log "Fail2ban running."

# ==============================================================================
# 8. Remnanode
# ==============================================================================
log "=== 8/11  Remnanode ==="
mkdir -p /opt/remnanode /var/log/remnanode

cat > /opt/remnanode/docker-compose.yml << COMPOSE
services:
  remnanode:
    container_name: remnanode
    hostname: remnanode
    image: remnawave/node:latest
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
docker_pull remnawave/node:latest || log "WARNING: Could not pull remnawave/node:latest — will use cached if available"
docker compose up -d
docker compose ps
log "Remnanode started."

# ==============================================================================
# 9. Node Exporter
# ==============================================================================
log "=== 9/11  Node Exporter ==="
if [[ ! -f /usr/local/bin/node_exporter ]]; then
  NODE_EXPORTER_VERSION="1.8.2"
  cd /tmp
  wget -q "https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz"
  tar xf "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz"
  mv "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64/node_exporter" /usr/local/bin/
  rm -rf "node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64"*
fi
id node_exporter &>/dev/null || useradd -rs /bin/false node_exporter

cat > /etc/systemd/system/node_exporter.service << 'EOF'
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
systemctl restart node_exporter
systemctl is-active node_exporter && log "Node Exporter running." || err "Node Exporter failed."

# ==============================================================================
# 10. Speedtest Exporter
# ==============================================================================
log "=== 10/11  Speedtest Exporter ==="
mkdir -p /root/speedtest-exporter
cat > /root/speedtest-exporter/docker-compose.yml << 'COMPOSE'
services:
  speedtest-exporter:
    image: kutovoys/speedtest-exporter
    restart: always
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
docker_pull kutovoys/speedtest-exporter || log "WARNING: Could not pull speedtest-exporter — will use cached if available"
docker compose up -d
docker compose ps
log "Speedtest Exporter started."

# ==============================================================================
# 11. Logrotate
# ==============================================================================
log "=== 11/11  Logrotate ==="
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
logrotate -f /etc/logrotate.d/remnanode 2>/dev/null || true
log "Logrotate configured."

# ==============================================================================
# Post-install: xray-sni
# ==============================================================================
log "=== Post-install  xray-sni ==="

if [[ -d /root/xray-sni ]]; then
  cd /root/xray-sni && git pull
else
  git clone https://github.com/locklance/xray-sni.git /root/xray-sni
fi

cat > /root/xray-sni/.env << EOF
SNI_DOMAIN="${SNI_DOMAIN}"
SNI_PORT="9443"
CF_API_TOKEN="${CF_API_TOKEN}"
EOF

CERT_BASE="/var/lib/docker/volumes/xray-sni_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${SNI_DOMAIN}"

if [[ "$COPY_CERT" == "y" ]]; then
  if [[ -z "${CERT_CRT_B64:-}" || -z "${CERT_KEY_B64:-}" ]]; then
    err "COPY_CERT=y but cert data not provided (CERT_CRT_B64/CERT_KEY_B64 empty)."
    exit 1
  fi

  log "Writing certificate from backend-provided data…"

  # Create the caddy volume directory by briefly starting the container
  cd /root/xray-sni
  docker_pull $(grep 'image:' docker-compose.yml | awk '{print $2}' | head -1) 2>/dev/null || true
  docker compose up -d 2>/dev/null || true
  sleep 3
  docker compose down 2>/dev/null || true

  mkdir -p "$CERT_BASE"
  echo "${CERT_CRT_B64}"  | base64 -d > "${CERT_BASE}/${SNI_DOMAIN}.crt"  && log "  .crt written"
  echo "${CERT_KEY_B64}"  | base64 -d > "${CERT_BASE}/${SNI_DOMAIN}.key"  && log "  .key written"
  if [[ -n "${CERT_JSON_B64:-}" ]]; then
    echo "${CERT_JSON_B64}" | base64 -d > "${CERT_BASE}/${SNI_DOMAIN}.json" && log "  .json written"
  fi

  log "Starting xray-sni with copied certificate…"
  cd /root/xray-sni && docker compose up -d
  docker compose ps
else
  log "New domain — Caddy will request cert via DNS-01 on start."
  cd /root/xray-sni
  docker compose up -d
  docker compose ps
fi

# ==============================================================================
log ""
log "=== Setup complete ==="
log ""
log "Services:"
log "  remnanode       → :2222  (allowed from ${PANEL_API_IP})"
log "  node_exporter   → :9100  (allowed from ${METRICS_IP})"
log "  speedtest       → :9200  (allowed from ${METRICS_IP})"
log "  xray-sni        → :443   (SNI: ${SNI_DOMAIN})"
