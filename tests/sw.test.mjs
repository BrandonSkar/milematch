/* Service worker tests. Run with:  npm run test:sw
 *
 * sw.js sits between every visitor and every file the app is made of, and it
 * has now caused two bugs that looked like "the change was never deployed":
 * a new script missing from the precache list, and a cache-first strategy that
 * needed two reloads before anything appeared. Neither showed up in any test,
 * because there were none.
 *
 * It is a plain script that talks to `self`, `caches`, `fetch` and `location`,
 * so it is loaded into a vm context with those stubbed — no browser, no
 * service worker registration, no build step.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'sw.js'), 'utf8');

/** A Response stand-in: enough of one for sw.js, and inspectable. */
class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status === undefined ? 200 : init.status;
    this.headers = new Map(Object.entries(init.headers || {}));
  }
  clone() { return new FakeResponse(this.body, { status: this.status }); }
}

/**
 * Load sw.js with a controllable world around it.
 *
 * Timers are queued rather than scheduled, so the network-timeout path can be
 * triggered on demand instead of by waiting three and a half real seconds.
 */
function loadSW({ network, cached = {}, failToAdd = null }) {
  const store = new Map(Object.entries(cached));
  const timers = [];
  const handlers = {};

  const added = [];
  const caches = {
    async open() {
      return {
        put: async (req, res) => { store.set(String(req.url || req), res); },
        add: async (asset) => {
          added.push(asset);
          // One missing file must not abort the whole install.
          if (failToAdd && String(asset).includes(failToAdd)) throw new Error("404");
          store.set(String(asset), new FakeResponse("precached"));
        }
      };
    },
    async match(req) { return store.get(String(req.url || req)); },
    async keys() { return ['milematch-old']; },
    async delete() { return true; }
  };

  const ctx = {
    console, Promise, Error, JSON, Object, Map, String, Number, Boolean, Array, Math, Date,
    URL, Response: FakeResponse,
    setTimeout: (fn) => { const t = { fn, cancelled: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
    fetch: (req) => network(req),
    caches,
    location: { origin: 'https://brandonskar.github.io' },
    self: {
      addEventListener: (name, fn) => { handlers[name] = fn; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'sw.js' });

  return {
    handlers,
    store,
    added,
    /** Fire every pending timer — the network-timeout fallback. */
    fireTimers() { timers.filter((t) => !t.cancelled).forEach((t) => t.fn()); timers.length = 0; },
    /** Run the fetch handler and hand back whatever it responded with. */
    async handle(url, method = 'GET', afterDispatch) {
      let responded = null;
      const event = {
        request: { url, method },
        respondWith(p) { responded = p; }
      };
      handlers.fetch(event);
      if (afterDispatch) afterDispatch();
      return responded ? responded : null;
    }
  };
}

const PAGE = 'https://brandonskar.github.io/milematch/js/app.js';

/* ── The two-reload bug ────────────────────────────────────────
 *
 * The whole reason this file exists. */

test('a change shows on the FIRST load, not the one after it', async () => {
  const sw = loadSW({
    network: async () => new FakeResponse('version 2'),
    cached: { [PAGE]: new FakeResponse('version 1') }
  });

  const res = await sw.handle(PAGE);
  assert.strictEqual(res.body, 'version 2',
    'serving the cached copy and fetching the new one for next time is what made people reload twice');
});

test('and the fresh copy is what gets cached', async () => {
  const sw = loadSW({
    network: async () => new FakeResponse('version 2'),
    cached: { [PAGE]: new FakeResponse('version 1') }
  });

  await sw.handle(PAGE);
  // The cache write is not awaited by the handler, so let it settle.
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(sw.store.get(PAGE).body, 'version 2');
});

test('a failed response is not cached over a good one', async () => {
  const sw = loadSW({
    network: async () => new FakeResponse('go away', { status: 500 }),
    cached: { [PAGE]: new FakeResponse('version 1') }
  });

  await sw.handle(PAGE);
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(sw.store.get(PAGE).body, 'version 1',
    'a 500 must not evict the copy that works offline');
});

/* ── Still an offline app ──────────────────────────────────────── */

test('offline falls back to the cached copy', async () => {
  const sw = loadSW({
    network: async () => { throw new Error('offline'); },
    cached: { [PAGE]: new FakeResponse('version 1') }
  });

  const res = await sw.handle(PAGE);
  assert.strictEqual(res.body, 'version 1');
});

test('a network that never answers falls back rather than hanging', async () => {
  const sw = loadSW({
    network: () => new Promise(() => {}),   // never settles, like a dying connection
    cached: { [PAGE]: new FakeResponse('version 1') }
  });

  const res = await sw.handle(PAGE, 'GET', () => sw.fireTimers());
  assert.strictEqual(res.body, 'version 1',
    'a dead network rejects; a dying one does not, which is what the timeout is for');
});

test('offline and never cached says so instead of failing silently', async () => {
  const sw = loadSW({ network: async () => { throw new Error('offline'); } });

  const res = await sw.handle(PAGE);
  assert.strictEqual(res.status, 503);
  assert.match(res.body, /Offline/i);
});

/* ── What must never be cached ─────────────────────────────────── */

test('fare lookups are never served from cache', async () => {
  let calls = 0;
  const sw = loadSW({
    network: async () => { calls++; return new FakeResponse('{"offers":[]}'); },
    cached: { 'https://w.dev/search?origin=SEA': new FakeResponse('stale prices') }
  });

  const res = await sw.handle('https://w.dev/search?origin=SEA');
  assert.strictEqual(res.body, '{"offers":[]}', 'a stale price is worse than no price');
  assert.strictEqual(calls, 1);
});

test('a fare lookup while offline reports it, in the shape the app parses', async () => {
  const sw = loadSW({ network: async () => { throw new Error('offline'); } });
  const res = await sw.handle('https://w.dev/search?origin=SEA');
  assert.strictEqual(res.status, 503);
  assert.deepStrictEqual(JSON.parse(res.body), { error: 'offline' });
});

test('a non-GET request is left entirely alone', async () => {
  const sw = loadSW({ network: async () => new FakeResponse('nope') });
  const res = await sw.handle(PAGE, 'POST');
  assert.strictEqual(res, null, 'not answering lets the browser do what it would have done');
});

test('another origin is left to the browser', async () => {
  const sw = loadSW({ network: async () => new FakeResponse('elsewhere') });
  const res = await sw.handle('https://fonts.example.com/x.woff2');
  assert.strictEqual(res, null);
});

/* ── Precache ──────────────────────────────────────────────────── */

test('installing precaches every asset, and one bad file does not abort it', async () => {
  const sw = loadSW({
    network: async () => new FakeResponse('x'),
    failToAdd: 'icon-512'
  });

  let waited = null;
  sw.handlers.install({ waitUntil: (p) => { waited = p; } });
  assert.ok(waited, 'install has to hold the worker open while it precaches');
  await waited;

  assert.ok(sw.added.includes('./index.html'), 'the shell');
  assert.ok(sw.added.includes('./js/app.js'), 'and every script it loads');
  assert.ok(sw.added.length > 10, 'the whole list was attempted');
  assert.ok(sw.store.has('./js/app.js'),
    'a single 404 must not take the rest of the precache down with it');
});

/* The build number in the footer is how "am I looking at the new version?"
 * gets answered without opening devtools — so it has to actually track the
 * cache it is meant to describe. */
test('the footer build number matches the service worker cache', () => {
  const cfg = readFileSync(join(ROOT, 'data', 'config.js'), 'utf8');
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');

  const build = /PB\.BUILD\s*=\s*(\d+)/.exec(cfg);
  const cache = /const CACHE = 'milematch-v(\d+)'/.exec(sw);

  assert.ok(build, 'data/config.js must declare PB.BUILD');
  assert.ok(cache, "sw.js must declare a versioned CACHE");
  assert.strictEqual(build[1], cache[1],
    'bump both together, or the page will claim a version it is not serving');
});
