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
      /* An airport box now feeds a chip list, and every one of these tests
       * means "the route IS this". Clear that side first, or codes from an
       * earlier test pile up and quietly turn a single search into a
       * multi-airport one, complete with a confirm dialog. */
      if (sel === '#fromInput' || sel === '#toInput') {
        const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
        document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
      }
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
    from: [...document.querySelectorAll('#fromChips .apt-chip')].map(c => c.firstChild.textContent).join(),
    to: [...document.querySelectorAll('#toChips .apt-chip')].map(c => c.firstChild.textContent).join(),
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

/* ── Picking airports ──────────────────────────────────────────
 *
 * Both sides take several codes. The box you type into is not the value — it
 * is only how a chip gets added — so these read the chips, not the input.
 *
 * The old select-on-focus and replace-on-next-key tests are gone with the
 * single-value field they guarded: the box empties after every chip, so there
 * is never a full field to retype over. */

const chipsOn = (side) => evaluate(
  `[...document.querySelectorAll('#${side}Chips .apt-chip')].map(c => c.firstChild.textContent)`);

const clearSides = () => evaluate(`(() => {
  document.querySelectorAll('.apt-chip button').forEach(b => b.click());
  ['#fromInput', '#toInput'].forEach(s => {
    const e = document.querySelector(s);
    e.value = '';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
})()`);

test('a completed code becomes a chip on its own', maybe, async () => {
  await clearSides();
  await evaluate(`document.querySelector('#fromInput').focus()`);
  await typeText('sea');

  const state = await evaluate(`({
    chips: [...document.querySelectorAll('#fromChips .apt-chip')].map(c => c.firstChild.textContent),
    box: document.querySelector('#fromInput').value,
    hint: document.querySelector('#fromHint').textContent
  })`);

  assert.deepStrictEqual(state.chips, ['SEA'], 'three characters is a whole IATA code');
  assert.strictEqual(state.box, '', 'and the box clears, ready for the next one');
  assert.match(state.hint, /1 airport selected/);
});

test('several airports can be picked on one side', maybe, async () => {
  await clearSides();
  await evaluate(`document.querySelector('#fromInput').focus()`);
  await typeText('sea');
  await typeText('pdx');
  await typeText('geg');
  assert.deepStrictEqual(await chipsOn('from'), ['SEA', 'PDX', 'GEG']);
});

test('the same airport twice is ignored rather than duplicated', maybe, async () => {
  await clearSides();
  await evaluate(`document.querySelector('#fromInput').focus()`);
  await typeText('sea');
  await typeText('sea');
  assert.deepStrictEqual(await chipsOn('from'), ['SEA'],
    'a duplicate would be searched twice for the same answer');
});

test('a chip is removed by its own button', maybe, async () => {
  await clearSides();
  await evaluate(`document.querySelector('#fromInput').focus()`);
  await typeText('sea');
  await typeText('pdx');
  await evaluate(`document.querySelectorAll('#fromChips .apt-chip button')[0].click()`);
  assert.deepStrictEqual(await chipsOn('from'), ['PDX']);
});

test('backspace in an empty box pulls the last chip back to edit', maybe, async () => {
  await clearSides();
  await evaluate(`document.querySelector('#fromInput').focus()`);
  await typeText('sea');
  await typeText('pdx');

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });

  const state = await evaluate(`({
    chips: [...document.querySelectorAll('#fromChips .apt-chip')].map(c => c.firstChild.textContent),
    box: document.querySelector('#fromInput').value.toUpperCase()
  })`);
  assert.deepStrictEqual(state.chips, ['SEA'], 'the chip comes off');
  assert.strictEqual(state.box, 'PDX', 'and lands back in the box, not the bin');
});

test('an unknown code waits for Enter instead of being taken silently', maybe, async () => {
  await clearSides();
  await evaluate(`document.querySelector('#fromInput').focus()`);
  await typeText('zzz');

  let state = await evaluate(`({
    chips: [...document.querySelectorAll('#fromChips .apt-chip')].map(c => c.firstChild.textContent),
    box: document.querySelector('#fromInput').value.toUpperCase(),
    hint: document.querySelector('#fromHint').textContent
  })`);
  assert.deepStrictEqual(state.chips, [], 'nothing is committed on its own');
  assert.strictEqual(state.box, 'ZZZ', 'so the typo is still there to fix');
  assert.match(state.hint, /Not in the airport list/);
});

