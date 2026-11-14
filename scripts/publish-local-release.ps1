<#
.SYNOPSIS
  Build MashVoice locally on Windows (using all CPU cores in ~45s incremental)
  and publish all .exe / .msi / Portable.zip / Auto-Updater assets directly to GitHub Releases
  without waiting for GitHub Actions!

.EXAMPLE
  npm run release:local
  # or bump version + build + push in 1 command:
  powershell -ExecutionPolicy Bypass -File scripts/publish-local-release.ps1 -Version 1.0.8
#>

param(
  [string]$Version = "",
  [string]$Repo = "MyMasha/MashVoice",
  [switch]$SkipGitPush
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI ('gh') est requis. Installez-le avec : winget install GitHub.cli puis 'gh auth login'"
}

# Optional automatic version bump across package.json, Cargo.toml, src-tauri/Cargo.toml & tauri.conf.json
if ($Version -ne "") {
  $cleanVer = $Version.TrimStart("v")
  Write-Host "-> Mise a jour de la version vers v$cleanVer..." -ForegroundColor Cyan

  $pkgRaw = Get-Content "package.json" -Raw
  $pkgRaw = $pkgRaw -replace '"version":\s*"[^"]+"', "`"version`": `"$cleanVer`""
  Set-Content "package.json" -Value $pkgRaw -NoNewline

  $tauriConfRaw = Get-Content "src-tauri/tauri.conf.json" -Raw
  $tauriConfRaw = $tauriConfRaw -replace '"version":\s*"[^"]+"', "`"version`": `"$cleanVer`""
  Set-Content "src-tauri/tauri.conf.json" -Value $tauriConfRaw -NoNewline

  $rootCargo = Get-Content "Cargo.toml" -Raw
  $rootCargo = $rootCargo -replace 'version\s*=\s*"[^"]+"', "version = `"$cleanVer`""
  Set-Content "Cargo.toml" -Value $rootCargo -NoNewline

  $tauriCargo = Get-Content "src-tauri/Cargo.toml" -Raw
  $tauriCargo = $tauriCargo -replace '(?m)^version\s*=\s*"[^"]+"', "version = `"$cleanVer`""
  Set-Content "src-tauri/Cargo.toml" -Value $tauriCargo -NoNewline
}

$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
$ver = $pkg.version
$tag = "v$ver"

# Maximize local multi-core Rust speed
$cores = [Environment]::ProcessorCount
$env:CARGO_BUILD_JOBS = "$cores"
$env:RUSTFLAGS = "-C debuginfo=0"

# Load local Tauri signing key automatically if stored at ~/.tauri/mashvoice.key
$defaultKeyPath = Join-Path $HOME ".tauri\mashvoice.key"
if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and (Test-Path $defaultKeyPath)) {
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $defaultKeyPath -Raw
  if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
  }
  Write-Host "-> Cle de signature Ed25519 locale chargee depuis $defaultKeyPath" -ForegroundColor Green
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host "-> Build local MashVoice $tag sur $cores threads CPU..." -ForegroundColor Yellow
npm run tauri:build
if ($LASTEXITCODE -ne 0) {
  throw "Echec du build local Tauri."
}

$releaseDir = "src-tauri/target/release"
$bundleDir = "$releaseDir/bundle"
$plainExe = "$releaseDir/mashvoice-tauri.exe"
if (-not (Test-Path $plainExe)) {
  throw "Binaire introuvable : $plainExe"
}

