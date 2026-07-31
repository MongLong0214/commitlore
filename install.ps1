<#
    Installs commitlore from source on Windows, for any agent that is not Claude Code.

      irm https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.ps1 | iex
      & ([scriptblock]::Create((irm https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.ps1))) v0.4.1

    Claude Code users do not need this script. The repository is itself a plugin
    marketplace (ADR-0011), so two /plugin commands register the MCP server, the
    pre-edit context hook and the skills. That path is first in the README and
    this one is second.

    This is install.sh's twin, not a port of a different idea. The shell script
    defines the contract and this one implements the same one:

      - Node.js 22+ (ADR-0010) and Git are checked before anything is written.
      - A pinned tag is checked out into the user's local application data.
      - A thin shim runs "node <checkout>\dist\commitlore.mjs".
      - No compiled executable, no platform asset, no checksum of a downloaded
        tarball. ADR-0026 removed all of that from the product.
      - Nothing is elevated: no administrator prompt, no Program Files, no
        machine-level PATH.
      - The user's PATH is never modified. When the shim's directory is not on
        PATH the command to add it is printed, which is the whole of what this
        script does about it. Two active records on install.sh reject an
        installer that edits the user's environment behind their back, and a
        user-scope PATH write is the same act in Windows spelling.
      - Post-install verification reports; it never decides the exit code.

    Exit codes, identical to install.sh: 1 = missing or too-old prerequisite, or
    bad usage (nothing was written), 2 = the source could not be fetched, 4 = the
    install target is occupied by something this script did not put there.

    Windows support is not claimed by this file. It installs, and what it
    installs runs; whether the containment property #71 establishes holds on
    Windows is a separate question with its own ticket (T-1124).

    ASCII only, deliberately. A non-ASCII character in a string silently
    terminated /bin/sh in install.sh's own history, and a script that arrives
    down a pipe has no encoding declaration to fall back on.

    Windows PowerShell 5.1 and PowerShell 7+ both run this. Nothing here uses
    the ternary operator, null-coalescing, or any other 7-only syntax.
#>

param(
    [string] $Version = $env:COMMITLORE_VERSION
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'MongLong0214/commitlore'
$NodeMajorMin = 22
$WrapperMarker = ':: commitlore:wrapper:v1'

$SourceUrl = $env:COMMITLORE_INSTALL_SOURCE
if ([string]::IsNullOrEmpty($SourceUrl)) {
    $SourceUrl = "https://github.com/$Repo.git"
}

function Write-Log {
    param([string] $Message)
    Write-Host "commitlore-install: $Message"
}

function Stop-Install {
    param(
        [string] $Message,
        [int] $Code = 1
    )
    # Written to the error stream, read by a human. `throw` would print a
    # PowerShell stack trace over the message that matters.
    [Console]::Error.WriteLine("commitlore-install: error: $Message")
    exit $Code
}

# --- 1. prerequisites, before anything is written ---------------------------
#
# Both are hard requirements rather than conveniences: the shim runs the bundle
# with node, and the checkout is a git clone. A missing one is named, with what
# to do about it, and nothing is installed.

# `Select-Object -First 1`: Get-Command returns *every* match on PATH, and a
# Windows runner really does carry two node.exe. Without it $nodeBin becomes an
# array, the interpolated error message reads as two paths joined by a space, and
# the version check invokes something that is not a program. The first match is
# also the right one -- it is what typing `node` would run.
$nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $nodeCommand) {
    Stop-Install "Node.js $NodeMajorMin or newer is required and no ""node"" was found on PATH. Install Node.js $NodeMajorMin+ (https://nodejs.org), then run this again. Nothing was installed." 1
}
$nodeBin = $nodeCommand.Source

