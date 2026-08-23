/* Engine tests. Run with:  node --test tests/
 *
 * The app files are plain browser scripts that attach to `window`, so we load
 * them into a vm context with `window` aliased to the sandbox itself.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPB() {
  const root = path.join(__dirname, '..');
  const ctx = {
    console, Math, Date, JSON, Object, Array, String, Number, Boolean,
    parseFloat, parseInt, isNaN, btoa, atob, URLSearchParams, fetch
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/config.js', 'data/airports.js', 'data/programs.js', 'data/charts.js',
   'data/cards.js', 'js/engine.js', 'js/flights.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  ctx.PB.loadAirports();
  return ctx.PB;
}

const PB = loadPB();

/* ── Geography ─────────────────────────────────────────────── */

test('airports load with regions and coordinates', () => {
  assert.ok(Object.keys(PB.airports).length > 200, 'expected a few hundred airports');
  assert.strictEqual(PB.airports.SFO.region, 'NA');
  assert.strictEqual(PB.airports.NRT.region, 'NEA');
  assert.strictEqual(PB.airports.LHR.city, 'London');
});

test('great-circle distances are accurate to within 1%', () => {
  const check = (a, b, expected) => {
    const d = PB.distance(PB.airports[a], PB.airports[b]);
    const drift = Math.abs(d - expected) / expected;
    assert.ok(drift < 0.01, `${a}-${b} was ${d}, expected ~${expected}`);
  };
  check('SFO', 'NRT', 5130);
  check('LAX', 'JFK', 2475);
  check('JFK', 'LHR', 3450);
  check('LHR', 'SIN', 6750);
});

/* ── Chart lookups ─────────────────────────────────────────── */

/* Aeroplan prices by zone pair FIRST, then distance within it. Modelling it as
 * one global distance table produced -33% to +40% errors. These pin the real
 * published values so that regression cannot come back. */
test('Aeroplan uses zone pair then distance, matching the published chart', () => {
  const cases = [
    ['SEA', 'ORD', 'y', 12500], ['SEA', 'ORD', 'j', 25000],  // NA-NA 1,501-2,750 (1,716 mi)
    ['JFK', 'LAX', 'y', 12500], ['JFK', 'LAX', 'j', 25000],  // NA-NA 1,501-2,750 (2,470 mi)
    ['HNL', 'JFK', 'y', 22500], ['HNL', 'JFK', 'j', 35000],  // NA-NA 2,751+     (4,975 mi)
    ['JFK', 'LHR', 'y', 32500], ['JFK', 'LHR', 'j', 60000],  // NA-EU 0-4,000    (3,443 mi)
    ['SFO', 'FRA', 'y', 42500], ['SFO', 'FRA', 'j', 75000]   // NA-EU 4,001-6,000 (5,685 mi)
  ];
  cases.forEach(([a, b, cabin, expected]) => {
    const from = PB.airports[a], to = PB.airports[b];
    const p = PB.priceAward('AC', {
      from, to, distance: PB.distance(from, to),
      cabin, roundTrip: false, passengers: 1
    });
    assert.strictEqual(p.miles, expected, `${a}-${b} ${cabin}`);
    assert.strictEqual(p.confidence, 'chart');
    assert.ok(p.chartVerified, 'Aeroplan chart should be marked verified');
  });
});

test('a domestic hop is not priced with a transatlantic band', () => {
  // The old global-distance model charged 35,000 for SEA-ORD business by
  // reaching into a long-haul band. Zone-aware pricing must not.
  const p = PB.priceAward('AC', {
    from: PB.airports.SEA, to: PB.airports.ORD,
    distance: 1716, cabin: 'j', roundTrip: false, passengers: 1
  });
  assert.ok(p.miles < 30000, `domestic business should be well under 30k, got ${p.miles}`);
});

test('Avios aliases resolve to the shared BA band table', () => {
  const ctx = { from: PB.airports.JFK, to: PB.airports.LHR, distance: 3450, cabin: 'y', roundTrip: false, passengers: 1 };
  assert.strictEqual(PB.priceAward('IB', ctx).miles, PB.priceAward('BA', ctx).miles);
  assert.strictEqual(PB.priceAward('QR', ctx).miles, PB.priceAward('BA', ctx).miles);
});

