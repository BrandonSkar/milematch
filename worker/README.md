# Live fare lookup (optional)

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

From this `worker/` directory:

```bash
npx wrangler login
npx wrangler secret put AMADEUS_CLIENT_ID       # paste your API Key
npx wrangler secret put AMADEUS_CLIENT_SECRET   # paste your API Secret
npx wrangler deploy
```

Wrangler prints a URL like `https://award-compass.yourname.workers.dev`.

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
