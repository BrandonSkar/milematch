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

  /* -------------------------------------------------------------------
   * Google Flights deep links.
   *
   * Google Flights takes its search in a `tfs` parameter: a protobuf
   * message, base64url encoded. It is undocumented and reverse-engineered,
   * but it is the only form that reliably carries exact dates — the plain
   * `?q=Flights from X to Y on DATE` natural-language search frequently
   * drops or misreads the date, which is what googleFlightsSearchUrl()
   * below is kept around for as a fallback.
   *
   * Message shape:
   *   Info      { repeated FlightData data = 3; repeated int32 passengers = 8;
   *               int32 seat = 9; int32 trip = 19; }
   *   FlightData{ string date = 2; repeated Airport from = 13;
   *               repeated Airport to = 14; }
   *   Airport   { string code = 1; int32 type = 2; }
   *
   * If Google ever changes this, swap the call in googleFlightsUrl() to
   * googleFlightsSearchUrl() and the app keeps working.
   * ----------------------------------------------------------------- */

  function varint(n) {
    var bytes = [];
    while (n > 127) { bytes.push((n & 0x7f) | 0x80); n >>>= 7; }
    bytes.push(n);
    return bytes;
  }

  function tag(field, wireType) { return varint((field << 3) | wireType); }

  function lengthDelimited(field, bytes) {
    return tag(field, 2).concat(varint(bytes.length), bytes);
  }

  function stringField(field, str) {
    var bytes = [];
    // IATA codes and ISO dates are ASCII, so a byte-per-char is exact here.
    for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
    return lengthDelimited(field, bytes);
  }

  function varintField(field, n) { return tag(field, 0).concat(varint(n)); }

  function airportMsg(code) {
    return stringField(1, code).concat(varintField(2, 0));
  }

  function legMsg(from, to, date) {
    return stringField(2, date)
      .concat(lengthDelimited(13, airportMsg(from)))
      .concat(lengthDelimited(14, airportMsg(to)));
  }

  function base64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  var SEAT_CODE = { y: 1, w: 2, j: 3, f: 4 };

  /** Deep link to Google Flights with the exact route, dates, and cabin. */
  PB.flights.googleFlightsUrl = function (q) {
    // Without a departure date there is nothing to deep link to; fall back to
    // the natural-language search so the link still does something useful.
    if (!q.from || !q.to || !q.date) return PB.flights.googleFlightsSearchUrl(q);

    var roundTrip = !!(q.roundTrip && q.returnDate);
    var msg = lengthDelimited(3, legMsg(q.from, q.to, q.date));

    if (roundTrip) {
      msg = msg.concat(lengthDelimited(3, legMsg(q.to, q.from, q.returnDate)));
    }

    // One entry per adult passenger; 1 = adult.
    for (var i = 0; i < (q.passengers || 1); i++) msg = msg.concat(varintField(8, 1));

    msg = msg.concat(varintField(9, SEAT_CODE[q.cabin] || 1));
    msg = msg.concat(varintField(19, roundTrip ? 1 : 2));

    return 'https://www.google.com/travel/flights?tfs=' + base64url(msg) + '&hl=en&curr=USD';
  };

  /** Natural-language fallback. Google often ignores the date in this form. */
  PB.flights.googleFlightsSearchUrl = function (q) {
    var parts = ['Flights'];
    if (q.from) parts.push('from ' + q.from);
    if (q.to) parts.push('to ' + q.to);
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