test('region charts match in either direction', () => {
  const there = PB.priceAward('AV', {
    from: PB.airports.SFO, to: PB.airports.FRA, distance: 5700, cabin: 'j', roundTrip: false, passengers: 1
  });
  const back = PB.priceAward('AV', {
    from: PB.airports.FRA, to: PB.airports.SFO, distance: 5700, cabin: 'j', roundTrip: false, passengers: 1
  });
  assert.strictEqual(there.miles, 63000);
  assert.strictEqual(back.miles, 63000);
});

test('round trips double a one-way chart price', () => {
  const base = { from: PB.airports.SFO, to: PB.airports.FRA, distance: 5700, cabin: 'j', passengers: 1 };
  const ow = PB.priceAward('AV', { ...base, roundTrip: false });
  const rt = PB.priceAward('AV', { ...base, roundTrip: true });
  assert.strictEqual(rt.miles, ow.miles * 2);
});

test('ANA round-trip-only chart is NOT doubled again', () => {
  const base = { from: PB.airports.SFO, to: PB.airports.NRT, distance: 5130, cabin: 'j', passengers: 1 };
  const ow = PB.priceAward('NH', { ...base, roundTrip: false });
  const rt = PB.priceAward('NH', { ...base, roundTrip: true });
  // 110,000 is the current verified partner rate. The 85,000 figure still
  // quoted all over the internet is the pre-devaluation chart.
  assert.strictEqual(rt.miles, 110000);
  assert.strictEqual(ow.miles, 110000, 'ANA partner awards are round trip either way');
  assert.ok(rt.roundTripChart);
  assert.ok(rt.chartVerified);
});

test('passenger count scales the mileage', () => {
  const base = { from: PB.airports.SFO, to: PB.airports.FRA, distance: 5700, cabin: 'j', roundTrip: false };
  const one = PB.priceAward('AV', { ...base, passengers: 1 });
  const two = PB.priceAward('AV', { ...base, passengers: 2 });
  assert.strictEqual(two.miles, one.miles * 2);
  assert.strictEqual(two.milesPerPerson, one.miles);
});

test('dynamic programs need a cash anchor and derive miles from it', () => {
  const base = { from: PB.airports.SFO, to: PB.airports.JFK, distance: 2580, cabin: 'y', roundTrip: false, passengers: 1 };
  assert.strictEqual(PB.priceAward('UA', base), null, 'no cash price -> no dynamic quote');

  const priced = PB.priceAward('UA', { ...base, cashPrice: 400 });
  // $400 at ~1.35 cents/point
  assert.ok(Math.abs(priced.miles - 400 * 100 / 1.35) < 600, `got ${priced.miles}`);
  assert.strictEqual(priced.confidence, 'dynamic');
});

test('missing region pairs fall back to a flagged rough estimate', () => {
  const p = PB.priceAward('SK', {
    from: PB.airports.GRU, to: PB.airports.NBO, distance: 5900, cabin: 'y', roundTrip: false, passengers: 1
  });
  assert.strictEqual(p.confidence, 'rough');
  assert.ok(p.miles > 0);
  assert.match(p.source, /rough estimate/i);
});

/* ── Surcharges ────────────────────────────────────────────── */

test('surcharge profile drives taxes: LifeMiles beats BA on the same route', () => {
  const av = PB.estimateTaxes('AV', 5700, 'j', 2);   // profile: none
  const ba = PB.estimateTaxes('BA', 5700, 'j', 2);   // profile: high
  assert.ok(av < 60, `LifeMiles taxes should be minimal, got ${av}`);
  assert.ok(ba > 400, `BA business surcharges should be steep, got ${ba}`);
});

test('surcharge model stays calibrated to real-world round trips', () => {
  // Each is a round trip (2 legs) against a figure travellers actually see.
  // Generous ranges — this guards against drift, not exact quotes.
  const cases = [
    ['AV', 5112, 'j', 2, 20, 80,   'LifeMiles charges effectively nothing'],
    ['AC', 5112, 'j', 2, 100, 260, 'Aeroplan SFO-NRT business ~$170'],
    ['NH', 5112, 'j', 2, 240, 480, 'ANA SFO-NRT business ~$350'],
    ['BA', 3450, 'j', 2, 550, 1000, 'BA JFK-LHR business ~$780'],
    ['BA', 3450, 'y', 2, 250, 550, 'BA JFK-LHR economy ~$410']
  ];
  cases.forEach(([prog, dist, cabin, legs, lo, hi, why]) => {
    const t = PB.estimateTaxes(prog, dist, cabin, legs);
    assert.ok(t >= lo && t <= hi, `${prog} ${cabin}: got $${t}, expected $${lo}-$${hi} (${why})`);
  });
});

