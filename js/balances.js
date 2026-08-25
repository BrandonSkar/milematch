/* How old a balance is.
 *
 * Balances are entered by hand. There is no consumer API for a points balance
 * - Chase, Amex, Citi and the airlines publish none, and Plaid deals in
 * dollars, not points - so the number in the box is whatever somebody last
 * typed there.
 *
 * That makes staleness the failure mode. A number typed in April looks exactly
 * like one typed today, and the app will happily tell you to transfer points
 * you spent months ago. Every balance carries the day it was set so the UI can
 * say how old it is, and flag the ones too old to trust.
 */
window.PB = window.PB || {};

(function (PB) {
  'use strict';

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