$nodeVersion = ''
try {
    $nodeVersion = (& $nodeBin --version 2>$null | Select-Object -First 1)
} catch {
    $nodeVersion = ''
}
if ($null -eq $nodeVersion) { $nodeVersion = '' }
$nodeVersion = $nodeVersion.Trim()
if ($nodeVersion -notmatch '^v[0-9]+') {
    Stop-Install """$nodeBin --version"" did not report a version (got: ""$nodeVersion""), so the Node.js major version cannot be checked. Nothing was installed." 1
}
$nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt $NodeMajorMin) {
    Stop-Install "Node.js $NodeMajorMin or newer is required; this machine has $nodeVersion. Upgrade Node.js, then run this again. Nothing was installed." 1
}

# Run it rather than only look for it: a git that cannot execute is as useless
# here as a missing one, and this is the check that catches both.
$gitRan = $false
try {
    & git --version > $null 2>&1
    $gitRan = ($LASTEXITCODE -eq 0)
} catch {
    $gitRan = $false
}
if (-not $gitRan) {
    Stop-Install "Git is required, and ""git --version"" did not run. Install Git (or repair the installation), then run this again. Nothing was installed." 1
}

# --- 2. resolve the version to install -------------------------------------
#
# A tag, never a branch. Passing one explicitly is the reviewable path; with
# none, the newest semver tag is resolved with `git ls-remote`, which needs no
# API token and no rate limit. The default must not resolve to a branch --
# installing a moving target is what pinning exists to prevent.

if (-not [string]::IsNullOrEmpty($Version)) {
    if ($Version -match '^v[0-9]') {
        # already a tag
    } elseif ($Version -match '^[0-9]') {
        $Version = "v$Version"
    } else {
        Stop-Install """$Version"" is not a version tag. Pass a tag such as v0.4.1, or pass nothing to install the newest one." 1
    }
} else {
    # Only vMAJOR.MINOR.PATCH is considered. A pre-release tag would otherwise
    # sort against its release and win on string length, which is backwards.
    # [version] compares the numbers as numbers, which is the whole reason
    # install.sh had to zero-pad: it has no such type and `sort -V` is not POSIX.
    $refs = ''
    try {
        $refs = (& git ls-remote --tags --refs $SourceUrl 2>$null) -join "`n"
    } catch {
        $refs = ''
    }
    $tags = @()
    foreach ($line in ($refs -split "`n")) {
        if ($line -match 'refs/tags/(v[0-9]+\.[0-9]+\.[0-9]+)$') {
            $tags += $Matches[1]
        }
    }
    if ($tags.Count -eq 0) {
        Stop-Install "no version tag could be resolved from $SourceUrl. Pass one explicitly, for example: & ([scriptblock]::Create((irm <url>/install.ps1))) v0.4.1" 2
    }
    $Version = ($tags | Sort-Object -Property { [version]($_.TrimStart('v')) } | Select-Object -Last 1)
}

Write-Log "installing $Version"

# --- 3. fetch the pinned checkout ------------------------------------------
#
# Into the user's local application data, keyed by tag, so an upgrade adds a
# checkout beside the old one instead of mutating it. Cloned to a temporary name
# and renamed, so a failed clone never leaves a half-checkout that looks
# installed.

$dataRoot = Join-Path $env:LOCALAPPDATA 'commitlore'
$checkout = Join-Path $dataRoot $Version

if (Test-Path -LiteralPath (Join-Path $checkout 'dist')) {
    Write-Log "reusing the existing checkout at $checkout"
} else {
    New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
    $checkoutTmp = Join-Path $dataRoot (".{0}.incoming.{1}" -f $Version, $PID)
    if (Test-Path -LiteralPath $checkoutTmp) {
        Remove-Item -LiteralPath $checkoutTmp -Recurse -Force
    }
    # Keep git's own reason. Swallowing it and printing a guess sends a user
    # looking in the wrong place whenever the cause is something else, which is
    # most of the time. git puts the useful line first and the generic advice
    # last, so the first fatal: line is what a reader needs.
    $cloneLog = ''
    try {
        $cloneLog = (& git clone --quiet --depth 1 --branch $Version $SourceUrl $checkoutTmp 2>&1 | Out-String)
    } catch {
        $cloneLog = $_.Exception.Message
    }
    if ($LASTEXITCODE -ne 0) {
        if (Test-Path -LiteralPath $checkoutTmp) {
            Remove-Item -LiteralPath $checkoutTmp -Recurse -Force -ErrorAction SilentlyContinue
        }
        $reason = ''
        foreach ($line in ($cloneLog -split "`r?`n")) {
            if ($line -match '^fatal:') { $reason = $line.Trim(); break }
        }
        if ([string]::IsNullOrEmpty($reason)) {
            $reason = ($cloneLog -replace '\s+', ' ').Trim()
        }
        if ([string]::IsNullOrEmpty($reason)) { $reason = 'nothing' }
        Stop-Install "could not fetch $Version from $SourceUrl. git said: $reason. Nothing was installed." 2
    }
    if (-not (Test-Path -LiteralPath (Join-Path $checkoutTmp 'dist\commitlore.mjs'))) {
        Remove-Item -LiteralPath $checkoutTmp -Recurse -Force -ErrorAction SilentlyContinue
        Stop-Install "$Version does not carry dist/commitlore.mjs, so there is nothing to run. Nothing was installed." 2
    }
    if (Test-Path -LiteralPath $checkout) {
        Remove-Item -LiteralPath $checkout -Recurse -Force
    }
    Move-Item -LiteralPath $checkoutTmp -Destination $checkout
    Write-Log "checked out $Version into $checkout"
}

