/* MileMatch fare proxy - Cloudflare Worker (free tier: 100k requests/day).
 *
 * Fetches real Google Flights results through SerpApi, so nobody using
 * MileMatch has to open another tab, copy anything, or type a price.
 *
 * Why SerpApi rather than scraping Google directly: Google Flights renders
 * client-side, so it needs a headless browser, which will not run on a free
 * Worker. SerpApi runs that infrastructure and absorbs the legal exposure of
 * scraping; we call a documented JSON endpoint. Free tier is 250 searches per
 * month and 50 per hour, which is why the cache below matters.
 *
 * Why a proxy at all: an API key in front-end JavaScript is a published API
 * key, and the browser would block the cross-origin call anyway.
 *
 * Endpoints:
 *   GET /health  -> { ok, credentials, keys, cached }
 *   GET /search  -> { offers, fetchedAt } - fetchedAt is when SerpApi
 *                   answered, which survives in the cached copy
 *
 * Secrets (npx wrangler secret put NAME):
 *   SERPAPI_KEYS  one key, or several comma-separated. Tried in order; the
 *                 next is used when one runs out of searches.
 *   SERPAPI_KEY   the older single-key name, still honoured.
 *
 * Vars (wrangler.toml):
 *   ALLOWED_ORIGIN  your Pages origin, comma separated, or * while developing
 *   CACHE_HOURS     how long an identical search is reused (default 6)
 */

/* Best-effort per-IP rate limiting.
 *
 * Isolate-local, so it resets when Cloudflare recycles the isolate and is not
 * shared across colos. It will not stop a distributed abuser - it caps a
 * runaway script or one machine hammering the endpoint, which is the realistic
 * failure mode when the URL is baked into a public page. */
/* Bump whenever the SHAPE of a normalised offer changes.
 *
 * The edge cache is keyed on the request URL, and deploying new code does not
 * clear it. Without a version in that key, a worker that has just learned to
 * send something new keeps answering without it for up to CACHE_HOURS - which
 * is exactly how return flights stayed missing after the deploy that added
 * them. Old entries are not deleted; they simply stop being addressed. */
const PAYLOAD_VERSION = '2';

const RATE = { windowMs: 60_000, maxPerWindow: 20 };
const hits = new Map();

function rateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (!times.length || now - times[times.length - 1] > RATE.windowMs) hits.delete(key);
    }
  }
  return recent.length > RATE.maxPerWindow;
}

/* CORS headers are advisory - a browser honours them, curl does not. So when
 * an allowlist is configured we also REJECT mismatched origins server-side.
 * That cannot make a public endpoint private; it stops other SITES spending
 * this key's monthly allowance. */
function originAllowed(request, env) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  if (allowed === '*') return true;
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return allowed.split(',').map((s) => s.trim()).includes(origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const configured = env.ALLOWED_ORIGIN || '*';
    const reqOrigin = request.headers.get('Origin');
    const origin = configured === '*' ? '*'
      : (originAllowed(request, env) ? reqOrigin : configured.split(',')[0].trim());

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (url.pathname === '/health') {
      return json({
        ok: true,
        credentials: apiKeys(env).length > 0,
        keys: apiKeys(env).length,
        provider: 'serpapi/google_flights',
        payloadVersion: PAYLOAD_VERSION,
        cacheHours: Number(env.CACHE_HOURS || 6),
        originLocked: configured !== '*'
      }, 200, origin);
    }

    if (url.pathname === '/search') {
      if (!originAllowed(request, env)) {
        return json({ error: 'This fare lookup only serves its own site.' }, 403, origin);
      }
      if (rateLimited(request.headers.get('CF-Connecting-IP'))) {
        return json({ error: 'Too many searches in a short period. Wait a minute.' }, 429, origin);
      }
      try {
        return await handleSearch(url, env, ctx, origin);
      } catch (err) {
        return json({ error: err.message }, 502, origin);
      }
    }

    return json({ error: 'Not found. Try /health or /search.' }, 404, origin);
  }
};

