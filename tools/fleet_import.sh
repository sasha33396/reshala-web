#!/bin/bash
# ==============================================================================
# fleet_import.sh — Массовый импорт серверов в базу флота Решалы
#
# Использование:
#   bash fleet_import.sh servers.txt
#
# Формат файла (tab-разделитель):
#   имя<TAB>ip<TAB>пароль
#
# Пример:
#   de-0-waicore    213.176.77.3    JdJ7hDf0hlKr
#   de-1-waicore    178.17.52.163   2gVMK0keTYfy
#   ru-0-timeweb    176.124.209.206
#
# Серверы без пароля добавляются в базу без деплоя ключа (пометка SKIP).
# Серверы которые уже есть в базе — пропускаются.
# Результат сохраняется в /tmp/fleet_import_YYYYMMDD_HHMMSS.log
# ==============================================================================

set -uo pipefail

# --- Конфигурация ---
FLEET_DB="${HOME}/.reshala_fleet"
SSH_KEY_DIR="${HOME}/.ssh"
KEY_PREFIX="id_ed25519_reshala_node_"
DEFAULT_USER="root"
DEFAULT_PORT="22"
LOG_FILE="/tmp/fleet_import_$(date +%Y%m%d_%H%M%S).log"

# --- Цвета ---
C_RESET='\033[0m'
C_GREEN='\033[0;32m'
C_RED='\033[0;31m'
C_YELLOW='\033[0;33m'
C_CYAN='\033[0;36m'
C_GRAY='\033[0;90m'
C_BOLD='\033[1m'

log()  { local msg="[$(date '+%H:%M:%S')] $*"; echo -e "$msg"; echo "$msg" >> "$LOG_FILE"; }
ok()   { local msg="${C_GREEN}[✓]${C_RESET} $*"; echo -e "$msg"; echo "[OK]  $*" >> "$LOG_FILE"; }
err()  { local msg="${C_RED}[✗]${C_RESET} $*"; echo -e "$msg"; echo "[ERR] $*" >> "$LOG_FILE"; }
warn() { local msg="${C_YELLOW}[!]${C_RESET} $*"; echo -e "$msg"; echo "[WARN] $*" >> "$LOG_FILE"; }
info() { local msg="${C_CYAN}[i]${C_RESET} $*"; echo -e "$msg"; echo "[INFO] $*" >> "$LOG_FILE"; }

# --- Проверка зависимостей ---
check_deps() {
    local missing=()
    for cmd in sshpass ssh-keygen ssh-copy-id; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        err "Не хватает утилит: ${missing[*]}"
        echo -e "  Установи: ${C_BOLD}apt install -y sshpass openssh-client${C_RESET}"
        exit 1
    fi
}

# --- Генерация уникального SSH ключа для сервера ---
generate_key() {
    local name="$1" ip="$2"
    local ip_safe; ip_safe="${ip//./_}"
    local key_path="${SSH_KEY_DIR}/${KEY_PREFIX}${name}_${ip_safe}"

    if [[ ! -f "$key_path" ]]; then
        ssh-keygen -t ed25519 -f "$key_path" -N "" -C "reshala_node_${name}" -q
    fi
    echo "$key_path"
}

# --- Деплой ключа на сервер через sshpass ---
deploy_key() {
    local ip="$1" port="$2" user="$3" pass="$4" key_pub="$5"

    # sshpass с паролем через env (безопаснее чем -p для спецсимволов)
    SSHPASS="$pass" sshpass -e ssh-copy-id \
        -o StrictHostKeyChecking=no \
        -o ConnectTimeout=10 \
        -o UserKnownHostsFile=/dev/null \
        -i "$key_pub" \
        -p "$port" \
        "${user}@${ip}" \
        2>/dev/null
}

# --- Проверка есть ли сервер уже в базе ---
is_in_fleet() {
    local ip="$1"
    if [[ -f "$FLEET_DB" ]] && grep -q "|${ip}|" "$FLEET_DB" 2>/dev/null; then
        return 0
    fi
    return 1
}

# --- Добавление записи в базу флота ---
add_to_fleet() {
    local name="$1" user="$2" ip="$3" port="$4" key_path="$5" pass="$6"
    touch "$FLEET_DB"
    echo "${name}|${user}|${ip}|${port}|${key_path}|${pass}" >> "$FLEET_DB"
}

