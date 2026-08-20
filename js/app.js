/* UI controller. Vanilla DOM — no framework, no build step. */
(function (PB) {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state, lastResult = null, lastQuery = null, liveOffers = [], selectedOfferId = null;

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

    ['#fromInput', '#toInput'].forEach(function (sel) {
      $(sel).addEventListener('input', function () {
        this.value = this.value.toUpperCase().slice(0, 3);
        updateAirportHints();
        persistSearchForm();
      });
    });

    $('#roundTripInput').addEventListener('change', function () {
      $('#returnField').style.opacity = this.checked ? '1' : '.45';
      $('#returnInput').disabled = !this.checked;
      refreshExternalLinks();
      persistSearchForm();
    });

    $$('input[name=fareSource]').forEach(function (r) {
      r.addEventListener('change', function () { applyFareSource(this.value); persistSearchForm(); });
    });

    /* Every one of these feeds the Google Flights deep link, so the link has
     * to be rebuilt on each — not just when the airport fields change. */
    ['#dateInput', '#returnInput', '#cabinInput', '#paxInput', '#cashInput'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        refreshExternalLinks();
        persistSearchForm();
      });
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

    if (mode === 'live') {
      var hint = $('#liveFareHint');
      if (PB.flights.hasProxy(state.settings)) {
        hint.textContent = 'Fares come from Amadeus through your worker at ' + state.settings.proxyUrl;
        hint.classList.remove('warn');
      } else {
        hint.innerHTML = 'No worker URL configured yet. Add one under <b>Settings</b>, or switch back to entering the price yourself.';
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
    var link = $('#gfLink');
    if (!link) return;

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
      fareSource: ($$('input[name=fareSource]').filter(function (r) { return r.checked; })[0] || {}).value || 'manual'
    };
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

    var mode = (state.settings && state.settings.fareSource) || 'manual';
    var radio = $$('input[name=fareSource]').filter(function (r) { return r.value === mode; })[0];
    if (radio) radio.checked = true;
    applyFareSource(mode);
    updateAirportHints();
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
        if (!offers.length) {
          setStatus('No fares came back for that route and date. Try another date, or enter a price manually.', 'err');
          $('#results').innerHTML = '';
          return;
        }
        setStatus('');
        selectedOfferId = offers[0].id;
        renderOffers();
        evaluateWith(q, offers[0].price);
      }).catch(function (err) {
        setStatus('Live search failed: ' + esc(err.message) +
          '<br><small>Check the worker URL in Settings, or switch to entering the price yourself.</small>', 'err');
      });
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
      balances: effectiveBalances()
    });
    if (result.error) { setStatus(esc(result.error), 'err'); return; }
    lastResult = result;
    lastQuery = Object.assign({}, q, { cashPrice: cashPrice });
    renderResults(result, lastQuery);
  }

  function renderOffers() {
    var wrap = $('#offers');
    wrap.innerHTML = '';
    liveOffers.slice(0, 12).forEach(function (o) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'offer' + (o.id === selectedOfferId ? ' is-selected' : '');
      btn.innerHTML =
        '<span class="offer-main">' +
          '<span class="offer-carrier">' + esc(o.carriers.join(', ')) + '</span>' +
          '<span class="offer-meta">' + (o.stops === 0 ? 'Nonstop' : o.stops + ' stop' + (o.stops > 1 ? 's' : '')) +
            (o.durationText ? ' · ' + esc(o.durationText) : '') + '</span>' +
        '</span>' +
        '<span class="offer-price">' + PB.fmt.money(o.price) + '</span>';
      btn.addEventListener('click', function () {
        selectedOfferId = o.id;
        renderOffers();
        evaluateWith(lastQuery, o.price);
      });
      wrap.appendChild(btn);
    });
    $('#offersWrap').hidden = false;
  }

  var VERDICT_LABEL = { great: 'Excellent value', good: 'Good value', poor: 'Weak — consider cash', bad: 'Do not book', unknown: '—' };

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

    html += '<h2 class="section-title">Redemption options <small>ranked by value per point, affordable first</small></h2>';

    if (!shown.length) {
      html += '<p class="empty">Nothing to show.</p>';
    } else {
      shown.forEach(function (o, i) { html += renderOption(o, q, i === 0 && o.affordable); });
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
  }

  function metric(label, value) {
    return '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  }

  function renderOption(o, q, isBest) {
    var cls = 'option' + (isBest ? ' is-best' : '') + (o.affordable ? '' : ' is-unaffordable');
    var h = '<div class="' + cls + '">';

    h += '<div class="option-head"><div class="option-name">' + esc(o.program.name) +
         (o.program.alliance && o.program.alliance !== 'none'
            ? '<span class="option-alliance">' + esc(o.program.alliance) + '</span>' : '') +
         '</div><div class="badges">';
    if (isBest) h += '<span class="badge great">Best match</span>';
    if (o.verdict !== 'unknown') h += '<span class="badge ' + o.verdict + '">' + VERDICT_LABEL[o.verdict] + '</span>';
    if (!o.affordable) h += '<span class="badge short">Short ' + PB.fmt.miles(o.shortfall) + '</span>';
    if (o.roundTripChart) h += '<span class="badge info">Round trip only</span>';
    h += '</div></div>';

    h += '<div class="metrics">' +
      '<div class="metric"><dt>Points</dt><dd>' + PB.fmt.miles(o.miles) + '</dd></div>' +
      '<div class="metric"><dt>Taxes &amp; fees</dt><dd class="' + (o.taxes > (q.cashPrice || 0) * 0.4 ? 'bad' : '') + '">' + PB.fmt.money(o.taxes) + '</dd></div>' +
      '<div class="metric"><dt>Value per point</dt><dd class="' + (o.verdict === 'great' || o.verdict === 'good' ? 'good' : o.verdict === 'bad' ? 'bad' : '') + '">' + PB.fmt.cpp(o.cpp) + '</dd></div>' +
      '<div class="metric"><dt>Cash saved</dt><dd>' + PB.fmt.money(o.savings) + '</dd></div>' +
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

    h += '<div class="option-links">';
    h += '<span class="confidence">' + esc(o.source) + '</span>';
    PB.flights.awardSearchLinks(q, o.programId).forEach(function (l) {
      h += '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.name) + ' ↗</a>';
    });
    h += '</div>';

    if (o.note) h += '<p class="option-note">' + esc(o.note) + '</p>';

    return h + '</div>';
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

    $('#testProxy').addEventListener('click', function () {
      var url = proxy.value.trim();
      var status = $('#proxyStatus');
      if (!url) { status.textContent = 'Enter a URL first.'; return; }
      status.textContent = 'Testing…';
      fetch(url.replace(/\/+$/, '') + '/health')
        .then(function (r) { return r.json(); })
        .then(function (j) {
          status.textContent = j.ok ? 'Connected. Amadeus credentials ' + (j.credentials ? 'present.' : 'MISSING — set them in the worker.') : 'Reachable but unhealthy.';
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
