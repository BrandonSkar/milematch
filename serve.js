/* Minimal static server for local testing — no dependencies.
 *
 * You can open index.html directly from disk, but service workers and the
 * install prompt only activate over http(s). Run this to test those:
 *
 *   node serve.js          -> http://localhost:8080
 *   node serve.js 3000     -> http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 8080;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);

  /* Refuse anything that escapes the project directory.
   *
   * The comparison has to include the separator. A bare prefix test says a
   * sibling directory is inside this one whenever its name merely starts the
   * same way — "…/Points Booking Agent-old" passes a startsWith check against
   * "…/Points Booking Agent" and is then served happily. */
  const resolved = path.resolve(file);
  const root = path.resolve(ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(file, (err, stat) => {
    if (err || stat.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + url);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      // Always revalidate, so editing a data file and reloading actually shows it.
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => {
  console.log(`MileMatch running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