test('economy never carries a higher surcharge multiplier than business', () => {
  Object.keys(PB.SURCHARGE_MODEL).forEach((profile) => {
    const m = PB.SURCHARGE_MODEL[profile].cabinMultiplier;
    assert.ok(m.y <= m.w && m.w <= m.j && m.j <= m.f, `${profile} multipliers out of order`);
  });
});

/* ── Balances and transfers ────────────────────────────────── */

test('reachable() sums direct miles plus everything transferable in', () => {
  const r = PB.reachable('AC', { AC: 10000, UR: 50000, MR: 30000, TYP: 99999 });
  assert.strictEqual(r.direct, 10000);
  // Citi does not transfer to Aeroplan, so its balance must be excluded.
  assert.strictEqual(r.transferable, 80000);
  assert.strictEqual(r.total, 90000);
  assert.ok(!r.paths.some((p) => p.currency === 'TYP'));
});

test('non-1:1 ratios are applied (Amex -> JetBlue is 1000:800)', () => {
  const r = PB.reachable('B6', { MR: 10000 });
  assert.strictEqual(r.total, 8000);
});

/* ── Transfer partner integrity ────────────────────────────── */

/* These pin the exact partnerships a user reported as wrong. A phantom
 * transfer is the worst failure this app can produce: it sends you to move
 * points irreversibly into a program that cannot receive them. */
test('phantom transfers stay dead', () => {
  const phantom = [
    ['MR', 'SK', 'Amex does not transfer to SAS EuroBonus'],
    ['UR', 'EK', 'Chase has never partnered with Emirates'],
    ['BILT', 'SQ', 'Bilt does not transfer to Singapore'],
    ['BILT', 'QF', 'Bilt does not transfer to Qantas'],
    ['BILT', 'AM', 'Bilt does not transfer to Aeromexico'],
    ['WF', 'AC', 'Wells Fargo does not transfer to Aeroplan'],
    ['WF', 'SQ', 'Wells Fargo does not transfer to Singapore'],
    ['C1', 'VS', 'Capital One does not transfer to Virgin Atlantic'],
    ['C1', 'IB', 'Capital One does not transfer to Iberia'],
    ['TYP', 'AM', 'Citi removed Aeromexico in Jan 2026'],
    ['TYP', 'AC', 'Citi does not transfer to Aeroplan'],
    ['UR', 'AA', 'Chase does not transfer to American']
  ];
  phantom.forEach(([cur, prog, why]) => {
    assert.ok(!PB.TRANSFERS[cur][prog], `${cur} -> ${prog}: ${why}`);
  });
});

test('real partnerships that are easy to doubt are present', () => {
  const real = [
    ['BILT', 'AA', 'Bilt genuinely does reach AAdvantage'],
    ['BILT', 'AS', 'Bilt is the only major currency with Alaska at 1:1'],
    ['BILT', 'UA', 'Bilt reaches United'],
    ['TYP', 'AA', 'Citi ThankYou reaches AAdvantage'],
    ['MR', 'NH', 'Amex is the only US route into ANA'],
    ['WF', 'CX', 'Wells Fargo added Cathay in Apr 2026']
  ];
  real.forEach(([cur, prog, why]) => {
    assert.ok(PB.TRANSFERS[cur][prog], `${cur} -> ${prog} missing: ${why}`);
  });
});

test('SAS is unreachable from every card currency', () => {
  const r = PB.reachable('SK', { UR: 1e6, MR: 1e6, C1: 1e6, TYP: 1e6, BILT: 1e6, WF: 1e6 });
  assert.strictEqual(r.transferable, 0, 'no US currency transfers to EuroBonus');
  assert.strictEqual(r.paths.length, 0);
});

