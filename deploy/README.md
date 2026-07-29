# Deploy — SMTP Fleet Panel

## Primeira instalação

### 1. Copie a pasta do projeto para a VPS
```bash
# Do seu computador local:
scp -r "script agents/" root@IP_DA_VPS:/tmp/smtp-panel-src
```
Ou via git se tiver repositório:
```bash
git clone SEU_REPO /tmp/smtp-panel-src
```

### 2. Configure o DNS antes da instalação
Antes de rodar o instalador, o registro A/AAAA do domínio escolhido deve apontar para o IP público da VPS.
Exemplo:
- `painel.seudominio.com` → IP da VPS

### 3. Execute o instalador na VPS
```bash
ssh root@IP_DA_VPS
cd /tmp/smtp-panel-src/deploy
bash install.sh
```

O script vai:
- Instalar Python, Node.js, Nginx, Certbot e plugin do Nginx
- Fazer build do frontend
- Criar serviço systemd para o backend
- Configurar nginx para servir o painel e a API
- Solicitar o domínio e pedir um certificado Let's Encrypt
- Se você responder `s` à pergunta de Cloudflare, criar automaticamente os registros DNS `A` e `CNAME` na Cloudflare

---

## Fluxo esperado

1. O script pergunta pelo domínio público (ex: `painel.seudominio.com`)
2. O script cria o bloco do nginx para esse domínio
3. O Certbot solicita o certificado HTTPS via Let's Encrypt
4. O painel fica disponível em:
   - `https://SEU_DOMINIO`
   - `http://IP_DA_VPS` (fallback local)

---

## Observações de produção

O backend lê `DATABASE_URL` e `CORS_ORIGINS` do arquivo `/opt/smtp-panel/panel.env` criado pelo instalador. Se você estiver fazendo deploy em uma VPS, garanta que o `DATABASE_URL` aponte para um diretório persistente, por exemplo:

```bash
DATABASE_URL=sqlite:////var/lib/smtp-panel/panel.db
CORS_ORIGINS=https://SEU_DOMINIO
```

## Acesso após instalação

| Recurso | URL |
|---|---|
| Painel local | `http://IP_DA_VPS` |
| Painel via domínio | `https://SEU_DOMINIO` |
| Webhook endpoint | `https://SEU_DOMINIO/api/webhooks/receive/TOKEN` |

---

## Atualizar após mudanças no código

```bash
# Sincronize os arquivos e depois na VPS:
bash /tmp/smtp-panel-src/deploy/update.sh
```

---

## Tunnel no ambiente de desenvolvimento

Se você quiser reabrir um tunnel no seu computador local (não na VPS), rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\start-dev-tunnel.ps1 -Port 8000
```

Se quiser matar um tunnel antigo antes de abrir outro:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\start-dev-tunnel.ps1 -Port 8000 -Force
```

O script abre o tunnel para o backend em `http://127.0.0.1:8000` e imprime a URL pública do Cloudflare.

---

## Comandos úteis na VPS

```bash
# Status dos serviços
systemctl status smtp-panel
systemctl status nginx

# Logs em tempo real
tail -f /var/log/smtp-panel/backend.log

# Editar variáveis de ambiente (CORS, etc.)
nano /opt/smtp-panel/panel.env
systemctl restart smtp-panel
```

---

## Após obter o certificado

Edite `/opt/smtp-panel/panel.env` se quiser ajustar o CORS:
```bash
CORS_ORIGINS=http://localhost:5173,https://SEU_DOMINIO
```
E reinicie:
```bash
systemctl restart smtp-panel
```
