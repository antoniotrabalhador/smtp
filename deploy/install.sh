#!/usr/bin/env bash
# ============================================================
#  SMTP Fleet Panel — Deploy Script
#  Executa na VPS como root ou com sudo
#  Ubuntu 22.04 / 24.04
# ============================================================
set -euo pipefail

# ── Cores ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()   { echo -e "${RED}[ERRO]${NC}  $*"; exit 1; }

PANEL_DIR="/opt/smtp-panel"
VENV_DIR="$PANEL_DIR/backend/.venv"
DIST_DIR="$PANEL_DIR/frontend/dist"
DB_DIR="/var/lib/smtp-panel"
LOG_DIR="/var/log/smtp-panel"
PANEL_USER="smtppanel"

ensure_node() {
    if command -v node >/dev/null 2>&1; then
        local node_version major
        node_version=$(node -v 2>/dev/null | sed 's/^v//')
        major=$(echo "$node_version" | cut -d. -f1)
        if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 20 )); then
            return 0
        fi
    fi

    info "Instalando Node.js 22.x para compatibilidade com Vite 8..."
    apt-get remove -y nodejs libnode-dev libnode108 nodejs-doc 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || true
    apt-get install -y nodejs || die "Falha ao instalar Node.js"
    node -v >/dev/null 2>&1 || die "Node.js não encontrado após instalação"
    ok "Node.js $(node -v) instalado"
}

cloudflare_create_or_update_record() {
    local record_type="$1"
    local record_name="$2"
    local record_content="$3"
    local proxied="$4"
    local ttl="$5"
    local priority="$6"

    if [[ -z "${CF_API_TOKEN:-}" || -z "${CF_ZONE_ID:-}" ]]; then
        return 0
    fi

    local payload
    payload=$(python3 - "$record_type" "$record_name" "$record_content" "$proxied" "$ttl" "$priority" <<'PY'
import json, sys
record_type = sys.argv[1]
record_name = sys.argv[2]
record_content = sys.argv[3]
proxied = sys.argv[4]
ttl = int(sys.argv[5]) if sys.argv[5] else 1
priority = int(sys.argv[6]) if sys.argv[6] else None
payload = {
    "type": record_type,
    "name": record_name,
    "content": record_content,
    "ttl": ttl,
    "proxied": proxied.lower() == "true"
}
if priority is not None:
    payload["priority"] = priority
print(json.dumps(payload))
PY
)

    local existing_json
    existing_json=$(curl -sS -X GET "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=${record_type}&name=${record_name}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json")

    local record_id
    record_id=$(python3 - "$existing_json" <<'PY'
import json, sys
try:
    data = json.loads(sys.argv[1])
except Exception:
    raise SystemExit("")
for item in data.get("result", []):
    if item.get("name"):
        print(item.get("id", ""))
        break
PY
)

    if [[ -n "$record_id" ]]; then
        curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${record_id}" \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "$payload" >/dev/null
    else
        curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "$payload" >/dev/null
    fi
}

# ============================================================
echo -e "\n${BOLD}══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SMTP Fleet Panel — Instalador                      ${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}\n"

[[ $EUID -ne 0 ]] && die "Execute como root: sudo bash install.sh"

info "Atualizando pacotes..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    nginx \
    curl wget git rsync \
    lsb-release gnupg2 ca-certificates \
    certbot python3-certbot-nginx \
    > /dev/null 2>&1
ensure_node
ok "Pacotes instalados"

if ! id "$PANEL_USER" &>/dev/null; then
    useradd --system --shell /bin/false --home "$PANEL_DIR" "$PANEL_USER"
    ok "Usuário $PANEL_USER criado"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"

info "Copiando arquivos para $PANEL_DIR ..."
mkdir -p "$PANEL_DIR" "$DB_DIR" "$LOG_DIR"
rm -rf "$PANEL_DIR/backend" "$PANEL_DIR/frontend"
rsync -a --exclude='**/.venv' --exclude='**/node_modules' --exclude='**/__pycache__' --exclude='**/dist' "$SRC_DIR/backend" "$PANEL_DIR/"
rsync -a --exclude='**/node_modules' --exclude='**/dist' "$SRC_DIR/frontend" "$PANEL_DIR/"
rsync -a "$SRC_DIR/agent" "$PANEL_DIR/"
ok "Arquivos copiados"

