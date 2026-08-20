/* Credit cards and their welcome bonuses.
 *
 * !!! SIGN-UP BONUSES CHANGE CONSTANTLY !!!
 * Offers are frequently targeted, and in-branch / referral / incognito offers
 * routinely beat the public one. The numbers below are typical public offers as
 * of PB.META.asOf and exist so you can model "what would this card get me".
 * Always confirm the live offer before applying. You can also add your own card
 * in the app (Cards tab -> Add custom card) without touching this file.
 *
 * bonus       : welcome bonus points
 * minSpend    : spend required, in dollars
 * spendMonths : months allowed to hit minSpend
 * fee         : annual fee (first year, dollars)
 * currency    : which PB.CURRENCIES / PB.PROGRAMS balance the bonus lands in
 */
window.PB = window.PB || {};

PB.CARDS = [
  // --- Chase Ultimate Rewards -------------------------------------------
  { id: 'csp',   name: 'Chase Sapphire Preferred',      issuer: 'Chase',        currency: 'UR',   bonus: 60000,  minSpend: 4000,  spendMonths: 3, fee: 95 },
  { id: 'csr',   name: 'Chase Sapphire Reserve',        issuer: 'Chase',        currency: 'UR',   bonus: 60000,  minSpend: 5000,  spendMonths: 3, fee: 550 },
  { id: 'cip',   name: 'Chase Ink Business Preferred',  issuer: 'Chase',        currency: 'UR',   bonus: 100000, minSpend: 8000,  spendMonths: 3, fee: 95 },
  { id: 'icash', name: 'Chase Ink Business Cash',       issuer: 'Chase',        currency: 'UR',   bonus: 75000,  minSpend: 6000,  spendMonths: 6, fee: 0 },
  { id: 'cfu',   name: 'Chase Freedom Unlimited',       issuer: 'Chase',        currency: 'UR',   bonus: 20000,  minSpend: 500,   spendMonths: 3, fee: 0 },

  // --- Amex Membership Rewards ------------------------------------------
  { id: 'amexplat',  name: 'Amex Platinum',             issuer: 'American Express', currency: 'MR', bonus: 80000,  minSpend: 8000,  spendMonths: 6, fee: 695 },
  { id: 'amexgold',  name: 'Amex Gold',                 issuer: 'American Express', currency: 'MR', bonus: 60000,  minSpend: 6000,  spendMonths: 6, fee: 325 },
  { id: 'amexgreen', name: 'Amex Green',                issuer: 'American Express', currency: 'MR', bonus: 40000,  minSpend: 3000,  spendMonths: 6, fee: 150 },
  { id: 'amexbizplat', name: 'Amex Business Platinum',  issuer: 'American Express', currency: 'MR', bonus: 150000, minSpend: 20000, spendMonths: 3, fee: 695 },
  { id: 'amexbizgold', name: 'Amex Business Gold',      issuer: 'American Express', currency: 'MR', bonus: 100000, minSpend: 15000, spendMonths: 3, fee: 375 },

  // --- Capital One -------------------------------------------------------
  { id: 'venturex',    name: 'Capital One Venture X',          issuer: 'Capital One', currency: 'C1', bonus: 75000,  minSpend: 4000,  spendMonths: 3, fee: 395 },
  { id: 'venture',     name: 'Capital One Venture Rewards',    issuer: 'Capital One', currency: 'C1', bonus: 75000,  minSpend: 4000,  spendMonths: 3, fee: 95 },
  { id: 'venturexbiz', name: 'Capital One Venture X Business', issuer: 'Capital One', currency: 'C1', bonus: 150000, minSpend: 30000, spendMonths: 3, fee: 395 },

  // --- Citi ---------------------------------------------------------------
  { id: 'strata',    name: 'Citi Strata Premier',        issuer: 'Citi', currency: 'TYP', bonus: 75000, minSpend: 4000, spendMonths: 3, fee: 95 },
  { id: 'stratelite', name: 'Citi Strata Elite',         issuer: 'Citi', currency: 'TYP', bonus: 80000, minSpend: 4000, spendMonths: 3, fee: 595 },

  // --- Bilt / Wells Fargo --------------------------------------------------
  { id: 'bilt',      name: 'Bilt Mastercard',            issuer: 'Bilt',        currency: 'BILT', bonus: 0,     minSpend: 0,    spendMonths: 0, fee: 0,
    note: 'No welcome bonus — the value is earning points on rent with no fee.' },
  { id: 'wfjourney', name: 'Wells Fargo Autograph Journey', issuer: 'Wells Fargo', currency: 'WF', bonus: 60000, minSpend: 4000, spendMonths: 3, fee: 95 },

  // --- Co-branded airline cards (bonus lands in that airline program) -------
  { id: 'ua_explorer',  name: 'United Explorer',                 issuer: 'Chase',           currency: 'UA', bonus: 60000,  minSpend: 3000, spendMonths: 3, fee: 95 },
  { id: 'ua_quest',     name: 'United Quest',                    issuer: 'Chase',           currency: 'UA', bonus: 70000,  minSpend: 4000, spendMonths: 3, fee: 350 },
  { id: 'dl_gold',      name: 'Delta SkyMiles Gold',             issuer: 'American Express', currency: 'DL', bonus: 70000,  minSpend: 3000, spendMonths: 6, fee: 150 },
  { id: 'dl_reserve',   name: 'Delta SkyMiles Reserve',          issuer: 'American Express', currency: 'DL', bonus: 100000, minSpend: 6000, spendMonths: 6, fee: 650 },
  { id: 'aa_platinum',  name: 'AAdvantage Platinum Select',      issuer: 'Citi',            currency: 'AA', bonus: 60000,  minSpend: 3000, spendMonths: 4, fee: 99 },
  { id: 'as_visa',      name: 'Alaska Airlines Visa Signature',  issuer: 'Bank of America', currency: 'AS', bonus: 60000,  minSpend: 3000, spendMonths: 3, fee: 95 },
  { id: 'wn_priority',  name: 'Southwest Rapid Rewards Priority', issuer: 'Chase',          currency: 'WN', bonus: 50000,  minSpend: 1000, spendMonths: 3, fee: 149 },
  { id: 'b6_plus',      name: 'JetBlue Plus',                    issuer: 'Barclays',        currency: 'B6', bonus: 60000,  minSpend: 1000, spendMonths: 3, fee: 99 },
  { id: 'ba_visa',      name: 'British Airways Visa Signature',  issuer: 'Chase',           currency: 'BA', bonus: 75000,  minSpend: 5000, spendMonths: 3, fee: 95 },
  { id: 'vs_visa',      name: 'Virgin Atlantic World Elite',     issuer: 'Synchrony',       currency: 'VS', bonus: 60000,  minSpend: 2000, spendMonths: 3, fee: 99 },
  { id: 'ac_aeroplan',  name: 'Aeroplan Card (US)',              issuer: 'Chase',           currency: 'AC', bonus: 70000,  minSpend: 4000, spendMonths: 3, fee: 95 }
];
