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

  /* A personal Settings entry wins; otherwise fall back to the shared worker
   * baked into data/config.js so visitors get live fares with no setup. */
  PB.flights.proxyUrl = function (settings) {
    var own = settings && settings.proxyUrl && settings.proxyUrl.trim();
    if (own) return own;
    var shared = (PB.CONFIG && PB.CONFIG.sharedProxyUrl || '').trim();
    return shared || '';
  };

  PB.flights.usingSharedProxy = function (settings) {
    var own = settings && settings.proxyUrl && settings.proxyUrl.trim();
    return !own && !!(PB.CONFIG && PB.CONFIG.sharedProxyUrl || '').trim();
  };

  PB.flights.hasProxy = function (settings) {
    return !!PB.flights.proxyUrl(settings);
  };

  /** Live search through the Worker proxy. */
  PB.flights.searchLive = function (q, settings) {
    var base = PB.flights.proxyUrl(settings).replace(/\/+$/, '');
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
    /* Airline filtering happens upstream at Amadeus so we don't burn quota
     * fetching offers we'd only throw away client-side. */
    if (q.airlines && q.airlines.length) {
      params.set('includedAirlineCodes', q.airlines.join(','));
    }

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
      var carriers = {}, codes = {};
      itineraries.forEach(function (it) {
        it.segments.forEach(function (s) {
          carriers[s.carrierName] = true;
          codes[s.carrier] = true;
        });
      });
      return {
        id: o.id,
        price: parseFloat(o.price.grandTotal || o.price.total),
        currency: o.price.currency,
        carriers: Object.keys(carriers),
        carrierCodes: Object.keys(codes),
        bags: baggageOf(o),
        itineraries: itineraries,
        stops: Math.max.apply(null, itineraries.map(function (i) { return i.stops; })),
        durationText: itineraries.map(function (i) { return prettyDuration(i.duration); }).join(' / ')
      };
    });
    offers.sort(function (a, b) { return a.price - b.price; });
    return offers;
  };

  /* What the fare actually includes, per Amadeus.
   *
   * Amadeus reports baggage per traveller per segment. A fare only counts as
   * including a bag if EVERY segment does — a basic-economy connection that
   * allows a bag on one leg but not the other is not a "free bag" fare.
   *
   * Older API responses omit includedCabinBags entirely. Absent data is
   * reported as null (unknown), never as false, so the UI can distinguish
   * "this fare has no bag" from "the API didn't say". */
  function baggageOf(offer) {
    var tp = (offer.travelerPricings || [])[0];
    if (!tp) return { checked: null, cabin: null };

    var details = tp.fareDetailsBySegment || [];
    if (!details.length) return { checked: null, cabin: null };

    function minAcross(key) {
      var seen = false, min = Infinity;
      details.forEach(function (d) {
        var bag = d[key];
        if (!bag) return;
        seen = true;
        // Amadeus gives either a piece count or a weight allowance.
        var qty = bag.quantity != null ? bag.quantity : (bag.weight > 0 ? 1 : 0);
        min = Math.min(min, qty);
      });
      return seen ? min : null;
    }

    return { checked: minAcross('includedCheckedBags'), cabin: minAcross('includedCabinBags') };
  }

  /* -------------------------------------------------------------------
   * Paste parser.
   *
   * The free fare APIs are gone, and scraping Google from a server needs a
   * headless browser (their results are rendered client-side), which cannot
   * run on a free Worker and breaks whenever the markup shifts.
   *
   * But you are already looking at the results page. Select all, copy, paste
   * here. Your browser did the browsing, as a person, which is the part that
   * was never the problem. No API key, no quota, no server, works for anyone
   * you share the app with.
   *
   * The parser is deliberately loose: it anchors on prices and reads context
   * backwards, so it survives Google reordering things and works on text
   * copied from Kayak, Expedia or an airline site too.
   * ----------------------------------------------------------------- */

  var AIRLINE_WORDS = [
    'Alaska', 'American', 'Delta', 'United', 'Southwest', 'JetBlue', 'Spirit',
    'Frontier', 'Hawaiian', 'Allegiant', 'Sun Country', 'Breeze',
    'Air Canada', 'WestJet', 'Aeromexico', 'Volaris',
    'British Airways', 'Virgin Atlantic', 'Lufthansa', 'Swiss', 'Austrian',
    'Air France', 'KLM', 'Iberia', 'TAP', 'Aer Lingus', 'Finnair', 'SAS',
    'Turkish', 'Emirates', 'Qatar', 'Etihad', 'Saudia', 'Royal Jordanian',
    'ANA', 'Japan Airlines', 'JAL', 'Korean Air', 'Asiana', 'Singapore',
    'Cathay', 'EVA Air', 'China Airlines', 'Thai', 'Malaysia', 'Vietnam',
    'Qantas', 'Air New Zealand', 'Fiji Airways',
    'Avianca', 'Copa', 'LATAM', 'Azul', 'GOL',
    'Icelandair', 'Norwegian', 'Ryanair', 'easyJet', 'Vueling', 'Wizz',
    'Ethiopian', 'Kenya Airways', 'South African', 'Royal Air Maroc',
    'Air India', 'IndiGo', 'Play', 'Condor', 'Aegean', 'LOT', 'ITA'
  ];

  /**
   * Pull flight offers out of text copied from a flight results page.
   * @returns array of offers shaped like the live-search ones, so the same
   *          rendering and filtering code handles both.
   */
  PB.flights.parsePastedFares = function (text) {
    if (!text || !text.trim()) return [];

    var lines = text.split('\n')
      .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
      .filter(function (l) { return l.length; });

    var offers = [];
    var seen = {};
    var prevPriceIdx = -1;   // records are delimited by the previous fare

    lines.forEach(function (line, idx) {
      // Anchor on anything that looks like a fare. Ignore trailing decimals
      // and reject implausible values so "$5" or a phone number isn't a fare.
      var m = /\$\s?([\d][\d,]{1,6})(?:\.\d{2})?/.exec(line);
      if (!m) return;
      var price = parseInt(m[1].replace(/,/g, ''), 10);
      if (!(price >= 20 && price <= 40000)) return;

      // Ancillary charges sit right next to fares and look identical.
      if (/\b(fee|baggage|bag|seat|upgrade|deposit|credit|discount|save|off)\b/i.test(line)) {
        return;
      }

      /* Context is only the lines since the PREVIOUS fare. Without this bound
       * a record inherits its neighbour's details — one entry's layover time
       * became the next entry's flight duration, and two Kayak rows merged
       * into one airline list. */
      var start = prevPriceIdx + 1;
      var window = lines.slice(start, idx + 1).join(' | ');
      prevPriceIdx = idx;

      var carriers = AIRLINE_WORDS.filter(function (name) {
        return new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(window);
      });

      var stops = null;
      if (/\bnonstop\b|\bdirect\b/i.test(window)) stops = 0;
      else {
        var sm = /(\d+)\s*stop/i.exec(window);
        if (sm) stops = parseInt(sm[1], 10);
      }

      var dm = /(\d+)\s*hr\s*(?:(\d+)\s*min)?/i.exec(window);
      var duration = dm ? (dm[1] + 'h' + (dm[2] ? ' ' + dm[2] + 'm' : '')) : '';

      // Google repeats the same itinerary in several places; collapse them.
      var key = price + '|' + carriers.join(',') + '|' + stops;
      if (seen[key]) return;
      seen[key] = true;

      offers.push({
        id: 'paste-' + offers.length,
        price: price,
        currency: 'USD',
        carriers: carriers.length ? carriers : ['Unknown airline'],
        carrierCodes: carriers.map(codeFor).filter(Boolean),
        // Nothing in copied text says what the fare includes.
        bags: { checked: null, cabin: null },
        itineraries: [],
        stops: stops == null ? null : stops,
        durationText: duration,
        fromPaste: true
      });
    });

    offers.sort(function (a, b) { return a.price - b.price; });
    return offers;
  };

  function codeFor(name) {
    var hit = (PB.POPULAR_AIRLINES || []).filter(function (a) {
      return a.name.toLowerCase() === name.toLowerCase();
    })[0];
    return hit ? hit.code : null;
  }

  /** Client-side filters for things Amadeus can't express as query params. */
  PB.flights.applyFilters = function (offers, filters) {
    filters = filters || {};
    return offers.filter(function (o) {
      // Same rule as baggage: unknown never silently fails a filter. Pasted
      // text often doesn't say how many stops a fare has.
      if (filters.nonStop && o.stops !== null && o.stops !== 0) return false;
      // Unknown baggage never silently fails the filter — see baggageOf().
      if (filters.freeCarryOn && o.bags.cabin !== null && o.bags.cabin < 1) return false;
      if (filters.freeChecked && o.bags.checked !== null && o.bags.checked < 1) return false;
      if (filters.airlines && filters.airlines.length) {
        var hit = o.carrierCodes.some(function (c) { return filters.airlines.indexOf(c) !== -1; });
        if (!hit) return false;
      }
      return true;
    });
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
   *   Airport   { int32 type = 1; string code = 2; }
   *
   * Field order inside Airport matters and is easy to get backwards: type is
   * field 1, the IATA code is field 2. Reversed, Google still reads the dates
   * and silently drops the route, leaving the origin/destination boxes empty.
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
    return varintField(1, 1).concat(stringField(2, code));  // type 1 = airport
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
