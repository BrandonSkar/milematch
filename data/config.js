/* Site-wide configuration.
 *
 * Set `sharedProxyUrl` once here and everyone who opens the site gets live
 * fares automatically — no Settings step, nothing to paste. Commit it and it
 * is permanent.
 *
 * !! READ THIS BEFORE YOU FILL IT IN !!
 *
 * 1. EVERY visitor shares YOUR Amadeus quota. The free tier is a monthly call
 *    allowance. Friends searching burns it; when it runs out, live search
 *    stops working for everyone until the month rolls over. The app falls back
 *    to manual price entry, so nothing breaks — it just goes quiet.
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

PB.CONFIG = {
  /* e.g. 'https://milematch.yourname.workers.dev' */
  sharedProxyUrl: '',

  /* Shown next to the Settings field so people know a shared worker is in use
   * and whose quota they are spending. */
  sharedProxyNote: 'Shared fare lookup provided by the site owner.'
};