# --- 4. install the shim ---------------------------------------------------
#
# A .cmd shim rather than an extensionless file: cmd.exe and PowerShell both
# find and run a .cmd from PATH, and an extensionless script is not executable
# on Windows at all. The git hook does not go through PATH -- `commitlore init`
# records the bundle and the interpreter in the repository's git config -- so the
# shim is for the terminal, which is where a user types the name.

$destDir = $env:COMMITLORE_INSTALL_DIR
if ([string]::IsNullOrEmpty($destDir)) {
    $destDir = Join-Path $dataRoot 'bin'
}
$dest = Join-Path $destDir 'commitlore.cmd'

# Refuse to clobber a file this script did not put there. A previous shim
# carries the marker; a previous install prints a bare semver. Anything else is
# somebody else's file and is left exactly where it is.
if (Test-Path -LiteralPath $dest) {
    $existing = ''
    try {
        $existing = (Get-Content -LiteralPath $dest -Raw -ErrorAction SilentlyContinue)
    } catch {
        $existing = ''
    }
    if ($null -eq $existing) { $existing = '' }
    if ($existing.Contains($WrapperMarker)) {
        Write-Log "upgrading the existing commitlore shim at $dest"
    } else {
        $existingVersion = ''
        try {
            $existingVersion = (& $dest --version 2>$null | Select-Object -First 1)
        } catch {
            $existingVersion = ''
        }
        if ($null -eq $existingVersion) { $existingVersion = '' }
        $existingVersion = $existingVersion.Trim()
        if ($existingVersion -match '^[0-9]+\.[0-9]+\.[0-9]+') {
            Write-Log "replacing a previous commitlore install at $dest ($existingVersion -> $Version)"
        } else {
            Stop-Install "$dest already exists and is not a commitlore shim (got: ""$existingVersion"") -- refusing to overwrite it. Remove it first, or set COMMITLORE_INSTALL_DIR to install elsewhere." 4
        }
    }
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$bundle = Join-Path $checkout 'dist\commitlore.mjs'
# CRLF, written explicitly. cmd.exe mis-parses a batch file with LF endings in
# ways that depend on the line -- a `set` can swallow the next line -- so the
# endings are part of the file format here rather than a preference.
$shimLines = @(
    '@echo off',
    $WrapperMarker,
    ':: Installed by install.ps1. Edits are lost on reinstall.',
    'setlocal',
    ('set "COMMITLORE_NODE=' + $nodeBin + '"'),
    'if not exist "%COMMITLORE_NODE%" set "COMMITLORE_NODE=node"',
    ('"%COMMITLORE_NODE%" "' + $bundle + '" %*'),
    'exit /b %ERRORLEVEL%'
)
$shimText = ($shimLines -join "`r`n") + "`r`n"

# Write beside the destination and rename. An in-place overwrite of a file that
# may be executing is the defect that forced a same-day patch release in the
# shell installer's history; a move is the closest thing Windows offers to the
# atomic rename that fixed it.
$destTmp = "$dest.commitlore-install.$PID"
[System.IO.File]::WriteAllText($destTmp, $shimText, (New-Object System.Text.UTF8Encoding($false)))
Move-Item -LiteralPath $destTmp -Destination $dest -Force

Write-Log "installed to $dest"

# The install is complete by this point. Verification reports; it does not
# decide. A single failure is retried once before it is reported, and a reported
# failure still exits 0 -- an install that succeeded must not be failed by a
# check that could not run.
$installedVersion = ''
foreach ($attempt in 1, 2) {
    try {
        $installedVersion = (& $dest --version 2>$null | Select-Object -First 1)
    } catch {
        $installedVersion = ''
    }
    if ($null -eq $installedVersion) { $installedVersion = '' }
    $installedVersion = $installedVersion.Trim()
    if (-not [string]::IsNullOrEmpty($installedVersion)) { break }
    if ($attempt -eq 1) { Start-Sleep -Seconds 1 }
}
if (-not [string]::IsNullOrEmpty($installedVersion)) {
    Write-Host $installedVersion
} else {
    Write-Log "installed, but unverified: ""$dest --version"" did not run in this shell."
    Write-Log "the shim is in place; verify it yourself with: $dest --version"
}

# Printed, never written. Rewriting a user's environment from a piped installer
# is ruled out on install.sh, and this is the same act in Windows spelling.
$onPath = $false
foreach ($entry in ($env:PATH -split ';')) {
    if ($entry.TrimEnd('\') -eq $destDir.TrimEnd('\')) { $onPath = $true; break }
}
if (-not $onPath) {
    Write-Log "note: $destDir is not on PATH."
    Write-Log "add it for your account with:"
    Write-Log "  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';$destDir', 'User')"
}

# --- 5. detect and wire coding agents --------------------------------------
#
# Everything below is additive and best-effort: it never touches the exit codes
# above (1-4 stay reserved for phase 1 -- the tool is already installed and
# working by the time this runs), and every agent it wires is detect-then-act, in
# the same order as install.sh:
#
#   1. Is the agent actually on this machine? An agent that is not found is left
#      alone completely -- no config is created "for later".
#   2. Does its config already mention commitlore? If so, this is a re-run:
#      report it and change nothing.
#   3. Otherwise create the config fresh, or merge into the existing one.
#
# PowerShell parses and writes JSON natively, so unlike install.sh there is no
# jq to be missing -- the "cannot merge without jq" branch has no counterpart
# here. An unparseable config is still left untouched and reported.

Write-Log ''
Write-Log 'Detecting coding agents...'

$wired = New-Object System.Collections.ArrayList
$skipped = New-Object System.Collections.ArrayList
$notFound = New-Object System.Collections.ArrayList

function Add-Wired { param([string] $Message) $wired.Add($Message) | Out-Null }
function Add-Skipped { param([string] $Agent, [string] $Reason) $skipped.Add("$($Agent): $Reason") | Out-Null }

function Test-AgentPresent {
    param([string] $Command, [string[]] $Paths)
    if (-not [string]::IsNullOrEmpty($Command)) {
        if ($null -ne (Get-Command $Command -CommandType Application -ErrorAction SilentlyContinue)) { return $true }
    }
    foreach ($path in $Paths) {
        if (Test-Path -LiteralPath $path) { return $true }
    }
    return $false
}

# `mcpServers: { name: { command, args } }` -- Gemini CLI, Cursor and Windsurf
# all document this exact shape.
function Wire-McpServersJson {
    param([string] $Agent, [string] $ConfigPath)

    $configDir = Split-Path -Parent $ConfigPath
    try {
        New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    } catch {
        Add-Skipped $Agent "could not create $configDir"
        return
    }

    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        $fresh = [ordered]@{
            mcpServers = [ordered]@{
                commitlore = [ordered]@{ command = $dest; args = @('mcp') }
            }
        }
        try {
            ($fresh | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
            Add-Wired "$($Agent): created $ConfigPath"
        } catch {
            Add-Skipped $Agent "could not write $ConfigPath"
        }
        return
    }

    $body = ''
    try {
        $body = (Get-Content -LiteralPath $ConfigPath -Raw)
    } catch {
        Add-Skipped $Agent "could not read $ConfigPath"
        return
    }
    if ($body -match '"commitlore"') {
        Add-Skipped $Agent "$ConfigPath already mentions commitlore -- left unchanged"
        return
    }
    try {
        $parsed = $body | ConvertFrom-Json
    } catch {
        Add-Skipped $Agent "$ConfigPath exists but is not parseable JSON -- left untouched. Add manually: {""mcpServers"":{""commitlore"":{""command"":""$dest"",""args"":[""mcp""]}}}"
        return
    }
    try {
        if ($null -eq $parsed.PSObject.Properties['mcpServers']) {
            $parsed | Add-Member -MemberType NoteProperty -Name 'mcpServers' -Value (New-Object PSObject)
        }
        $server = [ordered]@{ command = $dest; args = @('mcp') }
        $parsed.mcpServers | Add-Member -MemberType NoteProperty -Name 'commitlore' -Value $server -Force
        ($parsed | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
        Add-Wired "$($Agent): added the commitlore MCP server into the existing $ConfigPath"
    } catch {
        Add-Skipped $Agent "$ConfigPath could not be updated -- left as it was. Add manually: {""mcpServers"":{""commitlore"":{""command"":""$dest"",""args"":[""mcp""]}}}"
    }
}

$home_ = $env:USERPROFILE

# Claude Code -- https://code.claude.com/docs/en/discover-plugins#install-plugins
if (Test-AgentPresent 'claude' @()) {
    $plugins = ''
    try { $plugins = (& claude plugin list 2>$null | Out-String) } catch { $plugins = '' }
    if ($plugins -match 'commitlore') {
        Add-Skipped 'claude-code' 'the commitlore plugin is already installed -- left unchanged'
    } else {
        $added = $false
        try {
            & claude plugin marketplace add $Repo > $null 2>&1
            $added = ($LASTEXITCODE -eq 0)
        } catch { $added = $false }
        if (-not $added) {
            Add-Skipped 'claude-code' "could not add the $Repo marketplace -- run manually: claude plugin marketplace add $Repo"
        } else {
            $ok = $false
            try {
                & claude plugin install commitlore@commitlore --scope user > $null 2>&1
                $ok = ($LASTEXITCODE -eq 0)
            } catch { $ok = $false }
            if ($ok) {
                Add-Wired 'claude-code: installed the commitlore plugin (marketplace: commitlore, scope: user)'
            } else {
                Add-Skipped 'claude-code' 'marketplace added, but plugin install failed -- run manually: claude plugin install commitlore@commitlore'
            }
        }
    }
} else {
    $notFound.Add('Claude Code') | Out-Null
}

# Codex CLI -- TOML, one [mcp_servers.<name>] table per server.
# https://developers.openai.com/codex/mcp
if (Test-AgentPresent 'codex' @((Join-Path $home_ '.codex'))) {
    $codexConfig = Join-Path $home_ '.codex\config.toml'
    $existingToml = ''
    if (Test-Path -LiteralPath $codexConfig) {
        try { $existingToml = (Get-Content -LiteralPath $codexConfig -Raw) } catch { $existingToml = '' }
    }
    if ($existingToml -match '(?m)^\[mcp_servers\.commitlore\]') {
        Add-Skipped 'codex' "$codexConfig already has a [mcp_servers.commitlore] block -- left unchanged"
    } else {
        try {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $codexConfig) | Out-Null
            # A backslash is TOML's escape character inside a basic string, so a
            # Windows path has to be doubled or the parser reads \d as an escape.
            $tomlPath = $dest -replace '\\', '\\'
            $block = "`r`n[mcp_servers.commitlore]`r`ncommand = ""$tomlPath""`r`nargs = [""mcp""]`r`n"
            if (Test-Path -LiteralPath $codexConfig) {
                [System.IO.File]::AppendAllText($codexConfig, $block)
                Add-Wired "codex: appended a [mcp_servers.commitlore] block to the existing $codexConfig"
            } else {
                [System.IO.File]::WriteAllText($codexConfig, $block.TrimStart("`r", "`n"))
                Add-Wired "codex: created $codexConfig"
            }
        } catch {
            Add-Skipped 'codex' "could not write $codexConfig"
        }
    }
} else {
    $notFound.Add('Codex') | Out-Null
}

# Gemini CLI -- https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
if (Test-AgentPresent 'gemini' @((Join-Path $home_ '.gemini'))) {
    Wire-McpServersJson 'gemini-cli' (Join-Path $home_ '.gemini\settings.json')
} else {
    $notFound.Add('Gemini CLI') | Out-Null
}

# Cursor -- global config.
if (Test-AgentPresent 'cursor' @((Join-Path $home_ '.cursor'), (Join-Path $env:LOCALAPPDATA 'Programs\cursor'))) {
    Wire-McpServersJson 'cursor' (Join-Path $home_ '.cursor\mcp.json')
} else {
    $notFound.Add('Cursor') | Out-Null
}

# Windsurf -- https://docs.windsurf.com/windsurf/cascade/mcp
if (Test-AgentPresent 'windsurf' @((Join-Path $home_ '.codeium\windsurf'))) {
    Wire-McpServersJson 'windsurf' (Join-Path $home_ '.codeium\windsurf\mcp_config.json')
} else {
    $notFound.Add('Windsurf') | Out-Null
}

# opencode -- different shape from the rest: the key is `mcp`, not `mcpServers`,
# and `command` is an argv array. https://opencode.ai/docs/mcp-servers/
if (Test-AgentPresent 'opencode' @((Join-Path $home_ '.config\opencode'))) {
    $openConfig = Join-Path $home_ '.config\opencode\opencode.json'
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $openConfig) | Out-Null
        if (-not (Test-Path -LiteralPath $openConfig)) {
            $fresh = [ordered]@{
                '$schema' = 'https://opencode.ai/config.json'
                mcp = [ordered]@{
                    commitlore = [ordered]@{ type = 'local'; command = @($dest, 'mcp'); enabled = $true }
                }
            }
            ($fresh | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $openConfig -Encoding UTF8
            Add-Wired "opencode: created $openConfig"
        } else {
            $body = (Get-Content -LiteralPath $openConfig -Raw)
            if ($body -match '"commitlore"') {
                Add-Skipped 'opencode' "$openConfig already mentions commitlore -- left unchanged"
            } else {
                $parsed = $body | ConvertFrom-Json
                if ($null -eq $parsed.PSObject.Properties['mcp']) {
                    $parsed | Add-Member -MemberType NoteProperty -Name 'mcp' -Value (New-Object PSObject)
                }
                $server = [ordered]@{ type = 'local'; command = @($dest, 'mcp'); enabled = $true }
                $parsed.mcp | Add-Member -MemberType NoteProperty -Name 'commitlore' -Value $server -Force
                ($parsed | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $openConfig -Encoding UTF8
                Add-Wired "opencode: added the commitlore MCP server into the existing $openConfig"
            }
        }
    } catch {
        Add-Skipped 'opencode' "$openConfig could not be written or parsed -- left as it was. Add manually under ""mcp"": {""commitlore"":{""type"":""local"",""command"":[""$dest"",""mcp""],""enabled"":true}}"
    }
} else {
    $notFound.Add('opencode') | Out-Null
}

Write-Log ''
Write-Log '== commitlore install summary =='
if ($wired.Count -gt 0) {
    Write-Log ''
    Write-Log 'Wired:'
    foreach ($line in $wired) { Write-Log "  - $line" }
}
if ($skipped.Count -gt 0) {
    Write-Log ''
    Write-Log 'Skipped:'
    foreach ($line in $skipped) { Write-Log "  - $line" }
}
if ($notFound.Count -gt 0) {
    Write-Log ''
    Write-Log ("Not detected on this machine: " + ($notFound -join ', '))
}
Write-Log ''
Write-Log "Next: cd into a repository and run 'commitlore init' to install its git hook and index."
Write-Log '(install.ps1 never runs init for you -- it only installs the tool and wires agents, never touches a repository''s .git.)'
exit 0
