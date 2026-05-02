#!/usr/bin/env bash
# TITLE: Speedtest via Snap

set -euo pipefail

log() {
  printf '[speedtest] %s\n' "$*"
}

ensure_snap() {
  if command -v snap >/dev/null 2>&1; then
    log "snap is already installed"
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    log "snap is not installed and apt-get is unavailable"
    exit 1
  fi

  log "installing snapd"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y snapd
}

start_snapd() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now snapd.socket >/dev/null 2>&1 || true
    systemctl start snapd.service >/dev/null 2>&1 || true
  fi

  export PATH="$PATH:/snap/bin"
}

ensure_speedtest() {
  if command -v speedtest >/dev/null 2>&1; then
    log "speedtest is already installed"
    return
  fi

  if [ -x /snap/bin/speedtest ]; then
    ln -sf /snap/bin/speedtest /usr/local/bin/speedtest 2>/dev/null || true
    log "speedtest found in /snap/bin"
    return
  fi

  log "installing speedtest from snap"
  snap install speedtest
}

find_speedtest_bin() {
  if command -v speedtest >/dev/null 2>&1; then
    command -v speedtest
    return
  fi

  if [ -x /snap/bin/speedtest ]; then
    printf '/snap/bin/speedtest\n'
    return
  fi

  log "speedtest command was not found after snap install"
  exit 1
}

summarize_json() {
  local json_file="$1"
  if ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi

  python3 - "$json_file" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)

download = data.get("download", {}).get("bandwidth")
upload = data.get("upload", {}).get("bandwidth")
ping = data.get("ping", {}).get("latency")
result_url = data.get("result", {}).get("url")

if isinstance(download, (int, float)):
    print(f"download: {download * 8 / 1_000_000:.1f} Mbps")
if isinstance(upload, (int, float)):
    print(f"upload:   {upload * 8 / 1_000_000:.1f} Mbps")
if isinstance(ping, (int, float)):
    print(f"ping:     {ping:.1f} ms")
if result_url:
    print(f"result:   {result_url}")
PY
}

main() {
  log "checking snap"
  ensure_snap
  start_snapd

  log "checking speedtest"
  ensure_speedtest
  start_snapd

  local speedtest_bin
  speedtest_bin="$(find_speedtest_bin)"
  local output_file
  output_file="$(mktemp)"
  local notice_file
  notice_file="$(mktemp)"

  log "running Ookla speedtest"
  if "$speedtest_bin" --accept-license --accept-gdpr -f json >"$output_file" 2>"$notice_file"; then
    if ! summarize_json "$output_file"; then
      cat "$output_file"
    fi
  else
    local code=$?
    log "speedtest failed with exit code ${code}"
    cat "$notice_file" || true
    cat "$output_file" || true
    rm -f "$output_file" "$notice_file"
    exit "$code"
  fi

  rm -f "$output_file" "$notice_file"
}

main "$@"
