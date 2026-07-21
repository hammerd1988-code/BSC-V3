#requires -Version 5.1
<#
.SYNOPSIS
    One-liner installer for the Casper CLI standalone binary.
.DESCRIPTION
    Downloads the latest Casper CLI release asset for Windows, verifies its
    SHA-256 checksum against the release manifest, and installs it to a
    directory on the user's PATH.
.EXAMPLE
    powershell -Command "irm https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.ps1 | iex"
.EXAMPLE
    # Upgrade in place
    & ([scriptblock]::Create((irm .../install.ps1))) -Update
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$Version = "",
    [switch]$Force,
    [switch]$Update,
    [switch]$NoPath,
    [switch]$NoVerify
)

$ErrorActionPreference = "Stop"

$Owner = "hammerd1988-code"
$Repo = "BSC-V3"
$TagPrefix = "casper-cli-v"

if ($Update) { $Force = $true }

function Get-LatestTag {
    if ($Version) {
        if ($Version -like "$TagPrefix*") { return $Version }
        return "$TagPrefix$Version"
    }

    # GitHub's releases.atom feed is not rate-limited, unlike the REST API.
    # Resolve by the *tag* in each release link, not the editable title.
    $feedRaw = Invoke-WebRequest -Uri "https://github.com/$Owner/$Repo/releases.atom" -UseBasicParsing
    $content = $feedRaw.Content
    $matches = [regex]::Matches($content, "releases/tag/($([regex]::Escape($TagPrefix))[0-9][^""<]*)")
    foreach ($m in $matches) {
        return $m.Groups[1].Value   # entries are newest-first
    }
    throw "No Casper CLI release found."
}

# Detect ARM64 Windows so we install the matching binary.
$archEnv = $env:PROCESSOR_ARCHITECTURE
$arch6432 = $env:PROCESSOR_ARCHITEW6432
if ($archEnv -eq "ARM64" -or $arch6432 -eq "ARM64") {
    $asset = "casper-win-arm64.exe"
} else {
    $asset = "casper-win-x64.exe"
}

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Casper\bin"
}

$null = New-Item -ItemType Directory -Force -Path $InstallDir

$tag = Get-LatestTag
$baseUrl = "https://github.com/$Owner/$Repo/releases/download/$tag"
$downloadUrl = "$baseUrl/$asset"
$targetPath = Join-Path $InstallDir "casper.exe"

if ((Test-Path $targetPath) -and -not $Force) {
    $current = ""
    try { $current = (& $targetPath --version 2>$null) } catch { }
    if ($current) {
        Write-Host "Casper $current is already installed at $targetPath" -ForegroundColor Yellow
    } else {
        Write-Host "Casper is already installed at $targetPath" -ForegroundColor Yellow
    }
    Write-Host "Run with -Update to upgrade in place, -Force to overwrite, or -InstallDir to choose a different directory."
    exit 1
}

Write-Host "Installing Casper CLI $tag for Windows ($asset)..."
Write-Host "Downloading $asset..."

$tmpDir = Join-Path $env:TEMP "casper-install-$([Guid]::NewGuid())"
$null = New-Item -ItemType Directory -Force -Path $tmpDir
$tmp = Join-Path $tmpDir $asset
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tmp -UseBasicParsing
} catch {
    Write-Host "Download failed: $downloadUrl" -ForegroundColor Red
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    exit 1
}

# Verify integrity against the release SHA256SUMS manifest before installing.
if ($NoVerify) {
    Write-Host "WARNING: skipping checksum verification (-NoVerify)." -ForegroundColor Yellow
} else {
    $sumsPath = Join-Path $tmpDir "SHA256SUMS"
    $haveSums = $true
    try {
        Invoke-WebRequest -Uri "$baseUrl/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing
    } catch {
        $haveSums = $false
    }
    if ($haveSums) {
        $expected = $null
        foreach ($line in Get-Content $sumsPath) {
            $parts = $line -split '\s+', 2
            if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $asset) {
                $expected = $parts[0].Trim().ToLower()
                break
            }
        }
        if (-not $expected) {
            Write-Host "Checksum for $asset not found in SHA256SUMS." -ForegroundColor Red
            Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
            exit 1
        }
        $actual = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()
        if ($expected -ne $actual) {
            Write-Host "Checksum mismatch for $asset!" -ForegroundColor Red
            Write-Host "  expected: $expected"
            Write-Host "  actual:   $actual"
            Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
            exit 1
        }
        Write-Host "Checksum OK ($actual)."
    } else {
        Write-Host "WARNING: no SHA256SUMS published for $tag; cannot verify integrity. Continuing." -ForegroundColor Yellow
    }
}

Move-Item -Path $tmp -Destination $targetPath -Force
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue

if (-not $NoPath) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $parts = $userPath -split ';' | ForEach-Object { $_.TrimEnd('\') } | Where-Object { $_ -ne "" }
    if ($parts -notcontains $InstallDir) {
        [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$userPath", "User")
        Write-Host "Added $InstallDir to your user PATH." -ForegroundColor Green
    }
    # Also make the current process see it immediately.
    $procPath = [Environment]::GetEnvironmentVariable("Path", "Process")
    [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$procPath", "Process")
} else {
    Write-Host ""
    Write-Host "Add $InstallDir to your PATH to use 'casper' from anywhere."
}

Write-Host ""
& $targetPath --version
