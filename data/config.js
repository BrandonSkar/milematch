/* Site-wide configuration.
 *
 * Set `sharedProxyUrl` once here and everyone who opens the site gets real
 * Google Flights results automatically — no Settings step, nothing to paste,
 * nothing to type. Commit it and it is permanent. See worker/README.md to
 * deploy the worker that goes here.
 *
 * !! READ THIS BEFORE YOU FILL IT IN !!
 *
 * 1. EVERY visitor shares YOUR SerpApi allowance — 250 searches a month on the
 *    free tier. Friends searching burns it; when it runs out, live search stops
 *    for everyone until the month rolls over. Nothing breaks — the app falls
 *    back to pasting or typing a price. The worker caches identical searches
 *    for CACHE_HOURS so repeats of the same route and date cost nothing.
 *
 * 2. This URL becomes PUBLIC. It ships in the JavaScript of a public site and
 *    sits in a public repo. Anyone who views source can call it.
 *
 * 3. CORS is not a lock. `ALLOWED_ORIGIN` in wrangler.toml only governs what
 *    BROWSERS on other websites may do — a browser enforces it, a server does
 *    not. Anyone with curl can ignore it entirely. That is why the worker also
 *    checks the Origin header itself and rate-limits per IP. Those make casual
 *    abuse annoying; they cannot make a public endpoint private.
 *
 * Leave it empty to keep the per-person Settings field as the only way in.
 */
window.PB = window.PB || {};

/* Bumped with every deploy, and with CACHE in sw.js - a test fails if they
 * drift apart. It is printed in the footer so "am I on the new version?"
 * can be answered by looking at the page rather than by guessing at the
 * service worker. */
PB.BUILD = 37;

PB.CONFIG = {
  /* e.g. 'https://milematch.yourname.workers.dev' */
  sharedProxyUrl: 'https://milematch.branskar01.workers.dev',

  /* Shown next to the Settings field so people know a shared worker is in use
   * and whose quota they are spending. */
  sharedProxyNote: 'Shared fare lookup provided by the site owner.'
};
