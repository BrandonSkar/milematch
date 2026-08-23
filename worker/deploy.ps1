# Deploys the MileMatch fare proxy without the OAuth browser dance.
#
# `wrangler login` needs a browser round-trip back to localhost:8976. When that
# fails (unverified Cloudflare account, browser blocking the redirect, corporate
# proxy) it just times out after two minutes with no useful error. An API token
# skips the whole flow.
#
#   1. Create a free account:  https://dash.cloudflare.com/sign-up
#      VERIFY THE EMAIL. An unverified account can't authorise anything, which
#      is the usual reason the sign-in button appears to do nothing.
#   2. Make a token:           https://dash.cloudflare.com/profile/api-tokens
#      "Create Token" -> use the "Edit Cloudflare Workers" template -> Continue
#      -> Create Token -> copy it.
#   3. Amadeus keys (free):    https://developers.amadeus.com
#      Register, create an app in the Self-Service Workspace, copy the API Key
#      and API Secret.
#   4. Run:  .\deploy.ps1
#
# Nothing is written to disk and no secret is echoed. Values you paste are held
# only for the length of the run.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Read-Secret($label) {
    $secure = Read-Host -Prompt $label -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try   { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host ""
Write-Host "MileMatch fare proxy deploy" -ForegroundColor Cyan
Write-Host "---------------------------"

if (-not $env:CLOUDFLARE_API_TOKEN) {
    Write-Host "Cloudflare API token (from step 2 above)."
    $env:CLOUDFLARE_API_TOKEN = Read-Secret "  Paste token"
}
if (-not $env:CLOUDFLARE_API_TOKEN) { throw "No Cloudflare token supplied." }

# Fail early with a clear message rather than a confusing error mid-deploy.
Write-Host ""
Write-Host "Checking the token..." -NoNewline
try {
    $who = npx --yes wrangler whoami 2>&1 | Out-String
    if ($who -match 'not authenticated|Unable to authenticate|API token') {
        Write-Host " rejected." -ForegroundColor Red
        Write-Host $who
        throw "Cloudflare rejected that token. Re-create it with the 'Edit Cloudflare Workers' template."
    }
    Write-Host " ok." -ForegroundColor Green
} catch {
    Write-Host " could not verify." -ForegroundColor Yellow
    Write-Host $_.Exception.Message
}

Write-Host ""
Write-Host "Amadeus credentials (from step 3 above)."
$amadeusId     = Read-Secret "  API Key"
$amadeusSecret = Read-Secret "  API Secret"
if (-not $amadeusId -or -not $amadeusSecret) { throw "Both Amadeus values are required." }

Write-Host ""
Write-Host "Storing secrets on the worker..."
$amadeusId     | npx --yes wrangler secret put AMADEUS_CLIENT_ID
$amadeusSecret | npx --yes wrangler secret put AMADEUS_CLIENT_SECRET

Write-Host ""
Write-Host "Deploying..."
$deployLog = npx --yes wrangler deploy 2>&1 | Out-String
Write-Host $deployLog

# Pull the workers.dev URL straight out of the deploy output so it can be
# written into the site config - one less thing to copy by hand and get wrong.
$workerUrl = $null
if ($deployLog -match 'https://[a-z0-9._-]+\.workers\.dev') { $workerUrl = $Matches[0] }

if (-not $workerUrl) {
    Write-Host "Could not find the workers.dev URL in the deploy output." -ForegroundColor Yellow
    Write-Host "Copy it from above into data/config.js -> sharedProxyUrl yourself."
    exit 0
}

Write-Host "Worker URL: $workerUrl" -ForegroundColor Cyan

# Confirm it actually answers before wiring it into the site.
Write-Host "Checking /health..." -NoNewline
try {
    $health = Invoke-RestMethod -Uri "$workerUrl/health" -TimeoutSec 20
    if ($health.credentials) {
        Write-Host " ok - Amadeus credentials present." -ForegroundColor Green
    } else {
        Write-Host " reachable, but Amadeus credentials are MISSING." -ForegroundColor Red
    }
} catch {
    Write-Host " could not reach it yet (deploys take a few seconds to propagate)." -ForegroundColor Yellow
}

# Write the URL into data/config.js so every visitor gets live fares.
$configPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'data\config.js'
if (Test-Path $configPath) {
    $cfg = Get-Content $configPath -Raw
    $updated = [regex]::Replace(
        $cfg,
        "sharedProxyUrl:\s*'[^']*'",
        "sharedProxyUrl: '$workerUrl'"
    )
    if ($updated -ne $cfg) {
        # Write UTF-8 without BOM; the file contains em dashes that a BOM-ful
        # or ANSI write would mangle.
        [System.IO.File]::WriteAllText($configPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "Wrote the URL into data/config.js." -ForegroundColor Green
    } else {
        Write-Host "data/config.js already pointed somewhere - left it alone." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "Last step - publish it so your friends get live search too:" -ForegroundColor Cyan
Write-Host '    cd ..'
Write-Host '    git add data/config.js'
Write-Host '    git commit -m "Point the site at the shared fare worker"'
Write-Host '    git push'
Write-Host ""
Write-Host "ALLOWED_ORIGIN is already set to https://brandonskar.github.io in"
Write-Host "wrangler.toml, so other sites cannot spend your Amadeus quota."
