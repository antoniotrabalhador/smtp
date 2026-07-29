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

# ============================================================
echo -e "\n${BOLD}══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SMTP Fleet Panel — Instalador                      ${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}\n"

# ── 1. Verificar root ───────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Execute como root: sudo bash install.sh"

# ── 2. Dependências do sistema ──────────────────────────────
info "Atualizando pacotes..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    nodejs npm \
    nginx \
    curl wget git \
    lsb-release gnupg2 ca-certificates \
    > /dev/null 2>&1
ok "Pacotes instalados"

# ── 3. Criar usuário de serviço ─────────────────────────────
if ! id "$PANEL_USER" &>/dev/null; then
    useradd --system --shell /bin/false --home "$PANEL_DIR" "$PANEL_USER"
    ok "Usuário $PANEL_USER criado"
fi

# ── 4. Copiar arquivos para /opt ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"

info "Copiando arquivos para $PANEL_DIR ..."
mkdir -p "$PANEL_DIR" "$DB_DIR" "$LOG_DIR"
rsync -a --exclude='**/.venv' --exclude='**/node_modules' \
    --exclude='**/__pycache__' --exclude='**/dist' \
    "$SRC_DIR/backend"  "$PANEL_DIR/"
rsync -a --exclude='**/node_modules' --exclude='**/dist' \
    "$SRC_DIR/frontend" "$PANEL_DIR/"
ok "Arquivos copiados"

# ── 5. Build do frontend ────────────────────────────────────
info "Instalando dependências do frontend..."
cd "$PANEL_DIR/frontend"
npm install --silent
info "Fazendo build do frontend..."
npm run build --silent
ok "Frontend buildado em $DIST_DIR"

# ── 6. Virtualenv Python + dependências ────────────────────
info "Criando virtualenv Python..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$PANEL_DIR/backend/requirements.txt"
ok "Dependências Python instaladas"

# ── 7. Permissões ───────────────────────────────────────────
chown -R "$PANEL_USER:$PANEL_USER" "$PANEL_DIR" "$DB_DIR" "$LOG_DIR"

# ── 8. Systemd — Backend ────────────────────────────────────
info "Configurando serviço backend (systemd)..."
cat > /etc/systemd/system/smtp-panel.service <<EOF
[Unit]
Description=SMTP Fleet Panel Backend
After=network.target

[Service]
Type=simple
User=$PANEL_USER
WorkingDirectory=$PANEL_DIR/backend
EnvironmentFile=$PANEL_DIR/panel.env
ExecStart=$VENV_DIR/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
StandardOutput=append:$LOG_DIR/backend.log
StandardError=append:$LOG_DIR/backend-error.log

[Install]
WantedBy=multi-user.target
EOF

# Arquivo de variáveis de ambiente (editável depois)
if [[ ! -f "$PANEL_DIR/panel.env" ]]; then
    cat > "$PANEL_DIR/panel.env" <<EOF2
# CORS: adicione a URL do tunnel aqui depois (ex: https://xxx.trycloudflare.com)
CORS_ORIGINS=http://localhost:5173
DATABASE_URL=sqlite:///$DB_DIR/panel.db
EOF2
    chown "$PANEL_USER:$PANEL_USER" "$PANEL_DIR/panel.env"
fi

systemctl daemon-reload
systemctl enable smtp-panel
systemctl restart smtp-panel
sleep 2
systemctl is-active smtp-panel > /dev/null && ok "Backend rodando na porta 8000" || warn "Backend não iniciou — verifique: journalctl -u smtp-panel -n 30"
