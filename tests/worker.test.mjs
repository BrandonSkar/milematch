/* Worker tests. Run with:  npm run test:worker
 *
 * Exercises worker.js against a stubbed SerpApi so the request mapping,
 * normaliser, caching, origin lock and error handling are all verified without
 * spending any of the 250 monthly searches.
 *
 * The worker is an ES module, so it is loaded from a data: URL rather than
 * required — no build step, no bundler.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'worker', 'worker.js'), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;

/* Shaped like SerpApi's documented google_flights response. */
const SERP_RESPONSE = {
  best_flights: [
    {
      flights: [
        { departure_airport: { id: 'SEA', time: '2026-11-15 07:00' },
          arrival_airport:   { id: 'JFK', time: '2026-11-15 15:20' },
          airline: 'Alaska', flight_number: 'AS 12', airplane: 'Boeing 737' }
      ],
      layovers: [],
      total_duration: 320,
      price: 298,
      extensions: ['Carry-on included', '1 free checked bag'],
      departure_token: 'tok-alaska'
    },
    {
      flights: [
        { departure_airport: { id: 'SEA' }, arrival_airport: { id: 'SLC' },
          airline: 'Delta', flight_number: 'DL 800',
          // Google hangs notes off individual flights as well as the group.
          extensions: ['Below average legroom (30 in)'] },
        { departure_airport: { id: 'SLC' }, arrival_airport: { id: 'JFK' },
          airline: 'Delta', flight_number: 'DL 900',
          extensions: ['Below average legroom (30 in)'] }
      ],
      layovers: [{ duration: 65, name: 'Salt Lake City' }],
      total_duration: 550,
      price: 264,
      extensions: [],
      departure_token: 'tok-delta'
    }
  ],
  other_flights: [
    {
      flights: [
        { departure_airport: { id: 'SEA' }, arrival_airport: { id: 'DEN' },
          airline: 'United', flight_number: 'UA 500' },
        { departure_airport: { id: 'DEN' }, arrival_airport: { id: 'JFK' },
          airline: 'United', flight_number: 'UA 600' }
      ],
      layovers: [{ duration: 150, name: 'Denver' }],
      total_duration: 675,
      price: 241
    },
    // Junk the normaliser must drop rather than render as $0 fares.
    { flights: [], layovers: [], total_duration: 0 },
    { flights: [{ airline: 'Ghost' }], price: null }
  ]
};

let serpCalls = 0;
let lastSerpUrl = null;
let serpImpl = async () => new Response(JSON.stringify(SERP_RESPONSE), { status: 200 });

globalThis.fetch = async (url) => { lastSerpUrl = String(url); serpCalls++; return serpImpl(url); };

const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { return store.has(req.url) ? store.get(req.url).clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); }
  }
};

const ctx = { waitUntil: (p) => p };
const ORIGIN = 'https://brandonskar.github.io';
const env = { SERPAPI_KEY: 'test-key', ALLOWED_ORIGIN: ORIGIN, CACHE_HOURS: '6' };

const SEARCH = 'https://w.dev/search?origin=SEA&destination=JFK&departureDate=2026-11-15'
             + '&returnDate=2026-11-22&adults=2&travelClass=3&nonStop=true';

/* Each test needs its own cache key. A `_=` cache-buster will NOT do it — the
 * worker strips that parameter on purpose so a browser cache-buster doesn't
 * defeat the cache and burn the monthly allowance. Vary a real parameter. */
let dateSeed = 0;
const uniqueSearch = () =>
  SEARCH.replace('2026-11-15', '2026-11-' + String(10 + (++dateSeed)).padStart(2, '0'));

const req = (url, origin = ORIGIN) => new Request(url, { headers: origin ? { Origin: origin } : {} });

/* ── Request mapping ───────────────────────────────────────── */

test('search parameters map onto SerpApi google_flights', async () => {
  await worker.fetch(req(SEARCH), env, ctx);
  const p = new URL(lastSerpUrl).searchParams;
  assert.strictEqual(p.get('engine'), 'google_flights');
  assert.strictEqual(p.get('departure_id'), 'SEA');
  assert.strictEqual(p.get('arrival_id'), 'JFK');
  assert.strictEqual(p.get('outbound_date'), '2026-11-15');
  assert.strictEqual(p.get('return_date'), '2026-11-22');
  assert.strictEqual(p.get('type'), '1', '1 = round trip');
  assert.strictEqual(p.get('travel_class'), '3', '3 = business');
  assert.strictEqual(p.get('adults'), '2');
  assert.strictEqual(p.get('stops'), '1', 'nonStop maps to stops=1');
});