# Collect all generated artifacts
$uploadDir = Join-Path $env:TEMP "mashvoice-local-release-$ver"
if (Test-Path $uploadDir) { Remove-Item $uploadDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $uploadDir | Out-Null

# 1. Plain portable .exe (used by atomic 1-click SmartScreen-free self-updater)
$namedPlainExe = Join-Path $uploadDir "mashvoice-tauri_windows_x64.exe"
Copy-Item $plainExe $namedPlainExe -Force

# 2. Portable .zip
$stageDir = Join-Path $uploadDir "stage"
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Copy-Item $plainExe (Join-Path $stageDir "MashVoice.exe") -Force
$zipPath = Join-Path $uploadDir "MashVoice_${ver}_x64_Portable.zip"
Compress-Archive -Path "$stageDir/*" -DestinationPath $zipPath -Force
Remove-Item $stageDir -Recurse -Force

# 3. NSIS setup .exe, .msi & .sig files
$nsisFiles = Get-ChildItem -Path "$bundleDir/nsis" -File -ErrorAction SilentlyContinue
$msiFiles = Get-ChildItem -Path "$bundleDir/msi" -File -ErrorAction SilentlyContinue
foreach ($f in @($nsisFiles) + @($msiFiles)) {
  if ($null -ne $f) {
    Copy-Item $f.FullName (Join-Path $uploadDir $f.Name) -Force
  }
}

# 4. Generate latest.json for signed Tauri updater if .sig was produced
$setupSig = Get-ChildItem -Path $uploadDir -Filter "*-setup.exe.sig" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($setupSig) {
  $setupName = $setupSig.Name -replace '\.sig$', ''
  $sigContent = (Get-Content $setupSig.FullName -Raw).Trim()
  $latestObj = @{
    version = $ver
    notes = "MashVoice Singularity $tag (Build Local Rapide)"
    pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = @{
      "windows-x86_64" = @{
        signature = $sigContent
        url = "https://github.com/$Repo/releases/download/$tag/$setupName"
      }
    }
  }
  $latestJsonPath = Join-Path $uploadDir "latest.json"
  $latestObj | ConvertTo-Json -Depth 6 | Set-Content -Path $latestJsonPath -Encoding UTF8
}

# 5. SmartScreen-free PowerShell installer
Copy-Item "scripts/install-mashvoice.ps1" (Join-Path $uploadDir "install-mashvoice.ps1") -Force

$assets = Get-ChildItem -Path $uploadDir -File | ForEach-Object { $_.FullName }
Write-Host "-> Publication directe de $($assets.Count) fichiers vers GitHub Release $tag ($Repo)..." -ForegroundColor Cyan

$notes = @"
### ✨ MashVoice Singularity $tag (Windows x64 • Build Local Direct)
- **🚫 Zéro Barre en Jeu** : Masquage automatique de la barre flottante Windows/WebView2 de partage d'écran.
- **🎞️ Stream P2P `720p / 1080p / 2K / 4K` @ `15 / 30 / 60 / 120 FPS`** : Choix complet avant et pendant le stream.
- **🧊 Anti-Freeze Minecraft & OpenGL Plein Écran** : Désactivation `CalculateNativeWinOcclusion` + Anti-EcoQoS Windows 11 + Watchdog WebRTC.
- **🛡️ MashKrisp™ IA + Auto-Updater 1-Clic Sans SmartScreen**.

#### ⚡ Installation Rapide Sans Pop-Up Bleue SmartScreen (PowerShell)
``````powershell
irm https://github.com/$Repo/releases/latest/download/install-mashvoice.ps1 | iex
``````
"@

# Create release BEFORE pushing tag so GitHub Actions detects assets are already uploaded and skips rebuilding!
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$ErrorActionPreference = "Continue"
gh release view $tag --repo $Repo *> $null
$existsCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($existsCode -eq 0) {
  gh release upload $tag @assets --repo $Repo --clobber
} else {
  gh release create $tag @assets --repo $Repo --title "MashVoice Singularity $tag (Windows x64)" --notes $notes
}

if (-not $SkipGitPush) {
  $ErrorActionPreference = "Continue"
  git push origin HEAD 2>$null
  git push origin $tag 2>$null
}

$global:LASTEXITCODE = 0

$sw.Stop()
Write-Host "✓ Release $tag publiee en $([math]::Round($sw.Elapsed.TotalSeconds, 1))s sur https://github.com/$Repo/releases/tag/$tag !" -ForegroundColor Green
