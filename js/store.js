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
    customCards: [],       // user-defined cards
    settings: {
      proxyUrl: '',
      fareSource: 'paste',  // 'paste' | 'manual' | 'estimate' | 'live'
      hideUnaffordable: false,
      iosNoticeDismissed: false
    },
    lastSearch: {
      from: '', to: '', date: '', returnDate: '',
      cabin: 'j', passengers: 1, roundTrip: true, cashPrice: null
    }
  };

  function deepMerge(base, patch) {
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
        out[k] = deepMerge(base[k] || {}, patch[k]);
      } else {
        out[k] = patch[k];
      }
    });
    return out;
  }

  PB.store = {
    state: null,

    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        this.state = raw ? deepMerge(DEFAULTS, JSON.parse(raw)) : deepMerge(DEFAULTS, {});
      } catch (e) {
        console.warn('Could not read saved state, starting fresh.', e);
        this.state = deepMerge(DEFAULTS, {});
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
      this.state = deepMerge(this.state, patch);
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
      this.state = deepMerge(DEFAULTS, {});
      this.save();
    },

    exportJSON: function () {
      return JSON.stringify(this.state, null, 2);
    },

    importJSON: function (text) {
      var parsed = JSON.parse(text);
      this.state = deepMerge(DEFAULTS, parsed);
      this.save();
      return this.state;
    }
  };

})(window.PB);
