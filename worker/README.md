# Automatic fare lookup

Deploy this once and everyone using MileMatch gets **real Google Flights
results automatically** — no copying, no pasting, no typing a price, nothing to
configure on their end. About five minutes, free.

Without it the app still works: you paste or type a price. This just removes
that step, which matters most on a phone.

---

## How it gets the data

Google shut down their official flights API in 2018, and Google Flights renders
its results client-side — so fetching the page returns an empty shell. Reading
it needs a headless browser, which will not run on a free Cloudflare Worker.

[SerpApi](https://serpapi.com/google-flights-api) runs that infrastructure and
absorbs the legal exposure of scraping. We call a documented JSON endpoint.

**Free tier: 250 searches/month, 50/hour** — shared by everyone using your site,
so the worker caches identical searches (see `CACHE_HOURS`).

> **Amadeus is gone.** This worker previously used the Amadeus Self-Service API,
> which was decommissioned on 17 July 2026 with existing keys deactivated. If
> you find older instructions mentioning `AMADEUS_CLIENT_ID`, they're stale.

## Why a proxy rather than calling SerpApi from the page

Two reasons, both hard blockers:

1. **The key would be public.** Anything in front-end JavaScript is published.
2. **CORS.** The browser blocks the cross-origin call regardless.

The worker also adds an origin lock, per-IP rate limiting, and caching.

---

## Setup

### 1. Cloudflare account

<https://dash.cloudflare.com/sign-up> — free. **Verify the confirmation email.**
An unverified account cannot authorise anything, which is the usual reason the
sign-in button appears to do nothing.

Then create a token at <https://dash.cloudflare.com/profile/api-tokens>:
**Create Token** → **Edit Cloudflare Workers** template → Continue → Create.

### 2. SerpApi key

<https://serpapi.com/users/sign_up> — free, then copy your key from
<https://serpapi.com/manage-api-key>.

### 3. Deploy

```powershell
cd worker
.\deploy.ps1
```

It prompts for both keys, stores them as Worker secrets, deploys, checks
`/health`, and writes the resulting URL into `data/config.js` for you.

### 4. Publish

```bash
git add data/config.js
git commit -m "Point the site at the shared fare worker"
git push
```

Done. Anyone opening the site now gets live fares with zero setup.

#### Doing it by hand instead

```bash
export CLOUDFLARE_API_TOKEN=...      # PowerShell: $env:CLOUDFLARE_API_TOKEN="..."
npx wrangler secret put SERPAPI_KEY
npx wrangler deploy
```

`npx wrangler login` also works, but it needs a browser redirect back to
`localhost:8976`; when that fails it times out after two minutes with no useful
error. The token avoids it.

---

## Making 250 searches last

The allowance is shared by every visitor, so:

- **Identical searches are cached** for `CACHE_HOURS` (default 6). Same route,
  same dates, same cabin costs one search no matter how many people run it.
  Fares do move, so this is a trade-off rather than a free win — lower it if
  you care more about freshness than allowance.
- **`ALLOWED_ORIGIN` is enforced server-side** with a 403, not just advertised
  in CORS headers. CORS is honoured by browsers and ignored by curl, so on its
  own it was decoration. This stops other *sites* spending your allowance; it
  cannot make a public endpoint private.
- **Per-IP rate limiting**, 20 requests/minute. Isolate-local, so it caps a
  runaway script rather than a distributed abuser.

When the allowance runs out the app says so plainly and falls back to pasting
or typing a price. Nothing breaks.

## Endpoints

| Route | Returns |
|---|---|
| `/health` | `{ ok, credentials, provider, cacheHours, originLocked }` |
| `/search` | `{ offers: [...] }`, already normalised for the app |

`/search` parameters: `origin`, `destination`, `departureDate` (required);
`returnDate`, `adults`, `travelClass` (1–4), `currencyCode`, `nonStop`,
`departureToken`.

Each offer carries `extensions` — Google's own fare notes, verbatim, which is
where "1st checked bag: $40" lives. The app reads them so it can show what a
price does and does not cover.

### Return flights

A round trip is two questions. The first `/search` lists departures, and each
one comes back with a `departureToken`. Repeat the **same** search with that
token added and the answer is the ways home, each priced as a trip total.

That is a second lookup against the same allowance, so the app only asks when
someone opens the return list on a flight they picked. Departures and returns
cache separately, so re-opening the same one is free.

## Testing

```bash
npm run test:worker
```

13 tests run the worker against a stubbed SerpApi — request mapping,
normalisation, caching, the origin lock, and error handling — without spending
any of your monthly searches.

## Swapping providers

If SerpApi's terms or pricing stop suiting you, only `handleSearch()` and
`normalize()` in `worker.js` are provider-specific. The proxy, origin lock,
rate limiting, caching, and the entire front end are unaffected.
