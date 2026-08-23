/* MileMatch fare proxy — Cloudflare Worker (free tier: 100k requests/day).
 *
 * Why this exists: a static GitHub Pages site cannot call Amadeus directly.
 * The browser blocks it on CORS, and an API key shipped in front-end JavaScript
 * is a public API key. This worker holds the credentials server-side and
 * returns only the fare data.
 *
 * Endpoints:
 *   GET /health   -> { ok, credentials, host }
 *   GET /search   -> Amadeus Flight Offers Search, passed through
 *
 * Secrets (set with `npx wrangler secret put NAME`):
 *   AMADEUS_CLIENT_ID
 *   AMADEUS_CLIENT_SECRET
 *
 * Vars (set in wrangler.toml):
 *   AMADEUS_HOST     test.api.amadeus.com | api.amadeus.com
 *   ALLOWED_ORIGIN   your Pages origin, or * while developing
 */

let tokenCache = { value: null, expiresAt: 0 };

/* Best-effort per-IP rate limiting.
 *
 * This lives in isolate memory, so it resets when Cloudflare recycles the
 * isolate and is not shared across colos. It will not stop a determined,
 * distributed abuser — it exists to cap a runaway script or someone hammering
 * the endpoint from one machine, which is the realistic failure mode when the
 * URL is baked into a public page. Anything stronger needs KV or Durable
 * Objects, which is more machinery than this deserves. */
const RATE = { windowMs: 60_000, maxPerWindow: 40 };
const hits = new Map();

function rateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  recent.push(now);
  hits.set(ip, recent);

  // Keep the map from growing without bound across a long-lived isolate.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (!times.length || now - times[times.length - 1] > RATE.windowMs) hits.delete(key);
    }
  }
  return recent.length > RATE.maxPerWindow;
}

/* CORS response headers are advisory — a browser honours them, curl does not.
 * So when an allowlist is configured we also REJECT mismatched origins here,
 * server-side. That still cannot make a public endpoint private; it stops
 * other websites embedding this worker and spending the Amadeus quota. */
function originAllowed(request, env) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  if (allowed === '*') return true;
  const origin = request.headers.get('Origin');
  if (!origin) return false;               // non-browser caller
  return allowed.split(',').map((s) => s.trim()).includes(origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const configured = env.ALLOWED_ORIGIN || '*';
    // Echo back the caller's origin when it's on the allowlist.
    const reqOrigin = request.headers.get('Origin');
    const origin = configured === '*' ? '*'
      : (originAllowed(request, env) ? reqOrigin : configured.split(',')[0].trim());

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (url.pathname === '/health') {
      return json({
        ok: true,
        credentials: Boolean(env.AMADEUS_CLIENT_ID && env.AMADEUS_CLIENT_SECRET),
        host: env.AMADEUS_HOST || 'test.api.amadeus.com',
        originLocked: configured !== '*'
      }, 200, origin);
    }

    if (url.pathname === '/search') {
      if (!originAllowed(request, env)) {
        return json({ error: 'This fare lookup only serves its own site.' }, 403, origin);
      }
      if (rateLimited(request.headers.get('CF-Connecting-IP'))) {
        return json({
          error: 'Too many searches in a short period. Wait a minute and try again.'
        }, 429, origin);
      }
      try {
        return await handleSearch(url, env, origin);
      } catch (err) {
        return json({ error: err.message }, 502, origin);
      }
    }

    return json({ error: 'Not found. Try /health or /search.' }, 404, origin);
  }
};

async function handleSearch(url, env, origin) {
  if (!env.AMADEUS_CLIENT_ID || !env.AMADEUS_CLIENT_SECRET) {
    throw new Error('Amadeus credentials are not set on this worker. Run: npx wrangler secret put AMADEUS_CLIENT_ID');
  }

  const p = url.searchParams;
  const required = ['origin', 'destination', 'departureDate'];
  for (const key of required) {
    if (!p.get(key)) throw new Error(`Missing required parameter: ${key}`);
  }

  const host = env.AMADEUS_HOST || 'test.api.amadeus.com';
  const token = await getToken(env, host);

  const q = new URLSearchParams({
    originLocationCode: p.get('origin'),
    destinationLocationCode: p.get('destination'),
    departureDate: p.get('departureDate'),
    adults: p.get('adults') || '1',
    currencyCode: p.get('currencyCode') || 'USD',
    max: p.get('max') || '20'
  });
  if (p.get('returnDate')) q.set('returnDate', p.get('returnDate'));
  if (p.get('travelClass')) q.set('travelClass', p.get('travelClass'));
  if (p.get('nonStop') === 'true') q.set('nonStop', 'true');
  // Amadeus rejects both filters together, so only ever forward one.
  if (p.get('includedAirlineCodes')) {
    q.set('includedAirlineCodes', p.get('includedAirlineCodes'));
  } else if (p.get('excludedAirlineCodes')) {
    q.set('excludedAirlineCodes', p.get('excludedAirlineCodes'));
  }

  const res = await fetch(`https://${host}/v2/shopping/flight-offers?${q}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const body = await res.text();
  if (!res.ok) {
    // Amadeus returns useful structured errors — pass them through verbatim.
    throw new Error(`Amadeus ${res.status}: ${body.slice(0, 400)}`);
  }

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...cors(origin) }
  });
}

async function getToken(env, host) {
  // Tokens last ~30 minutes; reuse within the isolate and refresh a minute early.
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  const res = await fetch(`https://${host}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.AMADEUS_CLIENT_ID,
      client_secret: env.AMADEUS_CLIENT_SECRET
    })
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Amadeus auth failed: ${data.error_description || data.error || res.status}`);
  }

  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in - 60)) * 1000
  };
  return tokenCache.value;
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
