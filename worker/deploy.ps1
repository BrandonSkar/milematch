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
npx --yes wrangler deploy

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Copy the workers.dev URL printed above into MileMatch -> Settings -> Worker URL,"
Write-Host "press 'Test connection', then choose 'Live search' on the Search tab."
Write-Host ""
Write-Host "Once you know your Pages origin, set ALLOWED_ORIGIN in wrangler.toml to"
Write-Host "https://brandonskar.github.io and run 'npx wrangler deploy' again so other"
Write-Host "sites cannot spend your Amadeus quota."
