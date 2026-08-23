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
#   3. SerpApi key (free):     https://serpapi.com/users/sign_up
#      Register, then copy your key from https://serpapi.com/manage-api-key
#      Free tier is 250 searches/month, 50/hour, shared by everyone using the
#      site. The worker caches identical searches so repeats cost nothing.
#   4. Run:  .\deploy.ps1
#
# Nothing is written to disk and no secret is echoed. Values you paste are held
# only for the length of the run.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# PowerShell 5.1 still defaults to TLS 1.0 for outbound calls, which modern
# hosts refuse outright.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Read-Secret($label) {
    $secure = Read-Host -Prompt $label -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try   { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# Check the key against SerpApi BEFORE storing it. Finding out it was wrong
# only after a deploy, from a 401 buried in a proxy error, wastes everyone's
# time. /account does not consume a search.
function Test-SerpKey($key) {
    if (-not $key) { return $false }
    try {
        $acct = Invoke-RestMethod -Uri "https://serpapi.com/account?api_key=$key" -TimeoutSec 20
        $used = $acct.this_month_usage
        $left = $acct.total_searches_left
        Write-Host "  Key accepted." -ForegroundColor Green
        if ($null -ne $left) { Write-Host "  Searches left this month: $left  (used $used)" }
        return $true
    } catch {
        Write-Host "  SerpApi rejected that key." -ForegroundColor Red
        Write-Host "  Copy it from https://serpapi.com/manage-api-key - it is the long"
        Write-Host "  hex string under 'Your Private API Key', roughly 64 characters."
        return $false
    }
}

Write-Host ""
Write-Host "MileMatch fare proxy deploy" -ForegroundColor Cyan
Write-Host "---------------------------"

# Being signed in to the Cloudflare website is NOT the same as authenticating
# wrangler - they are separate. Accept either an existing wrangler login or an
# API token, and check before asking for anything.
Write-Host "Checking Cloudflare access..." -NoNewline
$who = npx --yes wrangler whoami 2>&1 | Out-String
$authenticated = ($who -notmatch 'not authenticated|Unable to authenticate')

if ($authenticated) {
    Write-Host " already signed in." -ForegroundColor Green
} elseif ($env:CLOUDFLARE_API_TOKEN) {
    Write-Host " using CLOUDFLARE_API_TOKEN." -ForegroundColor Green
} else {
    Write-Host " not signed in." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Two ways to fix that:"
    Write-Host "  1. Browser login  - opens Cloudflare and asks you to allow wrangler."
    Write-Host "                      Usually works now that you are signed in there."
    Write-Host "  2. API token      - paste one from"
    Write-Host "                      https://dash.cloudflare.com/profile/api-tokens"
    Write-Host "                      (Create Token -> 'Edit Cloudflare Workers')"
    Write-Host ""
    $choice = Read-Host "  Press Enter to try the browser login, or paste a token"

    if ($choice) {
        $env:CLOUDFLARE_API_TOKEN = $choice
    } else {
        Write-Host ""
        Write-Host "Opening the browser. Approve the request, then come back here."
        npx --yes wrangler login
        $who = npx --yes wrangler whoami 2>&1 | Out-String
        if ($who -match 'not authenticated|Unable to authenticate') {
            throw "Still not signed in. Use an API token instead - re-run this script and paste one."
        }
        Write-Host "Signed in." -ForegroundColor Green
    }
}

# Don't make someone re-paste a key that is already stored - this script gets
# re-run after fixable failures like a missing workers.dev subdomain.
$existingSecrets = npx --yes wrangler secret list 2>&1 | Out-String
$needKey = $true

if ($existingSecrets -match 'SERPAPI_KEY') {
    Write-Host ""
    Write-Host "A SerpApi key is already stored on this worker." -ForegroundColor Green
    Write-Host "(If searches are failing with 'Invalid API key', replace it.)"
    $replace = Read-Host "  Press Enter to keep it, or type 'new' to replace"
    if ($replace -ne 'new') { $needKey = $false }
}

if ($needKey) {
    Write-Host ""
    Write-Host "SerpApi key - the long hex string from https://serpapi.com/manage-api-key"
    Write-Host "Nothing appears as you paste. That is deliberate; paste and press Enter."
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $serpKey = (Read-Secret "  API key").Trim()
        if (-not $serpKey) {
            Write-Host "  Nothing was entered. If Ctrl+V does nothing, try right-click to paste." -ForegroundColor Yellow
            continue
        }
        Write-Host "  Checking the key with SerpApi..."
        if (Test-SerpKey $serpKey) { break }
        if ($attempt -eq 3) { throw "Could not verify a SerpApi key after 3 attempts." }
    }

    Write-Host ""
    Write-Host "Storing the secret on the worker..."
    $serpKey | npx --yes wrangler secret put SERPAPI_KEY
}

Write-Host ""
Write-Host "Deploying..."
$deployLog = npx --yes wrangler deploy 2>&1 | Out-String
Write-Host $deployLog

# Pull the workers.dev URL straight out of the deploy output so it can be
# written into the site config - one less thing to copy by hand and get wrong.
$workerUrl = $null
if ($deployLog -match 'https://[a-z0-9._-]+\.workers\.dev') { $workerUrl = $Matches[0] }

# A brand new Cloudflare account has no workers.dev subdomain, and the deploy
# fails with a warning that does not say where to fix it.
if ($deployLog -match 'register a workers\.dev subdomain') {
    Write-Host ""
    Write-Host "Cloudflare needs a workers.dev subdomain before it will host anything." -ForegroundColor Yellow
    Write-Host "This is a one-time account setting."
    Write-Host ""
    Write-Host "  1. Open https://dash.cloudflare.com"
    Write-Host "  2. Left sidebar -> Compute (Workers)  [older accounts: Workers & Pages]"
    Write-Host "  3. It will ask you to choose a subdomain. Pick anything, e.g. your name."
    Write-Host "  4. Re-run this script. It will not ask for your SerpApi key again."
    Write-Host ""
    exit 1
}

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
        Write-Host " ok - SerpApi key present." -ForegroundColor Green
    } else {
        Write-Host " reachable, but the SerpApi key is MISSING." -ForegroundColor Red
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
Write-Host "wrangler.toml, so other sites cannot spend your search allowance."
