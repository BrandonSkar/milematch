/* Award charts.
 *
 * !!! READ THIS !!!
 * These are APPROXIMATE reference values reviewed as of PB.META.asOf. Airlines
 * change charts without notice and several programs (United, Delta, Flying Blue)
 * have no published chart at all. The app labels every number as an estimate and
 * links you to the airline to confirm. NEVER transfer points based on a number
 * in this file alone — transfers are irreversible.
 *
 * Cabin keys: y = economy, w = premium economy, j = business, f = first
 *
 * Three chart shapes:
 *   distance     : ordered bands, [maxGreatCircleMiles, { y, w, j, f }]
 *   region       : "FROM-TO" keys, matched in either direction
 *   zoneDistance : "FROM-TO" keys, each holding its own distance bands
 */
window.PB = window.PB || {};

/* ---------------------------------------------------------------------------
 * ZONE + DISTANCE charts.
 *
 * Aeroplan does NOT price on distance alone. It picks the zone pair first,
 * then applies distance bands *within* that pair. Modelling it as one global
 * distance table (which this file did until 2026-08-20) produced errors of
 * -33% to +40%: domestic came out far too expensive and transatlantic far too
 * cheap. SFO-FRA business read 60,000 when the real price is 75,000 — enough
 * to strand a transfer 15,000 points short.
 *
 * Keys are zone pairs, matched in either direction, each holding its own
 * ordered distance bands.
 * ------------------------------------------------------------------------- */
PB.ZONE_DISTANCE_CHARTS = {
  /* Air Canada Aeroplan — partner chart, one-way.
   * Verified 2026-08-20 against the published chart (post 1 Jun 2026 revision).
   * Premium economy and first are interpolated where the chart does not
   * publish a distinct figure — flagged 'partial' below. */
  AC: {
    verifiedOn: '2026-08-20',
    source: 'https://awardtravelfinder.com/award-charts/aeroplan',
    zones: {
      'NA-NA': [
        [500,   { y: 6000,  w: 9000,  j: 15000, f: 20000 }],
        [1500,  { y: 10000, w: 15000, j: 20000, f: 27000 }],
        [2750,  { y: 12500, w: 19000, j: 25000, f: 34000 }],
        [99999, { y: 22500, w: 30000, j: 35000, f: 47000 }]
      ],
      'NA-EU': [
        [4000,  { y: 32500, w: 45000, j: 60000,  f: 85000  }],
        [6000,  { y: 42500, w: 58000, j: 75000,  f: 105000 }],
        [8000,  { y: 60000, w: 75000, j: 90000,  f: 125000 }],
        [99999, { y: 75000, w: 92000, j: 110000, f: 150000 }]
      ]
    }
  }
};

PB.DISTANCE_CHARTS = {
  /* Avios (British Airways) — per one-way segment.
   * Verified 2026-08-20 against the published 8-band Reward Flight chart.
   * The previous values here were 30-70% too expensive, which made every
   * Avios program look far worse than it is.
   *
   * Economy, business and first are the published figures. Premium economy is
   * NOT published per band and is interpolated 60% of the way from economy to
   * business — treat those as approximate. First is unavailable on the two
   * shortest bands; the values there are placeholders. */
  BA: [
    [650,   { y: 4000,  w: 6250,  j: 7750,  f: 11650  }],
    [1150,  { y: 6500,  w: 10400, j: 13000, f: 19500  }],
    [2000,  { y: 8500,  w: 13600, j: 17000, f: 25500  }],
    [3000,  { y: 10000, w: 17200, j: 22000, f: 34000  }],
    [4000,  { y: 13000, w: 22900, j: 29500, f: 44000  }],
    [5500,  { y: 16250, w: 35150, j: 47750, f: 68000  }],
    [6500,  { y: 21750, w: 42300, j: 56000, f: 85000  }],
    [99999, { y: 32500, w: 53800, j: 68000, f: 102000 }]
  ],

  /* Iberia Plus and Qatar Privilege Club use the same Avios bands.
   * Their advantage is lower surcharges, modelled in programs.js. */
  IB: 'BA',
  QR: 'BA',

  /* Cathay — Asia Miles partner chart, one-way */
  CX: [
    [750,   { y: 8000,  w: 11000, j: 16000, f: 22000  }],
    [2750,  { y: 20000, w: 27000, j: 35000, f: 50000  }],
    [5000,  { y: 30000, w: 42000, j: 55000, f: 80000  }],
    [7500,  { y: 40000, w: 55000, j: 75000, f: 110000 }],
    [99999, { y: 50000, w: 70000, j: 90000, f: 140000 }]
  ],

  /* Qantas Classic Flight Rewards, one-way */
  QF: [
    [600,   { y: 8000,  w: 11000, j: 15000, f: 20000  }],
    [1200,  { y: 12000, w: 17000, j: 24000, f: 32000  }],
    [2400,  { y: 18000, w: 26000, j: 36000, f: 54000  }],
    [3600,  { y: 25000, w: 36000, j: 50000, f: 75000  }],
    [4800,  { y: 32000, w: 46000, j: 68000, f: 102000 }],
    [5800,  { y: 37000, w: 52000, j: 78000, f: 117000 }],
    [99999, { y: 45000, w: 65000, j: 95000, f: 144000 }]
  ]
};