/* Every key this worker may spend, in the order they are tried.
 *
 * SERPAPI_KEYS is comma-separated so a key can be added or dropped without
 * touching this file. SERPAPI_KEY is still honoured, so a worker deployed
 * before rotation existed keeps working untouched.
 *
 * Trimmed because piping a value into `wrangler secret put` from PowerShell
 * appends a newline, which SerpApi rejects as an invalid key with no hint that
 * whitespace is the problem. */
function apiKeys(env) {
  const raw = [env.SERPAPI_KEYS, env.SERPAPI_KEY].filter(Boolean).join(',');
  const out = [];
  for (const part of raw.split(',')) {
    const key = part.trim();
    // A key repeated across both secrets must not be tried twice.
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/* Whether a failure belongs to the key rather than to the request.
 *
 * Only these are worth spending another key on. A malformed search fails
 * identically on every key, and retrying it would turn one bad request into
 * three - burning the pool to produce the same error. */
function keyIsSpent(status, error) {
  if (status === 401 || status === 429) return true;
  return /run out|limit|exceeded|invalid api key/i.test(error || '');
}

async function handleSearch(url, env, ctx, origin) {
  const keys = apiKeys(env);
  if (!keys.length) {
    throw new Error('No SerpApi key is set on this worker. Run: npx wrangler secret put SERPAPI_KEYS');
  }

  const p = url.searchParams;
  for (const key of ['origin', 'destination', 'departureDate']) {
    if (!p.get(key)) throw new Error(`Missing required parameter: ${key}`);
  }

  const roundTrip = Boolean(p.get('returnDate'));
  const q = new URLSearchParams({
    engine: 'google_flights',
    departure_id: p.get('origin'),
    arrival_id: p.get('destination'),
    outbound_date: p.get('departureDate'),
    currency: p.get('currencyCode') || 'USD',
    hl: 'en',
    adults: p.get('adults') || '1',
    // 1 = round trip, 2 = one way
    type: roundTrip ? '1' : '2',
    // 1 economy, 2 premium economy, 3 business, 4 first
    travel_class: p.get('travelClass') || '1'
  });
  if (roundTrip) q.set('return_date', p.get('returnDate'));
  // SerpApi stops: 0 any, 1 nonstop only, 2 <=1 stop, 3 <=2 stops
  if (p.get('nonStop') === 'true') q.set('stops', '1');

  /* Second leg of a round trip. Google prices a return against a specific
   * outbound, so the token has to travel WITH the original search parameters,
   * not instead of them - which is why this is the same endpoint rather than
   * one of its own. The results that come back are the ways home, each priced
   * as a trip total. */
  const departureToken = p.get('departureToken');
  if (departureToken) q.set('departure_token', departureToken);

  /* Identical searches must not each cost one. The cache key is built from the
   * INCOMING url, which never carries an api_key, so a search paid for by one
   * key is afterwards served to all of them. */
  const cacheHours = Number(env.CACHE_HOURS || 6);
  const cacheKeyUrl = new URL(url.toString());
  cacheKeyUrl.searchParams.delete('_');
  cacheKeyUrl.searchParams.set('__shape', PAYLOAD_VERSION);
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.text();
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-MileMatch-Cache': 'hit', ...cors(origin) }
    });
  }

  /* Try each key in turn, moving to the next only when the key itself is
   * spent. The last failure is remembered so that if every key is out, the
   * message says so rather than reporting whatever the final one happened to
   * say on its own. */
  let lastError = '';

  for (let i = 0; i < keys.length; i++) {
    q.set('api_key', keys[i]);
    const res = await fetch('https://serpapi.com/search.json?' + q.toString());
    const text = await res.text();

    let data = null;
    if (res.ok) {
      try { data = JSON.parse(text); }
      catch { throw new Error('SerpApi returned something that was not JSON.'); }
    }

    const error = data ? data.error : `SerpApi ${res.status}: ${text.slice(0, 200)}`;

    if (error) {
      if (keyIsSpent(res.status, error)) { lastError = error; continue; }
      throw new Error(error);
    }

    /* Stamped at the moment SerpApi actually answered, and stored WITH the
     * cached body - so a cache hit hours later still reports when the prices
     * were really seen, not when this request was served. Without that the
     * app cannot tell a fresh fare from a six-hour-old one, and quietly
     * presents both as current. */
    const payload = JSON.stringify({
      offers: normalize(data),
      fetchedAt: new Date().toISOString()
    });
    const response = new Response(payload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${cacheHours * 3600}`,
        'X-MileMatch-Cache': 'miss',
        // Which key answered, so rotation can be watched without logging keys.
        'X-MileMatch-Key': String(i + 1),
        ...cors(origin)
      }
    });
    // Store without blocking the response.
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }

  const plural = keys.length > 1 ? `all ${keys.length} keys` : 'the stored key';
  if (/invalid api key/i.test(lastError)) {
    throw new Error(`SerpApi rejected ${plural}. Re-run worker/deploy.ps1 and choose ` +
                    '"new" to replace them, checking each against ' +
                    'https://serpapi.com/manage-api-key');
  }
  throw new Error(`Monthly fare-lookup allowance used up on ${plural}. ${lastError}`);
}

/* Flatten SerpApi's shape into what the app already renders. Normalising here
 * rather than in the browser keeps provider details in one place. */
function normalize(data) {
  const groups = [...(data.best_flights || []), ...(data.other_flights || [])];

  return groups.map((g, i) => {
    const legs = g.flights || [];
    const carriers = [...new Set(legs.map((f) => f.airline).filter(Boolean))];
    const codes = [...new Set(legs.map((f) => (f.flight_number || '').split(' ')[0]).filter(Boolean))];

    // Google reports stops per itinerary; layovers is the reliable count.
    const stops = Array.isArray(g.layovers) ? g.layovers.length : Math.max(0, legs.length - 1);

    /* Google's free-text notes are where fare terms live - "Carry-on bag not
     * included", "1st checked bag: $40". They hang off the group on some
     * results and off individual flights on others, so gather both and pass
     * them through verbatim. The browser reads them (js/flights.js), which
     * keeps one set of rules covering live and pasted fares alike, and lets
     * the person booking see the airline's own words rather than a paraphrase.
     *
     * `bags` below stays for clients that predate that parsing. */
    const extensions = [...new Set([
      ...(g.extensions || []),
      ...legs.flatMap((f) => f.extensions || [])
    ].filter((s) => typeof s === 'string' && s.trim()))];

    // Absent means unknown, and unknown must never read as "no bag".
    const ext = extensions.join(' ').toLowerCase();
    const carryOn = /carry-on included|carry on included/.test(ext) ? 1 : null;
    const checked = /(\d+)\s*(?:free\s*)?checked bag/.exec(ext);

    return {
      id: 'sa-' + i,
      price: g.price,
      currency: 'USD',
      carriers: carriers.length ? carriers : ['Unknown airline'],
      carrierCodes: codes,
      bags: { cabin: carryOn, checked: checked ? Number(checked[1]) : null },
      extensions,
      /* Present on outbound results of a round trip; asking for it again with
       * this token returns the ways back. Absent on the return results. */
      departureToken: g.departure_token || null,
      stops,
      durationText: minutesToText(g.total_duration),
      itineraries: [{
        duration: g.total_duration,
        stops,
        segments: legs.map((f) => ({
          from: f.departure_airport && f.departure_airport.id,
          to: f.arrival_airport && f.arrival_airport.id,
          depart: f.departure_airport && f.departure_airport.time,
          arrive: f.arrival_airport && f.arrival_airport.time,
          carrierName: f.airline,
          number: f.flight_number,
          aircraft: f.airplane
        }))
      }]
    };
  })
  .filter((o) => typeof o.price === 'number' && o.price > 0)
  .sort((a, b) => a.price - b.price);
}

function minutesToText(mins) {
  if (!mins) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  return (h ? h + 'h ' : '') + (m ? m + 'm' : '').trim();
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept'
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) }
  });
}
