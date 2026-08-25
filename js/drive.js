/* What a trip actually costs, once getting to the airport is counted.
 *
 * The cheapest fare is routinely not the cheapest trip. A flight $180 cheaper
 * out of an airport two hours further away loses once the driving, the parking
 * and the fuel are priced — and wins easily if it is only twenty minutes
 * further. Nobody does that arithmetic reliably in their head, which is the
 * entire reason this file exists.
 *
 * Drive times are TYPED, not estimated. The app knows where every airport is
 * but not where you live, and a wrong guess here quietly reorders the results
 * — the same silent-wrong-answer failure the balance parser had. The
 * great-circle distance between two airports is offered as a sense of scale
 * and nothing more.
 */
window.PB = window.PB || {};

(function (PB) {
  'use strict';

  PB.drive = {};

  /* Defaults chosen to be defensible rather than flattering.
   *
   * perHour is what an hour behind the wheel is worth to you. It is NOT your
   * salary — a drive is not billable time — and it is deliberately modest so
   * the app does not manufacture a reason to prefer the closer airport.
   *
   * perMile is fuel and wear. It is not the IRS's ~$0.70, which is built for
   * tax deduction and folds in depreciation and insurance you pay whether the
   * car moves or not.
   *
   * mph turns a typed drive TIME into distance for the fuel figure, so there
   * is one number to enter per airport instead of two. */
  PB.drive.DEFAULTS = { perHour: 25, perMile: 0.20, mph: 45 };

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) && n >= 0 ? n : fallback;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  PB.drive.rates = function (settings) {
    var s = (settings && settings.drive) || {};
    var d = PB.drive.DEFAULTS;
    return {
      perHour: num(s.perHour, d.perHour),
      perMile: num(s.perMile, d.perMile),
      mph: num(s.mph, d.mph) || d.mph
    };
  };

  /**
   * Cost of using one airport as your ORIGIN, before any fare.
   *
   * Time and fuel are doubled — you drive there, and you drive home again.
   * Parking is for the whole trip and is not doubled.
   *
   * @param {{driveMinutes:number, parking:number}} entry
   */
  PB.drive.originCost = function (entry, settings) {
    var r = PB.drive.rates(settings);
    var minutes = num(entry && entry.driveMinutes, 0);
    var parking = num(entry && entry.parking, 0);
    var hours = minutes / 60;

    var time = hours * 2 * r.perHour;
    var fuel = hours * r.mph * 2 * r.perMile;

    return {
      minutes: minutes, hours: hours,
      time: round2(time), fuel: round2(fuel), parking: round2(parking),
      total: round2(time + fuel + parking)
    };
  };

  /**
   * Cost of using one airport as your DESTINATION.
   *
   * No parking and no fuel: your car is at home. What differs between arrival
   * airports is how long it takes to reach where you are actually going, and
   * any standing difference in what that leg costs — a longer rideshare, a
   * train ticket. Time is doubled for the trip back to the airport.
   *
   * @param {{driveMinutes:number, extraCost:number}} entry
   */
  PB.drive.destinationCost = function (entry, settings) {
    var r = PB.drive.rates(settings);
    var minutes = num(entry && entry.driveMinutes, 0);
    var extra = num(entry && entry.extraCost, 0);
    var hours = minutes / 60;

    var time = hours * 2 * r.perHour;

    return {
      minutes: minutes, hours: hours,
      time: round2(time), extra: round2(extra),
      total: round2(time + extra)
    };
  };

  /** Both ends together: getting to the plane, and getting away from it. */
  PB.drive.groundCost = function (originEntry, destEntry, settings) {
    var o = PB.drive.originCost(originEntry, settings);
    var d = PB.drive.destinationCost(destEntry, settings);
    return { origin: o, destination: d, total: round2(o.total + d.total) };
  };

  /* Every airport pair worth searching.
   *
   * Not N-squared: if you drive to an airport and park, you fly back into that
   * same airport, because your car is in the lot. Flying home to a DIFFERENT
   * airport is a real trip but a rarer one, and it doubles the searches, so it
   * is not what this offers.
   *
   * A pair that is the same airport at both ends is dropped rather than
   * refused — with several selected on each side it is a normal overlap, not
   * a mistake worth stopping for. */
  PB.drive.combos = function (origins, destinations) {
    var out = [];
    (origins || []).forEach(function (from) {
      (destinations || []).forEach(function (to) {
        if (from && to && from !== to) out.push({ from: from, to: to });
      });
    });
    return out;
  };

  /**
   * Rank priced combinations by what the whole trip costs.
   *
   * `fare` is the flight; `ground` comes from groundCost(). The winner is
   * whatever total is lowest, and every other row carries how much more it
   * costs — which is the number the question "is the longer drive worth it?"
   * actually turns on.
   *
   * @param {Array<{from,to,fare,ground}>} rows
   */
  PB.drive.rank = function (rows) {
    var priced = (rows || []).filter(function (r) {
      return r && isFinite(r.fare) && r.fare > 0;
    }).map(function (r) {
      var ground = r.ground && isFinite(r.ground.total) ? r.ground.total : 0;
      return Object.assign({}, r, { allIn: round2(r.fare + ground), groundTotal: round2(ground) });
    });

    priced.sort(function (a, b) { return a.allIn - b.allIn; });

    var best = priced.length ? priced[0].allIn : 0;
    return priced.map(function (r, i) {
      return Object.assign({}, r, {
        rank: i + 1,
        overBest: round2(r.allIn - best),
        /* The headline the whole feature exists for: this pair has the
         * cheapest FARE but not the cheapest trip, or the other way round. */
        cheapestFare: false
      });
    });
  };

  /** Mark which row had the lowest fare, so a result that wins on fare but
   *  loses on total can be shown as exactly that. */
  PB.drive.markCheapestFare = function (ranked) {
    if (!ranked || !ranked.length) return ranked || [];
    var min = null;
    ranked.forEach(function (r) { if (min === null || r.fare < min) min = r.fare; });
    return ranked.map(function (r) {
      return Object.assign({}, r, { cheapestFare: r.fare === min });
    });
  };

  /** Great-circle miles between two airport codes, for scale only. Returns
   *  null when either code is unknown rather than pretending to a number. */
  PB.drive.milesBetween = function (a, b) {
    var from = PB.airports && PB.airports[a];
    var to = PB.airports && PB.airports[b];
    if (!from || !to) return null;
    return Math.round(PB.distance(from, to));
  };

})(window.PB);
