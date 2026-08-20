/* Flight price providers.
 *
 * Three modes, in order of preference:
 *   1. 'proxy'  — live cash fares from Amadeus via your Cloudflare Worker.
 *   2. 'manual' — you paste the cash price you found on Google Flights. Always
 *                 works, needs zero setup, and is exactly as accurate as the
 *                 number you type.
 *   3. 'estimate' — a crude distance-based guess so you can try the app before
 *                 wiring anything up. NOT a real fare. Clearly labelled as such.
 *
 * A static site cannot call Amadeus directly: the browser blocks it on CORS and
 * your API key would be public. The Worker in /worker solves both.
 */
window.PB = window.PB || {};

(function (PB) {
  'use strict';

  PB.flights = {};

  PB.flights.hasProxy = function (settings) {
    return !!(settings && settings.proxyUrl && settings.proxyUrl.trim());
  };

  /** Live search through the Worker proxy. */
  PB.flights.searchLive = function (q, settings) {
    var base = settings.proxyUrl.replace(/\/+$/, '');
    var params = new URLSearchParams({
      origin: q.from,
      destination: q.to,
      departureDate: q.date,
      adults: String(q.passengers || 1),
      travelClass: PB.flights.amadeusCabin(q.cabin),
      currencyCode: 'USD',
      max: '20'
    });
    if (q.roundTrip && q.returnDate) params.set('returnDate', q.returnDate);
    if (q.nonStop) params.set('nonStop', 'true');

    return fetch(base + '/search?' + params.toString(), {
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('Proxy returned ' + r.status + ': ' + t.slice(0, 300));
        });
      }
      return r.json();
    }).then(function (json) {
      return PB.flights.normalizeAmadeus(json);
    });
  };

  PB.flights.amadeusCabin = function (cabin) {
    return { y: 'ECONOMY', w: 'PREMIUM_ECONOMY', j: 'BUSINESS', f: 'FIRST' }[cabin] || 'ECONOMY';
  };

  /** Reduce an Amadeus Flight Offers Search response to what we need. */
  PB.flights.normalizeAmadeus = function (json) {
    var dict = (json.dictionaries && json.dictionaries.carriers) || {};
    var offers = (json.data || []).map(function (o) {
      var itineraries = (o.itineraries || []).map(function (it) {
        var segs = (it.segments || []).map(function (s) {
          return {
            from: s.departure.iataCode,
            to: s.arrival.iataCode,
            depart: s.departure.at,
            arrive: s.arrival.at,
            carrier: s.carrierCode,
            carrierName: dict[s.carrierCode] || s.carrierCode,
            number: s.number,
            aircraft: s.aircraft && s.aircraft.code
          };
        });
        return { duration: it.duration, segments: segs, stops: Math.max(0, segs.length - 1) };
      });
      var carriers = {};
      itineraries.forEach(function (it) {
        it.segments.forEach(function (s) { carriers[s.carrierName] = true; });
      });
      return {
        id: o.id,
        price: parseFloat(o.price.grandTotal || o.price.total),
        currency: o.price.currency,
        carriers: Object.keys(carriers),
        itineraries: itineraries,
        stops: Math.max.apply(null, itineraries.map(function (i) { return i.stops; })),
        durationText: itineraries.map(function (i) { return prettyDuration(i.duration); }).join(' / ')
      };
    });
    offers.sort(function (a, b) { return a.price - b.price; });
    return offers;
  };

  function prettyDuration(iso) {
    if (!iso) return '';
    var m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
    if (!m) return '';
    return (m[1] ? m[1] + 'h ' : '') + (m[2] ? m[2] + 'm' : '').trim();
  }

  /* -------------------------------------------------------------------
   * Rough offline fare estimate.
   * A blunt distance curve so the app is usable with no API key. It is NOT
   * a quoted fare and the UI always says so.
   * ----------------------------------------------------------------- */
  PB.flights.estimateFare = function (q) {
    var from = PB.airports[q.from], to = PB.airports[q.to];
    if (!from || !to) return null;
    var d = PB.distance(from, to);

    // Economy: a fixed cost to get airborne plus a per-mile taper.
    var econ = 70 + Math.pow(d, 0.82) * 0.55;
    if (from.region !== to.region) econ *= 1.25;

    var cabinMult = { y: 1, w: 1.9, j: 3.6, f: 6.2 }[q.cabin] || 1;
    var oneWay = econ * cabinMult;
    var total = oneWay * (q.roundTrip ? 1.85 : 1) * (q.passengers || 1);
    return Math.round(total / 5) * 5;
  };

  /** Deep link out to Google Flights so you can grab a real price fast. */
  PB.flights.googleFlightsUrl = function (q) {
    var parts = ['Flights', 'from ' + q.from, 'to ' + q.to];
    if (q.date) parts.push('on ' + q.date);
    if (q.roundTrip && q.returnDate) parts.push('through ' + q.returnDate);
    var cabin = { y: '', w: 'Premium economy', j: 'Business', f: 'First' }[q.cabin];
    if (cabin) parts.push(cabin);
    return 'https://www.google.com/travel/flights?q=' + encodeURIComponent(parts.join(' '));
  };

  /** Award-search sites worth checking once the app points you at a program. */
  PB.flights.awardSearchLinks = function (q, programId) {
    var links = [
      { name: 'seats.aero', url: 'https://seats.aero/search?origin=' + q.from + '&destination=' + q.to },
      { name: 'Google Flights (cash)', url: PB.flights.googleFlightsUrl(q) }
    ];
    var prog = PB.PROGRAMS[programId];
    if (prog && prog.verify) links.unshift({ name: 'Book on ' + prog.short, url: prog.verify });
    return links;
  };

})(window.PB);
