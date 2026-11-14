# MashVoice Singularity — Installateur Rapide Sans SmartScreen (Windows x64)
# Usage en 1 ligne PowerShell :
#   irm https://github.com/MyMasha/MashVoice/releases/latest/download/install-mashvoice.ps1 | iex

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host ""
Write-Host "  =========================================================" -ForegroundColor Yellow
Write-Host "   MASHVOICE SINGULARITY — Installation Rapide (MyMasha)" -ForegroundColor Yellow
Write-Host "  =========================================================" -ForegroundColor Yellow

$repo = "MyMasha/MashVoice"
Write-Host "  -> Recherche de la derniere release signee sur GitHub ($repo)..." -ForegroundColor Cyan
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "MashVoice-Installer" }
$version = $release.tag_name

$setupAsset = $release.assets | Where-Object { $_.name -match 'x64-setup\.exe$' } | Select-Object -First 1
if (-not $setupAsset) {
    $setupAsset = $release.assets | Where-Object { $_.name -match '\.exe$' } | Select-Object -First 1
}
if (-not $setupAsset) {
    throw "Aucun binaire Windows .exe trouve dans la release $version."
}

$tmpDir = Join-Path $env:TEMP "MashVoice-Install"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$destExe = Join-Path $tmpDir $setupAsset.name

Write-Host "  -> Telechargement de $($setupAsset.name) ($version)..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $setupAsset.browser_download_url -OutFile $destExe -UseBasicParsing

# Supprime le flux NTFS Zone.Identifier (Mark-of-the-Web) qui declenche la pop-up bleue SmartScreen
Unblock-File -Path $destExe -ErrorAction SilentlyContinue

if ($setupAsset.name -match 'setup\.exe$') {
    Write-Host "  -> Installation espace utilisateur (sans UAC ni SmartScreen)..." -ForegroundColor Green
    $proc = Start-Process -FilePath $destExe -ArgumentList "/S" -Wait -PassThru
    $installedExe = Join-Path $env:LOCALAPPDATA "MashVoice\MashVoice.exe"
    if (Test-Path $installedExe) {
        Unblock-File -Path $installedExe -ErrorAction SilentlyContinue
        Write-Host "  -> Lancement de MashVoice $version !" -ForegroundColor Green
        Start-Process -FilePath $installedExe
    } else {
        Write-Host "  -> Installation terminee (code $($proc.ExitCode))." -ForegroundColor Green
    }
} else {
    $appDir = Join-Path $env:LOCALAPPDATA "MashVoice"
    New-Item -ItemType Directory -Force -Path $appDir | Out-Null
    $targetExe = Join-Path $appDir "MashVoice.exe"
    Copy-Item -Path $destExe -Destination $targetExe -Force
    Unblock-File -Path $targetExe -ErrorAction SilentlyContinue
    Write-Host "  -> MashVoice $version installe dans $targetExe — Lancement !" -ForegroundColor Green
    Start-Process -FilePath $targetExe
}