PB.REGION_CHARTS = {
  /* American AAdvantage — oneworld partner saver levels, one-way.
   * Verified 2026-08-20 against the published partner chart. The North America
   * rows below are the published figures; premium economy was low throughout
   * and contiguous-US first was 32,500 against a real 50,000.
   *
   * AA calls these "starting estimates" and prices some partner awards
   * dynamically above them, so treat these as a floor rather than a quote.
   *
   * Two mappings are lossy against AA's real zones and stay approximate:
   *  - CAM: AA splits the Caribbean and Central America differently; the
   *    South America Region 1 figures are used as the closest fit.
   *  - SA: AA has two South America zones. Region 2 (Brazil/Argentina/Chile)
   *    is used here as the more common long-haul case; northern South America
   *    is cheaper in reality.
   * The EU- rows are NOT published in this chart and remain estimates. */
  AA: {
    'NA-NA':   { y: 12500, w: 22500, j: 25000, f: 50000  },
    'NA-CAM':  { y: 20000, w: 27500, j: 30000, f: 55000  },
    'NA-SA':   { y: 30000, w: 40000, j: 57500, f: 85000  },
    'NA-EU':   { y: 30000, w: 40000, j: 57500, f: 85000  },
    'NA-ME':   { y: 40000, w: 62500, j: 70000, f: 115000 },
    'NA-AF':   { y: 40000, w: 65000, j: 75000, f: 120000 },
    'NA-SAS':  { y: 40000, w: 62500, j: 70000, f: 115000 },
    'NA-NEA':  { y: 35000, w: 50000, j: 60000, f: 80000  },
    'NA-SEA':  { y: 37500, w: 50000, j: 70000, f: 110000 },
    'NA-OC':   { y: 40000, w: 65000, j: 80000, f: 110000 },
    'EU-EU':   { y: 12500, w: 17500, j: 25000, f: 35000  },
    'EU-ME':   { y: 20000, w: 27500, j: 35000, f: 50000  },
    'EU-NEA':  { y: 30000, w: 40000, j: 50000, f: 70000  },
    'EU-SEA':  { y: 30000, w: 42500, j: 55000, f: 75000  }
  },

  /* Alaska Mileage Plan — partner levels, one-way.
   * Verified 2026-08-20. Alaska still uses a FIXED published partner chart
   * that applies to all dates and seasons — only Alaska-operated flights are
   * dynamic. The earlier note here claiming partner pricing had gone
   * distance-based was wrong.
   *
   * Alaska publishes ranges per region. The saver (low) end is used below.
   * Published ranges for reference:
   *   Europe   econ 22.5-27.5k  biz 55-57.5k  first 70-90k
   *   Asia     econ 25-30k      biz 50-60k    first 70-85k
   *   ME       econ 32.5k       biz 62.5-70k  first 100k
   *   Oceania  econ 30k         biz 55k       first 80k
   *   S.Amer   econ 20k         biz 40k
   *   US/CA/MX econ 5-15k       first 40k
   * Premium economy is not published and is interpolated. Africa and South
   * Asia are not published at all and remain estimates. */
  AS: {
    'NA-NA':   { y: 12500, w: 20000, j: 25000, f: 40000  },
    'NA-CAM':  { y: 12500, w: 20000, j: 30000, f: 40000  },
    'NA-SA':   { y: 20000, w: 30000, j: 40000, f: 60000  },
    'NA-EU':   { y: 22500, w: 38000, j: 55000, f: 70000  },
    'NA-NEA':  { y: 25000, w: 37000, j: 50000, f: 70000  },
    'NA-SEA':  { y: 30000, w: 45000, j: 60000, f: 85000  },
    'NA-OC':   { y: 30000, w: 42000, j: 55000, f: 80000  },
    'NA-ME':   { y: 32500, w: 47000, j: 62500, f: 100000 },
    'NA-AF':   { y: 45000, w: 60000, j: 75000, f: 105000 },
    'NA-SAS':  { y: 40000, w: 55000, j: 70000, f: 100000 }
  },

  /* Virgin Atlantic Flying Club — partner awards, one-way.
   * Verified 2026-08-20 for the rows that matter on US carriers:
   *   NA-EU business on Delta One  50,000  (confirmed)
   *   NA-NA economy on Delta        5,000-12,500; upper end used
   *   NA-NEA first on ANA          55,000-60,000
   * ANA awards through Virgin are bookable ONE WAY - Virgin does not impose
   * ANA's own round-trip requirement. An earlier note here claimed otherwise.
   * Rows not involving a US carrier remain estimates. */
  VS: {
    'NA-EU':   { y: 20000, w: 30000, j: 50000, f: 75000  },
    'NA-NEA':  { y: 22500, w: 32500, j: 45000, f: 60000  },
    'NA-CAM':  { y: 15000, w: 20000, j: 30000, f: 45000  },
    'NA-AF':   { y: 30000, w: 45000, j: 60000, f: 90000  },
    'NA-NA':   { y: 12500, w: 17500, j: 27500, f: 40000  },
    'EU-EU':   { y: 9000,  w: 13000, j: 18000, f: 25000  },
    'EU-NEA':  { y: 25000, w: 35000, j: 47500, f: 70000  }
  },

  /* Avianca LifeMiles — Star Alliance partners, one-way, NO fuel surcharges.
   * Checked 2026-08-20 but deliberately NOT marked verified: LifeMiles has
   * moved partly dynamic and now publishes RANGES rather than fixed cells.
   * Values below are the low (saver) end of the published range — you will
   * frequently be quoted the high end. Ranges, for reference:
   *   NA-EU   econ 35-45k   business 63-80k    first 100-120k
   *   NA-NEA  econ 40-47k   business 85-90k    first 110-120k
   *   NA-SEA  econ 42-50k   business 90-100k   first 120-130k
   *   NA-SA   econ 25-35k   business 50-65k
   *   NA-OC   econ 45-55k   business 90-100k
   *   NA-ME/AF econ 42-55k  business 78-90k */
  AV: {
    'NA-NA':   { y: 10000, w: 15000, j: 20000, f: 27500  },
    'NA-CAM':  { y: 10000, w: 15000, j: 25000, f: 32000  },
    'NA-SA':   { y: 25000, w: 35000, j: 50000, f: 65000  },
    'NA-EU':   { y: 35000, w: 48000, j: 63000, f: 100000 },
    'NA-ME':   { y: 42000, w: 57000, j: 78000, f: 105000 },
    'NA-AF':   { y: 42000, w: 58000, j: 78000, f: 105000 },
    'NA-SAS':  { y: 42000, w: 57000, j: 80000, f: 108000 },
    'NA-NEA':  { y: 40000, w: 55000, j: 85000, f: 110000 },
    'NA-SEA':  { y: 42000, w: 58000, j: 90000, f: 120000 },
    'NA-OC':   { y: 45000, w: 60000, j: 90000, f: 120000 },
    'EU-EU':   { y: 8000,  w: 12000, j: 20000, f: 30000  },
    'EU-NEA':  { y: 35000, w: 48000, j: 63000, f: 90000  },
    'EU-SA':   { y: 32000, w: 45000, j: 65000, f: 90000  }
  },

  /* Turkish Miles&Smiles — Star Alliance partners, one-way, no surcharges.
   * PARTIALLY verified 2026-08-20. Turkish devalued partner awards on
   * 3 Dec 2025 and the widely-repeated sweet spots here were pre-devaluation:
   *   NA-NA  economy   was 10,000, actually 15,000
   *   NA-EU  business  was 45,000, actually 85,000-90,000
   * Two independent sources agree on the domestic figures and on NA-Europe
   * business (85k to Greece/Hungary/Croatia, 90k to UK/France/Switzerland;
   * 90k used here as the common case). A third source disagreed with both and
   * was discarded.
   *
   * The remaining rows below are still UNVERIFIED estimates — Turkish does not
   * publish them anywhere reachable, and they are almost certainly also
   * pre-devaluation and therefore too cheap. */
  TK: {
    'NA-NA':   { y: 15000, w: 19000, j: 22500, f: 30000  },
    'NA-CAM':  { y: 12500, w: 18000, j: 27500, f: 35000  },
    'NA-SA':   { y: 25000, w: 35000, j: 50000, f: 65000  },
    'NA-EU':   { y: 45000, w: 65000, j: 90000, f: 120000 },
    'NA-ME':   { y: 37500, w: 50000, j: 62500, f: 85000  },
    'NA-AF':   { y: 40000, w: 52500, j: 65000, f: 90000  },
    'NA-SAS':  { y: 42500, w: 55000, j: 67500, f: 95000  },
    'NA-NEA':  { y: 40000, w: 52500, j: 67500, f: 90000  },
    'NA-SEA':  { y: 45000, w: 57500, j: 72500, f: 97500  },
    'NA-OC':   { y: 47500, w: 60000, j: 80000, f: 105000 },
    'EU-EU':   { y: 12500, w: 18000, j: 25000, f: 35000  }
  },

  /* Etihad Guest — one-way */
  EY: {
    'NA-NA':   { y: 12500, w: 18000, j: 25000, f: 35000  },
    'NA-ME':   { y: 44000, w: 60000, j: 88000, f: 110000 },
    'NA-EU':   { y: 32000, w: 44000, j: 62000, f: 88000  },
    'NA-SAS':  { y: 44000, w: 60000, j: 88000, f: 115000 },
    'EU-ME':   { y: 22000, w: 30000, j: 44000, f: 60000  }
  },

  /* Singapore KrisFlyer — Saver, one-way */
  SQ: {
    'NA-SEA':  { y: 45000, w: 62000, j: 99000, f: 130000 },
    'NA-NEA':  { y: 35000, w: 48000, j: 78000, f: 100000 },
    'NA-EU':   { y: 38000, w: 52000, j: 82000, f: 110000 },
    'NA-SAS':  { y: 42000, w: 58000, j: 92000, f: 120000 },
    'NA-OC':   { y: 40000, w: 55000, j: 88000, f: 115000 },
    'SEA-SEA': { y: 8000,  w: 12000, j: 18000, f: 25000  },
    'SEA-OC':  { y: 22000, w: 30000, j: 45000, f: 60000  },
    'EU-SEA':  { y: 38000, w: 52000, j: 82000, f: 110000 }
  },

  /* ANA Mileage Club — Star Alliance partner chart. ROUND TRIP prices.
   * Verified 2026-08-20. ANA has devalued materially: the widely-quoted
   * "85,000 business to Japan" is the OLD chart — it is now 110,000.
   * Premium economy is not published on the partner chart and is interpolated.
   * NEA here uses ANA's Japan (Zone 1-A) figures; Korea/China price higher. */
  NH: {
    'NA-NEA':  { y: 50000, w: 70000,  j: 110000, f: 170000 },
    'NA-EU':   { y: 55000, w: 75000,  j: 100000, f: 165000 },
    'NA-SEA':  { y: 80000, w: 105000, j: 136000, f: 240000 },
    'NA-OC':   { y: 75000, w: 100000, j: 145000, f: 246000 },
    'NA-NA':   { y: 30000, w: 40000,  j: 55000,  f: 90000  },
    'EU-NEA':  { y: 60000, w: 82000,  j: 118000, f: 200000 },
    'EU-SEA':  { y: 59000, w: 78000,  j: 94000,  f: 177000 },
    'NEA-SEA': { y: 30000, w: 40000,  j: 55000,  f: 80000  }   // not published; estimate
  },

  /* SAS EuroBonus — one-way */
  SK: {
    'NA-EU':   { y: 25000, w: 35000, j: 55000, f: 80000 },
    'EU-EU':   { y: 10000, w: 15000, j: 22000, f: 30000 },
    'NA-NA':   { y: 12500, w: 18000, j: 25000, f: 35000 }
  }
};
