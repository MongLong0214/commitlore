<#
    Installs commitlore from source on Windows, for any agent that is not Claude Code.

      irm https://raw.githubusercontent.com/MongLong0214/commitlore/v0.8.0/install.ps1 | iex
      & ([scriptblock]::Create((irm https://raw.githubusercontent.com/MongLong0214/commitlore/v0.8.0/install.ps1))) v0.8.0

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
      - Runtime verification completes before the shim is activated. An incoming
        checkout that cannot start is never reported as installed.

    Exit codes, identical to install.sh: 1 = missing or too-old prerequisite, or
    bad usage (nothing was written), 2 = the source could not be fetched, 3 =
    runtime verification ran and found an unusable checkout, 4 = the install
    target is occupied by something this script did not put there, 5 = runtime
    verification could not run on this machine.

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

# The full runtime inventory is data in the checkout it describes. A tag can
# add an asset and its manifest together, so an installer fetched from a newer
# ref never judges that tag against a list it could not contain.
$RuntimeManifestPath = 'installer/runtime-manifest.txt'
$RuntimeManifestFormat = 'commitlore-runtime-manifest-v1'

# Check one asset against both the working tree and the pinned tree. The
# manifest itself goes through this check before its contents are read, so
# emptying or truncating it locally cannot reduce what the installer verifies.
function Test-TrackedRuntimeFile {
    param(
        [string] $Root,
        [string] $RelativePath,
        [string] $Label
    )
    $path = Join-Path $Root ($RelativePath.Replace('/', '\'))
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return (New-VerificationResult 'failed' $path "the $Label requires a regular file there")
    }
    try {
        $treeEntry = ((& git -C $Root ls-tree --name-only HEAD -- $RelativePath 2>$null | Out-String).Trim())
        $gitCode = $LASTEXITCODE
    } catch {
        return (New-VerificationResult 'unavailable' $path "Git could not read the pinned checkout tree: $($_.Exception.Message)")
    }
    if ($gitCode -ne 0) {
        return (New-VerificationResult 'unavailable' $path "Git could not read the pinned checkout tree (exit $gitCode)")
    }
    if ($treeEntry -cne $RelativePath) {
        return (New-VerificationResult 'failed' $path "the pinned checkout does not record this $Label entry")
    }
    try {
        $previousGitPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & git -C $Root diff --quiet HEAD -- $RelativePath > $null 2>$null
        $gitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousGitPreference
    } catch {
        return (New-VerificationResult 'unavailable' $path "Git could not compare the pinned checkout ${Label}: $($_.Exception.Message)")
    }
    if ($gitCode -eq 0) {
        return (New-VerificationResult 'passed' $path '')
    }
    if ($gitCode -eq 1) {
        return (New-VerificationResult 'failed' $path "the $Label entry differs from the pinned checkout")
    }
    return (New-VerificationResult 'unavailable' $path "Git could not compare the pinned checkout $Label (exit $gitCode)")
}

# Releases before installer/runtime-manifest.txt cannot provide a full runtime
# inventory. They are still checked for the bundle the installer can name on
# its own, then receive the cross-version --version smoke test.
function Test-LegacyRuntime {
    param([string] $Root)
    $legacy = Test-TrackedRuntimeFile $Root 'dist/commitlore.mjs' 'legacy runtime check'
    if ($legacy.State -ne 'passed') { return $legacy }
    return (New-VerificationResult 'passed' $Root '' '' 'legacy')
}

function Test-RuntimeManifest {
    param([string] $Root)
    $manifestPath = Join-Path $Root ($RuntimeManifestPath.Replace('/', '\'))

    # `ls-tree` distinguishes an old tag (no path in the pinned tree) from a
    # damaged checkout (the pinned tree has it but the file is missing locally).
    try {
        $manifestTreeEntry = ((& git -C $Root ls-tree --name-only HEAD -- $RuntimeManifestPath 2>$null | Out-String).Trim())
        $gitCode = $LASTEXITCODE
    } catch {
        return (New-VerificationResult 'unavailable' $manifestPath "Git could not read the pinned checkout tree: $($_.Exception.Message)")
    }
    if ($gitCode -ne 0) {
        return (New-VerificationResult 'unavailable' $manifestPath "Git could not read the pinned checkout tree (exit $gitCode)")
    }
    if ([string]::IsNullOrEmpty($manifestTreeEntry)) {
        return (Test-LegacyRuntime $Root)
    }
    if ($manifestTreeEntry -cne $RuntimeManifestPath) {
        return (New-VerificationResult 'failed' $manifestPath 'the pinned checkout records an unexpected runtime manifest path')
    }

    $manifest = Test-TrackedRuntimeFile $Root $RuntimeManifestPath 'runtime manifest'
    if ($manifest.State -ne 'passed') { return $manifest }
    try {
        $manifestLines = @(Get-Content -LiteralPath $manifestPath -ErrorAction Stop)
    } catch {
        return (New-VerificationResult 'unavailable' $manifestPath "the runtime manifest could not be read: $($_.Exception.Message)")
    }
    if ($manifestLines.Count -eq 0) {
        return (New-VerificationResult 'failed' $manifestPath 'the runtime manifest is empty')
    }
    if ($manifestLines[0] -cne $RuntimeManifestFormat) {
        return (New-VerificationResult 'failed' $manifestPath "the runtime manifest format is not $RuntimeManifestFormat")
    }
    if ($manifestLines.Count -eq 1) {
        return (New-VerificationResult 'failed' $manifestPath 'the runtime manifest must name at least one runtime asset')
    }

    $seen = @{}
    for ($index = 1; $index -lt $manifestLines.Count; $index++) {
        $relativePath = $manifestLines[$index]
        if ([string]::IsNullOrEmpty($relativePath)) {
            return (New-VerificationResult 'failed' $manifestPath 'the runtime manifest contains an empty asset entry')
        }
        # Each entry is a canonical repository-relative file path. In particular,
        # no manifest may escape its checkout or use a second spelling of an asset.
        if ($relativePath -notmatch '^[A-Za-z0-9._-][A-Za-z0-9._/-]*$' -or $relativePath -match '(^/|/$|//|(^|/)\.\.?(/|$))') {
            return (New-VerificationResult 'failed' $manifestPath "the runtime manifest contains a non-canonical asset path: $relativePath")
        }
        if ($seen.ContainsKey($relativePath)) {
            return (New-VerificationResult 'failed' $manifestPath "the runtime manifest repeats an asset path: $relativePath")
        }
        $seen[$relativePath] = $true
        $asset = Test-TrackedRuntimeFile $Root $relativePath 'runtime manifest'
        if ($asset.State -ne 'passed') { return $asset }
    }
    return (New-VerificationResult 'passed' $Root '' '' 'manifest')
}

function New-VerificationResult {
    param(
        [string] $State,
        [string] $Path,
        [string] $Detail,
        [string] $Version = '',
        [string] $Mode = ''
    )
    return [pscustomobject]@{
        State = $State
        Path = $Path
        Detail = $Detail
        Version = $Version
        Mode = $Mode
    }
}

# A directory named after a release is not itself evidence that it contains
# that release. An interrupted or hand-copied upgrade can leave a clean older
# checkout at the newer path, so bind HEAD to the requested tag before reuse or
# activation.
function Test-RequestedTag {
    param(
        [string] $Root,
        [string] $Tag
    )
    $tagRef = "refs/tags/$Tag"

    try {
        $previousTagPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & git -C $Root show-ref --verify --quiet $tagRef > $null 2>$null
        $tagCode = $LASTEXITCODE
        $ErrorActionPreference = $previousTagPreference
    } catch {
        $ErrorActionPreference = $previousTagPreference
        return (New-VerificationResult 'unavailable' $Root "Git could not read requested tag $Tag ($($_.Exception.Message))")
    }
    if ($tagCode -eq 1) {
        return (New-VerificationResult 'failed' $Root "the checkout does not contain requested tag $Tag")
    }
    if ($tagCode -ne 0) {
        return (New-VerificationResult 'unavailable' $Root "Git could not read requested tag $Tag (exit $tagCode)")
    }

    try {
        $previousTagPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $requestedHead = ((& git -C $Root rev-parse --verify "$tagRef^{commit}" 2>$null | Out-String).Trim())
        $requestedCode = $LASTEXITCODE
        $ErrorActionPreference = $previousTagPreference
    } catch {
        $ErrorActionPreference = $previousTagPreference
        return (New-VerificationResult 'unavailable' $Root "Git could not resolve requested tag $Tag ($($_.Exception.Message))")
    }
    if ($requestedCode -ne 0) {
        return (New-VerificationResult 'unavailable' $Root "Git could not resolve requested tag $Tag to a commit (exit $requestedCode)")
    }

    try {
        $previousTagPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $checkoutHead = ((& git -C $Root rev-parse --verify HEAD 2>$null | Out-String).Trim())
        $headCode = $LASTEXITCODE
        $ErrorActionPreference = $previousTagPreference
    } catch {
        $ErrorActionPreference = $previousTagPreference
        return (New-VerificationResult 'unavailable' $Root "Git could not resolve checkout HEAD ($($_.Exception.Message))")
    }
    if ($headCode -ne 0) {
        return (New-VerificationResult 'unavailable' $Root "Git could not resolve checkout HEAD (exit $headCode)")
    }
    if ($checkoutHead -cne $requestedHead) {
        return (New-VerificationResult 'failed' $Root "checkout HEAD $checkoutHead does not match requested tag $Tag ($requestedHead)")
    }
    return (New-VerificationResult 'passed' $Root '')
}

# The installer may have arrived through Invoke-Expression, so it cannot safely
# reconstruct the command that invoked it. It can name the one deliberate repair
# that returns this transaction to a state a rerun can install into. The quoted
# command is valid in both Windows PowerShell 5.1 and PowerShell 7+.
function Stop-UnusableCheckout {
    param(
        [object] $Result,
        [string] $Checkout,
        [string] $Destination
    )
    [Console]::Error.WriteLine(('commitlore-install: error: runtime verification ran and found an unusable path: "{0}" ({1}). The existing shim at {2} was left unchanged.' -f $Result.Path, $Result.Detail, $Destination))
    if (Test-Path -LiteralPath $Checkout) {
        $quotedCheckout = $Checkout.Replace("'", "''")
        [Console]::Error.WriteLine('commitlore-install: error: To repair this checkout deliberately, remove only it, then rerun the same install command:')
        [Console]::Error.WriteLine("  Remove-Item -LiteralPath '$quotedCheckout' -Recurse -Force")
    }
    exit 3
}

# Smoke-test the checkout directly, while it is still only an incoming tree.
# doctor --json can legitimately exit 1 for a repository that needs setup; its
# JSON report proves the command ran. Exit 2 is the documented could-not-run
# result and is distinguished from a runtime failure below.
function Invoke-IncomingSmoke {
    param(
        [string] $Root,
        [string] $NodePath,
        [string] $ExpectedVersion
    )

    $entry = Join-Path $Root 'dist\commitlore.mjs'
    $smokeDir = Join-Path ([System.IO.Path]::GetTempPath()) ("commitlore-smoke-{0}" -f $PID)
    try {
        New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null
    } catch {
        return (New-VerificationResult 'unavailable' $entry "could not create smoke-test directory: $($_.Exception.Message)")
    }

    try {
        try {
            $previousSmokePreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $version = ((& $NodePath $entry --version 2>$null | Out-String).Trim())
            $versionCode = $LASTEXITCODE
            $ErrorActionPreference = $previousSmokePreference
        } catch {
            return (New-VerificationResult 'unavailable' $entry "--version could not start: $($_.Exception.Message)")
        }
        if ($versionCode -ne 0) {
            return (New-VerificationResult 'failed' $entry "--version ran and exited $versionCode")
        }
        if ([string]::IsNullOrEmpty($version)) {
            return (New-VerificationResult 'failed' $entry '--version exited 0 without reporting a version')
        }
        if ($version -cne $ExpectedVersion) {
            return (New-VerificationResult 'failed' $entry "--version reported ""$version"", want requested version ""$ExpectedVersion""")
        }

        $validMessage = Join-Path $smokeDir 'valid-message'
        $invalidMessage = Join-Path $smokeDir 'invalid-message'
        [System.IO.File]::WriteAllText($validMessage, "installer smoke test`n`nBlast: local`n", (New-Object System.Text.UTF8Encoding($false)))
        [System.IO.File]::WriteAllText($invalidMessage, "installer smoke test`n`nBlast: invalid`n", (New-Object System.Text.UTF8Encoding($false)))

        try {
            $previousSmokePreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            & $NodePath $entry validate --message-file $validMessage > $null 2>$null
            $validCode = $LASTEXITCODE
            $ErrorActionPreference = $previousSmokePreference
        } catch {
            return (New-VerificationResult 'unavailable' $entry "validate could not start: $($_.Exception.Message)")
        }
        if ($validCode -ne 0) {
            return (New-VerificationResult 'failed' $entry "validate of a valid record ran and exited $validCode")
        }

        try {
            $previousSmokePreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            & $NodePath $entry validate --message-file $invalidMessage > $null 2>$null
            $invalidCode = $LASTEXITCODE
            $ErrorActionPreference = $previousSmokePreference
        } catch {
            return (New-VerificationResult 'unavailable' $entry "validate could not start: $($_.Exception.Message)")
        }
        if ($invalidCode -ne 1) {
            return (New-VerificationResult 'failed' $entry "validate of an invalid record exited $invalidCode, want 1")
        }

        $doctorOutput = ''
        $doctorLocationPushed = $false
        try {
            Push-Location -LiteralPath $Root
            $doctorLocationPushed = $true
            $previousSmokePreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $doctorOutput = (& $NodePath $entry doctor --json 2>$null | Out-String)
            $doctorCode = $LASTEXITCODE
            $ErrorActionPreference = $previousSmokePreference
        } catch {
            return (New-VerificationResult 'unavailable' $entry "doctor --json could not start: $($_.Exception.Message)")
        } finally {
            if ($doctorLocationPushed) { Pop-Location }
        }
        if ($doctorCode -ne 0 -and $doctorCode -ne 1) {
            if ($doctorCode -eq 2 -or $doctorCode -eq 126 -or $doctorCode -eq 127) {
                return (New-VerificationResult 'unavailable' $entry "doctor --json could not run (exit $doctorCode)")
            }
            return (New-VerificationResult 'failed' $entry "doctor --json ran and exited $doctorCode")
        }
        if ($doctorOutput -notmatch '"schema"\s*:\s*"commitlore_doctor\.v2"') {
            return (New-VerificationResult 'failed' $entry 'doctor --json did not emit a CommitLore doctor report')
        }

        return (New-VerificationResult 'passed' $entry '' $version)
    } finally {
        if (Test-Path -LiteralPath $smokeDir) {
            Remove-Item -LiteralPath $smokeDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# A pre-manifest release also predates the current smoke-test contract. It may
# not emit today's doctor schema (or expose every later command), so only prove
# that the bundle the installer can name starts and reports its version. Tagged
# releases that carry the manifest always take Invoke-IncomingSmoke above.
function Invoke-LegacySmoke {
    param(
        [string] $Root,
        [string] $NodePath,
        [string] $ExpectedVersion
    )
    $entry = Join-Path $Root 'dist\commitlore.mjs'
    try {
        $previousSmokePreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $version = ((& $NodePath $entry --version 2>$null | Out-String).Trim())
        $versionCode = $LASTEXITCODE
        $ErrorActionPreference = $previousSmokePreference
    } catch {
        return (New-VerificationResult 'unavailable' $entry "--version could not start: $($_.Exception.Message)")
    }
    if ($versionCode -ne 0) {
        if ($versionCode -eq 126 -or $versionCode -eq 127) {
            return (New-VerificationResult 'unavailable' $entry "--version could not start (exit $versionCode)")
        }
        return (New-VerificationResult 'failed' $entry "--version ran and exited $versionCode")
    }
    if ([string]::IsNullOrEmpty($version)) {
        return (New-VerificationResult 'failed' $entry '--version exited 0 without reporting a version')
    }
    if ($version -cne $ExpectedVersion) {
        return (New-VerificationResult 'failed' $entry "--version reported ""$version"", want requested version ""$ExpectedVersion""")
    }
    return (New-VerificationResult 'passed' $entry '' $version)
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
    $previousGitPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & git --version > $null 2>$null
    $gitRan = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $previousGitPreference
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
        Stop-Install """$Version"" is not a version tag. Pass a tag such as v1.2.3, or pass nothing to install the newest one." 1
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
        Stop-Install "no version tag could be resolved from $SourceUrl. Pass one explicitly, for example: & ([scriptblock]::Create((irm <url>/install.ps1))) v1.2.3" 2
    }
    $Version = ($tags | Sort-Object -Property { [version]($_.TrimStart('v')) } | Select-Object -Last 1)
}

Write-Log "installing $Version"

# --- 3. check the activation target before materializing anything -----------
#
# A foreign shim is rejected before a checkout is fetched. This preserves both
# the foreign file and any prior working installation if the transaction cannot
# reach its activation point.

$dataRoot = Join-Path $env:LOCALAPPDATA 'commitlore'
$destDir = $env:COMMITLORE_INSTALL_DIR
if ([string]::IsNullOrEmpty($destDir)) {
    $destDir = Join-Path $dataRoot 'bin'
}
$dest = Join-Path $destDir 'commitlore.cmd'

# Refuse to clobber a file this script did not put there. A previous shim
# carries the marker. An older install predating the marker is recognised by a
# bare semver *and* the managed checkout that install would have left behind --
# printing a version was the whole test, so any unrelated executable answering
# `--version` with something like `1.2.3` was silently destroyed. Anything else
# is somebody else's file and is left exactly where it is.
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
        $existingCheckout = ''
        if ($existingVersion -match '^[0-9]+\.[0-9]+\.[0-9]+') {
            foreach ($candidate in @((Join-Path $dataRoot ("v" + $existingVersion)), (Join-Path $dataRoot $existingVersion))) {
                if (Test-Path -LiteralPath $candidate -PathType Container) { $existingCheckout = $candidate; break }
            }
        }
        if ($existingVersion -match '^[0-9]+\.[0-9]+\.[0-9]+' -and $existingCheckout -ne '') {
            Write-Log "replacing a previous commitlore install at $dest ($existingVersion -> $Version)"
        } elseif ($existingVersion -match '^[0-9]+\.[0-9]+\.[0-9]+') {
            Stop-Install "$dest already exists, reports version ""$existingVersion"", and has no commitlore checkout under $dataRoot to match it -- refusing to overwrite a file this installer cannot show it wrote. Remove it first, or set COMMITLORE_INSTALL_DIR to install elsewhere." 4
        } else {
            Stop-Install "$dest already exists and is not a commitlore shim (got: ""$existingVersion"") -- refusing to overwrite it. Remove it first, or set COMMITLORE_INSTALL_DIR to install elsewhere." 4
        }
    }
}

# --- 4. materialize and verify the pinned checkout -------------------------
#
# Into the user's local application data, keyed by tag, so an upgrade adds a
# checkout beside the old one instead of mutating it. A source checkout is
# always cloned into an incoming directory, then fully checked before it
# receives its stable name or the shim can point at it.

$checkout = Join-Path $dataRoot $Version
$checkoutTmp = ''
$candidate = ''
$manifest = $null

if (Test-Path -LiteralPath $checkout) {
    if (-not (Test-Path -LiteralPath $checkout -PathType Container)) {
        $manifest = New-VerificationResult 'failed' $checkout 'the existing checkout path is not a directory'
    } else {
        $manifest = Test-RuntimeManifest $checkout
    }
    if ($manifest.State -eq 'passed') {
        $tagBinding = Test-RequestedTag $checkout $Version
        if ($tagBinding.State -eq 'passed') {
            $candidate = $checkout
            if ($manifest.Mode -eq 'legacy') {
                Write-Log "reusing the existing checkout at $checkout (legacy runtime check and --version smoke test; this release predates $RuntimeManifestPath)"
            } else {
                Write-Log "reusing the existing checkout at $checkout (runtime manifest and requested tag verified)"
            }
        } else {
            $manifest = $tagBinding
        }
    }
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
    #
    # git's stderr goes to a file, exactly as install.sh does it, and success is
    # decided by the exit code alone. Merging stderr into the output stream with
    # 2>&1 is what a first draft did, and Windows PowerShell 5.1 promotes a native
    # command's stderr to a terminating error under $ErrorActionPreference =
    # 'Stop' -- so git's harmless "--depth is ignored in local clones" warning
    # aborted a clone that had otherwise succeeded. A warning is not a failure, and
    # only the exit code says which one this is.
    $cloneLogPath = Join-Path ([System.IO.Path]::GetTempPath()) ("commitlore-clone-{0}.log" -f $PID)
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & git clone --quiet --depth 1 --branch $Version $SourceUrl $checkoutTmp 2> $cloneLogPath
    $cloneCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    $cloneLog = ''
    if (Test-Path -LiteralPath $cloneLogPath) {
        $cloneLog = (Get-Content -LiteralPath $cloneLogPath -Raw -ErrorAction SilentlyContinue)
        if ($null -eq $cloneLog) { $cloneLog = '' }
        Remove-Item -LiteralPath $cloneLogPath -Force -ErrorAction SilentlyContinue
    }
    if ($cloneCode -ne 0) {
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
    $manifest = Test-RuntimeManifest $checkoutTmp
    if ($manifest.State -eq 'passed') {
        $tagBinding = Test-RequestedTag $checkoutTmp $Version
        if ($tagBinding.State -eq 'passed') {
            $candidate = $checkoutTmp
            if ($manifest.Mode -eq 'legacy') {
                Write-Log "$Version predates $RuntimeManifestPath; using the installer's legacy runtime check and --version smoke test"
            }
        } else {
            $manifest = $tagBinding
        }
    }
}

if ([string]::IsNullOrEmpty($candidate)) {
    if (-not [string]::IsNullOrEmpty($checkoutTmp) -and (Test-Path -LiteralPath $checkoutTmp)) {
        Remove-Item -LiteralPath $checkoutTmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($manifest.State -eq 'unavailable') {
        Stop-Install "runtime verification could not run for ""$($manifest.Path)"": $($manifest.Detail). The existing shim at $dest was left unchanged." 5
    }
    Stop-UnusableCheckout $manifest $checkout $dest
}

if ($manifest.Mode -eq 'legacy') {
    $smoke = Invoke-LegacySmoke $candidate $nodeBin ($Version.TrimStart('v'))
} else {
    $smoke = Invoke-IncomingSmoke $candidate $nodeBin ($Version.TrimStart('v'))
}
if ($smoke.State -ne 'passed') {
    if (-not [string]::IsNullOrEmpty($checkoutTmp) -and (Test-Path -LiteralPath $checkoutTmp)) {
        Remove-Item -LiteralPath $checkoutTmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($smoke.State -eq 'unavailable') {
        Stop-Install "runtime verification could not run for ""$($smoke.Path)"": $($smoke.Detail). The existing shim at $dest was left unchanged." 5
    }
    Stop-UnusableCheckout $smoke $checkout $dest
}

if ($candidate -eq $checkoutTmp) {
    if (Test-Path -LiteralPath $checkout) {
        Remove-Item -LiteralPath $checkoutTmp -Recurse -Force -ErrorAction SilentlyContinue
        Stop-Install "could not materialize verified incoming checkout at $checkout because that path became occupied. The existing shim at $dest was left unchanged." 4
    }
    try {
        Move-Item -LiteralPath $checkoutTmp -Destination $checkout
    } catch {
        Remove-Item -LiteralPath $checkoutTmp -Recurse -Force -ErrorAction SilentlyContinue
        Stop-Install "could not materialize verified incoming checkout at $checkout. The existing shim at $dest was left unchanged." 3
    }
    $checkoutTmp = ''
    $candidate = $checkout
    Write-Log "checked out and verified $Version into $checkout"
}

# --- 5. activate the verified shim -----------------------------------------
#
# A .cmd shim rather than an extensionless file: cmd.exe and PowerShell both
# find and run a .cmd from PATH, and an extensionless script is not executable
# on Windows at all. The git hook does not go through PATH -- `commitlore init`
# records the bundle and the interpreter in the repository's git config -- so the
# shim is for the terminal, which is where a user types the name.

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$bundle = Join-Path $candidate 'dist\commitlore.mjs'
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
try {
    [System.IO.File]::WriteAllText($destTmp, $shimText, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $destTmp -Destination $dest -Force
} catch {
    if (Test-Path -LiteralPath $destTmp) {
        Remove-Item -LiteralPath $destTmp -Force -ErrorAction SilentlyContinue
    }
    Stop-Install "could not activate verified checkout $candidate at $dest. The existing shim was left unchanged." 3
}

Write-Log "installed to $dest"
Write-Host $smoke.Version

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

# --- 6. detect and wire coding agents --------------------------------------
#
# Everything below is additive and best-effort: it never touches the exit codes
# above (1-5 stay reserved for the transactional install -- the tool is already installed and
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
# here. An unparseable config is still left untouched and reported. Hermes is
# YAML and has stricter byte-preservation requirements, so both installers
# dispatch to the same `commitlore hermes install` helper for that one profile.

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
        # Preserving an entry somebody configured is right; preserving one that
        # cannot start is not. A registration left by a temp-directory install
        # kept reporting "already mentions commitlore" long after the directory
        # was gone, so the host had no working server and every reinstall said
        # it was fine. The file is still never rewritten here -- a dead target
        # is named rather than counted as healthy.
        $existingCmd = ''
        try {
            $probe = $body | ConvertFrom-Json
            foreach ($container in @($probe.mcpServers, $probe.mcp, $probe.servers)) {
                if ($null -eq $container) { continue }
                $entry = $container.commitlore
                if ($null -eq $entry) { continue }
                $cmd = $entry.command
                if ($cmd -is [array]) { $cmd = $cmd | Select-Object -First 1 }
                if ($cmd -is [string] -and $cmd -ne '') { $existingCmd = $cmd; break }
            }
        } catch {
            $existingCmd = ''
        }
        if ($existingCmd -ne '' -and -not (Test-Path -LiteralPath $existingCmd)) {
            Add-Skipped $Agent "$ConfigPath names commitlore at ""$existingCmd"", which does not exist -- left unchanged, so this host has no working server; remove that entry and rerun to wire it to $dest"
            return
        }
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

# Codex CLI owns its MCP config whenever it is available. The file branch is
# only for an existing Codex home on a machine without the CLI: hand-writing
# TOML while the CLI is present invites drift when Codex changes its format.
# https://developers.openai.com/codex/mcp
if (Test-AgentPresent 'codex' @((Join-Path $home_ '.codex'))) {
    $codexConfig = Join-Path $home_ '.codex\config.toml'
    $codexCli = Get-Command codex -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $codexCli) {
        # A registration named `commitlore` is not evidence of a working one.
        # This branch used to check only that the name appeared in `codex mcp
        # list`, so an entry pointing at a wrapper some earlier install left in
        # a temp directory was reported healthy and never repaired -- the defect
        # install.sh already fixed by asking what the entry points at. Ownership
        # is decided by the target, never by the key it sits under.
        #
        # `$ErrorActionPreference` is relaxed around the native call: under
        # 'Stop' anything codex writes to stderr becomes a terminating error, and
        # "no such server" is an ordinary answer here, not a failure.
        $codexExisting = ''
        $eapCodex = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $codexExisting = (& codex mcp get commitlore 2>$null | Out-String) } catch { $codexExisting = '' }
        $ErrorActionPreference = $eapCodex

        $codexPointsHere = $codexExisting -match [regex]::Escape("command: $dest")
        $codexIsOurs = $codexExisting -match [regex]::Escape($dataRoot)

        if ($codexExisting.Trim() -ne '' -and $codexPointsHere) {
            Add-Skipped 'codex' 'commitlore already points at this install -- left unchanged'
        } elseif ($codexExisting.Trim() -ne '' -and -not $codexIsOurs) {
            Add-Skipped 'codex' 'an mcp server named commitlore points somewhere this install did not write -- left untouched'
        } else {
            # Either nothing is registered, or what is registered is a stale
            # entry this tool wrote. The stale one is removed first so the add
            # below is not refused for a name that is already taken.
            if ($codexExisting.Trim() -ne '') {
                $eapRemove = $ErrorActionPreference
                $ErrorActionPreference = 'Continue'
                try { & codex mcp remove commitlore > $null 2>&1 } catch { }
                $ErrorActionPreference = $eapRemove
            }
            $registered = $false
            try {
                & codex mcp add commitlore -- $dest mcp > $null 2>&1
                $registered = ($LASTEXITCODE -eq 0)
            } catch { $registered = $false }
            if ($registered) {
                Add-Wired 'codex: registered commitlore with codex mcp add'
            } else {
                Add-Skipped 'codex' 'codex mcp add could not register commitlore -- config file was left untouched'
            }
        }
    } else {
        $existingToml = ''
        if (Test-Path -LiteralPath $codexConfig) {
            try { $existingToml = (Get-Content -LiteralPath $codexConfig -Raw) } catch { $existingToml = '' }
        }
        if ($existingToml -match '(?m)^\[mcp_servers\.commitlore\]') {
            Add-Skipped 'codex' "$codexConfig already has a [mcp_servers.commitlore] block (config-file fallback; codex CLI is unavailable) -- left unchanged"
        } else {
            try {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $codexConfig) | Out-Null
                # A backslash is TOML's escape character inside a basic string, so a
                # Windows path has to be doubled or the parser reads \d as an escape.
                $tomlPath = $dest -replace '\\', '\\'
                $block = "`r`n[mcp_servers.commitlore]`r`ncommand = ""$tomlPath""`r`nargs = [""mcp""]`r`n"
                if (Test-Path -LiteralPath $codexConfig) {
                    [System.IO.File]::AppendAllText($codexConfig, $block)
                    Add-Wired "codex: appended a [mcp_servers.commitlore] block to the existing $codexConfig (config-file fallback; codex CLI is unavailable)"
                } else {
                    [System.IO.File]::WriteAllText($codexConfig, $block.TrimStart("`r", "`n"))
                    Add-Wired "codex: created $codexConfig (config-file fallback; codex CLI is unavailable)"
                }
            } catch {
                Add-Skipped 'codex' "could not write $codexConfig"
            }
        }
    }

# Codex's plugin API owns the plugin cache and marketplace. The packaged plugin
# supplies its own MCP server and capture skill, while the marker lets uninstall
# remove only the plugin this installer placed.
    $ok = $false
    try {
        & $dest plugin install-codex > $null 2>&1
        $ok = ($LASTEXITCODE -eq 0)
    } catch { $ok = $false }
    if ($ok) {
        Add-Wired 'codex: installed the commitlore plugin (marketplace: commitlore)'
    } else {
        Add-Skipped 'codex' "could not install the commitlore plugin -- run manually: $dest plugin install-codex"
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

# Hermes -- YAML active profile at ~/.hermes/config.yaml. The helper makes a
# backup before a surgical edit, registers the MCP server, and adds the
# installed bundle through skills.external_dirs (the supported read-only path).
if (Test-AgentPresent 'hermes' @((Join-Path $home_ '.hermes'))) {
    $hermesConfig = Join-Path $home_ '.hermes\config.yaml'
    $hermesOk = $false
    try {
        & $dest hermes install --config $hermesConfig --command $dest --data-root $dataRoot --verify
        $hermesOk = ($LASTEXITCODE -eq 0)
    } catch {
        $hermesOk = $false
    }
    if ($hermesOk) {
        Add-Wired "hermes: configured MCP and the installed CommitLore skill bundle in $hermesConfig"
    } else {
        Add-Skipped 'hermes' 'host setup could not finish; its existing config was left intact where it could not be edited safely'
    }
} else {
    $notFound.Add('Hermes') | Out-Null
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
