# Dot-source this file in PowerShell to get Mimo credentials in the current session:
#   . .\scripts\mimo-env.ps1

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') {
            Set-Item -Path "env:$($Matches[1])" -Value $Matches[2]
        }
    }
}

Write-Host "[mimo] MIMO_BASE_URL=$env:MIMO_BASE_URL"
Write-Host "[mimo] MIMO_DEFAULT_MODEL=$($env:MIMO_DEFAULT_MODEL ?? 'mimo-v2-flash')"
if ($env:MIMO_API_KEY) {
    Write-Host "[mimo] MIMO_API_KEY set ($($env:MIMO_API_KEY.Length) chars)"
} else {
    Write-Host "[mimo] MIMO_API_KEY NOT set - check .env.local"
}
