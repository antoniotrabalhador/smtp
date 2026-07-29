param(
    [int]$Port = 8000,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $candidate = Join-Path $env:LOCALAPPDATA 'Programs\cloudflared\cloudflared.exe'
    if (Test-Path $candidate) {
        return $candidate
    }

    return $null
}

if ($Force) {
    try {
        $existing = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue
        if ($existing) {
            $existing | Stop-Process -Force
        }
    } catch {}
}

$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
    Write-Host "cloudflared nao encontrado." -ForegroundColor Yellow
    Write-Host "Instale primeiro com: winget install --id Cloudflare.cloudflared" -ForegroundColor Yellow
    exit 1
}

Write-Host "Abrindo tunnel para http://127.0.0.1:$Port..." -ForegroundColor Cyan
Write-Host "Pressione Ctrl+C para parar." -ForegroundColor Yellow
& $cloudflared tunnel --url "http://127.0.0.1:$Port"
