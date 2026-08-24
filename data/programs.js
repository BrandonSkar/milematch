/* Loyalty currencies, airline programs, and transfer ratios.
 *
 * !! EDIT THIS FILE FREELY !!  Transfer ratios and partnerships change several
 * times a year, and transfer bonuses (e.g. "Amex -> Virgin Atlantic +30%") run
 * constantly. Nothing here is compiled — change a number, reload the page.
 *
 * asOf marks when these values were last reviewed. Treat everything as a
 * starting point to verify, not as an authority.
 */
window.PB = window.PB || {};

PB.META = { asOf: '2026-08', currency: 'USD' };

/* ---------------------------------------------------------------------------
 * Transferable ("flexible") currencies — the ones a credit card earns directly.
 * baseline = your personal floor value in cents per point. If a redemption
 * comes in under this, the app tells you to pay cash instead.
 * ------------------------------------------------------------------------- */
PB.CURRENCIES = {
  UR:   { name: 'Chase Ultimate Rewards',   short: 'Chase UR',  issuer: 'Chase',          baseline: 1.9, portalCpp: 1.25 },
  MR:   { name: 'Amex Membership Rewards',  short: 'Amex MR',   issuer: 'American Express', baseline: 1.8, portalCpp: 1.0 },
  C1:   { name: 'Capital One Miles',        short: 'Cap One',   issuer: 'Capital One',    baseline: 1.7, portalCpp: 1.0 },
  TYP:  { name: 'Citi ThankYou Points',     short: 'Citi TYP',  issuer: 'Citi',           baseline: 1.7, portalCpp: 1.0 },
  BILT: { name: 'Bilt Rewards',             short: 'Bilt',      issuer: 'Bilt',           baseline: 1.8, portalCpp: 1.25 },
  WF:   { name: 'Wells Fargo Rewards',      short: 'Wells Fargo', issuer: 'Wells Fargo',  baseline: 1.6, portalCpp: 1.0 }
};

/* ---------------------------------------------------------------------------
 * Airline programs you can actually ticket with.
 *
 *  chart      : which pricing model data/charts.js uses
 *               'distance' | 'region' | 'dynamic' | 'fixed'
 *  alliance   : Star | oneworld | SkyTeam | none
 *  surcharge  : how badly this program passes through carrier-imposed fees (YQ)
 *               'none' | 'low' | 'medium' | 'high'  -> drives the taxes estimate
 *  roundTripOnly : chart prices are for round trips (ANA)
 *  baseline   : your floor cpp for this specific currency
 *  verify     : where to confirm the real price before you transfer anything
 * ------------------------------------------------------------------------- */