test('a one-way search sends type=2 and no return date', async () => {
  await worker.fetch(req('https://w.dev/search?origin=SEA&destination=JFK&departureDate=2026-11-15'), env, ctx);
  const p = new URL(lastSerpUrl).searchParams;
  assert.strictEqual(p.get('type'), '2');
  assert.strictEqual(p.get('return_date'), null);
});

test('missing required parameters are refused', async () => {
  const r = await worker.fetch(req('https://w.dev/search?origin=SEA'), env, ctx);
  assert.strictEqual(r.status, 502);
  assert.match((await r.json()).error, /destination/);
});

/* ── Normalisation ─────────────────────────────────────────── */

test('offers are normalised, junk dropped, cheapest first', async () => {
  const r = await worker.fetch(req(uniqueSearch()), env, ctx);
  const { offers } = await r.json();

  assert.strictEqual(offers.length, 3, 'entries with no price must be dropped');
  assert.deepStrictEqual(offers.map((o) => o.price), [241, 264, 298]);

  const alaska = offers.find((o) => o.price === 298);
  assert.deepStrictEqual(alaska.carriers, ['Alaska']);
  assert.deepStrictEqual(alaska.carrierCodes, ['AS'], 'code comes from the flight number');
  assert.strictEqual(alaska.stops, 0);
  assert.strictEqual(alaska.durationText, '5h 20m');
  assert.strictEqual(alaska.bags.cabin, 1);
  assert.strictEqual(alaska.bags.checked, 1);

  const delta = offers.find((o) => o.price === 264);
  assert.strictEqual(delta.stops, 1, 'one layover is one stop');
  assert.strictEqual(delta.carriers.length, 1, 'repeated carriers dedupe');
  assert.strictEqual(delta.itineraries[0].segments.length, 2);
});

test('unknown baggage stays null rather than becoming false', async () => {
  const { offers } = await (await worker.fetch(req(uniqueSearch()), env, ctx)).json();
  const delta = offers.find((o) => o.price === 264);
  assert.strictEqual(delta.bags.cabin, null);
  assert.strictEqual(delta.bags.checked, null);
});

/* The fare notes are where "1st checked bag: $40" lives. The browser reads
 * them, so they have to arrive intact rather than pre-digested. */
test('fare notes are forwarded verbatim, from the group and its flights', async () => {
  const { offers } = await (await worker.fetch(req(uniqueSearch()), env, ctx)).json();

  const alaska = offers.find((o) => o.price === 298);
  assert.deepStrictEqual(alaska.extensions, ['Carry-on included', '1 free checked bag']);

  // Both Delta legs carry the same note; it should be listed once.
  const delta = offers.find((o) => o.price === 264);
  assert.deepStrictEqual(delta.extensions, ['Below average legroom (30 in)']);

  // An entry with no notes at all gets an empty list, not undefined.
  const united = offers.find((o) => o.price === 241);
  assert.deepStrictEqual(united.extensions, []);
});

/* ── Return flights ────────────────────────────────────────── */

test('each outbound carries the token that asks for the ways back', async () => {
  const { offers } = await (await worker.fetch(req(uniqueSearch()), env, ctx)).json();
  assert.strictEqual(offers.find((o) => o.price === 298).departureToken, 'tok-alaska');
  // Absent upstream means null, not undefined, so the app can test it plainly.
  assert.strictEqual(offers.find((o) => o.price === 241).departureToken, null);
});

test('a departure token is sent on with the search it belongs to', async () => {
  await worker.fetch(req(uniqueSearch() + '&departureToken=tok-alaska'), env, ctx);
  const p = new URL(lastSerpUrl).searchParams;
  assert.strictEqual(p.get('departure_token'), 'tok-alaska');
  // Google prices a return against a specific outbound, so the original
  // search has to travel with the token.
  assert.strictEqual(p.get('departure_id'), 'SEA');
  assert.strictEqual(p.get('arrival_id'), 'JFK');
  assert.strictEqual(p.get('return_date'), '2026-11-22');
  assert.strictEqual(p.get('type'), '1');
});

