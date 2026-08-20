/* Browser interaction tests. Run with:  npm run test:browser
 *
 * The engine tests in engine.test.js cover the maths, but they can't catch DOM
 * bugs — an input handler that eats your keystrokes, a link that goes stale.
 * This drives real Chrome over the DevTools Protocol against a real server.
 *
 * Skips itself if Chrome isn't installed, so it never blocks a checkout.
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const PORT = 9200 + Math.floor(Math.random() * 300);
const HTTP_PORT = 8100 + Math.floor(Math.random() * 300);
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server, chrome, ws, sessionId, msgId = 0;
const pending = new Map();
const pageErrors = [];

function send(method, params = {}, sid = sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}

async function typeText(text) {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch });
    await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(60);
  }
}

async function pressKey(key, code) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await sleep(60);
}

/* Focus a field the way a person does: click it, which should select whatever
 * is already there. */
async function clickField(selector) {
  const box = await evaluate(`(() => {
    const r = document.querySelector('${selector}').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1
    });
  }
  await sleep(120);
}

test.before(async () => {
  if (!CHROME) return;

  server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(HTTP_PORT)], {
    cwd: ROOT, stdio: 'ignore'
  });
  await sleep(700);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'awc-test-'));
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
      break;
    } catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Chrome did not expose a debugging port');

  ws = new WebSocket(wsUrl);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };
  await new Promise((r) => { ws.onopen = r; });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
  const attached = await send('Target.attachToTarget', { targetId, flatten: true }, undefined);
  sessionId = attached.sessionId;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/index.html` });
  await sleep(2200);
});

test.after(() => {
  try { ws && ws.close(); } catch {}
  try { chrome && chrome.kill(); } catch {}
  try { server && server.kill(); } catch {}
});

const maybe = { skip: !CHROME ? 'Chrome not installed' : false };

test('app boots with no uncaught exceptions', maybe, async () => {
  const booted = await evaluate(`!!(window.PB && Object.keys(PB.airports).length > 200)`);
  assert.ok(booted, 'PB and airport data should be loaded');
  assert.deepStrictEqual(pageErrors, []);
});

test('typing into an empty airport field works', maybe, async () => {
  await evaluate(`(() => { const e = document.querySelector('#fromInput'); e.value=''; e.focus(); })()`);
  await typeText('sea');
  const state = await evaluate(`({
    value: document.querySelector('#fromInput').value.toUpperCase(),
    hint: document.querySelector('#fromHint').textContent
  })`);
  assert.strictEqual(state.value, 'SEA');
  assert.match(state.hint, /Seattle/);
});

/* The regression: a field already holding a code used to swallow every
 * keystroke, because the input handler truncated back to 3 characters.
 * This is the state the app restores you into on every visit. */
test('a field that already holds a code can be retyped after clicking it', maybe, async () => {
  await evaluate(`(() => {
    const e = document.querySelector('#fromInput');
    e.value = 'SEA';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.blur();
  })()`);

  await clickField('#fromInput');   // click should select the existing code
  await typeText('sfo');

  const value = await evaluate(`document.querySelector('#fromInput').value.toUpperCase()`);
  assert.strictEqual(value, 'SFO', 'typing over an existing code must replace it');
});

/* And the harder case: the field is already focused with the caret parked at
 * the end, so there is no click or focus event left to trigger a selection. */
test('a full, already-focused field still accepts new input', maybe, async () => {
  await evaluate(`(() => {
    const e = document.querySelector('#toInput');
    e.value = 'SNA';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.focus();
    e.setSelectionRange(3, 3);   // caret at the end, nothing selected
  })()`);

  await typeText('lax');

  const value = await evaluate(`document.querySelector('#toInput').value.toUpperCase()`);
  assert.strictEqual(value, 'LAX', 'a full field must not silently eat keystrokes');
});

test('clicking a populated field selects its contents', maybe, async () => {
  await evaluate(`(() => {
    const e = document.querySelector('#toInput');
    e.value = 'NRT';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.blur();
  })()`);
  await clickField('#toInput');
  const sel = await evaluate(`({
    start: document.querySelector('#toInput').selectionStart,
    end: document.querySelector('#toInput').selectionEnd
  })`);
  assert.strictEqual(sel.start, 0);
  assert.strictEqual(sel.end, 3);
});