PB.PROGRAMS = {
  AC: {
    name: 'Air Canada Aeroplan', short: 'Aeroplan', alliance: 'Star',
    chart: 'zoneDistance', surcharge: 'low', baseline: 1.5, chartVerified: true,
    verify: 'https://www.aircanada.com/aeroplan',
    note: 'Zone pair first, then distance bands within it. No fuel surcharges on most Star partners, but Lufthansa/Austrian/Swiss pass some through.'
  },
  UA: {
    name: 'United MileagePlus', short: 'United', alliance: 'Star',
    chart: 'dynamic', dynamicCpp: 1.35, surcharge: 'none', baseline: 1.3,
    verify: 'https://www.united.com',
    note: 'Fully dynamic on United metal. Partner saver space is closer to a chart but United no longer publishes one — treat the number as an estimate.'
  },
  DL: {
    name: 'Delta SkyMiles', short: 'Delta', alliance: 'SkyTeam',
    chart: 'dynamic', dynamicCpp: 1.15, surcharge: 'none', baseline: 1.1,
    verify: 'https://www.delta.com',
    note: 'Fully dynamic and generally poor value. Included so you can see when it is NOT the answer.'
  },
  AA: {
    name: 'American AAdvantage', short: 'American', alliance: 'oneworld',
    chart: 'region', surcharge: 'low', baseline: 1.4,
    verify: 'https://www.aa.com',
    note: 'AA metal is dynamic; the partner award chart still applies to oneworld partners. Chart values here are the partner saver levels.'
  },
  AS: {
    name: 'Alaska Mileage Plan', short: 'Alaska', alliance: 'oneworld',
    chart: 'region', surcharge: 'low', baseline: 1.5,
    verify: 'https://www.alaskaair.com',
    note: 'Partner pricing shifted toward distance/dynamic in recent years. Verify before transferring.'
  },
  VS: {
    name: 'Virgin Atlantic Flying Club', short: 'Virgin Atlantic', alliance: 'SkyTeam',
    chart: 'region', surcharge: 'high', baseline: 1.6,
    verify: 'https://www.virginatlantic.com',
    note: 'Excellent partner sweet spots (ANA, Delta One), but Virgin\'s own metal carries heavy surcharges.'
  },
  AV: {
    name: 'Avianca LifeMiles', short: 'LifeMiles', alliance: 'Star',
    chart: 'region', surcharge: 'none', baseline: 1.5,
    verify: 'https://www.lifemiles.com',
    note: 'No fuel surcharges on any partner — often the cheapest all-in way to fly Star Alliance business. LifeMiles now prices in ranges rather than fixed cells; figures here are the saver end, so expect to be quoted more.'
  },
  TK: {
    name: 'Turkish Miles&Smiles', short: 'Turkish', alliance: 'Star',
    chart: 'region', surcharge: 'none', baseline: 1.6,
    verify: 'https://www.turkishairlines.com',
    note: 'DEVALUED 3 Dec 2025 — the famous 45,000-mile US-Europe business award is gone; it is now 85,000-90,000. US domestic on United rose to 15,000 economy / 22,500 business one-way. Booking can require phoning the call center.'
  },
  AF: {
    name: 'Air France/KLM Flying Blue', short: 'Flying Blue', alliance: 'SkyTeam',
    chart: 'dynamic', dynamicCpp: 1.5, surcharge: 'medium', baseline: 1.4,
    verify: 'https://www.flyingblue.com',
    note: 'Dynamic, but monthly Promo Rewards cut 25-50% off select routes. Worth checking the promo list separately.'
  },
  BA: {
    name: 'British Airways Executive Club', short: 'BA Avios', alliance: 'oneworld',
    chart: 'distance', surcharge: 'high', baseline: 1.4, chartVerified: true,
    verify: 'https://www.britishairways.com',
    note: 'Distance-based Avios. Great for short hops; BA-metal longhaul carries surcharges that can exceed $600 round trip.'
  },
  IB: {
    name: 'Iberia Plus', short: 'Iberia Avios', alliance: 'oneworld',
    chart: 'distance', surcharge: 'low', baseline: 1.5, chartVerified: true,
    verify: 'https://www.iberia.com',
    note: 'Same Avios currency as BA, far lower surcharges on Iberia metal. Avios move freely between BA/Iberia/Qatar/Finnair.'
  },
  QR: {
    name: 'Qatar Privilege Club', short: 'Qatar Avios', alliance: 'oneworld',
    chart: 'distance', surcharge: 'medium', baseline: 1.5, chartVerified: true,
    verify: 'https://www.qatarairways.com',
    note: 'Avios-based. Qsuite business class is the draw.'
  },
  EK: {
    name: 'Emirates Skywards', short: 'Emirates', alliance: 'none',
    chart: 'dynamic', dynamicCpp: 1.2, surcharge: 'high', baseline: 1.2,
    verify: 'https://www.emirates.com',
    note: 'Heavy surcharges. Usually only worth it for first class aspiration redemptions.'
  },
  EY: {
    name: 'Etihad Guest', short: 'Etihad', alliance: 'none',
    chart: 'region', surcharge: 'medium', baseline: 1.3,
    verify: 'https://www.etihad.com',
    note: 'Occasional partner sweet spots.'
  },
  SQ: {
    name: 'Singapore KrisFlyer', short: 'KrisFlyer', alliance: 'Star',
    chart: 'region', surcharge: 'medium', baseline: 1.5,
    verify: 'https://www.singaporeair.com',
    note: 'The only program that reliably releases Singapore Suites/First award space to its own members.'
  },
  CX: {
    name: 'Cathay (Asia Miles)', short: 'Asia Miles', alliance: 'oneworld',
    chart: 'distance', surcharge: 'medium', baseline: 1.4,
    verify: 'https://www.cathaypacific.com',
    note: 'Distance-based partner chart.'
  },
  NH: {
    name: 'ANA Mileage Club', short: 'ANA', alliance: 'Star',
    chart: 'region', roundTripOnly: true, surcharge: 'medium', baseline: 1.8, chartVerified: true,
    verify: 'https://www.ana.co.jp',
    note: 'ROUND TRIP ONLY on partner awards. Note ANA has devalued — business to Japan is 110,000 round trip, not the 85,000 still widely quoted. Amex is the only US transfer partner and transfers can take up to 3 days.'
  },
  SK: {
    name: 'SAS EuroBonus', short: 'SAS', alliance: 'SkyTeam',
    chart: 'region', surcharge: 'low', baseline: 1.4,
    verify: 'https://www.flysas.com',
    note: 'Moved from Star Alliance to SkyTeam. NO US credit card currency transfers to EuroBonus — you can only use miles already in the account. Amex is not a partner despite what other tools sometimes claim.'
  },
  QF: {
    name: 'Qantas Frequent Flyer', short: 'Qantas', alliance: 'oneworld',
    chart: 'distance', surcharge: 'medium', baseline: 1.3,
    verify: 'https://www.qantas.com',
    note: 'Distance-based. Best used for Australia/New Zealand domestic and Pacific crossings.'
  },
  B6: {
    name: 'JetBlue TrueBlue', short: 'JetBlue', alliance: 'none',
    chart: 'fixed', fixedCpp: 1.3, surcharge: 'none', baseline: 1.2,
    verify: 'https://www.jetblue.com',
    note: 'Revenue-based: points price tracks the cash fare at roughly a fixed rate.'
  },
  WN: {
    name: 'Southwest Rapid Rewards', short: 'Southwest', alliance: 'none',
    chart: 'fixed', fixedCpp: 1.4, surcharge: 'none', baseline: 1.3,
    verify: 'https://www.southwest.com',
    note: 'Revenue-based and fully refundable. The Companion Pass is the real prize here, not the redemption rate.'
  },
  AM: {
    name: 'Aeromexico Rewards', short: 'Aeromexico', alliance: 'SkyTeam',
    chart: 'dynamic', dynamicCpp: 1.2, surcharge: 'low', baseline: 1.1,
    verify: 'https://www.aeromexico.com',
    note: ''
  }
};

