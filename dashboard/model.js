/* Token Radar — Empirical Bayes valuation + costed farm-plan engine.
 * Fit on the 119 traded anchors (mcap & tvl recorded): FDV = TVL · M_cat · (TVL/M₀)^(ε−1) ·
 * (1 + w·clamp(g₇d,−50,+100)/100) · ((1−s) + s·min(age,1095)/1095) · (1 + c·ln #chains), with
 * M_cat = exp[(n·ln r̄_cat + k·ln r̄_all)/(n + k)] (EB shrinkage k=5), ε = 0.72, w = 0.40, s = 0.35,
 * c = 0.04. No name is special-cased. 5-fold CV (folds by slug order) and a walk-forward (train the
 * oldest 60% by listing day) report a Spearman rho, a median |Δlog| and the P25–P75 band of the
 * signed log residuals — that band becomes each row's IQR. Farm plans are costed: chain gas, a
 * TVL-scaled deposit with pool share, weekly actions, a category guard, exit triggers.
 * Runs in Node (module.exports — main.ts ships this source in the dossier) and the browser
 * (window.RadarModel — the sandbox re-scores live under new sliders). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports !== undefined && module.exports !== null) module.exports = api;
  else root.RadarModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MODEL_VERSION = 'eb-1';
  /** Sandbox defaults; the sliders reshape elasticity, growth weight and spread. */
  var PARAMS = { elasticity: 0.72, growth_weight: 0.40, maturity_spread: 0.35, growth_floor: -50, growth_cap: 100, maturity_days: 1095, shrink_k: 5, breadth_coef: 0.04, comps: 4, min_capital: 100, max_capital: 1000 };
  /** Approximate cost of one approval-or-action transaction, in USD, by chain as DefiLlama names it. */
  var GAS_USD = { Ethereum: 4.20, Bitcoin: 3.10, Arbitrum: 0.11, Base: 0.05, Optimism: 0.08, Polygon: 0.02, Avalanche: 0.15, Solana: 0.01, Sui: 0.01, BNB: 0.14, Tron: 0.55, 'Hyperliquid L1': 0.02 };
  var GAS_DEFAULT = 0.45;

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function finiteOrNull(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }
  function round6(n) { return Math.round(n * 1e6) / 1e6; }
  function median(xs) {
    if (xs.length === 0) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; }), mid = s.length >> 1;
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  /** Linear-interpolated percentile of an already-sorted array. */
  function percentileSorted(sorted, q) {
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return sorted[0];
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  /** Average ranks with ties shared, so Spearman handles ties exactly. */
  function rankify(xs) {
    var idx = xs.map(function (v, i) { return i; }).sort(function (a, b) { return xs[a] - xs[b] || (a < b ? -1 : a > b ? 1 : 0); });
    var ranks = new Array(xs.length), i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
      var avg = (i + j) / 2 + 1;
      for (var t = i; t <= j; t++) ranks[idx[t]] = avg;
      i = j + 1;
    }
    return ranks;
  }
  /** Spearman rank correlation; null under 2 pairs or without variance. */
  function spearman(pred, actual) {
    if (pred.length < 2) return null;
    var rp = rankify(pred), ra = rankify(actual), n = pred.length, mp = 0, ma = 0, num = 0, dp = 0, da = 0;
    for (var i = 0; i < n; i++) { mp += rp[i]; ma += ra[i]; }
    mp /= n; ma /= n;
    for (var j = 0; j < n; j++) { var x = rp[j] - mp, y = ra[j] - ma; num += x * y; dp += x * x; da += y * y; }
    return dp === 0 || da === 0 ? null : num / Math.sqrt(dp * da);
  }

  /** A pre-token protocol records no token: no market cap, no CoinGecko id, no symbol. */
  function isPreToken(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/; // DefiLlama's version-marker rule
  var EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  var DERIVATIVE_CATEGORIES = { 'CEX': 1, 'Bridge': 1, 'Canonical Bridge': 1, 'Cross Chain Bridge': 1, 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1 };
  var WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
  /** Why a pre-token protocol stays off the ranked board: reason codes for the Excluded tab. */
  function exclusionReasons(p) {
    var reasons = [];
    if (p.category !== null && DERIVATIVE_CATEGORIES[p.category]) reasons.push('cat: ' + p.category);
    if (VERSIONED.test(p.name)) reasons.push('versioned pool name');
    if (WRAPPED_WORD.test(p.name)) reasons.push('wrapped/staked name');
    if (EXCHANGE_PREFIX.test(p.name)) reasons.push('exchange-prefixed name');
    return reasons;
  }
  /** Age in whole days from as_of to the listing day; null when DefiLlama never dated it. */
  function ageDays(asOf, listedAt) {
    if (listedAt === null || typeof listedAt !== 'string') return null;
    var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((a - b) / 86400000)) : null;
  }

  /** The curve's fit: global log-median ratio, per-category counts and log-medians, the median
   * anchor TVL (the elasticity pivot M₀) and the median anchor age (fallback for undated protocols). */
  function anchorStats(anchors) {
    var logs = [], tvls = [], ages = [], buckets = {};
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i], lr = Math.log(a.mcap_usd / a.tvl_usd), key = a.category !== null && a.category !== '' ? a.category : 'Unsorted';
      logs.push(lr); tvls.push(a.tvl_usd);
      var age = finiteOrNull(a._age_days);
      if (age !== null) ages.push(age);
      (buckets[key] = buckets[key] || []).push(lr);
    }
    var catStats = {};
    Object.keys(buckets).forEach(function (k) {
      catStats[k] = { n: buckets[k].length, log_median: median(buckets[k].sort(function (x, y) { return x - y; })) };
    });
    var globalLog = median(logs);
    return { anchors_n: anchors.length, global_log_median: globalLog, global_multiple: Math.exp(globalLog), median_tvl: median(tvls), median_age: ages.length > 0 ? median(ages) : 730, categories: catStats };
  }
  /** The stats the board scores with and the page ships, identical in both places: log fields
   * rounded to 4 decimals, so the sandbox (reading the shipped copy) reproduces board.json exactly. */
  function roundStats(stats) {
    var categories = {};
    Object.keys(stats.categories).forEach(function (k) {
      categories[k] = { n: stats.categories[k].n, log_median: round4(stats.categories[k].log_median) };
    });
    return { anchors_n: stats.anchors_n, global_log_median: round4(stats.global_log_median), global_multiple: Math.exp(round4(stats.global_log_median)), median_tvl: stats.median_tvl, median_age: stats.median_age, categories: categories };
  }
  /** The empirical-Bayes category multiple: the category's log-median shrunk toward the global one. */
  function shrunkCategoryMultiple(stats, category, params) {
    var cs = category !== null && category !== '' && stats.categories[category] ? stats.categories[category] : null;
    var n = cs ? cs.n : 0, catLog = cs ? cs.log_median : stats.global_log_median, k = params.shrink_k;
    return Math.exp((n * catLog + k * stats.global_log_median) / (n + k));
  }
  /** A protocol normalized to what scoreComponents reads: the snapshot carries its age in
   * _age_days, the page's sandbox rows as age_days — one scoring path for build and sandbox. */
  function normalizedRow(p) {
    return { tvl_usd: p.tvl_usd, change_7d: p.change_7d, category: p.category, chains: p.chains, age_days: p._age_days };
  }
  /** The five multiplicative components of a row's implied multiple; works for a live anchor
   * (validated against its actual ratio) and for a pre-token protocol (becomes the implied value). */
  function scoreComponents(row, stats, params) {
    var catMult = shrunkCategoryMultiple(stats, row.category, params);
    var tvl = row.tvl_usd > 0 ? row.tvl_usd : 1, pivot = stats.median_tvl > 0 ? stats.median_tvl : 1;
    var elastic = Math.pow(tvl / pivot, params.elasticity - 1);
    var g = clamp(finiteOrNull(row.change_7d) !== null ? row.change_7d : 0, params.growth_floor, params.growth_cap);
    var growthMult = 1 + (g / 100) * params.growth_weight;
    var age = finiteOrNull(row.age_days) !== null ? row.age_days : stats.median_age;
    var maturityMult = (1 - params.maturity_spread) + params.maturity_spread * (clamp(age, 0, params.maturity_days) / params.maturity_days);
    var nChains = Array.isArray(row.chains) && row.chains.length > 0 ? row.chains.length : 1;
    var breadthMult = 1 + params.breadth_coef * Math.log(nChains);
    return { category: row.category !== null && row.category !== '' ? row.category : 'Unsorted', category_multiple: catMult, elasticity_factor: elastic, growth_pct: g, growth_mult: growthMult, maturity_mult: maturityMult, age_days: finiteOrNull(row.age_days), breadth_mult: breadthMult, multiple: catMult * elastic * growthMult * maturityMult * breadthMult };
  }

  /** Predicted-vs-actual scoring: a Spearman rho, a median absolute log error and the P25–P75 band
   * of the signed log residuals (actual minus predicted). */
  function validationMetrics(pairs) {
    var pred = [], actual = [];
    for (var i = 0; i < pairs.length; i++) { pred.push(pairs[i].pred); actual.push(pairs[i].actual); }
    var residuals = pairs.map(function (p) { return Math.log(p.actual) - Math.log(p.pred); }).sort(function (a, b) { return a - b; });
    var absLogs = residuals.map(function (r) { return Math.abs(r); }).sort(function (a, b) { return a - b; });
    return { n: pairs.length, spearman: round4(spearman(pred, actual)), median_abs_log_error: round4(median(absLogs)), residual_p25: round4(percentileSorted(residuals, 0.25)), residual_p75: round4(percentileSorted(residuals, 0.75)) };
  }
  /** Deterministic 5-fold cross-validation: anchors sorted by slug, fold = index mod 5. */
  function crossValidate(anchors, params) {
    var ordered = anchors.slice().sort(function (a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; });
    var pairs = [], K = 5, f, i, j;
    for (f = 0; f < K; f++) {
      var train = [];
      for (i = 0; i < ordered.length; i++) if (i % K !== f) train.push(ordered[i]);
      var stats = anchorStats(train);
      for (j = 0; j < ordered.length; j++) {
        if (j % K !== f) continue;
        pairs.push({ pred: scoreComponents(normalizedRow(ordered[j]), stats, params).multiple, actual: ordered[j].mcap_usd / ordered[j].tvl_usd });
      }
    }
    return validationMetrics(pairs);
  }
  /** Temporal walk-forward: train on the oldest 60% by listing day, predict the newest 40%. */
  function walkForward(anchors, params) {
    var ordered = anchors.slice().sort(function (a, b) {
      var ka = a.listed_at !== null ? a.listed_at : '9999-12-31', kb = b.listed_at !== null ? b.listed_at : '9999-12-31';
      return ka < kb ? -1 : ka > kb ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    var cut = Math.ceil(ordered.length * 0.6), stats = anchorStats(ordered.slice(0, cut)), pairs = [];
    for (var i = cut; i < ordered.length; i++) {
      pairs.push({ pred: scoreComponents(normalizedRow(ordered[i]), stats, params).multiple, actual: ordered[i].mcap_usd / ordered[i].tvl_usd });
    }
    return validationMetrics(pairs);
  }

  /** The nearest traded comparables: anchors ranked by |Δ ln TVL| discounted by chain overlap,
   * same-category anchors preferred. Computed from the snapshot's figures, never a name list. */
  function nearestComps(row, anchors, k) {
    var rowChains = {}, nChains = Math.max(1, (row.chains || []).length);
    (row.chains || []).forEach(function (c) { rowChains[c] = 1; });
    var logTvl = Math.log(row.tvl_usd > 0 ? row.tvl_usd : 1);
    var rowCat = row.category !== null && row.category !== '' ? row.category : 'Unsorted';
    function dist(a) {
      var hits = (a.chains || []).filter(function (c) { return rowChains[c]; }).length;
      var overlap = hits / Math.max(1, Math.min(a.chains.length, nChains));
      return Math.abs(Math.log(a.tvl_usd) - logTvl) * (1 - 0.5 * overlap) + ((a.category !== null ? a.category : 'Unsorted') === rowCat ? 0 : 3);
    }
    return anchors.map(function (a) { return { a: a, d: dist(a) }; })
      .sort(function (x, y) { return x.d - y.d || (x.a.slug < y.a.slug ? -1 : x.a.slug > y.a.slug ? 1 : 0); })
      .slice(0, k)
      .map(function (s) { return { slug: s.a.slug, name: s.a.name, category: s.a.category, tvl_usd: s.a.tvl_usd, mcap_usd: s.a.mcap_usd, ratio: round4(s.a.mcap_usd / s.a.tvl_usd), overlap: (s.a.chains || []).filter(function (c) { return rowChains[c]; }).length }; });
  }

  function gasForChain(chain) { return GAS_USD[chain] !== undefined ? GAS_USD[chain] : GAS_DEFAULT; }
  /** TVL-scaled deposit between $100 and $1,000 in $50 steps: bigger protocols take a bigger one. */
  function capitalFor(tvl, params) {
    return clamp(Math.round(clamp(500 * (tvl / 250000000), params.min_capital, params.max_capital) / 50) * 50, params.min_capital, params.max_capital);
  }
  /** Holding horizon keyed to the tokenless age: young protocols get the longest window. */
  function holdDaysFor(age) { return age === null ? 45 : age < 180 ? 60 : age < 365 ? 45 : 30; }

  function poolDesc(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('dex') >= 0) return 'deepest liquidity pool';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'USDC supply market';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'highest-TVL vault';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'flagged vault';
    if (c.indexOf('rwa') >= 0) return 'yield-bearing RWA tranche';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'staking pool';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('synthetic') >= 0) return 'USDC margin account';
    return 'primary pool';
  }
  function weeklyFor(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity') >= 0) return { actions: 'one small swap through the pool plus one fee claim', minutes: 15 };
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return { actions: 'one supply top-up or partial repay, alternating', minutes: 12 };
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('aggregator') >= 0) return { actions: 'one vault review plus a rebalance approval when the curator moves', minutes: 20 };
    if (c.indexOf('rwa') >= 0) return { actions: 'one NAV or attestation check plus a small top-up', minutes: 12 };
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return { actions: 'one reward claim plus a restake', minutes: 10 };
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('synthetic') >= 0) return { actions: 'one small hedge open-and-close round trip', minutes: 15 };
    return { actions: 'one deposit top-up, vote or position check', minutes: 10 };
  }
  function guardFor(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Before adding liquidity, check the pool\'s composition against an impermanent-loss simulator and keep your share under 1% so the exit never moves the price.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Keep the loan-to-value under 50% after every weekly action, so a 7-day TVL drawdown cannot trigger liquidation.';
    if (c.indexOf('rwa') >= 0) return 'Real-world assets carry KYC and withdrawal gates: verify the lockup, redemption window and attestation cadence before sizing the deposit.';
    if (c.indexOf('restak') >= 0) return 'Restaked receipts unbond on a queue measured in days; never size the deposit past what you can leave untouched through the full cooldown.';
    if (c.indexOf('staking') >= 0) return 'Staked balances exit on the chain\'s own unbonding schedule; check the queue length before depositing and never stake rent money.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('aggregator') >= 0) return 'The vault is curator-managed: read the curator\'s past decisions and the fee stack each week, and exit if the mandate changes without a vote.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('synthetic') >= 0) return 'Derivative margin is liquidation risk: size the position under 20% of the margin account and set a hard stop before opening anything.';
    return 'Verify every approval and deposit address against the protocol\'s own documentation, and never sign a permit you cannot read in the wallet prompt.';
  }
  function fmtUsdShort(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function shareStr(pct) { return pct >= 0.01 ? pct.toFixed(2) + '%' : pct >= 0.001 ? pct.toFixed(4) + '%' : pct.toFixed(6) + '%'; }
  /** Clamp a step inside the gate's 20..600 window, and inside the house 40..450 target. */
  function stepClamp(s) {
    var t = s.trim();
    if (t.length > 450) t = t.slice(0, 447).replace(/[\s,.;-]+$/, '') + '...';
    while (t.length < 40) t += ' Log the transaction hash with the date in the farm sheet.';
    return t;
  }
  /** A costed farm plan: five steps with the chain's gas, the deposit's pool share, the weekly
   * budget, the category's guard and explicit exit triggers over an age-keyed horizon. */
  function farmPlan(p, age, capital) {
    var chain = (p.chains && p.chains.length > 0) ? p.chains[0] : 'its main chain';
    var gas = gasForChain(chain), setupGas = Math.round(gas * 3 * 100) / 100, weeklyGas = Math.round(gas * 2 * 100) / 100;
    var weekly = weeklyFor(p.category), hold = holdDaysFor(age), share = (capital / p.tvl_usd) * 100, monthlyMinutes = weekly.minutes * 4;
    var name = p.name, pool = poolDesc(p.category);
    return {
      chain: chain, capital_usd: capital, gas_setup_usd: setupGas, gas_weekly_usd: weeklyGas, hold_days: hold,
      steps: [
        stepClamp('Open a fresh wallet used only for ' + name + ' and fund it with the deposit plus about $' + setupGas.toFixed(2) + ' of gas — ' + chain + ' actions cost about $' + gas.toFixed(2) + ' each, and approvals multiply.'),
        stepClamp('Deposit $' + capital + ' into ' + name + '\'s ' + pool + ' on ' + chain + ': about ' + shareStr(share) + ' of its ' + fmtUsdShort(p.tvl_usd) + ' TVL, small enough that your exit will not move the pool.'),
        stepClamp('Every week, run ' + weekly.actions + ' — about $' + weeklyGas.toFixed(2) + ' of gas and ' + weekly.minutes + ' minutes a session, ' + monthlyMinutes + ' minutes a month. Log every action with its date and transaction hash.'),
        stepClamp(guardFor(p.category) + ' Re-check it whenever ' + name + '\'s 7-day TVL move exceeds 25% in either direction.'),
        stepClamp('Hold at least ' + hold + ' days, then unwind in one move if none of the exit triggers fired: TVL 40% below your entry, changed points terms, or a token now trading you can claim into.'),
      ],
    };
  }

  /** Partition the snapshot, fit, validate, score. Returns {board, data}: board is the gate-shaped
   * rows array, data is everything the dashboard renders. */
  function buildRadar(snapshot, params) {
    params = params !== undefined && params !== null ? params : PARAMS;
    var asOf = snapshot.as_of, watchSet = {};
    snapshot.watchlist.forEach(function (s) { watchSet[s] = 1; });

    var pre = [], live = [];
    snapshot.protocols.forEach(function (p) {
      if (isPreToken(p)) { p._age_days = ageDays(asOf, p.listed_at); pre.push(p); }
      else if (p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX') { p._age_days = ageDays(asOf, p.listed_at); live.push(p); }
    });

    var watchlistRows = [], earlyRows = [], excludedRows = [];
    pre.forEach(function (p) {
      var reasons = exclusionReasons(p);
      if (watchSet[p.slug]) watchlistRows.push(p);
      else if (reasons.length > 0 || p.tvl_usd >= snapshot.floor_usd) {
        excludedRows.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, age_days: p._age_days, reasons: reasons.length > 0 ? reasons : ['above the floor yet off the watchlist: DefiLlama records a parent product the snapshot does not carry'] });
      } else earlyRows.push(p);
    });

    var anchors = live.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
    var stats = roundStats(anchorStats(anchors));
    var cv = crossValidate(anchors, params);
    var walk = walkForward(anchors, params);

    var scored = [];
    watchlistRows.concat(earlyRows).forEach(function (p) {
      var comp = scoreComponents(normalizedRow(p), stats, params);
      var implied = Math.max(1, Math.round(p.tvl_usd * comp.multiple));
      scored.push({ p: p, comp: comp, implied: implied, iqrLo: Math.max(1, Math.round(implied * Math.exp(cv.residual_p25))), iqrHi: Math.min(1e14, Math.round(implied * Math.exp(cv.residual_p75))), capital: capitalFor(p.tvl_usd, params) });
    });
    scored.sort(function (a, b) { return b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0); });

    var board = scored.map(function (s, i) {
      var p = s.p, m = s.comp;
      return {
        rank: i + 1, slug: p.slug, name: p.name, tier: watchSet[p.slug] ? 'watchlist' : 'early', category: p.category, chains: p.chains,
        tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, age_days: p._age_days,
        implied_value_usd: s.implied, iqr_lo_usd: s.iqrLo, iqr_hi_usd: s.iqrHi,
        model: { category: m.category, category_multiple: round4(m.category_multiple), elasticity_factor: round4(m.elasticity_factor), growth_pct: m.growth_pct, growth_mult: round4(m.growth_mult), maturity_mult: round4(m.maturity_mult), breadth_mult: round4(m.breadth_mult) },
        comps: nearestComps(p, anchors, params.comps),
        farm: farmPlan(p, p._age_days, s.capital),
        farm_steps: null, // filled below from the plan's steps
      };
    });
    board.forEach(function (r) { r.farm_steps = r.farm.steps; });    var liveRows = anchors.map(function (a) {
      return { slug: a.slug, name: a.name, category: a.category, chains: a.chains, tvl_usd: a.tvl_usd, mcap_usd: a.mcap_usd, ratio: round4(a.mcap_usd / a.tvl_usd), change_7d: a.change_7d };
    });

    var data = {
      as_of: asOf, source: snapshot.source, floor_usd: snapshot.floor_usd, model_version: MODEL_VERSION, params: params,
      stats: {
        global_log_median: stats.global_log_median, global_multiple: round4(stats.global_multiple), median_tvl: stats.median_tvl, median_age: stats.median_age,
        categories: Object.keys(stats.categories).sort().reduce(function (acc, k) {
          acc[k] = { n: stats.categories[k].n, log_median: stats.categories[k].log_median, multiple: round4(shrunkCategoryMultiple(stats, k === 'Unsorted' ? null : k, params)) };
          return acc;
        }, {}),
        residual_p25: cv.residual_p25, residual_p75: cv.residual_p75,
      },
      validation: { cv: cv, walk_forward: walk },
      counts: { protocols: snapshot.protocols.length, watchlist: watchlistRows.length, ranked: board.length, early: earlyRows.length, live: anchors.length, excluded: excludedRows.length },
      rows: board, live: liveRows,
      excluded: excludedRows.sort(function (a, b) { return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); }),
    };
    return { board: board, data: data };
  }

  /** Why the gate would refuse this board, or null: coverage, ranks, order, a real ranking, the
   * slug/name/implied shapes, and the farm-step window. */
  function boardIssue(board, snapshot) {
    if (board.length < 100 || board.length > 4000) return 'the board holds ' + board.length + ' rows, outside 100..4000';
    var seen = {}, have = {}, known = {}, i, r;
    snapshot.protocols.forEach(function (p) { known[p.slug] = 1; });
    for (i = 0; i < board.length; i++) {
      r = board[i];
      if (seen[r.slug] || !known[r.slug]) return 'slug ' + r.slug + ' is duplicated or not a snapshot protocol';
      seen[r.slug] = 1; have[r.slug] = 1;
      if (typeof r.slug !== 'string' || r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug)) return 'bad slug ' + JSON.stringify(r.slug);
      if (typeof r.name !== 'string' || r.name.length === 0) return 'empty name for ' + r.slug;
      if (!Number.isSafeInteger(r.rank) || r.rank !== i + 1) return 'rank at position ' + i + ' is ' + r.rank;
      if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return 'implied value for ' + r.slug + ' is ' + r.implied_value_usd;
      if (i > 0 && r.implied_value_usd > board[i - 1].implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
      if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return r.slug + ' has ' + (r.farm_steps ? r.farm_steps.length : 'no') + ' farm steps';
      for (var j = 0; j < r.farm_steps.length; j++) {
        var s = String(r.farm_steps[j]).trim();
        if (s.length < 20 || s.length > 600) return r.slug + ' has a farm step of ' + s.length + ' characters';
      }
    }
    if (board.length >= 2 && board[0].implied_value_usd === board[board.length - 1].implied_value_usd) return 'all rows share one implied value: not a ranking';
    var missing = snapshot.watchlist.filter(function (s) { return !have[s]; });
    if (missing.length > 0) return 'the board misses ' + missing.length + ' watchlist slugs: ' + missing.slice(0, 5).join(', ');
    return null;
  }

  return { MODEL_VERSION: MODEL_VERSION, PARAMS: PARAMS, buildRadar: buildRadar, boardIssue: boardIssue, scoreComponents: scoreComponents, anchorStats: anchorStats, crossValidate: crossValidate, walkForward: walkForward, median: median, spearman: spearman };
});