test('backspace still clears a field character by character', maybe, async () => {
  await evaluate(`(() => {
    const e = document.querySelector('#fromInput');
    e.value = 'SEA';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.focus();
    e.setSelectionRange(3, 3);
  })()`);
  await pressKey('Backspace', 8);
  assert.strictEqual(await evaluate(`document.querySelector('#fromInput').value.toUpperCase()`), 'SE');
  await pressKey('Backspace', 8);
  assert.strictEqual(await evaluate(`document.querySelector('#fromInput').value.toUpperCase()`), 'S');
});

test('maxlength keeps codes to three characters', maybe, async () => {
  await evaluate(`(() => { const e = document.querySelector('#fromInput'); e.value=''; e.focus(); })()`);
  await typeText('seattle');
  const value = await evaluate(`document.querySelector('#fromInput').value`);
  assert.strictEqual(value.length, 3);
});

test('the swap button exchanges origin and destination', maybe, async () => {
  await evaluate(`(() => {
    const f = document.querySelector('#fromInput'), t = document.querySelector('#toInput');
    f.value = 'SEA'; f.dispatchEvent(new Event('input', { bubbles: true }));
    t.value = 'SNA'; t.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#swapBtn').click();
  })()`);
  const state = await evaluate(`({
    from: document.querySelector('#fromInput').value.toUpperCase(),
    to: document.querySelector('#toInput').value.toUpperCase()
  })`);
  assert.strictEqual(state.from, 'SNA');
  assert.strictEqual(state.to, 'SEA');
});

/* The other regression: the Google Flights href only refreshed when the
 * airport fields changed, so date edits never reached it. */
test('the Google Flights link tracks every field that feeds it', maybe, async () => {
  const dates = await evaluate(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const datesIn = () => {
      const m = /[?&]tfs=([^&]+)/.exec(document.querySelector('#gfLink').href);
      if (!m) return null;
      const raw = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
      return (raw.match(/\\d{4}-\\d{2}-\\d{2}/g) || []).join(',');
    };
    const out = {};
    set('#fromInput', 'SEA'); set('#toInput', 'SNA');
    out.noDate = datesIn();
    set('#dateInput', '2026-11-15');
    out.afterDepart = datesIn();
    set('#dateInput', '2026-12-24');
    out.afterChangingDepart = datesIn();
    const rt = document.querySelector('#roundTripInput');
    rt.checked = true; rt.dispatchEvent(new Event('change', { bubbles: true }));
    set('#returnInput', '2027-01-04');
    out.roundTrip = datesIn();
    rt.checked = false; rt.dispatchEvent(new Event('change', { bubbles: true }));
    out.backToOneWay = datesIn();
    return out;
  })()`);

  assert.strictEqual(dates.noDate, null, 'no date yet -> natural-language fallback');
  assert.strictEqual(dates.afterDepart, '2026-11-15');
  assert.strictEqual(dates.afterChangingDepart, '2026-12-24', 'changing the date must update the link');
  assert.strictEqual(dates.roundTrip, '2026-12-24,2027-01-04');
  assert.strictEqual(dates.backToOneWay, '2026-12-24', 'stale return date must be dropped');
});

test('a full search renders ranked results', maybe, async () => {
  const result = await evaluate(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#bal-C1', 30000);
    set('#fromInput', 'SEA'); set('#toInput', 'SNA');
    set('#cabinInput', 'y'); set('#cashInput', 389);
    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    const first = document.querySelector('#results .option');
    return {
      count: document.querySelectorAll('#results .option').length,
      firstProgram: first ? first.querySelector('.option-name').textContent.trim() : null,
      firstAffordable: first ? !first.classList.contains('is-unaffordable') : false
    };
  })()`);

  assert.ok(result.count > 10, 'should price every program');
  assert.ok(result.firstAffordable, 'top result should be one you can actually book');
  assert.deepStrictEqual(pageErrors, [], 'no exceptions during a full search');
});