info "Instalando dependências do frontend..."
cd "$PANEL_DIR/frontend"
npm install --silent
info "Fazendo build do frontend..."
npm run build --silent
ok "Frontend buildado em $DIST_DIR"

info "Criando virtualenv Python..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$PANEL_DIR/backend/requirements.txt"
ok "Dependências Python instaladas"

chown -R "$PANEL_USER:$PANEL_USER" "$PANEL_DIR" "$DB_DIR" "$LOG_DIR"

info "Configurando serviço backend (systemd)..."
printf '%s\n' \
    '[Unit]' \
    'Description=SMTP Fleet Panel Backend' \
    'After=network.target' \
    '' \
    '[Service]' \
    'Type=simple' \
    "User=$PANEL_USER" \
    "WorkingDirectory=$PANEL_DIR/backend" \
    "EnvironmentFile=$PANEL_DIR/panel.env" \
    "ExecStart=$VENV_DIR/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000" \
    'Restart=always' \
    'RestartSec=5' \
    "StandardOutput=append:$LOG_DIR/backend.log" \
    "StandardError=append:$LOG_DIR/backend-error.log" \
    '' \
    '[Install]' \
    'WantedBy=multi-user.target' > /etc/systemd/system/smtp-panel.service

if [[ ! -f "$PANEL_DIR/panel.env" ]]; then
    printf '%s\n' \
        '# CORS: informe o domínio público aqui depois, ex: https://painel.exemplo.com' \
        'CORS_ORIGINS=http://localhost:5173' \
        "DATABASE_URL=sqlite:///$DB_DIR/panel.db" > "$PANEL_DIR/panel.env"
    chown "$PANEL_USER:$PANEL_USER" "$PANEL_DIR/panel.env"
fi

systemctl daemon-reload
systemctl enable smtp-panel
systemctl restart smtp-panel
sleep 2
systemctl is-active smtp-panel > /dev/null && ok "Backend rodando na porta 8000" || warn "Backend não iniciou — verifique: journalctl -u smtp-panel -n 30"

info "Configurando nginx..."
printf '%s\n' \
    'server {' \
    '    listen 80;' \
    '    listen [::]:80;' \
    '    server_name _;' \
    '' \
    '    location /api/ {' \
    '        proxy_pass         http://127.0.0.1:8000;' \
    '        proxy_set_header   Host $host;' \
    '        proxy_set_header   X-Real-IP $remote_addr;' \
    '        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;' \
    '        proxy_set_header   X-Forwarded-Proto $scheme;' \
    '        proxy_read_timeout 120s;' \
    '    }' \
    '' \
    '    location / {' \
    "        root $DIST_DIR;" \
    '        index index.html;' \
    '        try_files $uri /index.html;' \
    '    }' \
    '' \
    '    access_log /var/log/smtp-panel/nginx-access.log;' \
    '    error_log  /var/log/smtp-panel/nginx-error.log;' \
    '}' > /etc/nginx/sites-available/smtp-panel

ln -sf /etc/nginx/sites-available/smtp-panel /etc/nginx/sites-enabled/smtp-panel
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx
ok "Nginx configurado"