test('the swap button exchanges whole selections, not just the boxes', maybe, async () => {
  await clearSides();
  await evaluate(`document.querySelector('#fromInput').focus()`);
  await typeText('sea');
  await typeText('pdx');
  await evaluate(`document.querySelector('#toInput').focus()`);
  await typeText('sna');
  await evaluate(`document.querySelector('#swapBtn').click()`);

  assert.deepStrictEqual(await chipsOn('from'), ['SNA']);
  assert.deepStrictEqual(await chipsOn('to'), ['SEA', 'PDX'],
    'swapping one code and dropping the rest was the bug worth guarding');
});

test('what a multi-airport search will cost is stated before it is spent', maybe, async () => {
  await clearSides();
  await evaluate(`(() => {
    const live = [...document.querySelectorAll('input[name=fareSource]')].find(r => r.value === 'live');
    live.checked = true;
    live.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#fromInput').focus();
  })()`);
  await typeText('sea');
  await typeText('pdx');
  await evaluate(`document.querySelector('#toInput').focus()`);
  await typeText('lhr');
  await typeText('cdg');

  const note = await evaluate(`({
    hidden: document.querySelector('#comboCost').hidden,
    text: document.querySelector('#comboCost').textContent
  })`);
  assert.strictEqual(note.hidden, false);
  assert.match(note.text, /4 airport pairs/, 'two origins against two destinations');
  assert.match(note.text, /4 lookups/, 'and it says what that costs, before spending it');
});

/* The other regression: the Google Flights href only refreshed when the
 * airport fields changed, so date edits never reached it. */
