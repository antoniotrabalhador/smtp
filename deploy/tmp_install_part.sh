# ── 9. Nginx ────────────────────────────────────────────────
info "Configurando nginx..."
cat > /etc/nginx/sites-available/smtp-panel <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # API → backend Python
    location /api/ {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

    # Frontend buildado (React)
    location / {
        root  DIST_PLACEHOLDER;
        index index.html;
        try_files $uri /index.html;
    }

    # Logs
    access_log /var/log/smtp-panel/nginx-access.log;
    error_log  /var/log/smtp-panel/nginx-error.log;
}
NGINX

# Substituir placeholder pelo caminho real
sed -i "s|DIST_PLACEHOLDER|$DIST_DIR|g" /etc/nginx/sites-available/smtp-panel

# Ativar site
ln -sf /etc/nginx/sites-available/smtp-panel /etc/nginx/sites-enabled/smtp-panel
rm -f /etc/nginx/sites-enabled/default

nginx -t -q && systemctl reload nginx
ok "Nginx configurado — painel acessível em http://$(hostname -I | awk '{print $1}')"

# ── 10. Domínio + HTTPS com nginx + Let's Encrypt ──────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   Configuração do domínio + HTTPS                  ${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"
echo ""

# Limpar qualquer setup antigo do cloudflared
systemctl disable smtp-panel-tunnel >/dev/null 2>&1 || true
systemctl stop smtp-panel-tunnel >/dev/null 2>&1 || true
rm -f /etc/systemd/system/smtp-panel-tunnel.service

apt-get install -y -qq certbot python3-certbot-nginx > /dev/null 2>&1

read -rp "Digite o domínio público do painel (ex: painel.exemplo.com): " PANEL_DOMAIN
PANEL_DOMAIN=${PANEL_DOMAIN:-}

if [[ -n "$PANEL_DOMAIN" ]]; then
    read -rp "Digite o e-mail para o certificado Let's Encrypt: " CERT_EMAIL
    CERT_EMAIL=${CERT_EMAIL:-admin@$PANEL_DOMAIN}
else
    CERT_EMAIL=""
fi

# Configuração do nginx com o domínio (ou fallback para IP)
cat > /etc/nginx/sites-available/smtp-panel <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name SERVER_NAME_PLACEHOLDER;

    location /api/ {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location / {
        root DIST_PLACEHOLDER;
        index index.html;
        try_files $uri /index.html;
    }

    access_log /var/log/smtp-panel/nginx-access.log;
    error_log  /var/log/smtp-panel/nginx-error.log;
}
NGINX

sed -i "s|SERVER_NAME_PLACEHOLDER|${PANEL_DOMAIN:-_}|g" /etc/nginx/sites-available/smtp-panel
sed -i "s|DIST_PLACEHOLDER|$DIST_DIR|g" /etc/nginx/sites-available/smtp-panel

ln -sf /etc/nginx/sites-available/smtp-panel /etc/nginx/sites-enabled/smtp-panel
rm -f /etc/nginx/sites-enabled/default

nginx -t -q && systemctl reload nginx

if [[ -n "$PANEL_DOMAIN" ]]; then
    info "Pedido de certificado Let's Encrypt para $PANEL_DOMAIN"
    echo -e "${YELLOW}Antes de continuar, certifique-se de que o DNS A/AAAA do domínio aponta para este servidor.${NC}"
    read -rp "Pressione Enter quando o DNS estiver pronto..." _

    if ! certbot --nginx --non-interactive --agree-tos --redirect --email "$CERT_EMAIL" -d "$PANEL_DOMAIN"; then
        warn "Não foi possível obter o certificado automaticamente. Verifique o DNS e rode: certbot --nginx -d $PANEL_DOMAIN"
    fi
fi

if [[ -n "$PANEL_DOMAIN" ]]; then
    sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://localhost:5173,https://$PANEL_DOMAIN|" "$PANEL_DIR/panel.env"
    PANEL_URL="https://$PANEL_DOMAIN"
else
    sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://localhost:5173|" "$PANEL_DIR/panel.env"
    PANEL_URL="http://$(hostname -I | awk '{print $1}')"
fi

systemctl restart smtp-panel

# ── 11. Resumo final ────────────────────────────────────────