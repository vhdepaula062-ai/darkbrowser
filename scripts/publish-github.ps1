param([string]$Owner = 'vhdepaula062-ai', [string]$Name = 'darkbrowser', [string]$Account = 'vhdepaula062-ai')
$ErrorActionPreference = 'Stop'
if (!(Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Instale o GitHub CLI e execute gh auth login antes de publicar.' }
gh auth status
if ($LASTEXITCODE) { throw 'Entre no GitHub com gh auth login.' }
$login = (& gh api user --jq .login).Trim()
if ($LASTEXITCODE -or $login -ne $Account) { throw "Conta autenticada incorreta: entre como $Account antes de publicar. Nenhum repositorio foi criado." }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stage = Join-Path $env:TEMP ('darkbrowser-publish-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($entry in @('src','src-tauri','scripts','public','ui-kit','crates','team-server','sdks','mcp','.github')) {
    & robocopy (Join-Path $root $entry) (Join-Path $stage $entry) /E /XD node_modules target dist .git /XF .env '*.log' '.verification-profile' '.remaining-i18n.json' /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Falha ao copiar $entry" }
}
Get-ChildItem -LiteralPath $root -File | Where-Object { $_.Extension -in '.json','.ts','.html','.md' -or $_.Name -in '.gitignore','LICENSE' } | Copy-Item -Destination $stage
Push-Location $stage
try {
    git init -b main
    git add .
    git commit -m 'DarkBrowser community source'
    if ($LASTEXITCODE) { throw 'Configure seu nome e e-mail do Git antes de publicar.' }
    gh repo create "$Owner/$Name" --public --source . --remote origin --push --description 'DarkBrowser: Chromium profile launcher with PT-BR and English interface'
    if ($LASTEXITCODE) { throw 'Não foi possível criar/publicar o repositório.' }
    Write-Host "Publicado: https://github.com/$Owner/$Name"
} finally { Pop-Location }