/* ---------------------------------------------------------------------------
 * Transfer ratios: CURRENCY -> { PROGRAM: pointsOut / pointsIn }
 * 1 means 1:1. 0.8 means 1,000 points becomes 800 miles (e.g. Amex -> JetBlue).
 *
 * bonuses: add a live transfer bonus here and the engine picks it up
 * automatically, e.g.  PB.TRANSFER_BONUSES.MR = { VS: 0.30 }  for +30%.
 *
 * VERIFIED against published issuer partner lists — see PB.TRANSFER_SOURCES.
 *
 * Rule when sources disagree: OMIT THE TRANSFER.
 * A missing option costs you an idea. A phantom option sends you to move
 * points into a program that cannot receive them, and transfers are
 * irreversible. Amex->SAS, Chase->Emirates, Bilt->Singapore and Wells
 * Fargo->Air Canada were all phantom rows in earlier versions of this file.
 *
 * Programs the app does not model yet (Aer Lingus, EVA, Finnair, TAP, Thai,
 * Spirit, Virgin Red, JAL) are simply absent rather than wrong.
 * ------------------------------------------------------------------------- */
PB.TRANSFERS = {
  // Chase: 10 airline partners, all 1:1. No Emirates, no American.
  UR:   { AC: 1, AF: 1, BA: 1, IB: 1, SQ: 1, UA: 1, VS: 1, B6: 1, WN: 1 },

  // Amex: 17 airline partners. Etihad transfers ended 30 Jun 2026 and sources
  // disagree on whether it fully closed, so it is omitted per the rule above.
  MR:   { AC: 1, AF: 1, AM: 1.6, AV: 1, BA: 1, CX: 0.8, DL: 1, EK: 0.8,
          IB: 1, NH: 1, QF: 1, QR: 1, SQ: 1, VS: 1, B6: 0.8 },

  // Capital One: 18 airline partners. No Iberia, no Virgin Atlantic,
  // no Southwest, no American, no United.
  C1:   { AC: 1, AF: 1, AM: 1, AV: 1, BA: 1, CX: 1, EK: 0.75, EY: 1,
          QF: 1, QR: 1, SQ: 1, TK: 1, B6: 0.6 },

  // Citi: 15 airline partners. American IS a partner (two independent
  // sources). Aeromexico was removed 25 Jan 2026.
  TYP:  { AA: 1, AF: 1, AV: 1, CX: 1, EK: 0.8, EY: 1, QF: 1, QR: 1,
          SQ: 1, TK: 1, VS: 1, B6: 1 },

  // Bilt: 19 airline partners, all 1:1. The only major currency that
  // reaches both American and Alaska.
  BILT: { AA: 1, AC: 1, AF: 1, AS: 1, AV: 1, BA: 1, CX: 1, EK: 1, EY: 1,
          IB: 1, QR: 1, TK: 1, UA: 1, VS: 1, WN: 1 },

  // Wells Fargo: 8 airline partners, all 1:1. Cathay added Apr 2026,
  // JetBlue added Nov 2025.
  WF:   { AF: 1, AV: 1, BA: 1, CX: 1, IB: 1, VS: 1, B6: 1 }
};

/* Provenance, surfaced in the app so you can judge how stale a row is.
 * `count` is the issuer's full airline partner count; the table above lists
 * only those MileMatch models, so it will be smaller. */
