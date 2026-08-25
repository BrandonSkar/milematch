/* Reading point balances out of a rewards page you copied.
 *
 * There is no API for this. Chase, Amex, Citi and the airlines publish no
 * consumer endpoint for a points balance, and Plaid deals in dollars, not
 * points. The only ways to genuinely automate it are a paid aggregator with an
 * OAuth contract, or storing someone's airline password and logging in as
 * them - which this app will not do.
 *
 * So the same trick the fare parser uses: you are already looking at the page.
 * Select all, copy, paste. Your browser did the browsing, as a person, which
 * was never the hard part. One paste updates every balance it recognises, no
 * account, no server, nothing leaves the device.
 *
 * The parser is deliberately loose. It anchors on program NAMES rather than on
 * layout, so it survives a redesign and works on text copied from a bank page,
 * an airline page, or a tracker like AwardWallet.
 */
window.PB = window.PB || {};

(function (PB) {
  'use strict';

  /* Names a balance might be printed under, beyond the ones already in
   * PB.CURRENCIES and PB.PROGRAMS. Lowercase; matched as whole phrases.
   *
   * Bare "avios" is deliberately absent: British Airways, Iberia and Qatar all
   * denominate in Avios, so the word alone cannot say which account it is. The
   * programme names below disambiguate; an unlabelled "Avios" is reported as
   * unrecognised rather than guessed into the wrong balance. */
  var ALIASES = {
    UR:   ['ultimate rewards', 'chase points'],
    MR:   ['membership rewards', 'amex points'],
    C1:   ['capital one miles', 'venture miles', 'capital one rewards', 'capital one travel'],
    TYP:  ['thankyou points', 'thank you points', 'citi points', 'thankyou rewards'],
    BILT: ['bilt rewards', 'bilt points'],
    WF:   ['wells fargo rewards', 'go far rewards'],

    AA:   ['aadvantage', 'advantage miles'],
    AS:   ['mileage plan'],
    UA:   ['mileageplus', 'mileage plus'],
    DL:   ['skymiles', 'sky miles'],
    WN:   ['rapid rewards'],
    B6:   ['trueblue', 'true blue'],
    AC:   ['aeroplan'],
    BA:   ['executive club', 'british airways avios'],
    IB:   ['iberia plus', 'iberia avios'],
    QR:   ['privilege club', 'qatar avios'],
    VS:   ['flying club'],
    AF:   ['flying blue'],
    NH:   ['ana mileage club', 'ana miles'],
    SQ:   ['krisflyer', 'kris flyer'],
    TK:   ['miles&smiles', 'miles and smiles', 'miles & smiles'],
    AV:   ['lifemiles', 'life miles'],
    EK:   ['emirates skywards', 'skywards'],
    EY:   ['etihad guest'],
    CX:   ['asia miles', 'cathay membership'],
    QF:   ['qantas frequent flyer', 'qantas points'],
    AM:   ['club premier'],
    SK:   ['eurobonus', 'euro bonus']
  };

  /** Every phrase that identifies a balance, longest first so that
   *  "british airways avios" wins over a shorter overlapping name. */
  function phraseTable() {
    var out = [];
    function add(id, phrase) {
      phrase = String(phrase || '').toLowerCase().trim();
      // Two characters is a code, not a name; matching those hits everything.
      if (phrase.length > 3) out.push({ id: id, phrase: phrase });
    }

    Object.keys(PB.CURRENCIES || {}).forEach(function (id) {
      add(id, PB.CURRENCIES[id].name);
      add(id, PB.CURRENCIES[id].short);
    });
    Object.keys(PB.PROGRAMS || {}).forEach(function (id) {
      add(id, PB.PROGRAMS[id].name);
      add(id, PB.PROGRAMS[id].short);
    });
    Object.keys(ALIASES).forEach(function (id) {
      ALIASES[id].forEach(function (p) { add(id, p); });
    });

    out.sort(function (a, b) { return b.phrase.length - a.phrase.length; });
    return out;
  }

  /* A number that could plausibly be a balance.
   *
   * The traps are years and account numbers, which look identical to a small
   * balance. A grouped number ("84,062") or one sitting next to the words
   * points or miles is almost certainly a balance; a bare four-digit number in
   * calendar range almost certainly is not. */
  function balanceIn(line) {
    var best = null;
    var re = /([0-9][0-9,]{2,})(?:\.\d+)?/g;
    var m;
    while ((m = re.exec(line)) !== null) {
      var raw = m[1];
      var grouped = raw.indexOf(',') !== -1;
      var value = parseInt(raw.replace(/,/g, ''), 10);
      if (!(value >= 100 && value <= 20000000)) continue;

      var around = line.slice(Math.max(0, m.index - 24), m.index + raw.length + 24);
      var labelled = /\b(points?|miles?|pts|balance|available)\b/i.test(around);

      // A plain 1900-2100 with nothing calling it points is a date.
      if (!grouped && !labelled && value >= 1900 && value <= 2100) continue;

      var score = (grouped ? 2 : 0) + (labelled ? 2 : 0) + (value >= 1000 ? 1 : 0);
      if (!best || score > best.score) best = { value: value, score: score };
    }
    return best;
  }

  /**
   * Pull balances out of copied text.
   *
   * @returns {{ found: Array, unmatched: Array }}
   *   found     [{ id, name, value, line }] one per recognised programme
   *   unmatched program names seen with no number anywhere near them
   */
  PB.parseBalances = function (text) {
    var lines = String(text || '').split('\n')
      .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
      .filter(function (l) { return l.length; });

    var table = phraseTable();
    var found = {};
    var unmatched = {};

    /* Which programme, if any, each line names. Computed up front because it
     * is also the fence: a search for one programme's number must never run
     * past the line where the next programme starts, or a list like
     * "Membership Rewards / Mileage Plan / 61,900" hands Amex the Alaska
     * balance. Same bounding rule the fare parser uses. */
    var owner = lines.map(function (line) {
      var lower = line.toLowerCase();
      for (var t = 0; t < table.length; t++) {
        if (lower.indexOf(table[t].phrase) !== -1) return table[t].id;
      }
      return null;
    });

    /* A number belongs to exactly one account. Without claiming the line it
     * came from, a programme named just below someone else's balance reads
     * that balance backwards and both end up holding it. */
    var claimed = {};

    lines.forEach(function (line, i) {
      var id = owner[i];
      if (!id || found[id]) return;

      /* The number sits on the same line, or below it, sometimes with a line
       * of chrome in between ("SkyMiles" / "Statement closing" / "48,300
       * miles"). Occasionally a table puts it just above. Nearest wins. */
      var candidates = [{ idx: i, weight: 3 }];
      for (var j = i + 1; j < lines.length && j <= i + 2 && !owner[j]; j++) {
        candidates.push({ idx: j, weight: i + 2 - j + 1 });
      }
      if (i > 0 && !owner[i - 1]) candidates.push({ idx: i - 1, weight: 1 });

      var best = null;
      candidates.forEach(function (c) {
        if (claimed[c.idx]) return;
        var b = balanceIn(lines[c.idx]);
        if (!b) return;
        var score = b.score + c.weight;
        if (!best || score > best.score) best = { value: b.value, score: score, idx: c.idx };
      });

      if (best) {
        claimed[best.idx] = true;
        found[id] = { id: id, name: labelFor(id), value: best.value, line: lines[best.idx] };
      } else {
        unmatched[id] = labelFor(id);
      }
    });

    return {
      found: Object.keys(found).map(function (k) { return found[k]; })
        .sort(function (a, b) { return b.value - a.value; }),
      unmatched: Object.keys(unmatched)
        .filter(function (k) { return !found[k]; })
        .map(function (k) { return unmatched[k]; })
    };
  };

  function labelFor(id) {
    if (PB.CURRENCIES && PB.CURRENCIES[id]) return PB.CURRENCIES[id].short;
    if (PB.PROGRAMS && PB.PROGRAMS[id]) return PB.PROGRAMS[id].short;
    return id;
  }

  /* ------------------------------------------------------------------
   * Age.
   *
   * A number typed in April looks exactly like one typed today, and with
   * hand-entered balances staleness IS the failure mode - the app will happily
   * tell you to transfer points you spent months ago. Every balance carries
   * the day it was last set so the UI can say how old it is.
   * ---------------------------------------------------------------- */

  PB.balanceAge = function (iso, today) {
    if (!iso) return null;
    var a = /(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!a) return null;
    var then = Date.UTC(a[1], a[2] - 1, a[3]);
    var now = today ? Date.parse(today) : Date.now();
    return Math.max(0, Math.floor((now - then) / 86400000));
  };

  /** Plain English, and deliberately vague past a point — "about 5 months"
   *  is the honest resolution for a number somebody typed from memory. */
  PB.balanceAgeText = function (iso, today) {
    var days = PB.balanceAge(iso, today);
    if (days === null) return 'never updated';
    if (days === 0) return 'updated today';
    if (days === 1) return 'updated yesterday';
    if (days < 31) return 'updated ' + days + ' days ago';
    var months = Math.round(days / 30.44);
    if (months < 24) return 'updated about ' + months + ' month' + (months > 1 ? 's' : '') + ' ago';
    return 'updated over ' + Math.floor(months / 12) + ' years ago';
  };

  /** Old enough that the app should say so rather than quietly trust it. */
  PB.balanceIsStale = function (iso, today) {
    var days = PB.balanceAge(iso, today);
    return days === null || days >= 90;
  };

})(window.PB);
