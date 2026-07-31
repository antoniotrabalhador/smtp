# Deploy — SMTP Fleet Panel

## Primeira instalação

### 1. Copie a pasta do projeto para a VPS do painel
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
- Instalar Python, Node.js 22.x, Nginx, Certbot e plugin do Nginx
- Fazer build do frontend (React/Vite)
- Criar serviço systemd para o backend (`smtp-panel.service`)
- Configurar nginx para servir o painel e a API
- Solicitar o domínio e emitir o certificado Let's Encrypt automaticamente
- Opcionalmente criar os registros DNS `A` e `CNAME` na Cloudflare

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

O backend lê `DATABASE_URL` e `CORS_ORIGINS` do arquivo `/opt/smtp-panel/panel.env` criado pelo instalador.

```bash
# Exemplo de /opt/smtp-panel/panel.env após instalação com domínio:
DATABASE_URL=sqlite:////var/lib/smtp-panel/panel.db
CORS_ORIGINS=https://painel.seudominio.com
```

> **Nota:** `localhost:5173` **não deve aparecer** no `CORS_ORIGINS` em produção — o instalador configura isso automaticamente com o domínio real.

## Acesso após instalação

| Recurso | URL |
|---|---|
| Painel (IP direto) | `http://IP_DA_VPS` |
| Painel (domínio) | `https://SEU_DOMINIO` |
| Webhook endpoint | `https://SEU_DOMINIO/api/webhooks/receive/TOKEN` |

---

## Atualizar após mudanças no código

```bash
# Sincronize os arquivos e depois na VPS:
bash /tmp/smtp-panel-src/deploy/update.sh
```

O `update.sh` cuida de:
- Sincronizar os arquivos
- Rebuildar o frontend
- Recarregar o nginx (para servir os novos assets imediatamente)
- Reinstalar dependências Python se necessário
- Reiniciar o backend

---

## Tunnel no ambiente de desenvolvimento (Windows)

Se você quiser expor o backend local para testar webhooks ou instalar agentes em VPSs remotas, rode no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\start-dev-tunnel.ps1 -Port 8000
```

Para forçar fechar um tunnel antigo antes de abrir outro:
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\start-dev-tunnel.ps1 -Port 8000 -Force
```

> **Atenção:** A URL gerada pelo tunnel é **temporária** — não use como `panel_url` ao instalar agentes nas VPSs.
> Use sempre o domínio permanente do painel (`https://painel.seudominio.com`).

---

## Comandos úteis na VPS

```bash
# Status dos serviços
systemctl status smtp-panel
systemctl status nginx

# Logs em tempo real
tail -f /var/log/smtp-panel/backend.log
tail -f /var/log/smtp-panel/backend-error.log
tail -f /var/log/smtp-panel/nginx-access.log

# Editar variáveis de ambiente (CORS, etc.)
nano /opt/smtp-panel/panel.env
systemctl restart smtp-panel
```

---

## Após obter o certificado

O `CORS_ORIGINS` no `/opt/smtp-panel/panel.env` é configurado automaticamente pelo instalador.
Se precisar ajustar manualmente:

```bash
nano /opt/smtp-panel/panel.env
# CORS_ORIGINS=https://painel.seudominio.com
systemctl restart smtp-panel
```
