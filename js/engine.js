/* Points valuation engine.
 * Pure functions — no DOM, no network. Everything here is testable in isolation
 * (see tests/engine.test.js).
 */
window.PB = window.PB || {};

(function (PB) {
  'use strict';

  /* ---------------------------------------------------------------------
   * Airports & geography
   * ------------------------------------------------------------------- */

  PB.airports = {};

  PB.loadAirports = function () {
    PB.AIRPORT_TABLE.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var p = line.split('|');
      PB.airports[p[0]] = {
        iata: p[0], name: p[1], city: p[2], country: p[3],
        region: p[4], lat: parseFloat(p[5]), lon: parseFloat(p[6])
      };
    });
    return PB.airports;
  };

  /** Great-circle distance in statute miles. */
  PB.distance = function (a, b) {
    if (!a || !b) return null;
    var R = 3958.7613;
    var toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLon = toRad(b.lon - a.lon);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
  };

  /** Region-chart key, tried in both directions by lookupRegion(). */

  /* ---------------------------------------------------------------------
   * Chart lookups
   * ------------------------------------------------------------------- */

  function lookupDistance(programId, miles, cabin) {
    var chart = PB.DISTANCE_CHARTS[programId];
    if (typeof chart === 'string') chart = PB.DISTANCE_CHARTS[chart]; // alias
    if (!chart) return null;
    for (var i = 0; i < chart.length; i++) {
      if (miles <= chart[i][0]) {
        return { miles: chart[i][1][cabin], band: chart[i][0], confidence: 'chart' };
      }
    }
    return null;
  }

  /* Zone pair first, then distance bands inside that pair — how Aeroplan and
   * several other programs genuinely work. */
  function lookupZoneDistance(programId, from, to, miles, cabin) {
    var chart = PB.ZONE_DISTANCE_CHARTS[programId];
    if (!chart) return null;
    var bands = chart.zones[from.region + '-' + to.region] ||
                chart.zones[to.region + '-' + from.region];
    if (!bands) return null;
    for (var i = 0; i < bands.length; i++) {
      if (miles <= bands[i][0]) {
        return {
          miles: bands[i][1][cabin],
          band: bands[i][0],
          confidence: 'chart',
          verifiedOn: chart.verifiedOn,
          sourceUrl: chart.source
        };
      }
    }
    return null;
  }

  function lookupRegion(programId, from, to, cabin) {
    var chart = PB.REGION_CHARTS[programId];
    if (!chart) return null;
    var direct = chart[from.region + '-' + to.region];
    var reverse = chart[to.region + '-' + from.region];
    var hit = direct || reverse;
    if (!hit) return null;
    return { miles: hit[cabin], confidence: 'chart' };
  }

  /* When a program has no chart entry for this region pair, fall back to a
   * distance-scaled guess so the option still appears — clearly flagged. */
  function fallbackEstimate(programId, distMiles, cabin) {
    var cabinMult = { y: 1, w: 1.4, j: 2.1, f: 3.1 }[cabin];
    var base = 8000 + distMiles * 4.2;
    return { miles: Math.round(base * cabinMult / 500) * 500, confidence: 'rough' };
  }

  /* ---------------------------------------------------------------------
   * Taxes & carrier surcharges (estimate)
   * ------------------------------------------------------------------- */

  PB.estimateTaxes = function (programId, distMiles, cabin, legs) {
    var prog = PB.PROGRAMS[programId];
    var model = PB.SURCHARGE_MODEL[prog.surcharge] || PB.SURCHARGE_MODEL.low;
    var perLeg = model.base + (distMiles / 1000) * model.perThousandMiles;
    perLeg *= (model.cabinMultiplier[cabin] || 1);
    return Math.round(perLeg * legs);
  };

  /* ---------------------------------------------------------------------
   * Award pricing
   * ------------------------------------------------------------------- */

  /**
   * What does this program charge for this trip?
   * @returns { miles, taxes, confidence, source, roundTripChart, note }
   */
  PB.priceAward = function (programId, ctx) {
    var prog = PB.PROGRAMS[programId];
    if (!prog) return null;

    var dist = ctx.distance;
    var legs = ctx.roundTrip ? 2 : 1;
    var result = null;

    if (prog.chart === 'zoneDistance') {
      result = lookupZoneDistance(programId, ctx.from, ctx.to, dist, ctx.cabin);
      if (result) result.source = 'Zone + distance chart';
    } else if (prog.chart === 'distance') {
      result = lookupDistance(programId, dist, ctx.cabin);
      if (result) result.source = 'Distance-based chart';
    } else if (prog.chart === 'region') {
      result = lookupRegion(programId, ctx.from, ctx.to, ctx.cabin);
      if (result) result.source = 'Region award chart';
    } else if (prog.chart === 'dynamic') {
      if (!ctx.cashPrice) return null; // dynamic pricing needs a cash anchor
      result = {
        miles: Math.round(ctx.cashPrice * 100 / prog.dynamicCpp / legs / 500) * 500,
        confidence: 'dynamic',
        source: 'Dynamic — derived from cash fare at ~' + prog.dynamicCpp + '¢/pt'
      };
    } else if (prog.chart === 'fixed') {
      if (!ctx.cashPrice) return null;
      result = {
        miles: Math.round(ctx.cashPrice * 100 / prog.fixedCpp / legs / 100) * 100,
        confidence: 'fixed',
        source: 'Revenue-based at ~' + prog.fixedCpp + '¢/pt'
      };
    }

    if (!result) {
      result = fallbackEstimate(programId, dist, ctx.cabin);
      result.source = 'No chart entry for this region pair — rough estimate only';
    }
    if (result.miles == null || isNaN(result.miles)) return null;

    /* ANA publishes round-trip prices; everything else is one-way. */
    var totalMiles;
    if (prog.roundTripOnly) {
      totalMiles = result.miles;                       // chart is already RT
      result.roundTripChart = true;
      if (!ctx.roundTrip) {
        result.note = 'ANA partner awards must be booked round trip — price shown is for the round trip.';
      }
    } else {
      totalMiles = result.miles * legs;
    }

    totalMiles *= (ctx.passengers || 1);

    return {
      programId: programId,
      miles: totalMiles,
      milesPerPerson: Math.round(totalMiles / (ctx.passengers || 1)),
      taxes: PB.estimateTaxes(programId, dist, ctx.cabin, legs) * (ctx.passengers || 1),
      confidence: result.confidence,
      source: result.source,
      /* Whether this program's chart has been checked against a published
       * source, and when. Anything false is a from-memory approximation and
       * the UI says so. */
      chartVerified: !!prog.chartVerified,
      verifiedOn: result.verifiedOn || null,
      sourceUrl: result.sourceUrl || null,
      roundTripChart: !!result.roundTripChart,
      note: result.note || prog.note || ''
    };
  };

  /* ---------------------------------------------------------------------
   * Balances & transfer paths
   * ------------------------------------------------------------------- */

  function bonusFor(currencyId, programId) {
    var b = PB.TRANSFER_BONUSES[currencyId];
    return (b && b[programId]) || 0;
  }

  /**
   * How many miles could you actually put into this program right now?
   * Combines the direct balance with everything transferable in.
   * @param balances { UR: 60000, AC: 12000, ... }
   */
  PB.reachable = function (programId, balances) {
    var direct = balances[programId] || 0;
    var paths = [];
    var fromTransfers = 0;

    Object.keys(PB.TRANSFERS).forEach(function (cur) {
      var ratio = PB.TRANSFERS[cur][programId];
      if (!ratio) return;
      var have = balances[cur] || 0;
      if (have <= 0) return;
      var bonus = bonusFor(cur, programId);
      var effRatio = ratio * (1 + bonus);
      var yields = Math.floor(have * effRatio);
      fromTransfers += yields;
      paths.push({
        currency: cur,
        name: PB.CURRENCIES[cur].short,
        have: have,
        ratio: ratio,
        bonus: bonus,
        yields: yields
      });
    });

    paths.sort(function (a, b) { return b.yields - a.yields; });

    return { direct: direct, transferable: fromTransfers, total: direct + fromTransfers, paths: paths };
  };

  /**
   * Every transferable currency that can feed this program, whether or not you
   * hold any. The plan below picks one route; this is what else would work, so
   * the app never implies Amex is the only way into Aeroplan when Chase,
   * Capital One, Bilt and Wells Fargo all get there too.
   */
  PB.transferSources = function (programId, balances) {
    var held = [], others = [];
    Object.keys(PB.TRANSFERS).forEach(function (cur) {
      var ratio = PB.TRANSFERS[cur][programId];
      if (!ratio) return;
      var bonus = bonusFor(cur, programId);
      var entry = {
        currency: cur,
        name: PB.CURRENCIES[cur].short,
        issuer: PB.CURRENCIES[cur].issuer,
        ratio: ratio,
        bonus: bonus,
        have: balances[cur] || 0
      };
      (entry.have > 0 ? held : others).push(entry);
    });
    held.sort(function (a, b) { return b.have - a.have; });
    return { held: held, others: others, total: held.length + others.length };
  };

  /**
   * Given a required mile count, work out the cheapest way to get there:
   * spend the direct balance first, then draw from flexible currencies
   * best-ratio-first.
   */
  PB.buildTransferPlan = function (programId, needed, balances) {
    var pool = PB.reachable(programId, balances);
    var remaining = needed;
    var steps = [];

    var useDirect = Math.min(pool.direct, remaining);
    if (useDirect > 0) {
      steps.push({ type: 'direct', currency: programId, miles: useDirect });
      remaining -= useDirect;
    }

    /* Prefer the currency with the best effective ratio, then the largest
     * balance — this keeps 1.25:1 partners from being burned unnecessarily. */
    var candidates = pool.paths.slice().sort(function (a, b) {
      var er = (b.ratio * (1 + b.bonus)) - (a.ratio * (1 + a.bonus));
      return er !== 0 ? er : b.have - a.have;
    });

    candidates.forEach(function (p) {
      if (remaining <= 0) return;
      var effRatio = p.ratio * (1 + p.bonus);
      var pointsNeeded = Math.ceil(remaining / effRatio);
      var spend = Math.min(p.have, pointsNeeded);
      var gets = Math.floor(spend * effRatio);
      if (gets <= 0) return;
      steps.push({
        type: 'transfer', currency: p.currency, name: p.name,
        spend: spend, gets: gets, ratio: p.ratio, bonus: p.bonus
      });
      remaining -= gets;
    });

    return {
      covered: remaining <= 0,
      shortfall: Math.max(0, remaining),
      steps: steps,
      pool: pool
    };
  };

  /* ---------------------------------------------------------------------
   * Full evaluation
   * ------------------------------------------------------------------- */

  /**
   * Score every program for a trip and rank the results.
   * @param q {
   *   from, to        : IATA codes
   *   cabin           : y|w|j|f
   *   cashPrice       : total cash price for the whole party (dollars)
   *   passengers      : int
   *   roundTrip       : bool
   *   balances        : { currencyOrProgramId: points }
   *   includeUnaffordable : bool
   * }
   */
  PB.evaluate = function (q) {
    var from = PB.airports[q.from];
    var to = PB.airports[q.to];
    if (!from || !to) return { error: 'Unknown airport code' };

    var dist = PB.distance(from, to);
    var pax = q.passengers || 1;
    var ctx = {
      from: from, to: to, distance: dist, cabin: q.cabin,
      cashPrice: q.cashPrice, roundTrip: q.roundTrip, passengers: pax
    };

    var options = [];

    /* Optionally drop programs that cannot ticket any of the airlines you
     * actually fly. For someone who only uses the US majors, a program with no
     * route onto those carriers is noise — and noise among estimates is worse
     * than no answer at all. */
    var wantCarriers = (q.onlyCarriers || []).filter(Boolean);

    Object.keys(PB.PROGRAMS).forEach(function (pid) {
      if (wantCarriers.length) {
        var reach = PB.usCarriersFor(pid);
        var overlap = reach.some(function (c) { return wantCarriers.indexOf(c) !== -1; });
        if (!overlap) return;
      }
      if (q.verifiedOnly && !PB.PROGRAMS[pid].chartVerified) return;

      var priced = PB.priceAward(pid, ctx);
      if (!priced) return;

      var plan = PB.buildTransferPlan(pid, priced.miles, q.balances || {});
      var prog = PB.PROGRAMS[pid];

      /* Cents per point: what each mile saved you, net of the cash you still
       * pay in taxes and carrier surcharges. */
      var netCashSaved = (q.cashPrice || 0) - priced.taxes;
      var cpp = q.cashPrice && priced.miles ? (netCashSaved / priced.miles) * 100 : null;

      var verdict;
      if (cpp === null)               verdict = 'unknown';
      else if (netCashSaved <= 0)     verdict = 'bad';      // taxes exceed the fare
      else if (cpp >= prog.baseline * 1.5) verdict = 'great';
      else if (cpp >= prog.baseline)  verdict = 'good';
      else                            verdict = 'poor';

      options.push({
        programId: pid,
        program: prog,
        miles: priced.miles,
        milesPerPerson: priced.milesPerPerson,
        taxes: priced.taxes,
        cpp: cpp,
        verdict: verdict,
        confidence: priced.confidence,
        source: priced.source,
        chartVerified: priced.chartVerified,
        verifiedOn: priced.verifiedOn,
        sourceUrl: priced.sourceUrl,
        note: priced.note,
        roundTripChart: priced.roundTripChart,
        affordable: plan.covered,
        shortfall: plan.shortfall,
        plan: plan,
        pool: plan.pool,
        sources: PB.transferSources(pid, q.balances || {}),
        outOfPocket: priced.taxes,
        savings: q.cashPrice ? q.cashPrice - priced.taxes : null
      });
    });

    /* Rank: affordable first, then by value per point. */
    options.sort(function (a, b) {
      if (a.affordable !== b.affordable) return a.affordable ? -1 : 1;
      if (a.cpp === null) return 1;
      if (b.cpp === null) return -1;
      return b.cpp - a.cpp;
    });

    /* Travel-portal redemptions: no transfer, no award seat needed, fixed rate. */
    var portal = [];
    Object.keys(PB.CURRENCIES).forEach(function (cur) {
      var c = PB.CURRENCIES[cur];
      if (!c.portalCpp || !q.cashPrice) return;
      var need = Math.round(q.cashPrice * 100 / c.portalCpp);
      var have = (q.balances || {})[cur] || 0;
      portal.push({
        currency: cur, name: c.short, cpp: c.portalCpp,
        miles: need, have: have, affordable: have >= need
      });
    });
    portal.sort(function (a, b) {
      if (a.affordable !== b.affordable) return a.affordable ? -1 : 1;
      return a.miles - b.miles;
    });

    return {
      from: from, to: to, distance: dist,
      regionPair: from.region + ' → ' + to.region,
      cabin: q.cabin, passengers: pax, roundTrip: q.roundTrip,
      cashPrice: q.cashPrice,
      options: options,
      portal: portal
    };
  };

  /* ---------------------------------------------------------------------
   * Card modelling — "what would this card's bonus unlock?"
   * ------------------------------------------------------------------- */

  /** Merge real balances with simulated card bonuses into one balance map. */
  PB.applyCardBonuses = function (balances, cardIds, customCards) {
    var out = Object.assign({}, balances);
    var all = PB.CARDS.concat(customCards || []);
    (cardIds || []).forEach(function (id) {
      var card = all.filter(function (c) { return c.id === id; })[0];
      if (!card) return;
      out[card.currency] = (out[card.currency] || 0) + card.bonus;
    });
    return out;
  };

  /** Total annual fees and minimum spend across a set of simulated cards. */
  PB.cardCost = function (cardIds, customCards) {
    var all = PB.CARDS.concat(customCards || []);
    return (cardIds || []).reduce(function (acc, id) {
      var c = all.filter(function (x) { return x.id === id; })[0];
      if (!c) return acc;
      acc.fees += c.fee || 0;
      acc.minSpend += c.minSpend || 0;
      acc.bonus += c.bonus || 0;
      return acc;
    }, { fees: 0, minSpend: 0, bonus: 0 });
  };

  /**
   * "Which card should I open for this trip?"
   * For every card you don't already hold, add its welcome bonus to your
   * balances, re-run the whole evaluation, and report what that unlocks.
   */
  PB.rankCardsForTrip = function (q, balances, opts) {
    opts = opts || {};
    var customCards = opts.customCards || [];
    var exclude = opts.exclude || [];
    var all = PB.CARDS.concat(customCards);

    var before = PB.evaluate(Object.assign({}, q, { balances: balances }));
    if (before.error) return { error: before.error };
    var bestBefore = before.options.filter(function (o) { return o.affordable; })[0] || null;

    var rows = all.filter(function (c) {
      return exclude.indexOf(c.id) === -1 && (c.bonus || 0) > 0;
    }).map(function (card) {
      var boosted = Object.assign({}, balances);
      boosted[card.currency] = (boosted[card.currency] || 0) + card.bonus;

      var after = PB.evaluate(Object.assign({}, q, { balances: boosted }));
      var bestAfter = after.options.filter(function (o) { return o.affordable; })[0] || null;

      var unlocks = !!(bestAfter && !bestBefore);
      var improves = !!(bestAfter && bestBefore && bestAfter.cpp > bestBefore.cpp + 0.01);

      return {
        card: card,
        currencyName: (PB.CURRENCIES[card.currency] || PB.PROGRAMS[card.currency] || {}).short || card.currency,
        best: bestAfter,
        unlocks: unlocks,
        improves: improves,
        helps: unlocks || improves,
        /* Cash you avoid paying, minus the card's first-year fee. */
        netValue: bestAfter && q.cashPrice
          ? (q.cashPrice - bestAfter.taxes) - (card.fee || 0)
          : null
      };
    });

    rows.sort(function (a, b) {
      if (a.helps !== b.helps) return a.helps ? -1 : 1;
      if (a.netValue == null) return 1;
      if (b.netValue == null) return -1;
      return b.netValue - a.netValue;
    });

    return { bestBefore: bestBefore, rows: rows };
  };

  PB.fmt = {
    miles: function (n) { return n == null ? '—' : Math.round(n).toLocaleString(); },

    /* Compact points, the way every award table writes them: 4.5k, 12k,
     * 67.5k. A list of these is scannable on a phone in a way that a column
     * of 4,500 / 12,000 / 67,500 is not.
     *
     * The decimal appears only when it carries something - 4.5k but 9k, not
     * 9.0k - and is dropped entirely past 100k, where a tenth of a thousand
     * is noise. Anywhere a number gets ACTED on, a transfer amount above
     * all, keep using miles() - 125k is not a figure to type into a
     * transfer form. */
    milesShort: function (n) {
      if (n == null) return '—';
      n = Math.round(n);
      if (Math.abs(n) < 1000) return String(n);
      var k = n / 1000;
      if (Math.abs(k) >= 100) return Math.round(k) + 'k';
      var r = Math.round(k * 10) / 10;
      return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + 'k';
    },
    money: function (n) {
      if (n == null) return '—';
      return '$' + Math.round(n).toLocaleString();
    },
    cpp: function (n) { return n == null ? '—' : n.toFixed(2) + '¢'; },

    /* How long ago something was actually seen.
     *
     * Finer than balanceAgeText, which counts in days because a hand-typed
     * balance has no better resolution. A fare does: the worker caches for
     * six hours, so the difference between "just now" and "5h ago" is the
     * difference between a price you can book and one that has moved. */
    ago: function (iso, now) {
      if (!iso) return null;
      var t = Date.parse(iso);
      if (isNaN(t)) return null;
      var mins = Math.floor(((now ? Date.parse(now) : Date.now()) - t) / 60000);
      if (mins < 0) mins = 0;
      if (mins < 2) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return Math.floor(hrs / 24) + 'd ago';
    }
  };

})(window.PB);