test('the Google Flights link tracks every field that feeds it', maybe, async () => {
  const dates = await evaluate(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      /* An airport box now feeds a chip list, and every one of these tests
       * means "the route IS this". Clear that side first, or codes from an
       * earlier test pile up and quietly turn a single search into a
       * multi-airport one, complete with a confirm dialog. */
      if (sel === '#fromInput' || sel === '#toInput') {
        const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
        document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
      }
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
      /* An airport box now feeds a chip list, and every one of these tests
       * means "the route IS this". Clear that side first, or codes from an
       * earlier test pile up and quietly turn a single search into a
       * multi-airport one, complete with a confirm dialog. */
      if (sel === '#fromInput' || sel === '#toInput') {
        const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
        document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
      }
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
      /* An airport box now feeds a chip list, and every one of these tests
       * means "the route IS this". Clear that side first, or codes from an
       * earlier test pile up and quietly turn a single search into a
       * multi-airport one, complete with a confirm dialog. */
      if (sel === '#fromInput' || sel === '#toInput') {
        const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
        document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
      }
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

/* Simulated card bonuses are blended into the balances the engine uses, so a
 * result can claim "you can book this" on points the user does not own. */
test('results built on simulated card bonuses say so loudly', maybe, async () => {
  const r = await evaluate(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      /* An airport box now feeds a chip list, and every one of these tests
       * means "the route IS this". Clear that side first, or codes from an
       * earlier test pile up and quietly turn a single search into a
       * multi-airport one, complete with a confirm dialog. */
      if (sel === '#fromInput' || sel === '#toInput') {
        const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
        document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
      }
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('input[name=fareSource][value=manual]').click();
    // A small real balance, then a large simulated bonus on top.
    // Clear every balance, currencies AND airline programs, so the real
    // total is known rather than inherited from an earlier test.
    document.querySelectorAll('.balance-row input').forEach(el => {
      if (el.value) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    set('#bal-UR', 5000);
    const card = [...document.querySelectorAll('#cardList .cc')]
      .find(l => l.querySelector('.cc-bonus').textContent.includes('+'));
    if (!card.classList.contains('is-on')) card.querySelector('input').click();

    set('#fromInput','SEA'); set('#toInput','JFK'); set('#cabinInput','y'); set('#cashInput', 400);
    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable:true, bubbles:true }));

    const w = document.querySelector('.sim-warning');
    return { shown: !!w, text: w ? w.textContent.replace(/\\s+/g,' ') : '' };
  })()`);

  assert.ok(r.shown, 'a warning must appear when results lean on simulated points');
  assert.match(r.text, /points you don't have yet/i);
  assert.match(r.text, /You actually hold 5,000/, 'should state the real balance');
});

test('one click drops the simulated cards and re-prices on real points', maybe, async () => {
  const r = await evaluate(`(() => {
    document.querySelector('#dropSimCards').click();
    return {
      warningGone: !document.querySelector('.sim-warning'),
      ticked: document.querySelectorAll('#cardList .cc.is-on').length,
      chip: document.querySelector('#balanceChip').textContent,
      real: [...document.querySelectorAll('.balance-row input')].filter(i=>i.value).map(i=>i.id+'='+i.value).join(','),
      sim: document.querySelectorAll('#cardList .cc.is-on').length
    };
  })()`);

  assert.ok(r.warningGone, 'the warning should clear once simulation is off');
  assert.strictEqual(r.ticked, 0, 'no cards should remain modelled');
  assert.match(r.chip, /^5,000 pts/, 'the balance chip should fall back to real points');
});

test('each result names the airlines its program can actually book', maybe, async () => {
  const labels = await evaluate(`
    [...document.querySelectorAll('#results .result-program')].slice(0,6).map(e => e.textContent)
  `);
  assert.ok(labels.some((l) => /books /i.test(l)), 'programs should say what they ticket');
});

/* An unbundled fare is not the price it advertises. These pin the part of the
 * UI that says so, because a missing bag fee is a number the whole points-vs-
 * cash comparison is measured against. */

/** Paste two fares: one with a free bag, one that charges for everything. */
async function pasteBaggedFares() {
  return evaluate(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      /* An airport box now feeds a chip list, and every one of these tests
       * means "the route IS this". Clear that side first, or codes from an
       * earlier test pile up and quietly turn a single search into a
       * multi-airport one, complete with a confirm dialog. */
      if (sel === '#fromInput' || sel === '#toInput') {
        const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
        document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
      }
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    ['#nonStopInput','#carryOnInput','#checkedBagInput'].forEach(s => {
      const el = document.querySelector(s);
      if (el.checked) { el.checked = false; el.dispatchEvent(new Event('change',{bubbles:true})); }
    });
    document.querySelectorAll('#airlineChips .chip-toggle.is-on').forEach(b => b.click());

    document.querySelector('input[name=fareSource][value=paste]').click();
    set('#fromInput', 'SEA'); set('#toInput', 'JFK'); set('#cabinInput', 'y');
    set('#pasteInput', [
      'Alaska', '8 hr 20 min', 'Nonstop', '1 free checked bag', '$298', 'round trip',
      'Frontier', '9 hr 10 min', '1 stop', 'Carry-on bag not included',
      '1st checked bag: $45', '$188', 'round trip'
    ].join(String.fromCharCode(10)));

    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return document.querySelectorAll('#offers .offer').length;
  })()`);
}

test('a fare that charges for bags says so on the row', maybe, async () => {
  assert.strictEqual(await pasteBaggedFares(), 2, 'both fares should be listed');

  const rows = await evaluate(`
    [...document.querySelectorAll('#offers .offer')].map(o => ({
      airline: o.querySelector('.offer-carrier').textContent,
      tags: [...o.querySelectorAll('.offer-tag')].map(t => t.textContent),
      fees: [...o.querySelectorAll('.offer-tag.fee')].map(t => t.textContent)
    }))
  `);

  const frontier = rows.find((r) => r.airline.includes('Frontier'));
  const alaska = rows.find((r) => r.airline.includes('Alaska'));

  assert.deepStrictEqual(frontier.fees, ['carry-on costs extra', 'checked bag +$45'],
    'the charges must be on the row, with the amount when it is known');
  assert.ok(alaska.tags.includes('free checked bag'), 'and what IS included, alongside nonstop');
  assert.strictEqual(alaska.fees.length, 0, 'a fare with a free bag has nothing to warn about');
});

test('the picked flight itemises what the price does and does not buy', maybe, async () => {
  const detail = await evaluate(`(() => {
    // Pick the fare that charges, so there is something to itemise.
    const row = [...document.querySelectorAll('#offers .offer')]
      .find(o => o.querySelector('.offer-carrier').textContent.includes('Frontier'));
    row.click();
    const sel = document.querySelector('.offer.is-selected');
    return {
      lines: [...sel.querySelectorAll('.fare-line')].map(l => l.textContent.replace(/\\s+/g,' ')),
      note: (sel.querySelector('.fare-note.warn') || {}).textContent || '',
      quoted: [...sel.querySelectorAll('.fare-src')].map(s => s.textContent)
    };
  })()`);

  assert.ok(detail.lines.some((l) => /Fare, taxes.*\$188/.test(l)), 'the fare itself is a line item');
  assert.ok(detail.lines.some((l) => /Carry-on bag.*costs extra/.test(l)));
  assert.ok(detail.lines.some((l) => /Checked bag.*\+\$45/.test(l)));
  assert.match(detail.note, /not.{0,3} in the price above/i, 'it must be clear these are on top');
  assert.ok(detail.quoted.some((q) => q.includes('1st checked bag: $45')),
    "the airline's own wording should be quoted, not just paraphrased");
});

test('a fare that never mentions bags says that, rather than implying free', maybe, async () => {
  const lines = await evaluate(`(() => {
    const row = [...document.querySelectorAll('#offers .offer')]
      .find(o => o.querySelector('.offer-carrier').textContent.includes('Alaska'));
    row.click();
    const sel = document.querySelector('.offer.is-selected');
    return [...sel.querySelectorAll('.fare-line')].map(l => l.textContent.replace(/\\s+/g,' '));
  })()`);

  assert.ok(lines.some((l) => /Checked bag.*included/.test(l)), 'the free bag is stated');
  assert.ok(lines.some((l) => /Carry-on bag.*not stated/.test(l)),
    'and the carry-on nobody mentioned is neither promised nor denied');
});

/* Repeating a badge on every row is noise: if you filtered for it, you know. */
test('a filtered-for perk stops being announced on every row', maybe, async () => {
  const r = await evaluate(`(() => {
    const cb = document.querySelector('#checkedBagInput');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    const tags = [...document.querySelectorAll('#offers .offer-tag')].map(t => t.textContent);
    return { rows: document.querySelectorAll('#offers .offer').length, tags };
  })()`);

  assert.strictEqual(r.rows, 1, 'the fare known to charge for a bag is filtered out');
  assert.ok(!r.tags.includes('free checked bag'), 'and the badge is redundant once filtered for');
  assert.ok(r.tags.includes('nonstop'), 'badges not covered by a filter still show');

  await evaluate(`(() => {
    const cb = document.querySelector('#checkedBagInput');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
});

/* Return flights need a provider that can price them against an outbound.
 * Pasted text cannot, and the panel must not pretend otherwise. */
test('pasted fares offer no return picker', maybe, async () => {
  const panels = await evaluate(`document.querySelectorAll('#offers .returns').length`);
  assert.strictEqual(panels, 0);
});

/* The ways home, with the provider stubbed out — the point is the wiring, and
 * a real lookup would spend a share of the monthly fare allowance. */
async function liveRoundTripSearch() {
  await evaluate(`(() => {
    const leg = (from, to, depart, arrive, name, number) =>
      ({ from, to, depart, arrive, carrierName: name, number });

    PB.flights.hasProxy = () => true;
    PB.flights.searchLive = () => Promise.resolve([{
      id: 'sa-0', price: 620, currency: 'USD',
      carriers: ['Alaska'], carrierCodes: ['AS'], stops: 0,
      bags: { cabin: 1, checked: 0, cabinFee: null, checkedFee: 35 },
      extensions: ['Carry-on included', '1st checked bag: $35'],
      durationText: '5h 20m', departureToken: 'tok-1',
      itineraries: [{ segments: [leg('SEA','JFK','2026-11-15 07:00','2026-11-15 15:20','Alaska','AS 12')] }]
    }]);
    PB.flights.searchReturns = (q, s, token) => Promise.resolve(token !== 'tok-1' ? [] : [
      { id: 'r0', price: 620, carriers: ['Alaska'], carrierCodes: ['AS'], stops: 0,
        bags: { cabin: 1, checked: 0 }, durationText: '6h 05m',
        itineraries: [{ segments: [leg('JFK','SEA','2026-11-22 06:00','2026-11-22 09:05','Alaska','AS 21')] }] },
      { id: 'r1', price: 705, carriers: ['Alaska'], carrierCodes: ['AS'], stops: 0,
        bags: { cabin: 1, checked: 0 }, durationText: '6h 10m',
        itineraries: [{ segments: [leg('JFK','SEA','2026-11-22 17:30','2026-11-22 20:40','Alaska','AS 45')] }] }
    ]);

    const set = (sel, v) => {
      const el = document.querySelector(sel);
      /* An airport box now feeds a chip list, and every one of these tests
       * means "the route IS this". Clear that side first, or codes from an
       * earlier test pile up and quietly turn a single search into a
       * multi-airport one, complete with a confirm dialog. */
      if (sel === '#fromInput' || sel === '#toInput') {
        const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
        document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
      }
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const rt = document.querySelector('#roundTripInput');
    if (!rt.checked) { rt.checked = true; rt.dispatchEvent(new Event('change', { bubbles: true })); }
    set('#fromInput', 'SEA'); set('#toInput', 'JFK'); set('#cabinInput', 'y');
    set('#dateInput', '2026-11-15'); set('#returnInput', '2026-11-22');
    document.querySelector('input[name=fareSource][value=live]').click();
    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  })()`);
  await sleep(300);
}

test('a round-trip fare says the cheapest return is baked into its price', maybe, async () => {
  await liveRoundTripSearch();

  const panel = await evaluate(`(() => {
    const p = document.querySelector('#offers .returns');
    return p ? { text: p.textContent.replace(/\\s+/g,' '), hasBtn: !!p.querySelector('.returns-btn') } : null;
  })()`);

  assert.ok(panel, 'the picked outbound should offer its returns');
  assert.match(panel.text, /cheapest/i, 'the headline price is not just "the price"');
  assert.ok(panel.hasBtn, 'and fetching the alternatives is a deliberate act, not automatic');
});

test('the return flights list what each way home costs on top', maybe, async () => {
  await evaluate(`document.querySelector('#offers .returns .returns-btn').click()`);
  await sleep(300);

  const opts = await evaluate(`
    [...document.querySelectorAll('#offers .return-opt')].map(o => ({
      when: o.querySelector('.return-when').textContent.replace(/\\s+/g,' '),
      who: o.querySelector('.return-who').textContent.replace(/\\s+/g,' '),
      cost: o.querySelector('.return-cost').textContent.replace(/\\s+/g,' ')
    }))
  `);

  assert.strictEqual(opts.length, 2);
  assert.match(opts[0].when, /6:00 AM.*9:05 AM/, 'a return is chosen by its times');
  assert.match(opts[0].who, /already in the price/i, 'the cheapest is the one already assumed');
  assert.match(opts[1].cost, /\$705/, 'each option is priced as a trip total');
  assert.match(opts[1].cost, /\+\$85/, 'and against the total already quoted');
});

test('picking a return re-prices the whole trip, points included', maybe, async () => {
  const before = await evaluate(`document.querySelector('#jumpToPoints').textContent`);
  assert.match(before, /\$620/);

  const after = await evaluate(`(() => {
    document.querySelectorAll('#offers .return-opt')[1].click();
    return {
      jump: document.querySelector('#jumpToPoints').textContent,
      price: document.querySelector('.offer.is-selected .offer-price').textContent,
      delta: (document.querySelector('.offer.is-selected .offer-delta') || {}).textContent || '',
      picked: document.querySelectorAll('#offers .return-opt.is-picked').length,
      cash: [...document.querySelectorAll('.trip-summary dd')].map(d => d.textContent)
    };
  })()`);

  assert.strictEqual(after.picked, 1, 'the chosen return is marked');
  assert.match(after.price, /\$705/, 'the row shows what the trip now costs');
  assert.match(after.delta, /\+\$85/, 'and is honest about where the increase came from');
  assert.match(after.jump, /\$705/, 'the jump to the points comparison follows it');
  assert.ok(after.cash.includes('$705'),
    'the points comparison is measured against the new total, not the old one');
});

test('what the fare covers survives into the round-trip view', maybe, async () => {
  const lines = await evaluate(`
    [...document.querySelectorAll('.offer.is-selected .fare-line')].map(l => l.textContent.replace(/\\s+/g,' '))
  `);
  assert.ok(lines.some((l) => /Fare, taxes.*\$705/.test(l)), 'itemised against the trip total');
  assert.ok(lines.some((l) => /Carry-on bag.*included/.test(l)));
  assert.ok(lines.some((l) => /Checked bag.*\+\$35/.test(l)), 'the bag fee is still on show');
});
/* An old worker answers every search without a departure token. The panel
 * would just never appear, leaving nothing on screen to explain why. */
test('an out-of-date fare worker says so instead of hiding the returns', maybe, async () => {
  await evaluate(`(() => {
    const prev = PB.flights.searchLive;
    PB.flights.searchLive = () => prev().then(offers =>
      offers.map(o => Object.assign({}, o, { departureToken: undefined })));
    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  })()`);
  await sleep(300);

  const panel = await evaluate(`(() => {
    const p = document.querySelector('#offers .returns');
    return p ? p.textContent.replace(/\\s+/g,' ') : null;
  })()`);

  assert.ok(panel, 'the panel must still render, or there is nowhere to say anything');
  assert.match(panel, /newer fare worker/i);
  assert.match(panel, /deploy/i, 'and it should say what to do about it');
});

/* Times are the first thing anyone scans a flight list for. They used to be
 * hidden until you expanded a row, which made the list unscannable. */
test('every row shows when it leaves and lands, without being opened', maybe, async () => {
  await evaluate(`(() => {
    const leg = (from, to, depart, arrive, name, number) =>
      ({ from, to, depart, arrive, carrierName: name, number });
    PB.flights.hasProxy = () => true;
    PB.flights.searchLive = () => Promise.resolve([
      { id: 'sa-0', price: 300, currency: 'USD', carriers: ['Alaska'], carrierCodes: ['AS'],
        stops: 0, bags: {}, durationText: '2h 55m',
        itineraries: [{ segments: [leg('SEA','SNA','2026-11-15 07:18','2026-11-15 10:13','Alaska','AS 699')] }] },
      // A red-eye that lands the NEXT day, via a connection.
      { id: 'sa-1', price: 460, currency: 'USD', carriers: ['American'], carrierCodes: ['AA'],
        stops: 1, bags: {}, durationText: '6h 41m',
        itineraries: [{ segments: [
          leg('ONT','PHX','2026-11-15 19:35','2026-11-15 20:59','American','AA 2459'),
          leg('PHX','MCO','2026-11-15 22:15','2026-11-16 05:16','American','AA 1187')] }] }
    ]);
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      /* An airport box now feeds a chip list, and every one of these tests
       * means "the route IS this". Clear that side first, or codes from an
       * earlier test pile up and quietly turn a single search into a
       * multi-airport one, complete with a confirm dialog. */
      if (sel === '#fromInput' || sel === '#toInput') {
        const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
        document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
      }
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#fromInput', 'SEA'); set('#toInput', 'SNA'); set('#cabinInput', 'y');
    set('#dateInput', '2026-11-15');
    document.querySelector('input[name=fareSource][value=live]').click();
    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  })()`);
  await sleep(300);

  const rows = await evaluate(`
    [...document.querySelectorAll('#offers .offer')].map(o => ({
      when: (o.querySelector('.offer-when') || {}).textContent || '',
      airline: (o.querySelector('.offer-airline') || {}).textContent || '',
      over: (o.querySelector('.offer-when sup') || {}).textContent || '',
      meta: o.querySelector('.offer-meta').textContent.replace(/\\s+/g,' '),
      badge: (o.querySelector('.stop-badge') || {}).textContent || null,
      collapsed: !o.classList.contains('is-selected')
    }))
  `);

  assert.strictEqual(rows.length, 2);
  assert.match(rows[0].when, /SEA\s*7:18 AM.*SNA\s*10:13 AM/,
    'both airports and both times belong on the row itself');
  assert.match(rows[0].airline, /Alaska/, 'with the airline leading it');
  assert.strictEqual(rows[0].over, '', 'a same-day flight says nothing about days');

  const redeye = rows[1];
  assert.ok(redeye.collapsed, 'and on rows nobody has opened');
  assert.match(redeye.when, /ONT\s*7:35 PM.*MCO\s*5:16 AM/,
    'origin and final destination, not the connection');
  assert.strictEqual(redeye.over, '+1', 'landing tomorrow has to be stated, not implied');
  assert.match(redeye.meta, /via PHX/, 'and a connection should still name itself');
  assert.strictEqual(redeye.badge, '1 stop', 'with the count on the badge beside the price');
});

/* The row already says the airports and times, so a nonstop's single leg was
 * repeating it verbatim. A connection is a different matter. */
test('expanding a nonstop does not reprint the row above it', maybe, async () => {
  const detail = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('#offers .offer')];
    rows[0].click();
    const sel = document.querySelector('.offer.is-selected');
    return {
      legs: sel.querySelectorAll('.leg').length,
      only: (sel.querySelector('.leg-only') || {}).textContent || ''
    };
  })()`);
  assert.strictEqual(detail.legs, 0, 'no per-leg line for a single-leg flight');
  assert.match(detail.only, /AS 699/, 'only the flight number the row cannot carry');

  const connecting = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('#offers .offer')];
    rows[rows.length - 1].click();
    const sel = document.querySelector('.offer.is-selected');
    return {
      legs: sel.querySelectorAll('.leg').length,
      stop: (sel.querySelector('.leg-stop') || {}).textContent || ''
    };
  })()`);
  assert.strictEqual(connecting.legs, 2, 'each hop of a connection is still shown');
  assert.match(connecting.stop, /connection in PHX/);
});

/* "Fewest points" and "least cash" pull in opposite directions, and the best
 * value is often neither. Ranking by one of them alone decided that trade for
 * the user and never showed the alternative. */
const readRanked = () => evaluate(`
  [...document.querySelectorAll('#results > .result')].map(r => ({
    program: r.querySelector('.result-program').textContent,
    points: parseInt(r.querySelector('.result-cost').textContent.replace(/[^0-9]/g, ''), 10),
    cash: parseInt((r.querySelector('.result-tax').textContent.match(/[0-9,]+/) || ['0'])[0]
            .replace(/,/g, ''), 10),
    cpp: parseFloat(r.querySelector('.result-cpp').textContent) || 0
  }))
`);

const ascending = (xs) => xs.every((v, i) => i === 0 || xs[i - 1] <= v);
const descending = (xs) => xs.every((v, i) => i === 0 || xs[i - 1] >= v);

test('the redemption list sorts by points, by cash, and by value', maybe, async () => {
  await evaluate(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      /* An airport box now feeds a chip list, and every one of these tests
       * means "the route IS this". Clear that side first, or codes from an
       * earlier test pile up and quietly turn a single search into a
       * multi-airport one, complete with a confirm dialog. */
      if (sel === '#fromInput' || sel === '#toInput') {
        const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
        document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
      }
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelectorAll('.balance-row input').forEach(el => {
      if (el.value) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    set('#bal-MR', 400000);
    document.querySelector('input[name=fareSource][value=manual]').click();
    set('#fromInput', 'SEA'); set('#toInput', 'JFK'); set('#cabinInput', 'j');
    set('#cashInput', 1800);
    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  })()`);

  const buttons = await evaluate(`
    [...document.querySelectorAll('#results .sort-btn')].map(b => b.dataset.sort)
  `);
  assert.deepStrictEqual([...buttons], ['value', 'points', 'cash']);

  const byValue = await readRanked();
  assert.ok(byValue.length > 3, 'need several options to tell an order from an accident');
  assert.ok(descending(byValue.map((r) => r.cpp)), 'the default ranks best value first');

  const clickSort = (k) =>
    evaluate(`document.querySelector('#results .sort-btn[data-sort=${k}]').click()`);

  await clickSort('points');
  const byPoints = await readRanked();
  assert.ok(ascending(byPoints.map((r) => r.points)), 'fewest points first');

  await clickSort('cash');
  const byCash = await readRanked();
  assert.ok(ascending(byCash.map((r) => r.cash)), 'least cash out of pocket first');

  // Same options throughout - a sort is a view, not a different question.
  assert.strictEqual(byPoints.length, byValue.length);
  assert.deepStrictEqual(
    [...byCash.map((r) => r.program)].sort(),
    [...byValue.map((r) => r.program)].sort());

  await clickSort('value');
  const back = await readRanked();
  assert.deepStrictEqual([...back.map((r) => r.program)], [...byValue.map((r) => r.program)],
    'and it is reversible');
});