systemctl disable smtp-panel-tunnel >/dev/null 2>&1 || true
systemctl stop smtp-panel-tunnel >/dev/null 2>&1 || true
rm -f /etc/systemd/system/smtp-panel-tunnel.service

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   Configuração do domínio + HTTPS                  ${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"
echo ""

read -rp "Digite o domínio público do painel (ex: painel.exemplo.com): " PANEL_DOMAIN </dev/tty
PANEL_DOMAIN=${PANEL_DOMAIN:-}

read -rp "Deseja criar os registros DNS na Cloudflare automaticamente? [s/N]: " AUTO_CF </dev/tty
AUTO_CF=${AUTO_CF:-N}

if [[ "$AUTO_CF" =~ ^[Yy]$ ]]; then
    read -rp "Cloudflare API Token (com permissão Zone:DNS:Edit): " CF_API_TOKEN </dev/tty
    read -rp "Cloudflare Zone ID: " CF_ZONE_ID </dev/tty
else
    CF_API_TOKEN=""
    CF_ZONE_ID=""
fi

if [[ -n "$PANEL_DOMAIN" ]]; then
    read -rp "Digite o e-mail para o certificado Let's Encrypt: " CERT_EMAIL </dev/tty
    CERT_EMAIL=${CERT_EMAIL:-admin@$PANEL_DOMAIN}
    echo -e "${YELLOW}Antes de continuar, confirme que o DNS A/AAAA do domínio aponta para esta VPS.${NC}"
    read -rp "Pressione Enter quando o DNS estiver pronto..." _ </dev/tty

    printf '%s\n' \
        'server {' \
        '    listen 80;' \
        '    listen [::]:80;' \
        "    server_name $PANEL_DOMAIN;" \
        '' \
        '    location /api/ {' \
        '        proxy_pass         http://127.0.0.1:8000;' \
        '        proxy_set_header   Host $host;' \
        '        proxy_set_header   X-Real-IP $remote_addr;' \
        '        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;' \
        '        proxy_set_header   X-Forwarded-Proto $scheme;' \
        '        proxy_read_timeout 120s;' \
        '    }' \
        '' \
        '    location / {' \
        "        root $DIST_DIR;" \
        '        index index.html;' \
        '        try_files $uri /index.html;' \
        '    }' \
        '' \
        '    access_log /var/log/smtp-panel/nginx-access.log;' \
        '    error_log  /var/log/smtp-panel/nginx-error.log;' \
        '}' > /etc/nginx/sites-available/smtp-panel

    ln -sf /etc/nginx/sites-available/smtp-panel /etc/nginx/sites-enabled/smtp-panel
    nginx -t -q && systemctl reload nginx

    if ! certbot --nginx --non-interactive --agree-tos --redirect --email "$CERT_EMAIL" -d "$PANEL_DOMAIN"; then
        warn "Não foi possível obter o certificado automaticamente. Verifique o DNS e rode: certbot --nginx -d $PANEL_DOMAIN"
    fi

    if [[ -n "$CF_API_TOKEN" && -n "$CF_ZONE_ID" ]]; then
        info "Criando registros DNS na Cloudflare para $PANEL_DOMAIN..."
        VPS_IP=$(hostname -I | awk '{print $1}')
        cloudflare_create_or_update_record "A" "$PANEL_DOMAIN" "$VPS_IP" "true" "1" ""
        cloudflare_create_or_update_record "CNAME" "www.$PANEL_DOMAIN" "$PANEL_DOMAIN" "true" "1" ""
        ok "Registros DNS enviados para a Cloudflare"
    fi

    # Atualiza o CORS para o domínio real (sem localhost:5173 em produção)
    sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://$PANEL_DOMAIN|" "$PANEL_DIR/panel.env"
    PANEL_URL="https://$PANEL_DOMAIN"
else
    VPS_IP_CORS=$(hostname -I | awk '{print $1}')
    # Sem domínio: usa o IP da VPS (acesso direto via HTTP)
    sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://$VPS_IP_CORS|" "$PANEL_DIR/panel.env"
    PANEL_URL="http://$VPS_IP_CORS"
fi

systemctl restart smtp-panel

VPS_IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   Instalação concluída!                              ${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}Painel (rede local):${NC}      http://$VPS_IP"
echo -e "  ${GREEN}Painel (domínio):${NC}         ${PANEL_URL:-http://$VPS_IP}"
echo ""
echo -e "  ${CYAN}Serviços:${NC}"
echo -e "    systemctl status smtp-panel"
echo -e "    systemctl status nginx"
echo ""
echo -e "  ${CYAN}Logs:${NC}"
echo -e "    tail -f $LOG_DIR/backend.log"
echo -e "    tail -f /var/log/nginx/error.log"
echo ""
echo -e "  ${CYAN}URL do webhook (substitua TOKEN):${NC}"
echo -e "    ${PANEL_URL:-http://$VPS_IP}/api/webhooks/receive/TOKEN"
echo ""
