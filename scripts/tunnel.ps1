#requires -Version 5.1
<#
  Держит бесплатный туннель Pinggy живым и публикует актуальную ссылку
  в index.html на GitHub Pages.

  Бесплатный Pinggy закрывает туннель примерно через 60 минут, поэтому
  скрипт перезапускает его и обновляет ссылку в витрине.

  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\tunnel.ps1
#>

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$PinggyHost = '213.109.192.63'
$LocalPort  = if ($env:PORT) { $env:PORT } else { '4173' }
$IndexFile  = Join-Path $repo 'index.html'
$LogDir     = Join-Path $env:TEMP 'invest-osmotr'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$Message) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -Path (Join-Path $LogDir 'tunnel.log') -Value $line -Encoding UTF8
}

function Test-Local {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$LocalPort/api/health" -TimeoutSec 5
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Start-LocalServer {
  if (Test-Local) { return }
  Write-Log 'локальный сервер не отвечает — запускаю'
  $env:PORT = $LocalPort
  $env:HOST = '::'
  Start-Process -FilePath 'node' -ArgumentList 'server.js' `
    -WorkingDirectory $repo `
    -RedirectStandardOutput (Join-Path $LogDir 'server.out.log') `
    -RedirectStandardError  (Join-Path $LogDir 'server.err.log') `
    -WindowStyle Hidden
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Local) { return }
  }
  throw 'сервер не поднялся'
}

function Update-PublishedLink([string]$Url) {
  $html = Get-Content -Path $IndexFile -Raw -Encoding UTF8
  $pattern = '(?s)<!--LIVE_START-->.*?<!--LIVE_END-->'
  $block = '<!--LIVE_START--><a id="live" class="btn" href="' + $Url + '">Открыть демо&nbsp;→</a><!--LIVE_END-->'

  $currentHref = [regex]::Match($html, 'id="live"[^>]*href="([^"]+)"').Groups[1].Value
  if ($currentHref -eq $Url) {
    Write-Log "ссылка уже актуальна: $Url"
    return
  }

  $updated = [regex]::Replace($html, $pattern, $block)
  if ($updated -eq $html) { Write-Log 'блок ссылки не найден в index.html'; return }

  Set-Content -Path $IndexFile -Value $updated -Encoding UTF8 -NoNewline
  Write-Log "index.html обновлён: $Url"

  git add index.html 2>&1 | Out-Null
  $staged = git diff --cached --name-only
  if (-not $staged) { Write-Log 'нечего коммитить'; return }

  git -c user.name='fxllxw910' -c user.email='fxllxw910@users.noreply.github.com' `
      commit -m 'витрина: актуальная ссылка на демо-стенд' 2>&1 | Out-Null
  $push = git push origin HEAD:main 2>&1
  Write-Log ('git push: ' + ($push -join ' ').Trim())
}

function Open-Tunnel {
  $out = Join-Path $LogDir 'tunnel.out.log'
  $err = Join-Path $LogDir 'tunnel.err.log'
  Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

  Write-Log 'запускаю туннель Pinggy'
  $proc = Start-Process -FilePath 'ssh' `
    -ArgumentList '-T', '-p', '443',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=20',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ConnectTimeout=25',
      '-R', "0:localhost:$LocalPort",
      $PinggyHost `
    -RedirectStandardOutput $out `
    -RedirectStandardError  $err `
    -PassThru -WindowStyle Hidden

  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Test-Path $out)) { continue }
    $text = Get-Content -Path $out -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    $m = [regex]::Match($text, 'https://[a-z0-9-]+\.free\.pinggy\.net')
    if ($m.Success) { return @{ Url = $m.Value; Process = $proc } }
    if ($proc.HasExited) { break }
  }

  try { $proc | Stop-Process -Force -ErrorAction SilentlyContinue } catch { }
  $tail = Get-Content -Path $err -Raw -ErrorAction SilentlyContinue
  throw ('не удалось получить ссылку туннеля: ' + ($tail -replace '\s+', ' '))
}

Write-Log '=== сторож туннеля запущен ==='

while ($true) {
  try {
    Start-LocalServer
    $tunnel = Open-Tunnel
    Write-Log "туннель поднят: $($tunnel.Url)"
    Start-Sleep -Seconds 4
    Update-PublishedLink $tunnel.Url

    # Ждём, пока туннель жив, и проверяем его раз в минуту.
    while (-not $tunnel.Process.HasExited) {
      Start-Sleep -Seconds 60
    }
    Write-Log 'туннель закрыт — перезапускаю'
  } catch {
    Write-Log ('ошибка: ' + $_.Exception.Message)
  }
  Start-Sleep -Seconds 5
}