/* ── Stops, and sorting by them ────────────────────────────────
 *
 * Nonstop is what most people are actually hunting for, and it used to be a
 * phrase buried in a metadata line. It is now a badge beside the price, which
 * is the number it trades against. */

const twoFares = () => evaluate(`(() => {
  const set = (sel, v) => {
    const el = document.querySelector(sel);
    if (sel === '#fromInput' || sel === '#toInput') {
      const side = sel === '#fromInput' ? '#fromChips' : '#toChips';
      document.querySelectorAll(side + ' .apt-chip button').forEach(b => b.click());
    }
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  ['#nonStopInput','#carryOnInput','#checkedBagInput'].forEach(s => {
    const el = document.querySelector(s);
    if (el.checked) { el.checked = false; el.dispatchEvent(new Event('change',{bubbles:true})); }
  });
  document.querySelector('input[name=fareSource][value=paste]').click();
  set('#fromInput', 'SEA'); set('#toInput', 'JFK'); set('#cabinInput', 'y');
  // The nonstop is the DEARER of the two on purpose: sorting by stops has to
  // reorder against price, not merely agree with it.
  set('#pasteInput', [
    'Alaska', '8 hr 20 min', 'Nonstop', '$298', 'round trip',
    'Delta', '9 hr 10 min', '1 stop', '$264', 'round trip'
  ].join(String.fromCharCode(10)));
  document.querySelector('#searchForm')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
})()`);

