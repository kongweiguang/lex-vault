<#
.SYNOPSIS
Lex Vault Windows release helper for version bump, build, and updater artifacts.

.DESCRIPTION
By default bumps the desktop app patch version, synchronizes it across the
Tauri project files, builds the Windows NSIS installer, verifies updater
artifacts, generates latest.json, and copies the publishable files into a
versioned release directory.

.PARAMETER Version
Explicit semantic version to release, for example 0.1.4.

.PARAMETER Bump
Auto-increment the current semantic version by major, minor, or patch. When
neither Version nor Bump is provided, patch is used by default.

.PARAMETER ReleaseNotes
Release notes written into latest.json when ReleaseNotesFile is not provided.

.PARAMETER ReleaseNotesFile
UTF-8 text file whose full content will be written to latest.json notes.

.PARAMETER UpdaterEndpoint
Static updater endpoint prefix, for example:
https://law.ktestai.cn/lex-vault/app

.PARAMETER SigningKeyPath
Path to the Tauri updater signing private key.

.PARAMETER SkipBuild
Only updates versions and metadata, skips tauri build and artifact generation.
#>

param(
    [string]$Version,
    [ValidateSet("major", "minor", "patch")]
    [string]$Bump,
    [string]$ReleaseNotes = "- 修复了一些已知的问题。",
    [string]$ReleaseNotesFile,
    [string]$UpdaterEndpoint = "https://law.ktestai.cn/lex-vault/app",
    [string]$SigningKeyPath = "$HOME/.tauri/lex-vault.key",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Assert-SemVer {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if ($Value -notmatch '^\d+\.\d+\.\d+$') {
        throw "Version must use semantic version format x.y.z: $Value"
    }
}

function Get-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Set-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        $Value
    )

    $Value | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-NextVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CurrentVersion,
        [Parameter(Mandatory = $true)]
        [string]$Segment
    )

    Assert-SemVer -Value $CurrentVersion
    $parts = $CurrentVersion.Split(".") | ForEach-Object { [int]$_ }
    switch ($Segment) {
        "major" { return "{0}.0.0" -f ($parts[0] + 1) }
        "minor" { return "{0}.{1}.0" -f $parts[0], ($parts[1] + 1) }
        "patch" { return "{0}.{1}.{2}" -f $parts[0], $parts[1], ($parts[2] + 1) }
        default { throw "Unsupported bump segment: $Segment" }
    }
}

function Set-CargoPackageVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$TargetVersion
    )

    $content = Get-Content -Raw -LiteralPath $Path
    $replacement = '${1}' + $TargetVersion + '$3'
    $updated = [regex]::Replace(
        $content,
        '(?ms)(\[package\][\s\S]*?version\s*=\s*")([^"]+)(")',
        $replacement,
        1
    )

    if ($updated -eq $content) {
        throw "Failed to update Cargo package version in $Path"
    }

    Set-Content -LiteralPath $Path -Value $updated -Encoding UTF8
}

function Resolve-ReleaseNotes {
    param(
        [string]$InlineNotes,
        [string]$NotesFile
    )

    if ([string]::IsNullOrWhiteSpace($NotesFile)) {
        return $InlineNotes
    }

    if (-not (Test-Path -LiteralPath $NotesFile)) {
        throw "Release notes file not found: $NotesFile"
    }

    return (Get-Content -Raw -LiteralPath $NotesFile).Trim()
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$uiDir = (Resolve-Path $scriptDir).Path
$srcTauriDir = Join-Path $uiDir "src-tauri"
$bundleDir = Join-Path $srcTauriDir "target/release/bundle/nsis"
$packageJsonPath = Join-Path $uiDir "package.json"
$cargoTomlPath = Join-Path $srcTauriDir "Cargo.toml"
$configPath = Join-Path $srcTauriDir "tauri.conf.json"

if ($Version -and $Bump) {
    throw "Use either -Version or -Bump, not both."
}

$packageJson = Get-JsonFile -Path $packageJsonPath
$currentVersion = [string]$packageJson.version
Assert-SemVer -Value $currentVersion

$resolvedBump = $Bump
if (-not $Version -and -not $resolvedBump) {
    $resolvedBump = "patch"
}

$targetVersion = $currentVersion
if ($Version) {
    Assert-SemVer -Value $Version
    $targetVersion = $Version
} elseif ($resolvedBump) {
    $targetVersion = Get-NextVersion -CurrentVersion $currentVersion -Segment $resolvedBump
}

$notes = Resolve-ReleaseNotes -InlineNotes $ReleaseNotes -NotesFile $ReleaseNotesFile
$normalizedEndpoint = $UpdaterEndpoint.TrimEnd("/")

Write-Host "[INFO] current version: $currentVersion"
Write-Host "[INFO] target version: $targetVersion"
Write-Host "[INFO] updater endpoint: $normalizedEndpoint"
if ($resolvedBump) {
    Write-Host "[INFO] version bump strategy: $resolvedBump"
}

if ($targetVersion -ne $currentVersion) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm not found. Install Node.js and add npm to PATH first."
    }

    Write-Host "[INFO] syncing package.json and package-lock.json..."
    Push-Location $uiDir
    try {
        & npm version $targetVersion --no-git-tag-version --allow-same-version
    } finally {
        Pop-Location
    }

    Write-Host "[INFO] syncing src-tauri/Cargo.toml..."
    Set-CargoPackageVersion -Path $cargoTomlPath -TargetVersion $targetVersion

    Write-Host "[INFO] syncing src-tauri/tauri.conf.json..."
    $config = Get-JsonFile -Path $configPath
    $config.version = $targetVersion
    Set-JsonFile -Path $configPath -Value $config
} else {
    Write-Host "[INFO] version unchanged; skipping version bump."
    $config = Get-JsonFile -Path $configPath
}