test('return results cache separately from the departures they follow', async () => {
  const url = uniqueSearch();
  const before = serpCalls;
  await worker.fetch(req(url), env, ctx);
  await worker.fetch(req(url + '&departureToken=tok-alaska'), env, ctx);
  assert.strictEqual(serpCalls - before, 2, 'two different questions, two lookups');

  // ...but asking the same one twice still costs nothing.
  const again = await worker.fetch(req(url + '&departureToken=tok-alaska'), env, ctx);
  assert.strictEqual(again.headers.get('X-MileMatch-Cache'), 'hit');
});

/* ── Caching ───────────────────────────────────────────────── */

/* The app varies `_` on every request so a BROWSER never replays a stale copy
 * of a fare. That must not reach SerpApi - the whole point is that it defeats
 * the browser cache and only the browser cache. */
test('a browser cache-buster reaches the edge without costing a search', async () => {
  const url = uniqueSearch();
  await worker.fetch(req(url + '&_=1111'), env, ctx);

  const before = serpCalls;
  const second = await worker.fetch(req(url + '&_=2222'), env, ctx);
  assert.strictEqual(second.headers.get('X-MileMatch-Cache'), 'hit');
  assert.strictEqual(serpCalls, before, 'a different _ must not spend a lookup');
});

/* Deploying new code does not clear the edge cache, so the cache key carries
 * the payload shape. Otherwise a worker that just learned to send departure
 * tokens keeps answering without them until the old entries expire. */
test('the payload shape is part of the cache key, and is reported', async () => {
  const health = await (await worker.fetch(req('https://w.dev/health'), env, ctx)).json();
  assert.ok(health.payloadVersion, '/health should say which shape it speaks');

  const url = uniqueSearch();
  await worker.fetch(req(url), env, ctx);
  const cached = [...store.keys()].filter((k) => k.includes(new URL(url).searchParams.get('departureDate')));
  assert.ok(cached.length, 'the search should have been cached');
  assert.ok(cached.every((k) => k.includes('__shape=' + health.payloadVersion)),
    'and keyed on the shape it was built with');
});

test('an identical search is served from cache and costs nothing', async () => {
  const url = uniqueSearch();
  const first = await worker.fetch(req(url), env, ctx);
  assert.strictEqual(first.headers.get('X-MileMatch-Cache'), 'miss');

  serpCalls = 0;
  const second = await worker.fetch(req(url), env, ctx);
  assert.strictEqual(second.headers.get('X-MileMatch-Cache'), 'hit');
  assert.strictEqual(serpCalls, 0, 'a cache hit must not spend a SerpApi search');
});

test('a different date is a fresh search', async () => {
  const r = await worker.fetch(req(SEARCH.replace('2026-11-15', '2027-01-09')), env, ctx);
  assert.strictEqual(r.headers.get('X-MileMatch-Cache'), 'miss');
});

/* ── Origin lock ───────────────────────────────────────────── */

test('another site cannot spend the search allowance', async () => {
  const r = await worker.fetch(req(SEARCH, 'https://evil.example'), env, ctx);
  assert.strictEqual(r.status, 403);
});

test('a request with no Origin is refused when locked', async () => {
  const r = await worker.fetch(req(SEARCH, null), env, ctx);
  assert.strictEqual(r.status, 403);
});

test('wildcard origin allows anyone, for local development', async () => {
  const r = await worker.fetch(req(uniqueSearch(), 'https://anything'), { ...env, ALLOWED_ORIGIN: '*' }, ctx);
  assert.strictEqual(r.status, 200);
});

/* ── Errors ────────────────────────────────────────────────── */

test('a missing API key fails with a clear message', async () => {
  const r = await worker.fetch(req(uniqueSearch()), { ...env, SERPAPI_KEY: '' }, ctx);
  assert.strictEqual(r.status, 502);
  assert.match((await r.json()).error, /SERPAPI_KEY/);
});

test('running out of searches says so in plain language', async () => {
  serpImpl = async () => new Response(JSON.stringify({ error: 'You have run out of searches' }), { status: 200 });
  const r = await worker.fetch(req(uniqueSearch()), env, ctx);
  serpImpl = async () => new Response(JSON.stringify(SERP_RESPONSE), { status: 200 });
  assert.match((await r.json()).error, /allowance used up/i);
});

/* ── Health ────────────────────────────────────────────────── */

test('health reports credentials and the origin lock', async () => {
  const h = await (await worker.fetch(req('https://w.dev/health'), env, ctx)).json();
  assert.strictEqual(h.credentials, true);
  assert.strictEqual(h.originLocked, true);
  assert.strictEqual(h.provider, 'serpapi/google_flights');
});