const offerRows = () => evaluate(`[...document.querySelectorAll('#offers .offer')].map(o => ({
  airline: o.querySelector('.offer-airline').textContent,
  badge: o.querySelector('.stop-badge') ? o.querySelector('.stop-badge').textContent : null,
  direct: !!o.querySelector('.stop-badge.direct'),
  price: o.querySelector('.offer-price').textContent,
  delta: o.querySelector('.offer-delta') ? o.querySelector('.offer-delta').textContent : ''
}))`);

test('a nonstop is badged next to its price, not buried in the metadata', maybe, async () => {
  await twoFares();
  const rows = await offerRows();

  const alaska = rows.find((r) => r.airline.includes('Alaska'));
  const delta = rows.find((r) => r.airline.includes('Delta'));

  assert.strictEqual(alaska.badge, 'Direct');
  assert.ok(alaska.direct, 'and it is the one badge that gets a colour');
  assert.strictEqual(delta.badge, '1 stop');
  assert.ok(!delta.direct);
});

test('sorting by direct first beats price', maybe, async () => {
  await twoFares();

  let rows = await offerRows();
  assert.match(rows[0].airline, /Delta/, 'cheapest first by default, stops aside');

  await evaluate(`document.querySelector('[data-offer-sort=stops]').click()`);
  rows = await offerRows();

  assert.match(rows[0].airline, /Alaska/, 'the nonstop rises even though it costs more');
  assert.ok(rows[0].direct);
});

test('the price gap still measures against the cheapest fare, not the top row', maybe, async () => {
  await twoFares();
  await evaluate(`document.querySelector('[data-offer-sort=stops]').click()`);
  const rows = await offerRows();

  /* Alaska is $298 and Delta $264. Sorting by stops puts Alaska first, but
   * "+$34" has to keep meaning "more than the cheapest that came back" — if it
   * silently re-based on whatever now sits at the top, it would read +$0. */
  const alaska = rows.find((r) => r.airline.includes('Alaska'));
  assert.match(alaska.delta, /\+\$34/);
});

test('the sort bar stays hidden when there is nothing to sort', maybe, async () => {
  await evaluate(`(() => {
    const el = document.querySelector('#pasteInput');
    el.value = ['Alaska', '8 hr 20 min', 'Nonstop', '$298', 'round trip'].join(String.fromCharCode(10));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#searchForm')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  })()`);

  const bar = await evaluate(`document.querySelector('#offersSort').innerHTML`);
  assert.strictEqual(bar, '', 'one flight has no order to argue about');
});
