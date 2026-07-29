#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="/var/log/smtp-panel"
mkdir -p "$LOG_DIR"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok() { echo -e "${GREEN}[OK]${NC}    $*"; }
info() { echo -e "${CYAN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }

if ! command -v cloudflared >/dev/null 2>&1; then
    info "Instalando cloudflared..."
    ARCH=$(dpkg --print-architecture)
    wget -q -O /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
    dpkg -i /tmp/cloudflared.deb >/dev/null 2>&1
fi

info "Parando serviço antigo, se existir..."
systemctl disable smtp-panel-tunnel >/dev/null 2>&1 || true
systemctl stop smtp-panel-tunnel >/dev/null 2>&1 || true
rm -f /etc/systemd/system/smtp-panel-tunnel.service

info "Criando serviço do tunnel..."
cat > /etc/systemd/system/smtp-panel-tunnel.service <<'SVC'
[Unit]
Description=Cloudflare Tunnel for SMTP Panel
After=network.target smtp-panel.service

[Service]
Type=simple
User=root
ExecStart=/usr/bin/cloudflared tunnel --url http://127.0.0.1:8000
Restart=always
RestartSec=10
StandardOutput=append:/var/log/smtp-panel/tunnel.log
StandardError=append:/var/log/smtp-panel/tunnel-error.log

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable smtp-panel-tunnel
systemctl start smtp-panel-tunnel

info "Aguardando a URL do novo tunnel..."
for i in $(seq 1 15); do
    if grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" >/dev/null 2>&1; then
        break
    fi
    sleep 3
done

URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | tail -1 || true)

if [[ -n "$URL" ]]; then
    ok "Tunnel ativo"
    echo ""
    echo -e "${CYAN}URL pública:${NC} $URL"
    echo ""
    echo "Use isso no webhook:"
    echo "$URL/api/webhooks/receive/TOKEN"
else
    warn "Não encontrei a URL ainda. Veja o log:"
    echo "tail -f $LOG_DIR/tunnel.log"
fi
