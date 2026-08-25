/* UI controller. Vanilla DOM — no framework, no build step. */
(function (PB) {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state, lastResult = null, lastQuery = null, liveOffers = [], selectedOfferId = null;
  var pickedAirlines = [];   // carrier codes toggled on via the chip buttons

  /* Ways home for each outbound, keyed by offer id:
   *   { loading, error, options, selectedId }
   * Fetched only when asked for, because every lookup spends a share of the
   * monthly fare allowance, and kept so re-picking an outbound is free. */
  var returnsByOffer = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ═══════════════════════════ Boot ═══════════════════════════ */

  function init() {
    PB.loadAirports();
    state = PB.store.load();

    buildAirportList();
    bindTabs();
    bindSearch();
    bindBalances();
    bindCards();
    bindSettings();
    bindInstall();
    bindIosInstallNotice();

    restoreSearchForm();
    renderBalances();
    renderCards();
    renderCardSimSummary();
    updateBalanceChip();

    $('#asOf').textContent = PB.META.asOf;
    $('#versionTag').textContent = 'Chart data as of ' + PB.META.asOf;

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('Service worker registration failed', e);
      });
    }
  }

  function buildAirportList() {
    var dl = $('#airportList');
    var frag = document.createDocumentFragment();
    Object.keys(PB.airports).sort().forEach(function (code) {
      var a = PB.airports[code];
      var opt = document.createElement('option');
      opt.value = code;
      opt.label = a.city + ' — ' + a.name;
      frag.appendChild(opt);
    });
    dl.appendChild(frag);
  }

  /* ═══════════════════════════ Tabs ═══════════════════════════ */

  function bindTabs() {
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('.tab').forEach(function (t) { t.classList.toggle('is-active', t === tab); });
        $$('.panel').forEach(function (p) {
          p.classList.toggle('is-active', p.id === 'panel-' + tab.dataset.tab);
        });
      });
    });
  }

  /* ══════════════════════ Search & results ════════════════════ */

  function bindSearch() {
    var form = $('#searchForm');

    $('#swapBtn').addEventListener('click', function () {
      var f = $('#fromInput').value;
      $('#fromInput').value = $('#toInput').value;
      $('#toInput').value = f;
      updateAirportHints();
      persistSearchForm();
    });

    /* Airport code fields.
     *
     * Do NOT rewrite `this.value` on every keystroke. Uppercasing and
     * truncating in the input handler silently discarded any character typed
     * into an already-full field and yanked the caret to the end, which made
     * the field look frozen once a code was in it. `maxlength="3"` plus a CSS
     * text-transform gets the same result natively, with correct caret and
     * selection behaviour. readForm() uppercases the value for the engine. */
    ['#fromInput', '#toInput'].forEach(function (sel) {
      var el = $(sel);

      el.addEventListener('input', function () {
        updateAirportHints();
        persistSearchForm();
      });

      /* Normalise to uppercase once editing is done, so what's stored and
       * restored matches what's displayed. */
      el.addEventListener('change', function () {
        this.value = this.value.toUpperCase();
        updateAirportHints();
        persistSearchForm();
      });

      /* A three-letter code field must never feel stuck. The FIRST printable
       * keystroke after arriving in a full field replaces the whole code
       * instead of being silently dropped by maxlength — that's what makes a
       * restored "SEA" retypable as "SFO".
       *
       * Only the first one, though: within a typing burst, maxlength should
       * truncate normally so "seattle" still yields SEA rather than rolling
       * over to the last three characters. Backspace and modifier combos are
       * untouched, so partial edits keep working. */
      var replaceOnNextKey = false;

      el.addEventListener('keydown', function (e) {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        if (replaceOnNextKey && this.value.length >= 3 &&
            this.selectionStart === this.selectionEnd) {
          this.select();
        }
        replaceOnNextKey = false;
      });

      /* Select the existing code on focus so typing replaces it — the field
       * is three characters, nobody wants to edit it in place. */
      var selectOnRelease = false;
      el.addEventListener('mousedown', function () {
        selectOnRelease = document.activeElement !== this;
      });
      el.addEventListener('mouseup', function (e) {
        if (!selectOnRelease) return;
        selectOnRelease = false;
        e.preventDefault();   // stop the click from collapsing the selection
        this.select();
        replaceOnNextKey = true;
      });
      el.addEventListener('focus', function () {
        this.select();
        replaceOnNextKey = true;
      });
    });

    $('#roundTripInput').addEventListener('change', function () {
      $('#returnField').style.opacity = this.checked ? '1' : '.45';
      $('#returnInput').disabled = !this.checked;
      refreshExternalLinks();
      persistSearchForm();
    });

    $$('input[name=fareSource]').forEach(function (r) {
      r.addEventListener('change', function () {
        applyFareSource(this.value);
        updateFiltersNote();
        persistSearchForm();
      });
    });

    /* Every one of these feeds the Google Flights deep link, so the link has
     * to be rebuilt on each — not just when the airport fields change. */
    ['#dateInput', '#returnInput', '#cabinInput', '#paxInput', '#cashInput'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        refreshExternalLinks();
        persistSearchForm();
      });
    });

    buildAirlineChips();

    $('#clearAirlines').addEventListener('click', function () {
      pickedAirlines = [];
      $('#airlineInput').value = '';
      renderAirlineChips();
      updateFiltersNote();
      persistSearchForm();
      if (liveOffers.length) applyOfferFilters();
    });

    ['#nonStopInput', '#carryOnInput', '#checkedBagInput', '#airlineInput',
     '#strictAirlinesInput', '#onlyRelevantInput', '#verifiedOnlyInput'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        updateFiltersNote();
        persistSearchForm();
        // Re-filter what's already on screen instead of re-querying Amadeus.
        if (liveOffers.length) applyOfferFilters();
      });
    });
    $('#airlineInput').addEventListener('input', updateFiltersNote);

    $('#jumpToPoints').addEventListener('click', function () {
      var target = $('.headline') || $('#results');
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Briefly mark it so it is obvious where you landed.
      target.classList.add('flash');
      setTimeout(function () { target.classList.remove('flash'); }, 1400);
    });

    /* Parse as you paste, so the fares appear without pressing anything. */
    $('#pasteInput').addEventListener('input', function () {
      var parsed = PB.flights.parsePastedFares(this.value);
      var status = $('#pasteStatus');

      if (!this.value.trim()) { status.textContent = ''; status.classList.remove('warn'); return; }

      if (!parsed.length) {
        status.textContent = 'No prices found in that text. Make sure you copied the ' +
                             'results list itself, including the dollar amounts.';
        status.classList.add('warn');
        return;
      }

      status.textContent = 'Found ' + parsed.length + ' fare' + (parsed.length > 1 ? 's' : '') +
                           ', cheapest ' + PB.fmt.money(parsed[0].price) + '.';
      status.classList.remove('warn');

      liveOffers = parsed;
      selectedOfferId = parsed[0].id;
      returnsByOffer = {};
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      runSearch();
    });
  }

  function applyFareSource(mode) {
    $('#manualFare').hidden   = mode !== 'manual';
    $('#liveFare').hidden     = mode !== 'live';
    $('#estimateFare').hidden = mode !== 'estimate';
    $('#pasteFare').hidden    = mode !== 'paste';

    if (mode === 'live') {
      var hint = $('#liveFareHint');
      if (PB.flights.hasProxy(state.settings)) {
        hint.textContent = PB.flights.usingSharedProxy(state.settings)
          ? (PB.CONFIG.sharedProxyNote || 'Using the shared fare lookup.')
          : 'Fares come through your own worker at ' + PB.flights.proxyUrl(state.settings);
        hint.classList.remove('warn');
      } else {
        hint.innerHTML = 'No fare lookup is configured yet. Deploy the worker in ' +
          '<code>worker/</code> (about five minutes, free) and everyone using this site gets ' +
          'real Google Flights results automatically. Until then, use <b>Paste results</b>.';
        hint.classList.add('warn');
      }
    }
  }

  function updateAirportHints() {
    [['#fromInput', '#fromHint'], ['#toInput', '#toHint']].forEach(function (pair) {
      var code = $(pair[0]).value.toUpperCase();
      var a = PB.airports[code];
      var hint = $(pair[1]);
      if (a) {
        hint.textContent = a.city + ', ' + a.country + ' · ' + PB.REGION_NAMES[a.region];
        hint.classList.remove('warn');
      } else if (code.length === 3) {
        hint.textContent = 'Not in the airport list — add it to data/airports.js';
        hint.classList.add('warn');
      } else {
        hint.textContent = '';
        hint.classList.remove('warn');
      }
    });
    refreshExternalLinks();
  }

  /* Keeps the Google Flights link in step with the whole form. Called from
   * every field that affects it, so the link can never go stale. */
  function refreshExternalLinks() {
    var q = readForm();
    var links = [$('#gfLink'), $('#gfLinkPaste')].filter(Boolean);
    if (!links.length) return;

    links.forEach(function (link) {
      if (q.from && q.to) {
        link.href = PB.flights.googleFlightsUrl(q);
        link.removeAttribute('aria-disabled');
        link.title = q.date
          ? 'Search ' + q.from + ' → ' + q.to + ' on ' + q.date + (q.roundTrip && q.returnDate ? ', returning ' + q.returnDate : '')
          : 'Pick a departure date for an exact search';
      } else {
        link.href = 'https://www.google.com/travel/flights';
        link.title = 'Enter both airports for a direct search';
      }
    });
  }

  function readForm() {
    return {
      from: $('#fromInput').value.toUpperCase(),
      to: $('#toInput').value.toUpperCase(),
      date: $('#dateInput').value,
      returnDate: $('#returnInput').value,
      cabin: $('#cabinInput').value,
      passengers: Math.max(1, parseInt($('#paxInput').value, 10) || 1),
      roundTrip: $('#roundTripInput').checked,
      cashPrice: parseFloat($('#cashInput').value) || null,
      nonStop: $('#nonStopInput').checked,
      strictAirlines: $('#strictAirlinesInput').checked,
      onlyRelevant: $('#onlyRelevantInput').checked,
      verifiedOnly: $('#verifiedOnlyInput').checked,
      freeCarryOn: $('#carryOnInput').checked,
      freeChecked: $('#checkedBagInput').checked,
      // Chips plus anything typed into the overflow box, de-duplicated.
      airlines: pickedAirlines.concat(
        ($('#airlineInput').value || '')
          .toUpperCase().split(/[,\s]+/)
          .map(function (s) { return s.trim(); })
          .filter(function (s) { return /^[A-Z0-9]{2}$/.test(s); })
      ).filter(function (c, i, a) { return a.indexOf(c) === i; }),
      fareSource: ($$('input[name=fareSource]').filter(function (r) { return r.checked; })[0] || {}).value || 'manual'
    };
  }

  /* One-click airline chips. A short curated list beats a free-text code box
   * for the 95% case — nobody remembers that Frontier is F9. */
  function buildAirlineChips() {
    var host = $('#airlineChips');
    var lastGroup = null;

    PB.POPULAR_AIRLINES.forEach(function (a) {
      if (lastGroup && a.group !== lastGroup) {
        var sep = document.createElement('span');
        sep.className = 'chip-sep';
        host.appendChild(sep);
      }
      lastGroup = a.group;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-toggle';
      btn.dataset.code = a.code;
      btn.textContent = a.name;
      btn.title = a.code;
      btn.addEventListener('click', function () {
        var i = pickedAirlines.indexOf(a.code);
        if (i === -1) pickedAirlines.push(a.code); else pickedAirlines.splice(i, 1);
        renderAirlineChips();
        updateFiltersNote();
        persistSearchForm();
        if (liveOffers.length) applyOfferFilters();
      });
      host.appendChild(btn);
    });

    // Suggest codes for the long tail, rather than expecting anyone to know
    // that Lufthansa is LH.
    var codes = $('#airlineCodes');
    if (codes && PB.MORE_AIRLINES) {
      codes.textContent = 'Two-letter codes, comma separated. ' +
        PB.MORE_AIRLINES.map(function (a) { return a.name + ' ' + a.code; }).join(' · ');
    }

    renderAirlineChips();
  }

  function renderAirlineChips() {
    $$('#airlineChips .chip-toggle').forEach(function (btn) {
      btn.classList.toggle('is-on', pickedAirlines.indexOf(btn.dataset.code) !== -1);
    });
    $('#clearAirlines').hidden = !pickedAirlines.length && !$('#airlineInput').value;
  }

  /* Say how many programs survive the filters, and warn when "only my
   * airlines" is on with no airlines picked — that combination silently does
   * nothing, which is the kind of thing people quietly mistrust. */
  function updateProgramFilterNote(q) {
    var note = $('#programFilterNote');
    if (!note) return;

    var total = Object.keys(PB.PROGRAMS).length;
    var kept = Object.keys(PB.PROGRAMS).filter(function (pid) {
      if (q.verifiedOnly && !PB.PROGRAMS[pid].chartVerified) return false;
      if (q.onlyRelevant && q.airlines.length) {
        var reach = PB.usCarriersFor(pid);
        if (!reach.some(function (c) { return q.airlines.indexOf(c) !== -1; })) return false;
      }
      return true;
    }).length;

    if (q.onlyRelevant && !q.airlines.length) {
      note.innerHTML = 'Pick some airlines above for this to do anything — ' +
                       'with none selected, every program is shown.';
      note.classList.add('warn');
      return;
    }
    note.classList.remove('warn');
    note.textContent = kept === total
      ? 'Showing all ' + total + ' programs.'
      : 'Showing ' + kept + ' of ' + total + ' programs.';
  }

  /* The filters describe real flights, which only exist in live mode. Say so
   * rather than letting them look active while doing nothing. */
  function updateFiltersNote() {
    var q = readForm();
    var on = [];
    if (q.nonStop) on.push('nonstop');
    if (q.freeCarryOn) on.push('free carry-on');
    if (q.freeChecked) on.push('free checked bag');
    if (q.airlines.length) {
      var known = PB.POPULAR_AIRLINES.concat(PB.MORE_AIRLINES || []);
      var named = q.airlines.map(function (code) {
        var hit = known.filter(function (a) { return a.code === code; })[0];
        return hit ? hit.name : code;
      });
      on.push((q.strictAirlines ? 'only ' : '') +
        (named.length > 4 ? named.length + ' airlines' : named.join(', ')));
    }

    updateProgramFilterNote(q);

    var note = $('#filtersNote');
    if (!on.length) { note.textContent = ''; note.classList.remove('warn'); return; }

    // Pasted fares are real flights too, so the filters apply there as well.
    if (q.fareSource === 'live' || q.fareSource === 'paste') {
      note.textContent = 'Filtering by: ' + on.join(', ') + '.';
      note.classList.remove('warn');
    } else {
      note.innerHTML = 'These filters need a list of flights. Use <b>Paste results</b> ' +
        '— otherwise they are ignored.';
      note.classList.add('warn');
    }
  }

  function persistSearchForm() {
    PB.store.patch({ lastSearch: readForm(), settings: { fareSource: readForm().fareSource } });
  }

  function restoreSearchForm() {
    var s = state.lastSearch || {};
    if (s.from) $('#fromInput').value = s.from;
    if (s.to) $('#toInput').value = s.to;
    if (s.date) $('#dateInput').value = s.date;
    if (s.returnDate) $('#returnInput').value = s.returnDate;
    if (s.cabin) $('#cabinInput').value = s.cabin;
    if (s.passengers) $('#paxInput').value = s.passengers;
    if (s.cashPrice) $('#cashInput').value = s.cashPrice;
    $('#roundTripInput').checked = s.roundTrip !== false;
    $('#returnInput').disabled = !$('#roundTripInput').checked;
    $('#nonStopInput').checked = !!s.nonStop;
    $('#strictAirlinesInput').checked = !!s.strictAirlines;
    $('#onlyRelevantInput').checked = !!s.onlyRelevant;
    $('#verifiedOnlyInput').checked = !!s.verifiedOnly;
    $('#carryOnInput').checked = !!s.freeCarryOn;
    $('#checkedBagInput').checked = !!s.freeChecked;
    /* Restore chips for anything in the curated list; the rest goes back into
     * the free-text overflow box. */
    if (s.airlines && s.airlines.length) {
      var known = PB.POPULAR_AIRLINES.map(function (a) { return a.code; });
      pickedAirlines = s.airlines.filter(function (c) { return known.indexOf(c) !== -1; });
      var extra = s.airlines.filter(function (c) { return known.indexOf(c) === -1; });
      if (extra.length) $('#airlineInput').value = extra.join(', ');
    }

    var mode = (state.settings && state.settings.fareSource) || 'paste';
    var radio = $$('input[name=fareSource]').filter(function (r) { return r.value === mode; })[0];
    if (radio) radio.checked = true;
    applyFareSource(mode);
    updateAirportHints();
    updateFiltersNote();
    if ($('#airlineChips').children.length) renderAirlineChips();
  }

  /** Real balances plus any credit-card bonuses being simulated. */
  function effectiveBalances() {
    return PB.applyCardBonuses(state.balances, state.simulatedCards, state.customCards);
  }

  function setStatus(msg, kind) {
    var el = $('#searchStatus');
    if (!msg) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'status' + (kind ? ' ' + kind : '');
    el.innerHTML = msg;
  }

  function runSearch() {
    var q = readForm();
    lastQuery = q;
    persistSearchForm();

    if (!PB.airports[q.from] || !PB.airports[q.to]) {
      setStatus('Unknown airport code. Use a 3-letter IATA code that exists in <code>data/airports.js</code>.', 'err');
      return;
    }
    if (q.from === q.to) {
      setStatus('Origin and destination are the same.', 'err');
      return;
    }

    if (q.fareSource === 'live') {
      if (!PB.flights.hasProxy(state.settings)) {
        setStatus('Live search needs a worker URL. Add one in <b>Settings</b>, or pick another fare source.', 'err');
        return;
      }
      if (!q.date) {
        setStatus('Live search needs a departure date.', 'err');
        return;
      }
      setStatus('Searching live fares…', 'busy');
      $('#offersWrap').hidden = true;
      PB.flights.searchLive(q, state.settings).then(function (offers) {
        liveOffers = offers;
        returnsByOffer = {};
        if (!offers.length) {
          setStatus('No fares came back for that route and date. Try another date, or enter a price manually.', 'err');
          $('#results').innerHTML = '';
          return;
        }
        setStatus('');
        applyOfferFilters();
      }).catch(function (err) {
        setStatus('Live search failed: ' + esc(err.message) +
          '<br><small>Check the worker URL in Settings, or switch to entering the price yourself.</small>', 'err');
      });
      return;
    }

    if (q.fareSource === 'paste') {
      liveOffers = PB.flights.parsePastedFares($('#pasteInput').value);
      returnsByOffer = {};
      if (!liveOffers.length) {
        setStatus('Paste the copied flight results first — the app reads the prices out of them.', 'err');
        return;
      }
      setStatus('');
      applyOfferFilters();
      return;
    }

    $('#offersWrap').hidden = true;
    var cash = q.cashPrice;

    if (q.fareSource === 'estimate') {
      cash = PB.flights.estimateFare(q);
      $('#cashInput').value = cash;
    }

    if (!cash) {
      setStatus('Enter the cash price for this trip so the app has something to measure points against.', 'err');
      return;
    }

    setStatus('');
    evaluateWith(q, cash);
  }

  function evaluateWith(q, cashPrice) {
    var result = PB.evaluate({
      from: q.from, to: q.to, cabin: q.cabin, cashPrice: cashPrice,
      passengers: q.passengers, roundTrip: q.roundTrip,
      balances: effectiveBalances(),
      onlyCarriers: q.onlyRelevant ? q.airlines : [],
      verifiedOnly: q.verifiedOnly
    });
    if (result.error) { setStatus(esc(result.error), 'err'); return; }
    lastResult = result;
    lastQuery = Object.assign({}, q, { cashPrice: cashPrice });
    renderResults(result, lastQuery);
  }

  /* Narrow the live offers to what the filters allow, pick the cheapest
   * survivor, and price it. Runs on every filter change without re-querying. */
  function applyOfferFilters() {
    var q = readForm();
    var shown = PB.flights.applyFilters(liveOffers, q);

    if (!shown.length) {
      setStatus('No fares match those filters. ' + liveOffers.length +
                ' were found before filtering — try relaxing one.', 'err');
      $('#offersWrap').hidden = true;
      $('#results').innerHTML = '';
      return;
    }

    setStatus(shown.length < liveOffers.length
      ? 'Showing ' + shown.length + ' of ' + liveOffers.length + ' fares after filtering.'
      : '');

    if (!shown.some(function (o) { return o.id === selectedOfferId; })) {
      selectedOfferId = shown[0].id;
    }
    renderOffers(shown, q);
    var picked = shown.filter(function (o) { return o.id === selectedOfferId; })[0];
    evaluateWith(q, tripTotal(picked));

    /* The points comparison sits below up to a dozen flight rows, which is far
     * enough off screen that "below" alone was not a useful instruction. */
    var jump = $('#jumpToPoints');
    jump.hidden = false;
    jump.textContent = 'See what the ' + PB.fmt.money(tripTotal(picked)) + ' ' +
                       picked.carriers[0] + ' flight costs in points ↓';
  }

  /* ─────────────────────── Ways home ──────────────────────────
   * A round-trip fare is quoted against the cheapest available return, so the
   * headline price already assumes one - it just never says which. Asking for
   * the alternatives shows what a better-timed return actually costs, and the
   * price that comes back is the new trip total. */

  function chosenReturn(offer) {
    var entry = offer && returnsByOffer[offer.id];
    if (!entry || !entry.options || !entry.selectedId) return null;
    return entry.options.filter(function (r) { return r.id === entry.selectedId; })[0] || null;
  }

  /** What this trip costs: the fare, or the pairing if a return was chosen. */
  function tripTotal(offer) {
    var back = chosenReturn(offer);
    return back ? back.price : offer.price;
  }

  /* Returns exist only where a provider can price them: a live round-trip
   * search. Pasted text is one column of numbers with no way to ask.
   *
   * 'stale' is the case worth naming out loud. A worker deployed before return
   * flights existed answers every search without a departure token, so the
   * panel would simply never appear and there would be nothing on screen to
   * explain why. Detecting it here rather than asking the worker its version
   * matters: an old worker cannot tell you it is old. */
  function returnsState(offer, q) {
    if (!offer || !q.roundTrip || !q.returnDate) return 'none';
    if (offer.fromPaste || !PB.flights.hasProxy(state.settings)) return 'none';
    return offer.departureToken ? 'ready' : 'stale';
  }

  function loadReturns(offer, q) {
    if (returnsByOffer[offer.id] && returnsByOffer[offer.id].loading) return;
    returnsByOffer[offer.id] = { loading: true };
    paintReturns(offer, q);

    PB.flights.searchReturns(q, state.settings, offer.departureToken)
      .then(function (options) {
        /* The list is the ways home ranked by trip total; more than a handful
         * is a departures board, not a choice. */
        returnsByOffer[offer.id] = { options: options.slice(0, 6) };
        paintReturns(offer, q);
      })
      .catch(function (err) {
        returnsByOffer[offer.id] = { error: err.message };
        paintReturns(offer, q);
      });
  }

  function paintReturns(offer, q) {
    var panel = $('#returns-' + cssId(offer.id));
    if (!panel) return;
    var entry = returnsByOffer[offer.id] || {};

    if (returnsState(offer, q) === 'stale') {
      panel.innerHTML = '<p class="returns-note">' +
        '<b>Return flights need a newer fare worker.</b> This one answered without the ' +
        'token that asks for the ways home — re-run <code>worker/deploy.ps1</code> and ' +
        'search again.</p>';
      return;
    }

    if (entry.loading) {
      panel.innerHTML = '<p class="returns-note">Looking up the ways back…</p>';
      return;
    }

    if (entry.error) {
      panel.innerHTML = '<p class="returns-note err">Could not load return flights: ' +
        esc(entry.error) + '</p>';
      return;
    }

    if (!entry.options) {
      panel.innerHTML =
        '<p class="returns-note">' +
          'The ' + PB.fmt.money(offer.price) + ' above is this outbound paired with the ' +
          '<b>cheapest</b> way back. Other returns cost more.' +
        '</p>' +
        '<button type="button" class="returns-btn" data-act="load">Show the return flights →</button>';
      panel.querySelector('[data-act=load]')
        .addEventListener('click', function () { loadReturns(offer, q); });
      return;
    }

    if (!entry.options.length) {
      panel.innerHTML = '<p class="returns-note">No return flights came back for this outbound.</p>';
      return;
    }

    var html = '<p class="returns-note">Ways back on ' + esc(q.returnDate) +
      '. Picking one sets the trip total, and the points comparison follows it.</p>' +
      '<div class="return-list"></div>';
    panel.innerHTML = html;
    var list = panel.querySelector('.return-list');

    entry.options.forEach(function (r, i) {
      /* The cheapest way home is the one already baked into the headline
       * price, so it is the implied default rather than an upsell. */
      var isDefault = i === 0 && !entry.selectedId;
      var picked = r.id === entry.selectedId;
      var delta = r.price - offer.price;
      var segs = (r.itineraries && r.itineraries[0] && r.itineraries[0].segments) || [];
      var first = segs[0] || {}, last = segs[segs.length - 1] || {};

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'return-opt' + (picked ? ' is-picked' : '') + (isDefault ? ' is-default' : '');
      btn.setAttribute('aria-pressed', picked ? 'true' : 'false');
      btn.innerHTML =
        '<span class="return-when">' +
          esc(clockTime(first.depart) || '—') + ' <span class="leg-arrow">→</span> ' +
          esc(clockTime(last.arrive) || '—') +
          (first.from && last.to ? ' <em>' + esc(first.from) + '–' + esc(last.to) + '</em>' : '') +
        '</span>' +
        '<span class="return-who">' + esc(r.carriers.join(', ')) + ' · ' +
          (r.stops === 0 ? 'nonstop' : r.stops + ' stop' + (r.stops > 1 ? 's' : '')) +
          (r.durationText ? ' · ' + esc(r.durationText) : '') +
          (isDefault ? ' · <b>already in the price</b>' : '') +
        '</span>' +
        '<span class="return-cost">' +
          '<b>' + PB.fmt.money(r.price) + '</b>' +
          '<i>' + (delta > 0 ? '+' + PB.fmt.money(delta) + ' vs cheapest'
                 : delta < 0 ? PB.fmt.money(delta) : 'trip total') + '</i>' +
        '</span>';

      btn.addEventListener('click', function () {
        var e = returnsByOffer[offer.id];
        e.selectedId = e.selectedId === r.id ? null : r.id;
        applyOfferFilters();   // re-price the trip on the new total
      });
      list.appendChild(btn);
    });
  }

  /* Provider ids are opaque strings; keep them out of selector syntax. */
  function cssId(id) { return String(id).replace(/[^a-zA-Z0-9_-]/g, '_'); }

  /* Time strings arrive as "2026-11-15 07:00" (worker) or ISO (older paths).
   * Show a plain clock time; fall back to the raw value rather than "Invalid
   * Date" if a provider sends something unexpected. */
  function clockTime(raw) {
    if (!raw) return '';
    var m = /(\d{1,2}):(\d{2})/.exec(String(raw));
    if (!m) return '';
    var h = parseInt(m[1], 10);
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + m[2] + ' ' + suffix;
  }

  /* Whole days between two provider timestamps.
   *
   * A red-eye that leaves at 10:15 PM and lands at 5:16 AM lands TOMORROW,
   * and printing those two times side by side without saying so is the single
   * most misleading thing a flight row can do. Both stamps carry a date, so
   * compare the dates rather than guessing from the clock going backwards -
   * a long-haul can cross two days, and a westbound can land before it left. */
  function dayOffset(fromRaw, toRaw) {
    var a = /(\d{4})-(\d{2})-(\d{2})/.exec(String(fromRaw || ''));
    var b = /(\d{4})-(\d{2})-(\d{2})/.exec(String(toRaw || ''));
    if (!a || !b) return 0;
    var days = (Date.UTC(b[1], b[2] - 1, b[3]) - Date.UTC(a[1], a[2] - 1, a[3])) / 86400000;
    return Math.round(days);
  }

  /** Where and when, for the collapsed row: SEA 7:18 AM → SNA 10:13 AM. */
  function whenLabel(segs) {
    var first = segs[0], last = segs[segs.length - 1];
    if (!first || !last) return '';
    var dep = clockTime(first.depart), arr = clockTime(last.arrive);
    if (!dep || !arr) return '';
    var over = dayOffset(first.depart, last.arrive);
    return '<span class="offer-when">' +
      (first.from ? '<b>' + esc(first.from) + '</b> ' : '') + esc(dep) +
      '<i>→</i>' +
      (last.to ? '<b>' + esc(last.to) + '</b> ' : '') + esc(arr) +
      (over > 0 ? '<sup title="Arrives ' + over + ' day' + (over > 1 ? 's' : '') +
                  ' later">+' + over + '</sup>' : '') +
      '</span>';
  }

  /* Badges for the facts you would otherwise have to hunt for: what the fare
   * includes, and what it quietly does not.
   *
   * A badge every row carries tells you nothing, so anything the filters
   * already guarantee is left off — if you asked for nonstops with a free
   * checked bag, saying so on all twelve rows is noise. */
  function offerTags(o, q, cheapest) {
    var b = o.bags || {};
    var tags = [];
    var add = function (label, kind) { tags.push({ label: label, kind: kind }); };

    if (o.price === cheapest) add('cheapest', '');
    if (o.stops === 0 && !q.nonStop) add('nonstop', 'alt');
    if (b.cabin > 0 && !q.freeCarryOn) add('free carry-on', 'alt');
    if (b.checked > 0 && !q.freeChecked) {
      add(b.checked > 1 ? b.checked + ' free checked bags' : 'free checked bag', 'alt');
    }

    /* The other half of the story, and the half a price comparison hides:
     * these fares cost more than the number on the right. */
    if (b.cabin === 0) add(b.cabinFee ? 'carry-on +' + PB.fmt.money(b.cabinFee) : 'carry-on costs extra', 'fee');
    if (b.checked === 0) add(b.checkedFee ? 'checked bag +' + PB.fmt.money(b.checkedFee) : 'checked bag costs extra', 'fee');

    return tags.map(function (t) {
      return '<span class="offer-tag' + (t.kind ? ' ' + t.kind : '') + '">' + esc(t.label) + '</span>';
    }).join('');
  }

  function renderOffers(offers, q) {
    q = q || readForm();
    var wrap = $('#offers');
    var list = (offers || liveOffers).slice(0, 12);
    var cheapest = list.length ? Math.min.apply(null, list.map(function (o) { return o.price; })) : 0;
    wrap.innerHTML = '';

    list.forEach(function (o) {
      var selected = o.id === selectedOfferId;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'offer' + (selected ? ' is-selected' : '');
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');

      var segs = (o.itineraries && o.itineraries[0] && o.itineraries[0].segments) || [];

      /* Stops are said once: as a badge when it is a selling point, as text
       * when it is a cost. Both at once was just the word twice. Where a
       * connection exists, name it - "1 stop in PHX" is a decision, "1 stop"
       * is a riddle. */
      var meta = [];
      if (o.stops == null) meta.push('Stops unknown');
      else if (o.stops > 0) {
        var via = segs.slice(1).map(function (s) { return s.from; }).filter(Boolean);
        meta.push(o.stops + ' stop' + (o.stops > 1 ? 's' : '') +
                  (via.length ? ' in ' + esc(via.join(', ')) : ''));
      }
      if (o.durationText) meta.push(esc(o.durationText));

      var total = tripTotal(o);
      var extra = o.price - cheapest;

      var h = '<span class="offer-row">' +
        '<span class="offer-main">' +
          '<span class="offer-carrier">' +
            '<span class="offer-airline">' + esc(o.carriers.join(', ')) + '</span>' +
            whenLabel(segs) +
          '</span>' +
          '<span class="offer-meta">' + meta.join(' · ') +
            offerTags(o, q, cheapest) +
          '</span>' +
        '</span>' +
        '<span class="offer-priceblock">' +
          '<span class="offer-price">' + PB.fmt.money(total) + '</span>' +
          (total !== o.price
            ? '<span class="offer-delta">' + (total > o.price ? '+' : '') +
              PB.fmt.money(total - o.price) + ' · your return</span>'
            : extra > 0 ? '<span class="offer-delta">+' + PB.fmt.money(extra) + '</span>' : '') +
        '</span>' +
      '</span>';

      /* Expanding adds only what the row above does NOT already say.
       *
       * A nonstop's single leg is the same airports and the same two times
       * that now head the row, so repeating it was pure duplication - all it
       * carried that the row did not was the flight number. Connections still
       * get the full per-leg breakdown, because each hop is genuinely new
       * information. */
      if (selected) {
        h += '<span class="offer-detail">';
        if (segs.length > 1) {
          segs.forEach(function (s, i) {
            h += '<span class="leg">' +
              '<b>' + esc(s.from || '?') + '</b> ' + esc(clockTime(s.depart)) +
              ' <span class="leg-arrow">→</span> ' +
              '<b>' + esc(s.to || '?') + '</b> ' + esc(clockTime(s.arrive)) +
              (s.carrierName || s.number
                ? '<em>' + esc([s.carrierName, s.number].filter(Boolean).join(' ')) + '</em>'
                : '') +
              '</span>';
            if (i < segs.length - 1) {
              h += '<span class="leg-stop">connection in ' + esc(segs[i + 1].from || '?') + '</span>';
            }
          });
        } else if (segs.length === 1) {
          var only = [segs[0].carrierName, segs[0].number].filter(Boolean).join(' ');
          if (only) h += '<span class="leg-only">' + esc(only) + '</span>';
        } else {
          h += '<span class="leg-stop">No itinerary detail for this fare.</span>';
        }

        h += fareTerms(o, total);

        /* A statement, not a call to action — the clickable jump lives below
         * the whole list, since a button cannot be nested inside this one. */
        h += '<span class="offer-chosen">✓ Using this flight for the points comparison</span></span>';
      }

      btn.innerHTML = h;

      btn.addEventListener('click', function () {
        selectedOfferId = o.id;
        applyOfferFilters();
      });
      wrap.appendChild(btn);

      /* Ways home hang below the flight they belong to. They cannot live
       * inside it: each is its own button, and buttons do not nest. */
      if (selected && returnsState(o, q) !== 'none') {
        var panel = document.createElement('div');
        panel.className = 'returns';
        panel.id = 'returns-' + cssId(o.id);
        wrap.appendChild(panel);
        paintReturns(o, q);
      }
    });
    $('#offersWrap').hidden = false;
  }

  /* Exactly what the price on the right does and does not buy.
   *
   * An airline fare is not one number any more. Rendering only the headline
   * lets a $40 bag arrive at the airport as a surprise, and — since this app
   * measures points against cash — quietly flatters the cash side of every
   * comparison it draws. So: what is in, what is extra, what nobody said. */
  function fareTerms(o, total) {
    var terms = PB.flights.fareExtras(o);
    var h = '<span class="fare-terms">' +
      '<span class="fare-line is-fare"><i>Fare, taxes and carrier fees</i>' +
        '<b>' + PB.fmt.money(total) + '</b></span>';

    terms.included.forEach(function (label) {
      h += '<span class="fare-line"><i>' + esc(cap(label)) + '</i><b>included</b></span>';
    });

    terms.extra.forEach(function (item) {
      h += '<span class="fare-line is-extra"><i>' + esc(cap(item.label)) + '</i><b>' +
        (item.amount == null ? 'costs extra' : '+' + PB.fmt.money(item.amount)) +
        '</b></span>';
    });

    terms.unknown.forEach(function (label) {
      h += '<span class="fare-line is-unknown"><i>' + esc(cap(label)) + '</i><b>not stated</b></span>';
    });

    if (terms.extra.length) {
      h += '<span class="fare-note warn">Anything marked extra is <b>not</b> in the price above. ' +
           'Bag fees are usually charged per traveler, each way — check the airline\'s page before you book.</span>';
    }
    if (terms.unknown.length) {
      var named = joinWords(terms.unknown.map(function (l) { return 'a ' + l; }));
      h += '<span class="fare-note">Nothing here says whether ' + esc(named) +
           ' is included, so ' + (terms.unknown.length > 1 ? 'either' : 'it') +
           ' could be an extra charge at booking.</span>';
    }

    PB.flights.feeNotes(o).forEach(function (line) {
      h += '<span class="fare-src">“' + esc(line) + '”</span>';
    });

    return h + '</span>';
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function joinWords(list) {
    return list.length < 2 ? (list[0] || '')
      : list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1];
  }

  /* Verdicts describe the VALUE of a hypothetical award, never its existence.
   * "Excellent value" previously read like an offer on a real seat; it now says
   * what it actually means — good rate IF a saver seat is open. */
  var VERDICT_LABEL = {
    great:   'Great rate if available',
    good:    'Good rate if available',
    poor:    'Weak — consider cash',
    bad:     'Do not book',
    unknown: '—'
  };

  function renderResults(r, q) {
    var host = $('#results');
    var hideUnaff = state.settings.hideUnaffordable;
    var affordable = r.options.filter(function (o) { return o.affordable; });
    var shown = hideUnaff ? affordable : r.options;

    var html = '';

    /* Trip header */
    html += '<div class="trip-summary">' +
      metric('Route', esc(r.from.iata) + ' → ' + esc(r.to.iata)) +
      metric('Distance', PB.fmt.miles(r.distance) + ' mi' + (q.roundTrip ? ' each way' : '')) +
      metric('Zones', esc(r.regionPair)) +
      metric('Cabin', esc(PB.CABINS[r.cabin].name)) +
      metric('Travelers', String(r.passengers)) +
      metric('Cash price', PB.fmt.money(q.cashPrice)) +
      '</div>';

    if (!affordable.length) {
      html += '<div class="status">You can\'t cover this trip with your current balances. ' +
        'Every option below shows how far short you are — or try the <b>Cards</b> tab to see which welcome bonus would close the gap.</div>';
    }

    /* Simulated card bonuses are blended into the balances the engine uses, so
     * a result can say "you can book this" when it actually means "you could,
     * if you opened four cards, paid the fees and hit the spend". That has to
     * be impossible to miss, not a green note on another tab. */
    var simCost = PB.cardCost(state.simulatedCards, state.customCards);
    if (simCost.bonus > 0) {
      var realTotal = Object.keys(state.balances)
        .reduce(function (a, k) { return a + state.balances[k]; }, 0);
      html += '<div class="sim-warning">' +
        '<div>' +
          '<strong>These results assume ' + PB.fmt.miles(simCost.bonus) + ' points you don\'t have yet.</strong> ' +
          'You actually hold <b>' + PB.fmt.miles(realTotal) + '</b>. The rest is modelled from ' +
          state.simulatedCards.length + ' credit card' + (state.simulatedCards.length > 1 ? 's' : '') +
          ' you\'d need to open' +
          (simCost.fees ? ', costing ' + PB.fmt.money(simCost.fees) + ' in annual fees' : '') +
          (simCost.minSpend ? ' and ' + PB.fmt.money(simCost.minSpend) + ' of required spend' : '') +
          '.' +
        '</div>' +
        '<button type="button" id="dropSimCards" class="btn">Use only my real points</button>' +
        '</div>';
    }

    /* Headline: the single answer, stated once, in plain language. Everything
     * else on the page is supporting detail you can choose to open. */
    var best = affordable[0];
    if (best) {
      html += '<div class="headline">' +
        '<div class="headline-label">Cheapest way to book this</div>' +
        '<div class="headline-main">' +
          '<span class="headline-program">' + esc(best.program.short) + '</span>' +
          '<span class="headline-cost">' + PB.fmt.miles(best.miles) + ' pts' +
            (best.taxes ? ' <em>+ ' + PB.fmt.money(best.taxes) + '</em>' : '') + '</span>' +
        '</div>' +
        '<div class="headline-sub">Instead of ' + PB.fmt.money(q.cashPrice) + ' cash · ' +
          PB.fmt.cpp(best.cpp) + ' per point · ' +
          (best.plan.steps.length === 1 && best.plan.steps[0].type === 'direct'
            ? 'miles already in your account'
            : 'transfer from ' + esc((best.plan.steps.filter(function (s) { return s.type === 'transfer'; })[0] || {}).name || '—')) +
        '</div>' +
      '</div>';
    }

    html += '<div class="availability-warning">' +
      '<strong>Chart prices, not available seats.</strong> ' +
      'Confirm on the airline before transferring — many of these will not be bookable.' +
      '</div>';

    if (!shown.length) {
      html += '<p class="empty">Nothing to show.</p>';
    } else {
      /* Options you cannot afford stay below the ones you can, whichever sort
       * is chosen — a cheaper award you have no points for is not a better
       * answer, it is a different problem. */
      var affordableShown = sortOptions(shown.filter(function (o) { return o.affordable; }));
      var lockedShown = sortOptions(shown.filter(function (o) { return !o.affordable; }));

      html += sortBar();
      affordableShown.forEach(function (o, i) { html += renderOption(o, q, i === 0); });

      if (lockedShown.length) {
        html += '<details class="locked-group"><summary>' + lockedShown.length +
                ' more you don\'t have enough points for</summary>';
        lockedShown.forEach(function (o) { html += renderOption(o, q, false); });
        html += '</details>';
      }
    }

    /* Portal comparison */
    var portalAff = r.portal.filter(function (p) { return p.affordable; });
    if (r.portal.length) {
      html += '<h2 class="section-title">Or book through a travel portal <small>no transfer, no award seat needed</small></h2>';
      html += '<div class="card">';
      html += '<p class="hint">Fixed-rate redemptions on the same cash fare. Simpler and always available, but usually worth less per point than a good transfer.</p>';
      r.portal.slice(0, 4).forEach(function (p) {
        html += '<div class="rank-row"><div class="rank-main">' +
          '<div class="rank-name">' + esc(p.name) + ' travel portal</div>' +
          '<div class="rank-meta">' + p.cpp.toFixed(2) + '¢ per point · you hold ' + PB.fmt.miles(p.have) + '</div>' +
          '</div><div class="rank-value">' + PB.fmt.miles(p.miles) + ' pts<small>' +
          (p.affordable ? 'covered' : 'short ' + PB.fmt.miles(p.miles - p.have)) + '</small></div></div>';
      });
      html += (portalAff.length ? '' : '<p class="hint">None of your portal balances cover this fare outright.</p>') + '</div>';
    }

    html += '<p class="warn-block" style="margin-top:1rem">' +
      '<strong>Before you transfer anything:</strong> confirm the award is actually bookable and priced as shown on the airline\'s own site. ' +
      'Chart values here are estimates, transfers are irreversible, and this app cannot see live award seat availability.</p>';

    host.innerHTML = html;

    $$('.sort-btn', host).forEach(function (btn) {
      btn.addEventListener('click', function () {
        resultSort = btn.dataset.sort;
        /* Re-render from the result already in hand: sorting is a view, not a
         * new question, so it must not re-price or re-query anything. */
        renderResults(r, q);
      });
    });

    var drop = $('#dropSimCards');
    if (drop) {
      drop.addEventListener('click', function () {
        state.simulatedCards = [];
        PB.store.save();
        renderCards();
        renderCardSimSummary();
        renderBalances();
        updateBalanceChip();
        if (lastQuery && lastQuery.cashPrice) evaluateWith(lastQuery, lastQuery.cashPrice);
      });
    }
  }

  function metric(label, value) {
    return '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  }

  /* Three different questions, three different winners.
   *
   * "Fewest points" and "least cash" pull in opposite directions and the best
   * value is often neither: on one real search LifeMiles wanted 28,000 more
   * points than Iberia to save $192 in fees. Ranking by cents-per-point alone
   * decided that trade for you and never showed the alternative. */
  var RESULT_SORTS = {
    value:  { label: 'Best value',    key: function (o) { return o.cpp == null ? -Infinity : o.cpp; }, desc: true },
    points: { label: 'Fewest points', key: function (o) { return o.miles; } },
    cash:   { label: 'Least cash',    key: function (o) { return o.outOfPocket || 0; } }
  };
  var resultSort = 'value';

  function sortOptions(list) {
    var s = RESULT_SORTS[resultSort] || RESULT_SORTS.value;
    return list.slice().sort(function (a, b) {
      var d = s.key(a) - s.key(b);
      if (d) return s.desc ? -d : d;
      // A stable tiebreak, so equal rows do not shuffle when you re-sort.
      return (b.cpp || 0) - (a.cpp || 0);
    });
  }

  function sortBar() {
    return '<div class="sort-bar"><span>Sort by</span>' +
      Object.keys(RESULT_SORTS).map(function (k) {
        return '<button type="button" class="sort-btn' + (k === resultSort ? ' is-on' : '') +
          '" data-sort="' + k + '">' + RESULT_SORTS[k].label + '</button>';
      }).join('') + '</div>';
  }

  /* One line you can scan, with the detail folded away behind it. The old
   * layout showed five metrics, four badges, a transfer plan, alternate
   * sources, provenance and three links on every one of 22 results — far too
   * much to read. */
  function renderOption(o, q, isBest) {
    var cls = 'result' + (isBest ? ' is-best' : '') + (o.affordable ? '' : ' is-locked');
    var h = '<details class="' + cls + '"' + (isBest ? ' open' : '') + '>';

    /* A loyalty program is not an airline. Iberia Avios shows up for an
     * American flight because Avios can ticket oneworld — which is not
     * obvious unless the row says so. */
    var CARRIER_NAMES = { AA: 'American', AS: 'Alaska', UA: 'United', DL: 'Delta',
                          B6: 'JetBlue', WN: 'Southwest' };
    var books = (PB.usCarriersFor(o.programId) || [])
      .map(function (c) { return CARRIER_NAMES[c] || c; });

    h += '<summary>' +
      '<span class="result-program">' + esc(o.program.short) +
        (books.length ? '<em> · books ' + esc(books.join(', ')) + '</em>' : '') +
        (o.roundTripChart ? '<em> · round trip</em>' : '') + '</span>' +
      '<span class="result-cost">' + PB.fmt.miles(o.miles) + '<small> pts</small></span>' +
      '<span class="result-tax">' + (o.taxes ? '+ ' + PB.fmt.money(o.taxes) : 'no fees') + '</span>' +
      '<span class="result-cpp ' + o.verdict + '">' + PB.fmt.cpp(o.cpp) + '</span>' +
      (o.affordable ? '' : '<span class="result-short">short ' + PB.fmt.miles(o.shortfall) + '</span>') +
      '</summary>';

    h += '<div class="result-body">';

    h += '<div class="metrics">' +
      '<div class="metric"><dt>Cash saved</dt><dd>' + PB.fmt.money(o.savings) + '</dd></div>' +
      '<div class="metric"><dt>Verdict</dt><dd class="' +
        (o.verdict === 'great' || o.verdict === 'good' ? 'good' : o.verdict === 'bad' ? 'bad' : '') +
        '" style="font-size:.85rem">' + VERDICT_LABEL[o.verdict] + '</dd></div>' +
      (q.passengers > 1 ? '<div class="metric"><dt>Per traveler</dt><dd>' + PB.fmt.miles(o.milesPerPerson) + '</dd></div>' : '') +
      '</div>';

    /* How you'd actually assemble the points */
    if (o.affordable && o.plan.steps.length) {
      h += '<div class="plan">';
      o.plan.steps.forEach(function (s) {
        if (s.type === 'direct') {
          h += '<div class="plan-step">Use <b>' + PB.fmt.miles(s.miles) + '</b> miles already in ' + esc(o.program.short) + '</div>';
        } else {
          h += '<div class="plan-step">Transfer <b>' + PB.fmt.miles(s.spend) + '</b> ' + esc(s.name) +
               ' <span class="plan-arrow">→</span> <b>' + PB.fmt.miles(s.gets) + '</b> ' + esc(o.program.short) +
               (s.bonus ? ' <span class="plan-bonus">+' + Math.round(s.bonus * 100) + '% bonus</span>' : '') +
               '</div>';
        }
      });
      h += '</div>';
    } else if (!o.affordable) {
      h += '<div class="plan"><div class="plan-step">You can reach <b>' + PB.fmt.miles(o.pool.total) +
           '</b> of the <b>' + PB.fmt.miles(o.miles) + '</b> needed' +
           (o.pool.paths.length ? ' (including everything transferable in)' : '') + '.</div></div>';
    }

    /* Other ways into this program, so one suggested route never reads as the
     * only route. */
    if (o.sources && o.sources.total) {
      var alsoHeld = (o.sources.held || []).filter(function (s) {
        return !o.plan.steps.some(function (st) { return st.currency === s.currency; });
      });
      var bits = [];
      if (alsoHeld.length) {
        bits.push('You could also use ' + alsoHeld.map(function (s) {
          return '<b>' + esc(s.name) + '</b>' + (s.ratio !== 1 ? ' (' + s.ratio + ':1)' : '');
        }).join(', '));
      }
      if (o.sources.others.length) {
        bits.push((bits.length ? 'Also transfers from ' : 'Transfers from ') +
          o.sources.others.map(function (s) { return esc(s.name); }).join(', '));
      }
      if (bits.length) {
        h += '<p class="alt-sources">' + bits.join('. ') + '.</p>';
      }
    } else if (o.pool && !o.pool.paths.length && !o.pool.direct) {
      h += '<p class="alt-sources warn">No US credit card currency transfers to ' +
           esc(o.program.short) + ' — miles must already be in the account.</p>';
    }

    h += '<div class="option-links">';
    h += '<span class="confidence' + (o.chartVerified ? ' verified' : '') + '" title="' +
         (o.chartVerified
           ? 'Checked against a published chart on ' + esc(o.verifiedOn || '')
           : 'Approximate — not yet checked against a published source') + '">' +
         esc(o.source) + (o.chartVerified ? ' · verified ' + esc(o.verifiedOn || '') : ' · unverified') +
         '</span>';
    PB.flights.awardSearchLinks(q, o.programId).forEach(function (l) {
      h += '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.name) + ' ↗</a>';
    });
    h += '</div>';

    if (o.note) h += '<p class="option-note">' + esc(o.note) + '</p>';

    return h + '</div></details>';
  }

  /* ═══════════════════════ Balances tab ═══════════════════════ */

  function bindBalances() {
    $('#clearBalances').addEventListener('click', function () {
      if (!confirm('Clear every balance you have entered? This cannot be undone.')) return;
      PB.store.patch({ balances: {} });
      state.balances = {};
      PB.store.save();
      renderBalances();
      updateBalanceChip();
    });
  }

  function renderBalances() {
    var sim = PB.applyCardBonuses({}, state.simulatedCards, state.customCards);

    function rows(host, entries) {
      host.innerHTML = '';
      entries.forEach(function (e) {
        var val = state.balances[e.id] || 0;
        var div = document.createElement('div');
        div.className = 'balance-row' + (val ? ' has-value' : '');
        div.innerHTML =
          '<label for="bal-' + e.id + '">' + esc(e.name) + '</label>' +
          '<span class="sub">' + esc(e.sub) + '</span>' +
          '<input id="bal-' + e.id + '" type="number" min="0" step="1000" placeholder="0" value="' + (val || '') + '">' +
          (sim[e.id] ? '<span class="sim">+' + PB.fmt.miles(sim[e.id]) + ' simulated from cards</span>' : '');
        var input = $('input', div);
        input.addEventListener('input', function () {
          PB.store.setBalance(e.id, parseFloat(this.value) || 0);
          div.classList.toggle('has-value', !!(parseFloat(this.value) || 0));
          updateBalanceChip();
          renderBalanceSummary();
        });
        host.appendChild(div);
      });
    }

    rows($('#currencyBalances'), Object.keys(PB.CURRENCIES).map(function (id) {
      return { id: id, name: PB.CURRENCIES[id].short, sub: PB.CURRENCIES[id].issuer };
    }));

    rows($('#programBalances'), Object.keys(PB.PROGRAMS).map(function (id) {
      var p = PB.PROGRAMS[id];
      return { id: id, name: p.short, sub: p.alliance === 'none' ? p.name : p.alliance };
    }));

    renderBalanceSummary();
  }

  function renderBalanceSummary() {
    var eff = effectiveBalances();
    var real = Object.keys(state.balances).reduce(function (a, k) { return a + state.balances[k]; }, 0);
    var total = Object.keys(eff).reduce(function (a, k) { return a + eff[k]; }, 0);
    var flexible = Object.keys(PB.CURRENCIES).reduce(function (a, k) { return a + (eff[k] || 0); }, 0);

    $('#balanceSummary').innerHTML =
      metric('Points you hold', PB.fmt.miles(real)) +
      metric('Simulated from cards', PB.fmt.miles(total - real)) +
      metric('Total available', PB.fmt.miles(total)) +
      metric('Transferable', PB.fmt.miles(flexible));
  }

  function updateBalanceChip() {
    var eff = effectiveBalances();
    var total = Object.keys(eff).reduce(function (a, k) { return a + eff[k]; }, 0);
    $('#balanceChip').textContent = PB.fmt.miles(total) + ' pts';
  }

  /* ═════════════════════════ Cards tab ════════════════════════ */

  function bindCards() {
    $('#cardSearch').addEventListener('input', renderCards);

    $('#rankCardsBtn').addEventListener('click', function () {
      if (!lastQuery || !lastQuery.cashPrice) {
        $('#cardRanking').innerHTML = '<p class="empty">Run a search first — the ranking is relative to a specific trip.</p>';
        return;
      }
      renderCardRanking();
    });

    var sel = $('#ccCurrency');
    Object.keys(PB.CURRENCIES).forEach(function (id) {
      sel.appendChild(new Option(PB.CURRENCIES[id].short, id));
    });
    Object.keys(PB.PROGRAMS).forEach(function (id) {
      sel.appendChild(new Option(PB.PROGRAMS[id].short + ' (airline)', id));
    });

    $('#customCardForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var card = {
        id: 'custom-' + Date.now(),
        name: $('#ccName').value.trim(),
        issuer: 'Custom',
        currency: $('#ccCurrency').value,
        bonus: parseInt($('#ccBonus').value, 10) || 0,
        minSpend: 0, spendMonths: 0,
        fee: parseInt($('#ccFee').value, 10) || 0,
        custom: true
      };
      state.customCards.push(card);
      PB.store.save();
      this.reset();
      renderCards();
    });
  }

  function allCards() { return PB.CARDS.concat(state.customCards || []); }

  function renderCards() {
    var filter = ($('#cardSearch').value || '').toLowerCase();
    var host = $('#cardList');
    host.innerHTML = '';

    allCards().filter(function (c) {
      return !filter || (c.name + ' ' + c.issuer).toLowerCase().indexOf(filter) !== -1;
    }).forEach(function (c) {
      var on = state.simulatedCards.indexOf(c.id) !== -1;
      var currencyName = (PB.CURRENCIES[c.currency] || PB.PROGRAMS[c.currency] || {}).short || c.currency;
      var label = document.createElement('label');
      label.className = 'cc' + (on ? ' is-on' : '');
      label.innerHTML =
        '<input type="checkbox"' + (on ? ' checked' : '') + '>' +
        '<span class="cc-body">' +
          '<span class="cc-name">' + esc(c.name) + '</span>' +
          '<span class="cc-meta">' + esc(c.issuer) + ' · ' + esc(currencyName) +
            (c.fee ? ' · $' + c.fee + '/yr' : ' · no annual fee') + '</span>' +
          '<span class="cc-bonus">' + (c.bonus ? '+' + PB.fmt.miles(c.bonus) + ' pts' : 'no welcome bonus') +
            (c.minSpend ? ' after $' + PB.fmt.miles(c.minSpend) + ' spend' : '') + '</span>' +
          (c.note ? '<span class="cc-meta">' + esc(c.note) + '</span>' : '') +
        '</span>';

      $('input', label).addEventListener('change', function () {
        var idx = state.simulatedCards.indexOf(c.id);
        if (this.checked && idx === -1) state.simulatedCards.push(c.id);
        if (!this.checked && idx !== -1) state.simulatedCards.splice(idx, 1);
        PB.store.save();
        label.classList.toggle('is-on', this.checked);
        renderCardSimSummary();
        renderBalances();
        updateBalanceChip();
        if (lastQuery && lastQuery.cashPrice) evaluateWith(lastQuery, lastQuery.cashPrice);
      });

      host.appendChild(label);
    });
  }

  function renderCardSimSummary() {
    var cost = PB.cardCost(state.simulatedCards, state.customCards);
    $('#cardSimSummary').innerHTML =
      metric('Cards modelled', String(state.simulatedCards.length)) +
      metric('Bonus points added', PB.fmt.miles(cost.bonus)) +
      metric('First-year fees', PB.fmt.money(cost.fees)) +
      metric('Spend required', PB.fmt.money(cost.minSpend));
  }

  function renderCardRanking() {
    var host = $('#cardRanking');
    host.innerHTML = '<p class="empty">Working…</p>';

    var q = {
      from: lastQuery.from, to: lastQuery.to, cabin: lastQuery.cabin,
      cashPrice: lastQuery.cashPrice, passengers: lastQuery.passengers,
      roundTrip: lastQuery.roundTrip
    };

    var ranked = PB.rankCardsForTrip(q, state.balances, {
      customCards: state.customCards,
      exclude: state.simulatedCards
    });

    if (ranked.error) { host.innerHTML = '<p class="empty">' + esc(ranked.error) + '</p>'; return; }

    var helping = ranked.rows.filter(function (r) { return r.helps; });
    var h = '<p class="hint" style="margin:.7rem 0">Trip: <b>' + esc(q.from) + ' → ' + esc(q.to) + '</b>, ' +
            esc(PB.CABINS[q.cabin].name) + ', ' + PB.fmt.money(q.cashPrice) + ' cash' +
            (ranked.bestBefore
              ? '. You can already book this via <b>' + esc(ranked.bestBefore.program.short) + '</b> at ' + PB.fmt.cpp(ranked.bestBefore.cpp) + '/pt.'
              : '. You cannot currently book this with your balances.') + '</p>';

    if (!helping.length) {
      h += '<p class="empty">No single welcome bonus changes the outcome for this trip.</p>';
    } else {
      helping.slice(0, 12).forEach(function (r) {
        h += '<div class="rank-row"><div class="rank-main">' +
          '<div class="rank-name">' + esc(r.card.name) +
            (r.unlocks ? ' <span class="badge good">Unlocks the trip</span>' : ' <span class="badge info">Better rate</span>') +
          '</div>' +
          '<div class="rank-meta">+' + PB.fmt.miles(r.card.bonus) + ' ' + esc(r.currencyName) +
            (r.card.minSpend ? ' after $' + PB.fmt.miles(r.card.minSpend) + ' spend' : '') +
            (r.card.fee ? ' · $' + r.card.fee + ' annual fee' : ' · no annual fee') +
            (r.best ? ' · books via ' + esc(r.best.program.short) + ' for ' + PB.fmt.miles(r.best.miles) + ' pts' : '') +
          '</div></div>' +
          '<div class="rank-value">' + PB.fmt.money(r.netValue) + '<small>value after fee</small></div></div>';
      });
      h += '<p class="hint" style="margin-top:.8rem">"Value after fee" is the cash fare you avoid, minus the card\'s first-year annual fee. ' +
           'It ignores minimum-spend difficulty, approval odds, and issuer rules like Chase 5/24.</p>';
    }
    host.innerHTML = h;
  }

  /* ═══════════════════════ Settings tab ═══════════════════════ */

  function bindSettings() {
    var proxy = $('#proxyInput');
    proxy.value = state.settings.proxyUrl || '';
    proxy.addEventListener('change', function () {
      PB.store.patch({ settings: { proxyUrl: this.value.trim() } });
      applyFareSource(readForm().fareSource);
    });

    /* Say plainly that there is nothing to do here, so nobody goes hunting for
     * a setup step they don't need. */
    var intro = $('#proxyIntro');
    if (PB.flights.usingSharedProxy(state.settings)) {
      proxy.placeholder = 'Using the site\'s lookup — leave empty';
      intro.innerHTML = '<b>Live search is already set up.</b> ' +
        esc(PB.CONFIG.sharedProxyNote || '') + ' Nothing to configure.';
    } else if (PB.flights.hasProxy(state.settings)) {
      intro.textContent = 'Live fares come from your own worker at ' +
        PB.flights.proxyUrl(state.settings) + '.';
    } else {
      intro.innerHTML = 'No fare lookup is configured, so <b>Live search</b> is unavailable. ' +
        'Paste or type a price instead, or deploy the worker in <code>worker/</code>.';
    }

    $('#testProxy').addEventListener('click', function () {
      var url = proxy.value.trim() || PB.flights.proxyUrl(state.settings);
      var status = $('#proxyStatus');
      if (!url) { status.textContent = 'No worker to test — add one below.'; return; }
      status.textContent = 'Testing…';
      fetch(url.replace(/\/+$/, '') + '/health')
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { status.textContent = 'Reachable but unhealthy.'; return; }
          /* Name the provider the worker reports rather than a hardcoded one -
           * this proxy has already changed providers once. */
          status.textContent = 'Connected to ' + (j.provider || 'the fare provider') + '. ' +
            (j.credentials ? 'API key present.' : 'API KEY MISSING — set it on the worker.');
        })
        .catch(function (e) { status.textContent = 'Failed: ' + e.message; });
    });

    $('#exportBtn').addEventListener('click', function () {
      var text = PB.store.exportJSON();
      navigator.clipboard.writeText(text).then(function () {
        $('#exportBtn').textContent = 'Copied ✓';
        setTimeout(function () { $('#exportBtn').textContent = 'Copy backup to clipboard'; }, 1800);
      }).catch(function () {
        $('#importArea').hidden = false;
        $('#importArea').value = text;
      });
    });

    $('#importBtn').addEventListener('click', function () {
      var area = $('#importArea');
      if (area.hidden) { area.hidden = false; area.focus(); return; }
      try {
        state = PB.store.importJSON(area.value);
        renderBalances(); renderCards(); renderCardSimSummary();
        updateBalanceChip(); restoreSearchForm();
        area.hidden = true;
        alert('Backup restored.');
      } catch (e) {
        alert('That does not look like a valid backup: ' + e.message);
      }
    });

    $('#resetBtn').addEventListener('click', function () {
      if (!confirm('Erase all balances, simulated cards, and settings from this browser?')) return;
      PB.store.reset();
      state = PB.store.load();
      renderBalances(); renderCards(); renderCardSimSummary();
      updateBalanceChip(); restoreSearchForm();
      $('#results').innerHTML = '';
    });
  }

  /* ═══════════════════ PWA install prompt ═════════════════════ */

  /* iOS never fires beforeinstallprompt, so the Install button below never
   * appears there — and on iOS the stakes are higher than convenience. Safari
   * deletes all script-writable storage (localStorage included) after 7 days
   * without a visit, which for a trip-planning app means balances vanish
   * between trips. Web apps on the Home Screen are exempt: they keep their own
   * usage counter. So on iOS, installing IS the persistence story. */
  function bindIosInstallNotice() {
    var notice = $('#iosInstallNotice');
    if (!notice) return;

    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
                // iPadOS 13+ reports as Mac; touch points give it away.
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = navigator.standalone === true ||
                     window.matchMedia('(display-mode: standalone)').matches;

    if (!isIOS || standalone || state.settings.iosNoticeDismissed) return;

    notice.hidden = false;
    $('#dismissIosNotice').addEventListener('click', function () {
      notice.hidden = true;
      PB.store.patch({ settings: { iosNoticeDismissed: true } });
    });
  }

  function bindInstall() {
    var deferred = null;
    var btn = $('#installBtn');

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      btn.hidden = false;
    });

    btn.addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.finally(function () {
        deferred = null;
        btn.hidden = true;
      });
    });

    window.addEventListener('appinstalled', function () { btn.hidden = true; });
  }

  document.addEventListener('DOMContentLoaded', init);

})(window.PB);