# ==============================================================================
# MAIN
# ==============================================================================
main() {
    local input_file="${1:-}"

    echo -e "\n${C_BOLD}${C_CYAN}━━━ Решала: Массовый импорт флота ━━━${C_RESET}\n"

    if [[ -z "$input_file" || ! -f "$input_file" ]]; then
        err "Укажи файл: bash fleet_import.sh servers.txt"
        echo ""
        echo -e "  Формат файла (TAB-разделитель):"
        echo -e "  ${C_GRAY}имя<TAB>ip<TAB>пароль${C_RESET}"
        echo -e "  ${C_GRAY}de-0-waicore    213.176.77.3    JdJ7hDf0hlKr${C_RESET}"
        exit 1
    fi

    check_deps
    mkdir -p "$SSH_KEY_DIR"
    chmod 700 "$SSH_KEY_DIR"
    touch "$FLEET_DB"

    local total=0 added=0 skipped_dup=0 skipped_nopass=0 failed=0

    info "Читаю файл: $input_file"
    info "База флота: $FLEET_DB"
    info "Лог:        $LOG_FILE"
    echo ""

    while IFS=$'\t' read -r name ip pass || [[ -n "$name" ]]; do
        # Пропускаем пустые строки и заголовки
        [[ -z "$name" || "$name" == "Нода" || "$name" =~ ^# ]] && continue
        # Убираем пробелы и CR
        name="${name//[$'\r\n ']/}"
        ip="${ip//[$'\r\n ']/}"
        pass="${pass//[$'\r\n']/}"
        # Пропускаем строки-разделители (без IP)
        [[ -z "$ip" || ! "$ip" =~ ^[0-9] ]] && continue

        ((total++))

        # Пропуск дубликатов
        if is_in_fleet "$ip"; then
            warn "ПРОПУСК (уже в базе): ${name} (${ip})"
            ((skipped_dup++))
            continue
        fi

        # Серверы без пароля — добавляем в базу без деплоя
        if [[ -z "$pass" || "$pass" == '``' || "$pass" == '`' ]]; then
            warn "БЕЗ ПАРОЛЯ (ключ не задеплоен): ${name} (${ip})"
            add_to_fleet "$name" "$DEFAULT_USER" "$ip" "$DEFAULT_PORT" "" ""
            ((skipped_nopass++))
            continue
        fi

        printf "${C_CYAN}[→]${C_RESET} %-30s %s  " "$name" "$ip"

        # Генерируем уникальный ключ
        local key_path
        key_path=$(generate_key "$name" "$ip")

        # Деплоим ключ
        if deploy_key "$ip" "$DEFAULT_PORT" "$DEFAULT_USER" "$pass" "${key_path}.pub"; then
            add_to_fleet "$name" "$DEFAULT_USER" "$ip" "$DEFAULT_PORT" "$key_path" ""
            echo -e "${C_GREEN}✓ OK${C_RESET}"
            echo "[OK]  $name ($ip) → $key_path" >> "$LOG_FILE"
            ((added++))
        else
            echo -e "${C_RED}✗ ОШИБКА (недоступен или неверный пароль)${C_RESET}"
            echo "[ERR] $name ($ip) — deploy failed" >> "$LOG_FILE"
            # Всё равно добавляем в базу с паролем как fallback
            add_to_fleet "$name" "$DEFAULT_USER" "$ip" "$DEFAULT_PORT" "" "$pass"
            ((failed++))
        fi

    done < "$input_file"

    echo ""
    echo -e "${C_BOLD}━━━ Итог ━━━${C_RESET}"
    echo -e "  Всего серверов:      ${total}"
    echo -e "  ${C_GREEN}Добавлено (ключ):    ${added}${C_RESET}"
    echo -e "  ${C_YELLOW}Без пароля:          ${skipped_nopass}${C_RESET}"
    echo -e "  ${C_YELLOW}Уже были в базе:     ${skipped_dup}${C_RESET}"
    echo -e "  ${C_RED}Ошибки деплоя:       ${failed}${C_RESET} (добавлены с паролем как fallback)"
    echo ""
    echo -e "  Лог: ${C_GRAY}${LOG_FILE}${C_RESET}"
    echo -e "  База: ${C_GRAY}${FLEET_DB}${C_RESET}"
    echo ""
    info "Готово. Запусти 'reshala' → Skynet для просмотра флота."
}

main "$@"
