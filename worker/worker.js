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
 *   GET /health  -> { ok, credentials, cached }
 *   GET /search  -> normalised flight offers
 *
 * Secret (npx wrangler secret put SERPAPI_KEY):
 *   SERPAPI_KEY
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
        credentials: Boolean(env.SERPAPI_KEY),
        provider: 'serpapi/google_flights',
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

async function handleSearch(url, env, ctx, origin) {
  if (!env.SERPAPI_KEY) {
    throw new Error('SERPAPI_KEY is not set on this worker. Run: npx wrangler secret put SERPAPI_KEY');
  }

  const p = url.searchParams;
  for (const key of ['origin', 'destination', 'departureDate']) {
    if (!p.get(key)) throw new Error(`Missing required parameter: ${key}`);
  }

  const roundTrip = Boolean(p.get('returnDate'));
  const q = new URLSearchParams({
    engine: 'google_flights',
    api_key: env.SERPAPI_KEY,
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

  /* The free tier is 250 searches a month shared by everyone using the site,
   * so identical searches must not each cost one. Cache on everything except
   * the API key. */
  const cacheHours = Number(env.CACHE_HOURS || 6);
  const cacheKeyUrl = new URL(url.toString());
  cacheKeyUrl.searchParams.delete('_');
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

  const res = await fetch('https://serpapi.com/search.json?' + q.toString());
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`SerpApi ${res.status}: ${text.slice(0, 300)}`);
  }

  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('SerpApi returned something that was not JSON.'); }

  if (data.error) {
    // Quota exhaustion is the expected failure, so name it clearly.
    throw new Error(/run out|limit|exceeded/i.test(data.error)
      ? `Monthly fare-lookup allowance used up. ${data.error}`
      : data.error);
  }

  const payload = JSON.stringify({ offers: normalize(data) });

  const response = new Response(payload, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${cacheHours * 3600}`,
      'X-MileMatch-Cache': 'miss',
      ...cors(origin)
    }
  });
  // Store without blocking the response.
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
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

    // "extensions" sometimes carries baggage notes; absent means unknown, and
    // unknown must never read as "no bag".
    const ext = (g.extensions || []).join(' ').toLowerCase();
    const carryOn = /carry-on included|carry on included/.test(ext) ? 1 : null;
    const checked = /(\d+)\s*(?:free\s*)?checked bag/.exec(ext);

    return {
      id: 'sa-' + i,
      price: g.price,
      currency: 'USD',
      carriers: carriers.length ? carriers : ['Unknown airline'],
      carrierCodes: codes,
      bags: { cabin: carryOn, checked: checked ? Number(checked[1]) : null },
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
