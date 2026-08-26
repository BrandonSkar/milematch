/* Local persistence. Everything lives in this browser's localStorage and is
 * never transmitted anywhere. The only outbound request the app ever makes is
 * the optional flight-price lookup through your own proxy. */
window.PB = window.PB || {};

(function (PB) {
  'use strict';

  var KEY = 'pb.state.v1';

  var DEFAULTS = {
    balances: {},          // { UR: 60000, AC: 12000, ... }
    /* When each balance was last set, ISO date, kept ALONGSIDE the amounts
     * rather than inside them. The engine takes balances as plain
     * { id: number } and so do the tests; wrapping every amount in an object
     * to carry one date would ripple through all of it for no gain. */
    balanceUpdated: {},    // { UR: '2026-08-25', ... }
    simulatedCards: [],    // card ids whose welcome bonus is being modelled
    /* Cards whose welcome bonus you have already earned. Those points are real
     * now and belong in `balances`, so the bonus must never be added again —
     * simulating it a second time builds a plan on points that do not exist,
     * and most issuers will not pay the same welcome bonus twice anyway. */
    heldCards: [],         // card ids you already hold
    customCards: [],       // user-defined cards
    settings: {
      proxyUrl: '',
      iosNoticeDismissed: false
    },
    lastSearch: {
      from: '', to: '', origins: [], destinations: [],
      date: '', returnDate: '',
      cabin: 'j', passengers: 1, roundTrip: true, cashPrice: null
    }
  };

  function deepMerge(base, patch) {
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    /* Object.assign copies an array property by REFERENCE, so a state built
     * from DEFAULTS shared DEFAULTS' own arrays: ticking a card pushed into
     * DEFAULTS.simulatedCards, and reset() then handed that same dirty array
     * straight back. Clone them so "clear everything" actually clears. */
    if (!Array.isArray(out)) {
      Object.keys(out).forEach(function (k) {
        if (Array.isArray(out[k])) out[k] = out[k].slice();
      });
    }
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
        out[k] = deepMerge(base[k] || {}, patch[k]);
      } else {
        out[k] = patch[k];
      }
    });
    return out;
  }

  /* Copy `source` over `target` WITHOUT swapping the object itself.
   *
   * app.js takes one reference from load() and holds it for the life of the
   * page. Any method that did `this.state = ...` silently orphaned that
   * reference: the app kept writing to a dead copy while save() serialised a
   * different one, so a change would render correctly and then vanish on
   * reload. Nothing may replace the state object once handed out. */
  function adopt(target, source) {
    Object.keys(target).forEach(function (k) {
      if (!(k in source)) delete target[k];
    });
    Object.keys(source).forEach(function (k) { target[k] = source[k]; });
    return target;
  }

  PB.store = {
    state: null,

    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        var next = raw ? deepMerge(DEFAULTS, JSON.parse(raw)) : deepMerge(DEFAULTS, {});
        this.state = this.state ? adopt(this.state, next) : next;
      } catch (e) {
        console.warn('Could not read saved state, starting fresh.', e);
        var blank = deepMerge(DEFAULTS, {});
        this.state = this.state ? adopt(this.state, blank) : blank;
      }
      return this.state;
    },

    save: function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state));
      } catch (e) {
        console.warn('Could not save state.', e);
      }
    },

    patch: function (patch) {
      adopt(this.state, deepMerge(this.state, patch));
      this.save();
      return this.state;
    },

    setBalance: function (id, value) {
      if (!value || value <= 0) {
        delete this.state.balances[id];
        delete this.state.balanceUpdated[id];
      } else {
        this.state.balances[id] = Math.round(value);
        this.state.balanceUpdated[id] = new Date().toISOString().slice(0, 10);
      }
      this.save();
    },

    reset: function () {
      if (!this.state) this.state = {};
      adopt(this.state, deepMerge(DEFAULTS, {}));
      this.save();
    },

    exportJSON: function () {
      return JSON.stringify(this.state, null, 2);
    },

    importJSON: function (text) {
      var parsed = JSON.parse(text);
      if (!this.state) this.state = {};
      adopt(this.state, deepMerge(DEFAULTS, parsed));
      this.save();
      return this.state;
    }
  };

})(window.PB);
