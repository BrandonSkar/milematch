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

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-test-'));
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

/* Everything the user types must survive leaving and coming back — that is the
 * whole point of the balances tab. */
test('balances, cards and search settings persist across a reload', maybe, async () => {
  await evaluate(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#bal-UR', 84000);
    set('#bal-AS', 12250);
    document.querySelector('#ccName').value = 'Persist Test Card';
    document.querySelector('#ccBonus').value = '40000';
    document.querySelector('#customCardForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    set('#fromInput', 'SEA'); set('#toInput', 'LHR');
  })()`);

  await send('Page.reload');
  await sleep(2000);

  const after = await evaluate(`({
    ur: document.querySelector('#bal-UR').value,
    as: document.querySelector('#bal-AS').value,
    from: document.querySelector('#fromInput').value.toUpperCase(),
    to: document.querySelector('#toInput').value.toUpperCase(),
    customCard: [...document.querySelectorAll('#cardList .cc-name')]
      .some(n => n.textContent === 'Persist Test Card'),
    keys: Object.keys(localStorage)
  })`);

  assert.strictEqual(after.ur, '84000');
  assert.strictEqual(after.as, '12250');
  assert.strictEqual(after.from, 'SEA');
  assert.strictEqual(after.to, 'LHR');
  assert.ok(after.customCard, 'a custom card must survive');
  assert.deepStrictEqual([...after.keys], ['pb.state.v1'], 'one tidy storage key');
});

/* The iOS notice exists because Safari wipes localStorage after 7 days away.
 * It must not nag desktop users, where that does not happen. */
test('the iOS install notice stays hidden on desktop', maybe, async () => {
  const hidden = await evaluate(`document.querySelector('#iosInstallNotice').hidden`);
  assert.strictEqual(hidden, true);
});

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
    // Default fare source is now "paste"; this test drives the typed-price path.
    document.querySelector('input[name=fareSource][value=manual]').click();
    set('#bal-C1', 30000);
    set('#fromInput', 'SEA'); set('#toInput', 'SNA');
    set('#cabinInput', 'y'); set('#cashInput', 389);
    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    const first = document.querySelector('#results .result');
    return {
      count: document.querySelectorAll('#results .result').length,
      firstProgram: first ? first.querySelector('.result-program').textContent.trim() : null,
      firstAffordable: first ? !first.classList.contains('is-locked') : false,
      firstIsOpen: first ? first.hasAttribute('open') : false,
      headline: !!document.querySelector('.headline'),
      headlineProgram: (document.querySelector('.headline-program') || {}).textContent,
      lockedGroup: !!document.querySelector('.locked-group'),
      banner: !!document.querySelector('.availability-warning')
    };
  })()`);

  assert.ok(result.count > 10, 'should price every program');
  assert.ok(result.firstAffordable, 'top result should be one you can actually book');
  assert.deepStrictEqual(pageErrors, [], 'no exceptions during a full search');
});

/* The results page used to show five metrics, four badges, a transfer plan,
 * alternate sources, provenance and three links on every one of 22 rows. */
test('results lead with one plain answer and fold the rest away', maybe, async () => {
  const r = await evaluate(`(() => {
    const first = document.querySelector('#results .result');
    const collapsed = [...document.querySelectorAll('#results .result')]
      .filter(el => !el.hasAttribute('open')).length;
    return {
      headline: (document.querySelector('.headline-program') || {}).textContent || null,
      headlineCost: (document.querySelector('.headline-cost') || {}).textContent || null,
      topRowOpen: first ? first.hasAttribute('open') : false,
      collapsedRows: collapsed,
      lockedGrouped: !!document.querySelector('.locked-group')
    };
  })()`);

  assert.ok(r.headline, 'a single headline answer should be shown');
  assert.match(r.headlineCost || '', /pts/);
  assert.ok(r.topRowOpen, 'the best option should start expanded');
  assert.ok(r.collapsedRows > 3, 'the rest should start collapsed, not all expanded');
});

test('pasting flight results produces pickable offers and prices them', maybe, async () => {
  const r = await evaluate(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // Reset filters left on by earlier tests.
    ['#nonStopInput','#carryOnInput','#checkedBagInput'].forEach(s => {
      const el = document.querySelector(s);
      if (el.checked) { el.checked = false; el.dispatchEvent(new Event('change',{bubbles:true})); }
    });
    document.querySelectorAll('#airlineChips .chip-toggle.is-on').forEach(b => b.click());

    document.querySelector('input[name=fareSource][value=paste]').click();
    set('#bal-C1', 200000);
    set('#fromInput', 'SEA'); set('#toInput', 'JFK'); set('#cabinInput', 'y');
    set('#pasteInput', [
      'Alaska', '8 hr 20 min', 'Nonstop', '$298', 'round trip',
      'Delta', '9 hr 10 min', '1 stop', '$264', 'round trip'
    ].join(String.fromCharCode(10)));

    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    return {
      status: document.querySelector('#pasteStatus').textContent,
      offersShown: document.querySelectorAll('#offers .offer').length,
      offersVisible: !document.querySelector('#offersWrap').hidden,
      results: document.querySelectorAll('#results .result').length,
      headline: !!document.querySelector('.headline')
    };
  })()`);

  assert.match(r.status, /Found 2 fares/);
  assert.strictEqual(r.offersShown, 2, 'both pasted fares should be selectable');
  assert.ok(r.offersVisible);
  assert.ok(r.results > 10, 'the cheapest pasted fare should be priced across programs');
  assert.ok(r.headline);
});

/* The points comparison sits below up to a dozen flight rows. Telling someone
 * it is "below" was not enough — there needs to be a way to get there. */
test('a jump control links the picked flight to its points comparison', maybe, async () => {
  const r = await evaluate(`(() => {
    const jump = document.querySelector('#jumpToPoints');
    return { hidden: jump.hidden, label: jump.textContent.trim() };
  })()`);
  assert.strictEqual(r.hidden, false, 'should appear once flights are listed');
  assert.match(r.label, /costs in points/i);
  assert.match(r.label, /\$\d/, 'should name the fare it applies to');

  const landed = await evaluate(`(() => {
    document.querySelector('#jumpToPoints').click();
    return !!document.querySelector('.headline.flash');
  })()`);
  assert.ok(landed, 'clicking should highlight the points headline');
});

test('the selected flight states it is the one being priced', maybe, async () => {
  const text = await evaluate(`
    (document.querySelector('.offer.is-selected .offer-chosen') || {}).textContent || ''
  `);
  assert.match(text, /using this flight/i);
});

test('nonstop filter narrows pasted offers', maybe, async () => {
  const r = await evaluate(`(() => {
    const cb = document.querySelector('#nonStopInput');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      offersShown: document.querySelectorAll('#offers .offer').length,
      note: document.querySelector('#filtersNote').textContent
    };
  })()`);

  assert.strictEqual(r.offersShown, 1, 'only the nonstop fare should remain');
  assert.match(r.note, /Filtering by/i);
  assert.doesNotMatch(r.note, /need a list of flights/i);
});

test('filters are marked inactive when there is no flight list to filter', maybe, async () => {
  const note = await evaluate(`(() => {
    const cb = document.querySelector('#nonStopInput');
    if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change',{bubbles:true})); }
    document.querySelector('input[name=fareSource][value=manual]').click();
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    return document.querySelector('#filtersNote').textContent;
  })()`);
  // Typing a single price gives nothing to filter, so the note must say so.
  assert.match(note, /need a list of flights/i);
  assert.match(note, /Paste results/i, 'should point at the mode that does work');
});
