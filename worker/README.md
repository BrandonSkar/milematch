# Live fare lookup (optional) — CURRENTLY NOT DEPLOYABLE

> ## ⚠️ Amadeus Self-Service is retired
>
> Amadeus paused new Self-Service registrations in **March 2026** and fully
> decommissioned the portal on **17 July 2026**, deactivating existing API
> keys. You cannot sign up, and this worker targets that dead API.
>
> The Amadeus **Enterprise** portal still exists but needs a commercial
> agreement and an account manager — not a route for a personal project.
>
> **Nothing is broken.** MileMatch never depended on this. Type the cash price
> from Google Flights (the link next to the field carries your exact route and
> dates) and every points calculation works exactly the same. That number is
> also more trustworthy than a sandbox fare, because you read it off a real
> booking page.
>
> ### If you want automatic fares anyway
>
> | Provider | Signup | Reality check |
> |---|---|---|
> | **Duffel** | ~1 min, test token immediately | Test mode returns a **simulated airline**, not real fares. Live access needs verification and an agreement. |
> | **Travelpayouts** | Free affiliate signup | Data API is **cached price trends**, not live quotes. Real-time search needs 50,000 MAU. |
> | **Amadeus Enterprise** | Sales process | Commercial agreement required. |
>
> There is no longer a free, self-signup API returning real live cash fares for
> a hobby project. The code below is kept as a working template — the CORS
> proxy, origin locking, rate limiting and token caching all still apply to
> whatever provider replaces it. Only `handleSearch()` and
> `normalizeAmadeus()` in `js/flights.js` need swapping.

---

## Original setup notes (Amadeus — no longer possible)

The app works without this. You just type the cash price yourself, which takes
about ten seconds on Google Flights. Set this up if you'd rather have real fares
pulled in automatically.

**Cost: $0.** Cloudflare Workers' free tier allows 100,000 requests/day and
Amadeus' Self-Service tier includes a free monthly call quota.

## Why a proxy is required

GitHub Pages serves static files only. A browser calling Amadeus directly from
`yourname.github.io` fails for two reasons that cannot be worked around
client-side:

1. **CORS** — Amadeus does not send `Access-Control-Allow-Origin` for browser
   requests, so the browser discards the response.
2. **Key exposure** — anything in front-end JavaScript is public. An API key
   shipped to the browser is a published API key.

This worker sits in between: it holds the credentials and returns only fare data.

## Setup

### 1. Get Amadeus credentials

1. Register at <https://developers.amadeus.com> (free, no card for the sandbox).
2. Create an app in **My Self-Service Workspace**.
3. Copy the **API Key** and **API Secret**.

The **test** environment is free and instant, but its inventory is limited and
partly cached — treat prices as illustrative. Moving to **production** gives real
fares and keeps a free monthly quota, but Amadeus requires a card on file to
enable it. Switch by changing `AMADEUS_HOST` in `wrangler.toml`.

### 2. Deploy the worker

You need a free Cloudflare account: <https://dash.cloudflare.com/sign-up>.
**Verify the confirmation email.** An unverified account cannot authorise
anything, which is the usual reason the sign-in button appears to do nothing.

#### Recommended: API token (skips the browser flow)

`npx wrangler login` needs the browser to redirect back to `localhost:8976`.
When that round-trip fails it simply times out after two minutes with no
useful error. A token avoids it entirely.

1. Go to <https://dash.cloudflare.com/profile/api-tokens>
2. **Create Token** → use the **Edit Cloudflare Workers** template → Continue → Create Token
3. Copy the token, then from this `worker/` directory:

```powershell
.\deploy.ps1
```

It prompts for the token and your Amadeus keys, stores the secrets on the
worker, and deploys. Nothing is written to disk and no secret is echoed.

Or do it by hand:

```bash
export CLOUDFLARE_API_TOKEN=...              # PowerShell: $env:CLOUDFLARE_API_TOKEN="..."
npx wrangler secret put AMADEUS_CLIENT_ID
npx wrangler secret put AMADEUS_CLIENT_SECRET
npx wrangler deploy
```

#### Alternative: OAuth

```bash
npx wrangler login
```

If this hangs on "Timed out waiting for authorization code", the browser never
completed the round-trip — use the token method above rather than retrying.

Either way, wrangler prints a URL like `https://milematch.yourname.workers.dev`.

### 3. Point the app at it

Open the app → **Settings** → paste the worker URL → **Test connection**.
You should see `Connected. Amadeus credentials present.`

Then on the Search tab pick **Live search** as the fare source.

### 4. Lock it down

Once you know your Pages URL, set `ALLOWED_ORIGIN` in `wrangler.toml` to it
(e.g. `https://yourname.github.io`) and redeploy. That stops other sites from
burning your Amadeus quota.

## Endpoints

| Route     | Returns                                                        |
|-----------|----------------------------------------------------------------|
| `/health` | `{ ok, credentials, host }` — used by the Test connection button |
| `/search` | Amadeus Flight Offers Search, passed through unmodified          |

`/search` parameters: `origin`, `destination`, `departureDate` (required);
`returnDate`, `adults`, `travelClass`, `currencyCode`, `max`, `nonStop`.

## Local testing

```bash
npx wrangler dev
```

Then set the app's worker URL to `http://localhost:8787`.

## Other providers

The app only needs *a cash price*, so swapping providers means editing
`normalizeAmadeus()` in `js/flights.js` and the fetch in this worker:

- **Travelpayouts / Aviasales** — free affiliate API, cached prices, no card.
- **Duffel** — free sandbox; live access needs a signed agreement.
- **seats.aero Partner API** — the only one that returns *award availability*
  rather than cash fares. Paid, and worth it only if you want the app to confirm
  a seat is actually open.