test('every currency carries a verification source', () => {
  Object.keys(PB.TRANSFERS).forEach((cur) => {
    const src = PB.TRANSFER_SOURCES[cur];
    assert.ok(src, `${cur} has no provenance entry`);
    assert.match(src.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(/^https:\/\//.test(src.url));
    // The table can only be a subset of the issuer's real partner list.
    assert.ok(Object.keys(PB.TRANSFERS[cur]).length <= src.count,
      `${cur} lists more partners than the issuer actually has`);
  });
});

test('transferSources reports every route into a program', () => {
  // Aeroplan is reachable from Chase, Amex, Capital One and Bilt.
  const s = PB.transferSources('AC', { MR: 60000 });
  assert.strictEqual(s.total, 4);
  // Spread into host-realm arrays — objects built inside the vm carry that
  // realm's Array prototype, which deepStrictEqual rejects.
  assert.deepStrictEqual([...s.held.map((h) => h.currency)], ['MR']);
  assert.deepStrictEqual([...s.others.map((o) => o.currency)].sort(), ['BILT', 'C1', 'UR']);
});

test('transfer bonuses increase the yield', () => {
  const before = PB.reachable('VS', { MR: 10000 }).total;
  PB.TRANSFER_BONUSES.MR = { VS: 0.30 };
  const after = PB.reachable('VS', { MR: 10000 }).total;
  delete PB.TRANSFER_BONUSES.MR;
  assert.strictEqual(before, 10000);
  assert.strictEqual(after, 13000);
});

test('buildTransferPlan spends direct miles first, then flexible points', () => {
  const plan = PB.buildTransferPlan('AC', 60000, { AC: 20000, UR: 100000 });
  assert.ok(plan.covered);
  assert.strictEqual(plan.steps[0].type, 'direct');
  assert.strictEqual(plan.steps[0].miles, 20000);
  assert.strictEqual(plan.steps[1].type, 'transfer');
  assert.strictEqual(plan.steps[1].spend, 40000);
});

test('buildTransferPlan reports an exact shortfall when you cannot cover it', () => {
  const plan = PB.buildTransferPlan('AC', 60000, { UR: 25000 });
  assert.strictEqual(plan.covered, false);
  assert.strictEqual(plan.shortfall, 35000);
});

test('plan prefers the better effective ratio', () => {
  // Both Chase and Amex reach JetBlue, but Amex loses 20% on the way.
  const plan = PB.buildTransferPlan('B6', 20000, { UR: 50000, MR: 50000 });
  assert.strictEqual(plan.steps[0].currency, 'UR');
});

/* ── Full evaluation ───────────────────────────────────────── */

const TRIP = {
  from: 'SFO', to: 'NRT', cabin: 'j', cashPrice: 4200,
  passengers: 1, roundTrip: true
};

test('evaluate() ranks affordable options ahead of unaffordable ones', () => {
  const r = PB.evaluate({ ...TRIP, balances: { UR: 120000, MR: 40000 } });
  assert.ok(!r.error);
  assert.ok(r.options.length > 5);

  const firstUnaffordable = r.options.findIndex((o) => !o.affordable);
  if (firstUnaffordable !== -1) {
    assert.ok(
      r.options.slice(firstUnaffordable).every((o) => !o.affordable),
      'affordable options must all come before unaffordable ones'
    );
  }
});

test('evaluate() computes cents-per-point net of taxes', () => {
  const r = PB.evaluate({ ...TRIP, balances: { UR: 200000 } });
  const opt = r.options.find((o) => o.programId === 'AV');
  const expected = ((TRIP.cashPrice - opt.taxes) / opt.miles) * 100;
  assert.ok(Math.abs(opt.cpp - expected) < 0.001);
  assert.strictEqual(opt.savings, TRIP.cashPrice - opt.taxes);
});

test('a fare cheaper than the surcharges is marked "do not book"', () => {
  const r = PB.evaluate({
    from: 'JFK', to: 'LHR', cabin: 'j', cashPrice: 200,
    passengers: 1, roundTrip: true, balances: { UR: 300000 }
  });
  const ba = r.options.find((o) => o.programId === 'BA');
  assert.strictEqual(ba.verdict, 'bad', 'BA surcharges exceed a $200 fare');
});

test('empty balances still produce priced options, all unaffordable', () => {
  const r = PB.evaluate({ ...TRIP, balances: {} });
  assert.ok(r.options.length > 0);
  assert.ok(r.options.every((o) => !o.affordable));
  assert.ok(r.options.every((o) => o.shortfall > 0));
});

test('unknown airport codes are reported, not thrown', () => {
  const r = PB.evaluate({ ...TRIP, from: 'ZZZ', balances: {} });
  assert.ok(r.error);
});

test('portal options are offered for every flexible currency', () => {
  const r = PB.evaluate({ ...TRIP, balances: { UR: 400000 } });
  const ur = r.portal.find((p) => p.currency === 'UR');
  assert.strictEqual(ur.miles, Math.round(4200 * 100 / 1.25)); // 336,000
  assert.ok(ur.affordable);
});

/* ── Cards ─────────────────────────────────────────────────── */

test('applyCardBonuses adds a welcome bonus to the right currency', () => {
  const out = PB.applyCardBonuses({ UR: 10000 }, ['csp'], []);
  assert.strictEqual(out.UR, 70000);  // 10k held + 60k bonus
});

test('cardCost totals bonuses, fees, and required spend', () => {
  const c = PB.cardCost(['csp', 'amexgold'], []);
  assert.strictEqual(c.bonus, 120000);
  assert.strictEqual(c.fees, 420);
  assert.strictEqual(c.minSpend, 10000);
});

test('rankCardsForTrip identifies cards that unlock an unaffordable trip', () => {
  const ranked = PB.rankCardsForTrip(TRIP, {}, { customCards: [], exclude: [] });
  assert.ok(!ranked.error);
  assert.strictEqual(ranked.bestBefore, null, 'no balances -> nothing bookable yet');

  const helpers = ranked.rows.filter((r) => r.helps);
  assert.ok(helpers.length > 0, 'some card bonus should unlock SFO-NRT business');
  assert.ok(helpers[0].unlocks);
  assert.ok(helpers[0].netValue > 0);

  // Ranked by value after the annual fee.
  for (let i = 1; i < helpers.length; i++) {
    assert.ok(helpers[i - 1].netValue >= helpers[i].netValue);
  }
});

test('rankCardsForTrip excludes cards already being simulated', () => {
  const ranked = PB.rankCardsForTrip(TRIP, {}, { customCards: [], exclude: ['csp', 'amexplat'] });
  const ids = ranked.rows.map((r) => r.card.id);
  assert.ok(!ids.includes('csp'));
  assert.ok(!ids.includes('amexplat'));
});

/* ── Google Flights deep links ─────────────────────────────── */

/* Decodes the tfs protobuf back out so we assert on what the bytes actually
 * say, not just that a URL was produced. */
function decodeTfs(url) {
  const m = /[?&]tfs=([^&]+)/.exec(url);
  if (!m) return null;
  const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(b64 + '='.repeat((4 - b64.length % 4) % 4), 'base64');

  const read = (b) => {
    const out = [];
    let i = 0;
    const varint = () => {
      let r = 0, shift = 0, byte;
      do { byte = b[i++]; r |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
      return r >>> 0;
    };
    while (i < b.length) {
      const key = varint(), field = key >>> 3, wire = key & 7;
      if (wire === 0) out.push({ field, value: varint() });
      else if (wire === 2) {
        const len = varint(), bytes = b.slice(i, i + len);
        i += len;
        const ascii = bytes.toString('latin1');
        out.push(/^[\x20-\x7e]+$/.test(ascii)
          ? { field, value: ascii }
          : { field, nested: read(bytes) });
      } else throw new Error('unexpected wire type ' + wire);
    }
    return out;
  };

  /* Airport is { type = 1 (varint), code = 2 (string) }. Getting these two
   * the wrong way round still produces a URL that Google accepts — it reads
   * the dates and silently drops the route — so the tests below assert on the
   * field numbers directly, not just on the decoded code. */
  const airport = (msg) => {
    const type = msg.find((p) => p.field === 1);
    const code = msg.find((p) => p.field === 2);
    assert.ok(type && typeof type.value === 'number', 'Airport field 1 must be the varint type');
    assert.ok(code && typeof code.value === 'string', 'Airport field 2 must be the IATA code');
    return code.value;
  };

  const top = read(buf);
  const legs = top.filter((f) => f.field === 3).map((leg) => ({
    date: leg.nested.find((p) => p.field === 2).value,
    from: airport(leg.nested.find((p) => p.field === 13).nested),
    to:   airport(leg.nested.find((p) => p.field === 14).nested)
  }));

  return {
    legs,
    passengers: top.filter((f) => f.field === 8).length,
    seat: (top.find((f) => f.field === 9) || {}).value,
    trip: (top.find((f) => f.field === 19) || {}).value
  };
}

test('deep link carries the exact one-way date, route, and cabin', () => {
  const url = PB.flights.googleFlightsUrl({
    from: 'SEA', to: 'SNA', date: '2026-11-15', returnDate: '2026-12-02',
    roundTrip: false, cabin: 'y', passengers: 1
  });
  const d = decodeTfs(url);
  assert.deepStrictEqual(d.legs, [{ date: '2026-11-15', from: 'SEA', to: 'SNA' }]);
  assert.strictEqual(d.trip, 2, '2 = one way');
  assert.strictEqual(d.seat, 1, '1 = economy');
  assert.strictEqual(d.passengers, 1);
});

test('an unchecked round trip ignores the stale return date', () => {
  // The return field keeps its value when you untick "Round trip"; the link
  // must not smuggle it into the URL.
  const d = decodeTfs(PB.flights.googleFlightsUrl({
    from: 'SEA', to: 'SNA', date: '2026-11-15', returnDate: '2026-12-02',
    roundTrip: false, cabin: 'y', passengers: 1
  }));
  assert.strictEqual(d.legs.length, 1);
});

test('round trips encode both legs, reversed, with both dates', () => {
  const d = decodeTfs(PB.flights.googleFlightsUrl({
    from: 'SFO', to: 'NRT', date: '2026-10-03', returnDate: '2026-10-17',
    roundTrip: true, cabin: 'j', passengers: 2
  }));
  assert.deepStrictEqual(d.legs, [
    { date: '2026-10-03', from: 'SFO', to: 'NRT' },
    { date: '2026-10-17', from: 'NRT', to: 'SFO' }
  ]);
  assert.strictEqual(d.trip, 1, '1 = round trip');
  assert.strictEqual(d.seat, 3, '3 = business');
  assert.strictEqual(d.passengers, 2);
});

test('every cabin maps to its Google seat code', () => {
  const expected = { y: 1, w: 2, j: 3, f: 4 };
  Object.keys(expected).forEach((cabin) => {
    const d = decodeTfs(PB.flights.googleFlightsUrl({
      from: 'JFK', to: 'LHR', date: '2026-09-01', roundTrip: false, cabin, passengers: 1
    }));
    assert.strictEqual(d.seat, expected[cabin], `cabin ${cabin}`);
  });
});

test('a missing date falls back to natural-language search, not a broken link', () => {
  const url = PB.flights.googleFlightsUrl({
    from: 'JFK', to: 'LHR', date: '', roundTrip: false, cabin: 'f', passengers: 1
  });
  assert.ok(url.includes('?q='), 'should fall back');
  assert.ok(!url.includes('tfs='));
  assert.ok(url.includes('JFK') && url.includes('LHR'));
});

test('deep link URLs are safely encoded', () => {
  const url = PB.flights.googleFlightsUrl({
    from: 'SFO', to: 'NRT', date: '2026-10-03', returnDate: '2026-10-17',
    roundTrip: true, cabin: 'j', passengers: 1
  });
  assert.ok(url.startsWith('https://www.google.com/travel/flights?tfs='));
  // base64url only: no +, /, or = that would break the query string.
  const tfs = /tfs=([^&]+)/.exec(url)[1];
  assert.match(tfs, /^[A-Za-z0-9_-]+$/);
});

/* ── Paste parser ──────────────────────────────────────────── */

const GOOGLE_PASTE = `
Best departing flights
7:00 AM – 3:20 PM
Alaska
8 hr 20 min
SEA–JFK
Nonstop
$298
round trip
6:05 AM – 6:15 PM
Delta
9 hr 10 min
SEA–JFK
1 stop
1 hr 5 min SLC
$264
round trip
10:30 PM – 12:45 PM
United
11 hr 15 min
SEA–JFK
1 stop
2 hr 30 min DEN
$241
round trip
5:45 AM – 2:05 PM
JetBlue
8 hr 20 min
SEA–JFK
Nonstop
$312
round trip
`;

test('pasted results parse into sorted offers', () => {
  const offers = PB.flights.parsePastedFares(GOOGLE_PASTE);
  assert.strictEqual(offers.length, 4);
  assert.deepStrictEqual([...offers.map((o) => o.price)], [241, 264, 298, 312]);
});

test('each pasted offer keeps its OWN airline, stops and duration', () => {
  const byPrice = {};
  PB.flights.parsePastedFares(GOOGLE_PASTE).forEach((o) => { byPrice[o.price] = o; });

  assert.deepStrictEqual([...byPrice[298].carriers], ['Alaska']);
  assert.strictEqual(byPrice[298].stops, 0);
  assert.strictEqual(byPrice[298].durationText, '8h 20m');

  assert.deepStrictEqual([...byPrice[241].carriers], ['United']);
  assert.strictEqual(byPrice[241].stops, 1);

  // Regression: JetBlue used to inherit United's "2 hr 30 min" layover as its
  // flight time, because the context window ran past the previous fare.
  assert.strictEqual(byPrice[312].durationText, '8h 20m');
  assert.deepStrictEqual([...byPrice[312].carriers], ['JetBlue']);
  assert.strictEqual(byPrice[312].stops, 0);
});

test('adjacent records do not merge their airlines', () => {
  const offers = PB.flights.parsePastedFares(`
Alaska Airlines
Nonstop  6h 05m
SEA - ORD
$189
American Airlines
1 stop  8h 40m
SEA - ORD
$164
`);
  assert.strictEqual(offers.length, 2);
  const byPrice = {};
  offers.forEach((o) => { byPrice[o.price] = o; });
  assert.deepStrictEqual([...byPrice[189].carriers], ['Alaska']);
  assert.deepStrictEqual([...byPrice[164].carriers], ['American']);
  assert.strictEqual(byPrice[189].stops, 0);
  assert.strictEqual(byPrice[164].stops, 1);
});

test('ancillary charges and junk are not treated as fares', () => {
  const offers = PB.flights.parsePastedFares(`
Call us at $5 for details
Baggage fee $35
Seat upgrade $89
Alaska
Nonstop
6 hr
$418
round trip
`);
  assert.deepStrictEqual([...offers.map((o) => o.price)], [418]);
});

test('text with no prices yields nothing rather than throwing', () => {
  assert.deepStrictEqual([...PB.flights.parsePastedFares('Track prices\nAbout these results')], []);
  assert.deepStrictEqual([...PB.flights.parsePastedFares('')], []);
  assert.deepStrictEqual([...PB.flights.parsePastedFares(null)], []);
});

test('four-figure fares with commas parse correctly', () => {
  const offers = PB.flights.parsePastedFares(`
British Airways
Nonstop
9 hr 15 min
$2,480
round trip
`);
  assert.strictEqual(offers.length, 1);
  assert.strictEqual(offers[0].price, 2480);
});

test('codeshares keep every operating carrier', () => {
  const offers = PB.flights.parsePastedFares(`
Air France, Delta
1 stop
13 hr 5 min
$2,150
`);
  assert.strictEqual(offers[0].carriers.length, 2);
  assert.ok(offers[0].carriers.includes('Air France'));
  assert.ok(offers[0].carriers.includes('Delta'));
});

test('filters apply to pasted offers, and unknowns never fail silently', () => {
  const offers = PB.flights.parsePastedFares(GOOGLE_PASTE);
  const nonstop = PB.flights.applyFilters(offers, { nonStop: true });
  assert.deepStrictEqual([...nonstop.map((o) => o.price)], [298, 312]);

  // Pasted text never reports baggage, so a bag filter must not wipe the list.
  const withBags = PB.flights.applyFilters(offers, { freeCarryOn: true, freeChecked: true });
  assert.strictEqual(withBags.length, offers.length);

  const onlyAlaska = PB.flights.applyFilters(offers, { airlines: ['AS'] });
  assert.deepStrictEqual([...onlyAlaska.map((o) => o.price)], [298]);
});

/* ── Shared vs personal fare proxy ─────────────────────────── */

test('a personal worker URL overrides the shared one', () => {
  const original = PB.CONFIG.sharedProxyUrl;
  PB.CONFIG.sharedProxyUrl = 'https://shared.example.workers.dev';
  try {
    const settings = { proxyUrl: 'https://mine.example.workers.dev' };
    assert.strictEqual(PB.flights.proxyUrl(settings), 'https://mine.example.workers.dev');
    assert.strictEqual(PB.flights.usingSharedProxy(settings), false);
  } finally {
    PB.CONFIG.sharedProxyUrl = original;
  }
});

test('with no personal URL the shared worker is used', () => {
  const original = PB.CONFIG.sharedProxyUrl;
  PB.CONFIG.sharedProxyUrl = 'https://shared.example.workers.dev';
  try {
    assert.strictEqual(PB.flights.proxyUrl({ proxyUrl: '' }), 'https://shared.example.workers.dev');
    assert.ok(PB.flights.usingSharedProxy({ proxyUrl: '' }));
    assert.ok(PB.flights.hasProxy({ proxyUrl: '' }));
  } finally {
    PB.CONFIG.sharedProxyUrl = original;
  }
});

test('with neither configured there is no proxy at all', () => {
  const original = PB.CONFIG.sharedProxyUrl;
  PB.CONFIG.sharedProxyUrl = '';
  try {
    assert.strictEqual(PB.flights.proxyUrl({ proxyUrl: '' }), '');
    assert.strictEqual(PB.flights.hasProxy({ proxyUrl: '' }), false);
    assert.strictEqual(PB.flights.usingSharedProxy({ proxyUrl: '' }), false);
  } finally {
    PB.CONFIG.sharedProxyUrl = original;
  }
});

test('whitespace-only settings do not count as a configured proxy', () => {
  const original = PB.CONFIG.sharedProxyUrl;
  PB.CONFIG.sharedProxyUrl = '';
  try {
    assert.strictEqual(PB.flights.hasProxy({ proxyUrl: '   ' }), false);
  } finally {
    PB.CONFIG.sharedProxyUrl = original;
  }
});

/* ── Data integrity ────────────────────────────────────────── */

test('every transfer target names a real program', () => {
  Object.keys(PB.TRANSFERS).forEach((cur) => {
    Object.keys(PB.TRANSFERS[cur]).forEach((prog) => {
      assert.ok(PB.PROGRAMS[prog], `${cur} -> unknown program ${prog}`);
    });
  });
});

test('every program has a usable pricing model', () => {
  Object.keys(PB.PROGRAMS).forEach((id) => {
    const p = PB.PROGRAMS[id];
    assert.ok(['zoneDistance', 'distance', 'region', 'dynamic', 'fixed'].includes(p.chart), `${id} has no chart type`);
    if (p.chart === 'zoneDistance') assert.ok(PB.ZONE_DISTANCE_CHARTS[id], `${id} declares a zone+distance chart but none exists`);
    if (p.chart === 'distance') assert.ok(PB.DISTANCE_CHARTS[id], `${id} declares a distance chart but none exists`);
    if (p.chart === 'region') assert.ok(PB.REGION_CHARTS[id], `${id} declares a region chart but none exists`);
    if (p.chart === 'dynamic') assert.ok(p.dynamicCpp > 0, `${id} needs dynamicCpp`);
    if (p.chart === 'fixed') assert.ok(p.fixedCpp > 0, `${id} needs fixedCpp`);
    assert.ok(PB.SURCHARGE_MODEL[p.surcharge], `${id} has an unknown surcharge profile`);
  });
});

test('every card pays into a currency or program the engine knows', () => {
  PB.CARDS.forEach((c) => {
    assert.ok(PB.CURRENCIES[c.currency] || PB.PROGRAMS[c.currency], `${c.id} pays into unknown ${c.currency}`);
  });
});

test('all chart entries define all four cabins', () => {
  Object.keys(PB.REGION_CHARTS).forEach((prog) => {
    Object.keys(PB.REGION_CHARTS[prog]).forEach((pair) => {
      ['y', 'w', 'j', 'f'].forEach((c) => {
        assert.ok(PB.REGION_CHARTS[prog][pair][c] > 0, `${prog} ${pair} missing cabin ${c}`);
      });
    });
  });
  Object.keys(PB.DISTANCE_CHARTS).forEach((prog) => {
    const chart = PB.DISTANCE_CHARTS[prog];
    if (typeof chart === 'string') return;
    chart.forEach((band) => {
      ['y', 'w', 'j', 'f'].forEach((c) => {
        assert.ok(band[1][c] > 0, `${prog} band ${band[0]} missing cabin ${c}`);
      });
    });
  });
});

test('distance chart bands are in ascending order', () => {
  Object.keys(PB.DISTANCE_CHARTS).forEach((prog) => {
    const chart = PB.DISTANCE_CHARTS[prog];
    if (typeof chart === 'string') return;
    for (let i = 1; i < chart.length; i++) {
      assert.ok(chart[i][0] > chart[i - 1][0], `${prog} bands out of order at index ${i}`);
    }
  });
});

test('every airport row parses cleanly', () => {
  Object.keys(PB.airports).forEach((code) => {
    const a = PB.airports[code];
    assert.match(code, /^[A-Z]{3}$/, `bad IATA code: ${code}`);
    assert.ok(PB.REGION_NAMES[a.region], `${code} has unknown region ${a.region}`);
    assert.ok(Number.isFinite(a.lat) && Math.abs(a.lat) <= 90, `${code} bad latitude`);
    assert.ok(Number.isFinite(a.lon) && Math.abs(a.lon) <= 180, `${code} bad longitude`);
  });
});