PB.TRANSFER_SOURCES = {
  UR:   { verifiedOn: '2026-08-20', count: 10, url: 'https://awardtravelfinder.com/credit-card-transfers/chase-ultimate-rewards' },
  MR:   { verifiedOn: '2026-08-20', count: 17, url: 'https://upgradedpoints.com/credit-cards/amex-membership-rewards-transfer-partners/' },
  C1:   { verifiedOn: '2026-08-20', count: 18, url: 'https://awardtravelfinder.com/credit-card-transfers/capital-one-miles' },
  TYP:  { verifiedOn: '2026-08-20', count: 15, url: 'https://frequentmiler.com/citi-thankyou-rewards-airline-and-hotel-transfer-partners/' },
  BILT: { verifiedOn: '2026-08-20', count: 19, url: 'https://awardtravelfinder.com/credit-card-transfers/bilt-rewards' },
  WF:   { verifiedOn: '2026-08-20', count: 8,  url: 'https://awardtravelfinder.com/credit-card-transfers/wells-fargo-autograph' }
};

/* Live transfer bonuses. Value is a fraction: 0.30 = +30% bonus miles.
 * Clear these out when the promo ends. */
PB.TRANSFER_BONUSES = {
  // MR:  { VS: 0.30 },
  // C1:  { AV: 0.25 }
};

/* ---------------------------------------------------------------------------
 * Taxes & carrier-surcharge estimator.
 * Rough all-in out-of-pocket on an award ticket, by surcharge profile and
 * distance. These are ESTIMATES to make the cents-per-point math honest —
 * the real number shows at booking.
 * ------------------------------------------------------------------------- */
/* Calibrated against typical real-world round trips:
 *   none   — LifeMiles/Turkish, any distance ......... ~$40 RT
 *   low    — Aeroplan SFO-NRT business .............. ~$170 RT
 *   medium — ANA SFO-NRT business ................... ~$350 RT
 *   high   — BA JFK-LHR business .................... ~$780 RT
 * Still an estimate — the real figure appears at booking. */
PB.SURCHARGE_MODEL = {
  none:   { base: 6,  perThousandMiles: 3,  cabinMultiplier: { y: 1, w: 1,   j: 1,   f: 1   } },
  low:    { base: 25, perThousandMiles: 8,  cabinMultiplier: { y: 1, w: 1.1, j: 1.3, f: 1.5 } },
  medium: { base: 40, perThousandMiles: 15, cabinMultiplier: { y: 1, w: 1.2, j: 1.5, f: 1.8 } },
  high:   { base: 75, perThousandMiles: 38, cabinMultiplier: { y: 1, w: 1.3, j: 1.9, f: 2.3 } }
};

/* ---------------------------------------------------------------------------
 * Airlines offered as one-click filter chips.
 *
 * Deliberately a short curated list rather than every IATA code on earth —
 * these are the carriers a US-based traveller actually ends up on. Anything
 * missing can still be typed into the airline box by code.
 *
 * `group` drives the visual split in the UI.
 * ------------------------------------------------------------------------- */
PB.POPULAR_AIRLINES = [
  { code: 'AA', name: 'American',        group: 'us' },
  { code: 'UA', name: 'United',          group: 'us' },
  { code: 'DL', name: 'Delta',           group: 'us' },
  { code: 'AS', name: 'Alaska',          group: 'us' },
  { code: 'B6', name: 'JetBlue',         group: 'us' },
  { code: 'WN', name: 'Southwest',       group: 'us' },
  { code: 'NK', name: 'Spirit',          group: 'us' },
  { code: 'F9', name: 'Frontier',        group: 'us' },
  { code: 'HA', name: 'Hawaiian',        group: 'us' },
  { code: 'AC', name: 'Air Canada',      group: 'intl' },
  { code: 'BA', name: 'British Airways', group: 'intl' },
  { code: 'LH', name: 'Lufthansa',       group: 'intl' },
  { code: 'AF', name: 'Air France',      group: 'intl' },
  { code: 'VS', name: 'Virgin Atlantic', group: 'intl' },
  { code: 'EK', name: 'Emirates',        group: 'intl' },
  { code: 'QR', name: 'Qatar',           group: 'intl' },
  { code: 'NH', name: 'ANA',             group: 'intl' },
  { code: 'SQ', name: 'Singapore',       group: 'intl' }
];

PB.CABINS = {
  y: { name: 'Economy',         short: 'Econ' },
  w: { name: 'Premium Economy', short: 'Prem' },
  j: { name: 'Business',        short: 'Biz'  },
  f: { name: 'First',           short: 'First'}
};
