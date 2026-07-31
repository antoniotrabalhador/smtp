#!/usr/bin/env bash
# ============================================================
#  SMTP Fleet Panel — Script de Atualização
#  Executa na VPS como root após sincronizar os arquivos
# ============================================================
set -euo pipefail

PANEL_DIR="/opt/smtp-panel"
VENV_DIR="$PANEL_DIR/backend/.venv"
LOG_DIR="/var/log/smtp-panel"
DB_DIR="/var/lib/smtp-panel"
PANEL_USER="smtppanel"
PANEL_ENV="$PANEL_DIR/panel.env"

ensure_node() {
    if command -v node >/dev/null 2>&1; then
        local node_version major
        node_version=$(node -v 2>/dev/null | sed 's/^v//')
        major=$(echo "$node_version" | cut -d. -f1)
        if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 20 )); then
            return 0
        fi
    fi

    info "Atualizando Node.js para 22.x para compatibilidade com Vite 8..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs >/dev/null 2>&1
    node -v >/dev/null 2>&1 || { echo "ERRO — falha ao instalar Node.js"; exit 1; }
}

GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
info() { echo -e "${CYAN}[INFO]${NC}  $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"

if [[ ! -f "$PANEL_ENV" ]]; then
    mkdir -p "$DB_DIR" "$LOG_DIR"
    cat > "$PANEL_ENV" <<EOF
# CORS: informe o domínio público aqui depois, ex: https://painel.exemplo.com
CORS_ORIGINS=http://localhost:5173
DATABASE_URL=sqlite:///$DB_DIR/panel.db
EOF
    chown "$PANEL_USER:$PANEL_USER" "$PANEL_ENV"
fi

info "Sincronizando arquivos..."
rsync -a --exclude='**/.venv' --exclude='**/node_modules' --exclude='**/__pycache__' --exclude='**/dist' "$SRC_DIR/backend" "$PANEL_DIR/"
rsync -a --exclude='**/node_modules' --exclude='**/dist' "$SRC_DIR/frontend" "$PANEL_DIR/"

"$VENV_DIR/bin/pip" install --quiet -r "$PANEL_DIR/backend/requirements.txt"

ensure_node

info "Rebuilding frontend..."
cd "$PANEL_DIR/frontend"
npm install --silent
npm run build --silent
ok "Frontend buildado"

# Recarrega o nginx para servir os novos assets imediatamente
if systemctl is-active nginx > /dev/null 2>&1; then
    nginx -t -q && systemctl reload nginx
    ok "Nginx recarregado"
fi

chown -R "$PANEL_USER:$PANEL_USER" "$PANEL_DIR"

info "Reiniciando backend..."
systemctl restart smtp-panel
sleep 2
if systemctl is-active smtp-panel > /dev/null; then
    ok "Backend reiniciado"
else
    echo "ERRO — log:"
    journalctl -u smtp-panel -n 20
fi

ok "Atualização concluída"
