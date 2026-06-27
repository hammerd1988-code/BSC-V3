# Casper CLI installer (Windows) — https://bloodsweatcode.org/install.ps1
#
#   irm https://bloodsweatcode.org/install.ps1 | iex
#
# Downloads the standalone casper.exe from the latest casper-cli GitHub release
# and installs it to %LOCALAPPDATA%\Casper\bin, adding that directory to your
# user PATH. No Node.js required.
#
# Environment overrides:
#   $env:CASPER_INSTALL_DIR   target directory (default: %LOCALAPPDATA%\Casper\bin)
#   $env:CASPER_VERSION       release tag to install (default: latest casper-cli-v*)

$ErrorActionPreference = 'Stop'

$Repo = 'hammerd1988-code/BSC-V3'
$InstallDir = if ($env:CASPER_INSTALL_DIR) { $env:CASPER_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Casper\bin' }

function Fail($msg) { Write-Host "X $msg" -ForegroundColor Red; exit 1 }

# Only x64 binaries are published for Windows today.
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne 'AMD64' -and $arch -ne 'x86') {
  Write-Host "! Detected architecture '$arch' — installing the x64 build (runs under emulation on Arm)." -ForegroundColor Yellow
}
$asset = 'casper-win-x64.exe'

# Resolve the release tag.
if ($env:CASPER_VERSION) {
  $tag = $env:CASPER_VERSION
} else {
  Write-Host 'Finding the latest Casper CLI release...' -ForegroundColor Cyan
  try {
    $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases" -Headers @{ 'User-Agent' = 'casper-installer' }
  } catch {
    Fail "Could not reach the GitHub releases API: $($_.Exception.Message)"
  }
  $rel = $releases | Where-Object { $_.tag_name -like 'casper-cli-v*' } | Select-Object -First 1
  if (-not $rel) { Fail 'Could not determine the latest casper-cli release tag.' }
  $tag = $rel.tag_name
}

$base = "https://github.com/$Repo/releases/download/$tag"
Write-Host "Downloading $asset ($tag)..." -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$dest = Join-Path $InstallDir 'casper.exe'

# Prefer the per-platform asset; fall back to the legacy 'casper.exe' that older
# releases shipped so this keeps working on today's release too.
try {
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $dest -UseBasicParsing
} catch {
  Write-Host "Per-platform asset not on $tag; trying legacy 'casper.exe'..." -ForegroundColor Cyan
  try {
    Invoke-WebRequest -Uri "$base/casper.exe" -OutFile $dest -UseBasicParsing
  } catch {
    Fail "Download failed. No '$asset' or 'casper.exe' asset on $tag."
  }
}

Write-Host "OK Installed casper -> $dest" -ForegroundColor Green

# Add the install dir to the user PATH if it isn't already there.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $InstallDir })) {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$InstallDir", 'User')
  $env:Path = "$env:Path;$InstallDir"
  Write-Host "Added $InstallDir to your user PATH (restart your terminal to pick it up)." -ForegroundColor Cyan
}

Write-Host ''
Write-Host "Run 'casper auth login' to link this machine, then 'casper --help'." -ForegroundColor Green
