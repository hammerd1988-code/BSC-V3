#requires -Version 5.1
<#
.SYNOPSIS
    One-liner installer for the Casper CLI standalone binary.
.DESCRIPTION
    Downloads the latest Casper CLI release asset for Windows and installs it
    to a directory on the user's PATH.
.EXAMPLE
    powershell -Command "irm https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.ps1 | iex"
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$Version = "",
    [switch]$Force,
    [switch]$NoPath
)

$Owner = "hammerd1988-code"
$Repo = "BSC-V3"
$TagPrefix = "casper-cli-"

function Get-LatestTag {
    if ($Version) {
        if ($Version -notlike "$TagPrefix*") {
            return "$TagPrefix$Version"
        }
        return $Version
    }

    # GitHub's releases.atom feed is not rate-limited, unlike the REST API.
    $feed = Invoke-RestMethod -Uri "https://github.com/$Owner/$Repo/releases.atom" -UseBasicParsing
    $entries = if ($feed -is [array]) {
        $feed
    } elseif ($feed.PSObject.Properties.Name -contains 'feed' -and $feed.feed.entry) {
        $feed.feed.entry
    } else {
        $feed
    }
    foreach ($entry in $entries) {
        $title = $entry.title
        if ($title -like "$TagPrefix*") {
            return $title
        }
    }
    throw "No Casper CLI release found."
}

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Casper\bin"
}

$null = New-Item -ItemType Directory -Force -Path $InstallDir

$asset = "casper-win-x64.exe"
$tag = Get-LatestTag
$downloadUrl = "https://github.com/$Owner/$Repo/releases/download/$tag/$asset"
$targetPath = Join-Path $InstallDir "casper.exe"

if ((Test-Path $targetPath) -and -not $Force) {
    Write-Host "Casper is already installed at $targetPath" -ForegroundColor Yellow
    Write-Host "Run with -Force to overwrite or -InstallDir to choose a different directory."
    exit 1
}

Write-Host "Installing Casper CLI $tag for Windows x64..."
Write-Host "Downloading $asset..."

$tmp = Join-Path $env:TEMP "casper-install-$([Guid]::NewGuid()).exe"
try {
    Invoke-RestMethod -Uri $downloadUrl -OutFile $tmp -UseBasicParsing
} catch {
    Write-Host "Download failed: $downloadUrl" -ForegroundColor Red
    exit 1
}

Move-Item -Path $tmp -Destination $targetPath -Force

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
}

Write-Host ""
& $targetPath --version
