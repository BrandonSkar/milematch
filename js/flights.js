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
    return proxySearch(q, settings, null);
  };

  /* Round trips are searched in two steps, the same way Google Flights does
   * it: the first call lists departures, and each departure carries a token
   * that asks "given THIS outbound, what are the ways back?". The price that
   * comes back is the trip total for that pairing, not the return leg alone.
   *
   * It costs a second lookup against a shared monthly allowance, so the app
   * only makes this call when someone actually asks to see the returns. */
  PB.flights.searchReturns = function (q, settings, departureToken) {
    if (!departureToken) return Promise.resolve([]);
    return proxySearch(q, settings, departureToken);
  };

  var nonce = 0;

  function proxySearch(q, settings, departureToken) {
    var base = PB.flights.proxyUrl(settings).replace(/\/+$/, '');
    var params = new URLSearchParams({
      origin: q.from,
      destination: q.to,
      departureDate: q.date,
      adults: String(q.passengers || 1),
      travelClass: PB.flights.cabinCode(q.cabin),
      currencyCode: 'USD'
    });
    if (q.roundTrip && q.returnDate) params.set('returnDate', q.returnDate);
    if (q.nonStop) params.set('nonStop', 'true');
    /* Airline filtering happens upstream at Amadeus so we don't burn quota
     * fetching offers we'd only throw away client-side. */
    if (q.airlines && q.airlines.length) {
      params.set('includedAirlineCodes', q.airlines.join(','));
    }
    /* The token only means anything alongside the search it came from, so it
     * is added to the same parameters rather than sent on its own. */
    if (departureToken) params.set('departureToken', departureToken);

    /* Defeat the BROWSER's own cache, and only the browser's.
     *
     * The worker answers with `Cache-Control: max-age=6h` to protect a shared
     * monthly search allowance, which also means a browser will replay its
     * stored copy for six hours without ever asking. That is how a freshly
     * deployed worker kept appearing not to be deployed: the network was
     * never reached. The worker strips `_` before building ITS cache key
     * precisely so this parameter cannot cost a search - the request reaches
     * the edge, the edge answers from cache, nobody pays SerpApi.
     *
     * A counter rides along with the clock because a timestamp alone is not
     * unique: two calls can land in the same millisecond, and browsers
     * deliberately coarsen timer resolution for privacy. */
    params.set('_', Date.now().toString(36) + (++nonce).toString(36));

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
      // The worker normalises provider quirks, so the browser just reads them.
      return ((json && json.offers) || []).map(PB.flights.readFareTerms);
    });
  }

  /* SerpApi's Google Flights travel_class: 1 economy, 2 premium economy,
   * 3 business, 4 first. */
  PB.flights.cabinCode = function (cabin) {
    return { y: '1', w: '2', j: '3', f: '4' }[cabin] || '1';
  };

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

      /* Copied results carry Google's baggage notes too — "Carry-on bag not
       * included", "1st checked bag: $40" — so the pasted path can say what a
       * fare covers instead of shrugging. Silence still means unknown. */
      var notes = lines.slice(start, idx + 1).filter(function (l) {
        return FEE_NOTE.test(l);
      });

      offers.push({
        id: 'paste-' + offers.length,
        price: price,
        currency: 'USD',
        carriers: carriers.length ? carriers : ['Unknown airline'],
        carrierCodes: carriers.map(codeFor).filter(Boolean),
        bags: PB.flights.readBags(window),
        extensions: notes,
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

  /* -------------------------------------------------------------------
   * What the fare actually covers.
   *
   * Airlines unbundled the ticket years ago: the headline price may or may
   * not carry a carry-on, a checked bag, or a seat you get to choose. Google
   * says so in free-text notes ("Carry-on bag not included", "1st checked
   * bag: $40"), which is the only place that information exists.
   *
   * THREE states have to stay distinct, and collapsing any two of them lies
   * to the person booking:
   *    a number  - included, and how many
   *    0         - explicitly NOT included, so it is an extra charge
   *    null      - nobody said, so the app must not claim either way
   * ----------------------------------------------------------------- */

  /** Read baggage terms out of whatever free text a provider gave us. */
  PB.flights.readBags = function (text) {
    var t = String(text || '').toLowerCase();

    var cabinFee = feeNear(t, 'carry[- ]?on');
    var checkedFee = feeNear(t, 'checked bag(?:gage)?');

    /* "not included" contains "included", so the exclusions must be tested
     * first or every unbundled fare reads as a bundled one. */
    var cabin = null;
    if (cabinFee != null || /carry[- ]?on[^|]{0,24}(?:not included|for a fee)|no carry[- ]?on|overhead bin[^|]{0,20}(?:unavailable|not included)/.test(t)) cabin = 0;
    else if (/carry[- ]?on[^|]{0,24}included|free carry[- ]?on/.test(t)) cabin = 1;

    var checked = null;
    var freeBags = /(\d+)\s*(?:free\s*)?checked bags?\b/.exec(t);
    if (checkedFee != null || /checked bag(?:gage)?[^|]{0,24}(?:not included|for a fee)/.test(t)) checked = 0;
    else if (freeBags) checked = parseInt(freeBags[1], 10);
    else if (/free checked bag/.test(t)) checked = 1;

    return { cabin: cabin, checked: checked, cabinFee: cabinFee, checkedFee: checkedFee };
  };

  /* A price has to be attached to the bag it belongs to. The character class
   * stops at the note separator and at the dollar sign itself, so a fee can
   * never be dragged in from the note next door. */
  function feeNear(text, phrase) {
    var m = new RegExp(phrase + '[^|$]{0,20}\\$\\s?(\\d[\\d,]*)').exec(text);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  /* A line that says something about what the ticket does or does not cover.
   * Shared, so the pasted path captures exactly what feeNotes() later quotes. */
  var FEE_NOTE = /\bbags?\b|baggage|carry[- ]?on|overhead bin|seat selection/i;

  /** Notes worth quoting back verbatim — the provider's own words beat any
   *  paraphrase when money is involved. */
  PB.flights.feeNotes = function (offer) {
    return ((offer && offer.extensions) || []).filter(function (line) {
      return FEE_NOTE.test(line);
    });
  };

  /* Fill in the fare terms the worker forwards. Parsing lives here rather
   * than in the worker so pasted text and live offers are read by exactly one
   * set of rules — and so a worker deployed before this existed still works:
   * its own coarser `bags` is used when no notes came with the offer. */
  PB.flights.readFareTerms = function (offer) {
    var notes = (offer && offer.extensions) || [];
    if (!notes.length) return offer;
    var read = PB.flights.readBags(notes.join(' | '));
    var was = offer.bags || {};
    var stated = function (a, b) { return a != null ? a : (b != null ? b : null); };
    offer.bags = {
      cabin: stated(read.cabin, was.cabin),
      checked: stated(read.checked, was.checked),
      cabinFee: read.cabinFee,
      checkedFee: read.checkedFee
    };
    return offer;
  };

  /**
   * Sort a fare's terms into what you get, what you pay extra for, and what
   * nobody stated. All three are rendered: an unlabelled fare is not the same
   * as a fare that includes nothing.
   */
  PB.flights.fareExtras = function (offer) {
    var b = (offer && offer.bags) || {};
    var included = [], extra = [], unknown = [];

    function sort(label, count, fee) {
      if (count == null) { unknown.push(label); return; }
      if (count > 0) {
        included.push(count > 1 ? count + ' ' + label + 's' : label);
        return;
      }
      extra.push({ label: label, amount: fee == null ? null : fee });
    }

    sort('carry-on bag', b.cabin, b.cabinFee);
    sort('checked bag', b.checked, b.checkedFee);
    return { included: included, extra: extra, unknown: unknown };
  };

  /** Client-side filters for things Amadeus can't express as query params. */
  PB.flights.applyFilters = function (offers, filters) {
    filters = filters || {};
    return offers.filter(function (o) {
      // Same rule as baggage: unknown never silently fails a filter. Pasted
      // text often doesn't say how many stops a fare has.
      if (filters.nonStop && o.stops !== null && o.stops !== 0) return false;
      /* Unknown baggage never silently fails the filter. Neither the worker
       * nor pasted text can always tell what a fare includes, and hiding those
       * fares would be worse than showing them unlabelled. */
      if (filters.freeCarryOn && o.bags.cabin !== null && o.bags.cabin < 1) return false;
      if (filters.freeChecked && o.bags.checked !== null && o.bags.checked < 1) return false;
      if (filters.airlines && filters.airlines.length) {
        var codes = o.carrierCodes || [];
        if (filters.strictAirlines) {
          /* Every carrier on the itinerary must be one you picked. A codeshare
           * that starts on American and finishes on someone else is exactly
           * what "don't even consider it" is meant to exclude.
           *
           * An offer with no carrier data cannot be proven compliant, so under
           * strict mode it is excluded - the one place where unknown fails a
           * filter, because that is the point of asking for strict. */
          if (!codes.length) return false;
          var all = codes.every(function (c) { return filters.airlines.indexOf(c) !== -1; });
          if (!all) return false;
        } else {
          var hit = codes.some(function (c) { return filters.airlines.indexOf(c) !== -1; });
          if (!hit) return false;
        }
      }
      return true;
    });
  };

  

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


  /* Several airport pairs, searched one at a time.
   *
   * Deliberately sequential. Nine searches fired at once spend nine lookups
   * before the first result reaches the screen, and both SerpApi hourly cap
   * and the worker own per-IP limit would rather they queued. Each result is
   * handed back as it lands so the run can be stopped the moment the answer is
   * obvious - which is the difference between this feature costing two
   * searches and costing nine.
   *
   * One pair failing does not stop the rest: an unserved route should not cost
   * you the results you have already paid for.
   */
  PB.flights.searchCombos = function (q, settings, combos, handlers) {
    var h = handlers || {};
    var list = combos || [];
    var results = [];
    var stopped = false;

    return list.reduce(function (chain, pair, i) {
      return chain.then(function () {
        if (stopped || (h.shouldStop && h.shouldStop())) { stopped = true; return null; }
        if (h.onProgress) h.onProgress({ index: i, total: list.length, pair: pair, done: false });

        var one = Object.assign({}, q, { from: pair.from, to: pair.to });
        return PB.flights.searchLive(one, settings).then(function (offers) {
          return { from: pair.from, to: pair.to, offers: offers || [], error: null };
        }).catch(function (err) {
          return { from: pair.from, to: pair.to, offers: [], error: err.message || String(err) };
        }).then(function (row) {
          results.push(row);
          if (h.onResult) h.onResult(row, results);
          if (h.onProgress) h.onProgress({ index: i, total: list.length, pair: pair, done: true });
        });
      });
    }, Promise.resolve()).then(function () {
      return { results: results, stopped: stopped, searched: results.length, planned: list.length };
    });
  };

  /** The cheapest offer in a set, or null when nothing usable came back. */
  PB.flights.cheapest = function (offers) {
    var best = null;
    (offers || []).forEach(function (o) {
      if (o && isFinite(o.price) && o.price > 0 && (!best || o.price < best.price)) best = o;
    });
    return best;
  };

})(window.PB);
