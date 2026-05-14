<#
.SYNOPSIS
  AI FSM Desktop — Smart Launcher
  Detects source changes → auto-rebuilds → launches from forge-out directly.
  No Squirrel involved — the shortcut points straight to the electron-forge package output.
#>

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$markerFile  = Join-Path $projectRoot '.last-package-ts'
$srcDir      = Join-Path $projectRoot 'src'

function Resolve-PackagedExePath {
    $candidateRoots = [System.Collections.Generic.List[string]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    function Add-CandidateRoot([string]$candidate) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            return
        }

        $resolved = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $candidate.Trim()))
        if ($seen.Add($resolved)) {
            $candidateRoots.Add($resolved)
        }
    }

    Add-CandidateRoot $env:AI_FSM_FORGE_OUT_DIR
    Add-CandidateRoot 'forge-out'

    Get-ChildItem -Path $projectRoot -Directory -Filter 'forge-out*' -ErrorAction SilentlyContinue |
        ForEach-Object { Add-CandidateRoot $_.FullName }

    $candidates = foreach ($root in $candidateRoots) {
        $exePath = Join-Path $root 'AI FSM Desktop-win32-x64\AiFsmDesktop.exe'
        if (Test-Path $exePath) {
            Get-Item $exePath
        }
    }

    return $candidates |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}

$forgeExe = Resolve-PackagedExePath

# ── Get newest file timestamp in src/ ──────────────────────────
function Get-SrcNewestTime {
    Get-ChildItem -Path $srcDir -Recurse -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1 -ExpandProperty LastWriteTimeUtc
}

# ── Get last build marker timestamp ────────────────────────────
function Get-LastBuildTime {
    if (Test-Path $markerFile) {
        return (Get-Item $markerFile).LastWriteTimeUtc
    }
    return [DateTime]::MinValue
}

# ── Write build marker ─────────────────────────────────────────
function Set-BuildMarker {
    [DateTime]::UtcNow.ToString('o') | Out-File -FilePath $markerFile -Encoding utf8 -NoNewline
}

# ── Check if rebuild is needed ─────────────────────────────────
$srcTime   = Get-SrcNewestTime
$buildTime = Get-LastBuildTime
$needsBuild = $srcTime -gt $buildTime

# Also check if package.json changed (new deps)
$pkgJsonTime = (Get-Item (Join-Path $projectRoot 'package.json')).LastWriteTimeUtc
if ($pkgJsonTime -gt $buildTime) { $needsBuild = $true }

# Also rebuild if exe doesn't exist
if (-not (Test-Path $forgeExe)) { $needsBuild = $true }

# ── Rebuild if needed ──────────────────────────────────────────
if ($needsBuild) {
    Write-Host ''
    Write-Host '  ╔══════════════════════════════════════════════╗' -ForegroundColor Cyan
    Write-Host '  ║  AI FSM Desktop — Source changes detected    ║' -ForegroundColor Cyan
    Write-Host '  ║  Auto-rebuilding...                          ║' -ForegroundColor Cyan
    Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor Cyan
    Write-Host ''
    Write-Host "  Source newest : $srcTime" -ForegroundColor DarkGray
    Write-Host "  Last build   : $(if ($buildTime -eq [DateTime]::MinValue) { 'never' } else { $buildTime })" -ForegroundColor DarkGray
    Write-Host ''

    Push-Location $projectRoot
    try {
        # Step 1: Clean old webpack output
        Write-Host '  [1/4] Cleaning old build...' -ForegroundColor Yellow
        & npm run clean 2>&1 | Out-Null

        # Step 2: Patch node-pty
        Write-Host '  [2/4] Patching native deps...' -ForegroundColor Yellow
        & npm run "patch:node-pty" 2>&1 | Out-Null
        & npm run "stage:node-pty-runtime" 2>&1 | Out-Null

        # Step 3: electron-forge package (produces forge-out/AI FSM Desktop-win32-x64/)
        Write-Host '  [3/4] Packaging (webpack build + electron package)...' -ForegroundColor Yellow
        $packageOutput = & npx electron-forge package 2>&1
        $exitCode = $LASTEXITCODE

        # Show errors if any
        if ($exitCode -ne 0) {
            Write-Host ''
            $packageOutput | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
            throw "electron-forge package failed with exit code $exitCode"
        }

        # Step 4: Write marker
        Write-Host '  [4/4] Marking build timestamp...' -ForegroundColor Yellow
        Set-BuildMarker
        $forgeExe = Resolve-PackagedExePath

        Write-Host ''
        Write-Host '  ✓ Build complete!' -ForegroundColor Green
        Write-Host ''
    }
    catch {
        Write-Host ''
        Write-Host "  ✗ Build failed: $_" -ForegroundColor Red
        if (Test-Path $forgeExe) {
            Write-Host '  Launching last known good build...' -ForegroundColor Yellow
        } else {
            Write-Host '  No previous build available. Please run: npm run package' -ForegroundColor Red
            Read-Host '  Press Enter to close'
            exit 1
        }
    }
    finally {
        Pop-Location
    }
}

# ── Launch the app ─────────────────────────────────────────────
if (Test-Path $forgeExe) {
    Start-Process -FilePath $forgeExe
} else {
    Write-Host '  ✗ Executable not found. Please run: npm run package' -ForegroundColor Red
    Read-Host '  Press Enter to close'
}