if ($SkipBuild) {
    Write-Host "[SUCCESS] version sync finished. Build skipped."
    Write-Host "          package.json / package-lock.json / Cargo.toml / tauri.conf.json -> $targetVersion"
    exit 0
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $env:TAURI_SIGNING_PRIVATE_KEY = $SigningKeyPath
}

if (-not (Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY)) {
    throw "Updater private key not found: $($env:TAURI_SIGNING_PRIVATE_KEY)`nRun this first:`nnpm run tauri signer generate -- -w `"$SigningKeyPath`""
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found. Install Node.js and add npm to PATH first."
}

Write-Host "[INFO] signer key: $($env:TAURI_SIGNING_PRIVATE_KEY)"
if ($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    Write-Host "[INFO] signer password env detected."
} else {
    Write-Host "[INFO] signer password env not set. Using key without password."
}
Write-Host "[INFO] release build will ignore local .env.development.local / .env.local overrides."
Write-Host "[INFO] running tauri build..."

Push-Location $uiDir
try {
    $env:LEX_VAULT_DISABLE_LOCAL_DEV_ENV = "1"
    & npm run tauri build
    if ($LASTEXITCODE -ne 0) {
        throw "tauri build failed with exit code $LASTEXITCODE"
    }
} finally {
    Remove-Item Env:LEX_VAULT_DISABLE_LOCAL_DEV_ENV -ErrorAction SilentlyContinue
    Pop-Location
}

if (-not (Test-Path -LiteralPath $bundleDir)) {
    throw "NSIS bundle directory not found: $bundleDir"
}

$setupExe = Get-ChildItem -LiteralPath $bundleDir -Filter "*-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setupExe) {
    throw "Setup exe not found under: $bundleDir"
}

$setupSigPath = "$($setupExe.FullName).sig"
if (-not (Test-Path -LiteralPath $setupSigPath)) {
    throw "Signature file not found: $setupSigPath`nMake sure createUpdaterArtifacts is enabled and the build used the signing key."
}

$latestJsonPath = Join-Path $bundleDir "latest.json"
$signature = (Get-Content -Raw -LiteralPath $setupSigPath).Trim()

$latest = [ordered]@{
    version = [string]$targetVersion
    notes = $notes
    pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $signature
            url = "$normalizedEndpoint/$($setupExe.Name)"
        }
    }
}

$latest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $latestJsonPath -Encoding UTF8

$releaseDir = Join-Path $uiDir ("release\windows\" + $targetVersion)
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

$releaseNotesOutputPath = Join-Path $releaseDir "release-notes.txt"
Set-Content -LiteralPath $releaseNotesOutputPath -Value $notes -Encoding UTF8

$releaseFiles = @(
    $setupExe.FullName,
    $setupSigPath,
    $latestJsonPath
)

foreach ($file in $releaseFiles) {
    Copy-Item -LiteralPath $file -Destination (Join-Path $releaseDir ([System.IO.Path]::GetFileName($file))) -Force
}

Write-Host ""
Write-Host "[SUCCESS] release build finished."
Write-Host "          version: $targetVersion"
Write-Host "          exe: $($setupExe.FullName)"
Write-Host "          sig: $setupSigPath"
Write-Host "          json: $latestJsonPath"
Write-Host "          release dir: $releaseDir"
Write-Host ""
Write-Host "[NEXT] Upload these files to:"
Write-Host "       $normalizedEndpoint"
Write-Host "[NEXT] latest.json URL should be:"
Write-Host "       $normalizedEndpoint/latest.json"
