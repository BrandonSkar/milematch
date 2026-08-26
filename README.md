# MileMatch

A points-and-miles flight optimizer that runs entirely in your browser. Enter
your balances, model a credit card welcome bonus, and see which loyalty program
books a given flight for the fewest points — and whether it's worth it at all
versus just paying cash.

Static site, no build step, no backend, no account. Installs as a desktop app.

---

## What it actually does

1. You tell it your points balances (Chase UR, Amex MR, Capital One, Citi,
   Bilt, Wells Fargo, plus any airline miles you already hold).
2. You give it a route and cabin. Fares are looked up live; if that cannot
   answer, it asks for a price instead. **You can pick
   several airports on each side** and it searches every pairing.
3. It prices that trip across ~22 airline programs, works out which ones you can
   reach — including multi-currency transfers — and ranks them by value per point.
4. It tells you the exact transfer path: *"Transfer 40,000 Chase UR → Aeroplan,
   combine with the 20,000 you already hold."*

Plus: tick any credit card and its welcome bonus is added to your balances, so
you can see exactly what a sign-up bonus would buy before you apply.

### Comparing airports

Pick several airports on either side and it searches every pairing, ranked by
the cheapest fare it found:

    SEA -> LHR   $612   Cheapest
    PDX -> LHR   $661   -  $49 more than SEA

**All of it is one lookup.** Google Flights takes a comma-separated list on both
ends, so nine pairings cost one search rather than nine. The results are ranked
across every pair at once, which means a pair whose best fare loses to
everything else may not come back at all - the right answer to "which airport
should I use", and the wrong one to "what is the best fare from each". Tick
**Price every pair separately** for the latter, at one lookup per pair.

Tap any row to load its flights and price them in points.

## What it deliberately does not do

**It cannot see live award availability.** No free API exists for that. This app
tells you *which program to use and what it should cost*; you still confirm the
seat is open on the airline's own site (every result links straight there).

If you want live award seat data, [seats.aero](https://seats.aero) has the best
coverage and a Partner API — it's a paid tier, and the app is built so you could
add it behind the existing provider interface.

> **Transfers are irreversible.** Confirm the real award price on the airline's
> site before moving points. Everything in `data/charts.js` is an estimate.

---

## Running it

Just open `index.html` — the data files are plain scripts, so it works straight
off the filesystem with no server.

For the service worker and install prompt to work you need real HTTP:

```bash
npm run serve        # http://localhost:8080
npm test             # 41 engine tests (pure logic, no browser needed)
npm run test:sw      # 11 service-worker tests, no browser needed
npm run test:browser # DOM tests, drives real Chrome over the DevTools Protocol
npm run test:all     # both suites
```

The browser suite skips itself if Chrome isn't installed. It exists because the
engine tests can't see the DOM — an input handler that eats keystrokes or a link
that goes stale will pass every unit test while the app is visibly broken.

## Publishing to GitHub Pages

```bash
git remote add origin https://github.com/YOUR-USERNAME/milematch.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.

Your site appears at `https://YOUR-USERNAME.github.io/milematch/` within a
minute or two. It must be a **public** repo — Pages on private repos requires a
paid plan.

### Installing it as a desktop app

Open the Pages URL in Chrome or Edge. An install icon appears in the address bar
(the app also shows an **Install app** button in the header). Click it and the app
opens in its own window with no browser chrome, gets a Start Menu entry, and works
offline.

This works because of three things already in the repo: `manifest.webmanifest`,
the registered service worker in `sw.js`, and HTTPS, which GitHub Pages provides
automatically.

## Optional: live cash fares

Without setup you type the cash price yourself. If you'd rather have real fares
pulled in, deploy the included Cloudflare Worker — free, ~5 minutes. See
[`worker/README.md`](worker/README.md).

---

## How the math works

**Cents per point** is the whole game:

```
cpp = (cash price − award taxes & surcharges) ÷ points required × 100
```

Subtracting surcharges matters enormously. A British Airways business award to
London might "save" you a $4,000 fare but charge $900 in carrier-imposed fees,
while Avianca LifeMiles charges near zero on the same Star Alliance seat. Any
tool that ignores this will steer you wrong, so each program carries a surcharge
profile (`none` / `low` / `medium` / `high`) that feeds a distance- and
cabin-scaled estimate.

Each program has a **baseline** cpp — your floor. Come in under it and the app
says pay cash instead. Come in 50% above and it's flagged as excellent.

**Four pricing models**, because programs genuinely differ:

| Model | Programs | How the price is derived |
|---|---|---|
| `distance` | Aeroplan, Avios (BA/Iberia/Qatar), Asia Miles, Qantas | Great-circle distance → band lookup |
| `region` | LifeMiles, Turkish, ANA, Alaska, AA partners, KrisFlyer… | Zone pair → chart cell |
| `dynamic` | United, Delta, Flying Blue, Emirates | Derived from the cash fare at a typical redemption rate |
| `fixed` | Southwest, JetBlue | Revenue-based, a near-constant cents-per-point |

Programs with no chart entry for a route still appear, flagged `rough estimate`,
so you never get a silently missing option.

**Transfer planning** spends direct miles first, then draws from flexible
currencies best-ratio-first — so a 1.25:1 partner like Amex→JetBlue doesn't get
burned when a 1:1 option exists. Live transfer bonuses are supported: add them to
`PB.TRANSFER_BONUSES` and every calculation picks them up.

---

## The data is yours to correct

Award charts, transfer ratios, and welcome bonuses change constantly. They live
in four plain files with no build step — edit a number, reload the page:

| File | Contents |
|---|---|
| `data/programs.js` | Currencies, programs, transfer ratios, transfer bonuses, surcharge model |
| `data/charts.js` | Distance and region award charts |
| `data/cards.js` | Credit cards and welcome bonuses |
| `data/airports.js` | ~250 airports with coordinates and award zones |

Values were last reviewed as of the `asOf` date shown in the app's Settings tab.
Treat every one of them as a starting point to verify, not as an authority —
especially sign-up bonuses, which are frequently targeted and vary by applicant.

## Project layout

```
index.html              app shell
css/styles.css          dark/light theme, no framework
js/engine.js            pricing, transfers, valuation  ← all the real logic
js/flights.js           fare providers (live / manual / estimate)
js/store.js             localStorage persistence
js/app.js               UI controller
data/*.js               the editable reference data
worker/                 optional Cloudflare Worker for live fares
tests/engine.test.js    41 tests over the pricing engine
tests/browser.test.js   10 DOM interaction tests in real Chrome
sw.js                   service worker (offline + installability)
```

`js/engine.js` is pure functions with no DOM and no network, which is why the
whole thing is testable with `node --test`.

## Privacy

Balances and settings live in this browser's `localStorage` and are never
transmitted. The only outbound request the app can make is a fare lookup through
a proxy you deploy and control yourself. There is no analytics, no account, and
no third-party script.

## License

MIT.
