/* Token Radar — terminal page. No framework, no network, no URLs. Reads window.RADAR (written by
 * main.ts beside the page) and window.RadarModel (this directory's model.js); the sandbox re-scores
 * every row with the model's own functions, so table, ranks and KPIs always agree with the formula.
 * Deep links (?shot=detail&rank=N, ?shot=filtered&tier=early&cat=Dexs) render the screenshot states. */
(function () {
  'use strict';
  var R = window.RADAR, M = window.RadarModel;
  if (!R || !M) return;
  var $ = function (id) { return document.getElementById(id); };
  var state = { tier: 'ranked', q: '', cat: '', chain: '', sortKey: 'rank', sortDir: 1, sizing: 1000 };
  var sandboxRows = R.rows.map(function (r) { return JSON.parse(JSON.stringify(r)); });
  /** Snapshot names are data, never trusted markup: every interpolation goes through esc(). */
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function fmtUsd(n) {
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtDelta(v) {
    if (v === null || v === undefined) return { text: '—', cls: 'delta-flat' };
    return { text: (v >= 0 ? '+' : '') + v.toFixed(1) + '%', cls: v > 0.05 ? 'delta-up' : v < -0.05 ? 'delta-down' : 'delta-flat' };
  }
  function fmtAge(d) { return d === null || d === undefined ? 'n/a' : d + 'd'; }
  function r4(n) { return Math.round(n * 1e4) / 1e4; }

  function fillKpis() {
    $('live-count').textContent = String(R.counts.live);
    $('model-version').textContent = 'model ' + R.model_version;
    $('as-of').textContent = 'snapshot ' + R.as_of;
    $('floor-pill').textContent = 'watchlist floor ' + fmtUsd(R.floor_usd);
    $('kpi-watch').textContent = R.counts.watchlist + '/' + R.counts.watchlist;
    $('kpi-ranked').textContent = String(R.counts.ranked);
    $('kpi-live').textContent = String(R.counts.live);
    $('kpi-cv').textContent = 'ρ ' + R.validation.cv.spearman.toFixed(2);
    $('kpi-walk').textContent = 'WF ρ ' + R.validation.walk_forward.spearman.toFixed(2) + ' · |Δlog| ' + R.validation.cv.median_abs_log_error.toFixed(2);
    $('kpi-excluded').textContent = String(R.counts.excluded);
    $('foot-source').textContent = R.source;
    var tabs = { ranked: R.counts.ranked, watchlist: R.counts.watchlist, early: R.counts.early, live: R.counts.live, excluded: R.counts.excluded };
    Object.keys(tabs).forEach(function (k) { var node = $('t-' + k); if (node) node.textContent = String(tabs[k]); });
  }  function top1Label() {
    var t = sandboxRows.slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; })[0];
    $('kpi-top1').textContent = t ? '№1 ' + t.name + ' · ' + fmtUsd(t.implied_value_usd) : '№1 —';
  }

  function readParams() {
    var p = {};
    for (var k in R.params) p[k] = R.params[k];
    p.elasticity = parseFloat($('s-elasticity').value);
    p.growth_weight = parseFloat($('s-growth').value);
    p.maturity_spread = parseFloat($('s-spread').value);
    return p;
  }
  function recompute() {
    var params = readParams(), stats = R.stats;
    $('val-elasticity').textContent = params.elasticity.toFixed(2);
    $('val-growth').textContent = params.growth_weight.toFixed(2);
    $('val-spread').textContent = params.maturity_spread.toFixed(2);
    sandboxRows.forEach(function (r) {
      var comp = M.scoreComponents(r, stats, params);
      r.implied_value_usd = Math.max(1, Math.round(r.tvl_usd * comp.multiple));
      r.model = { category: comp.category, category_multiple: r4(comp.category_multiple), elasticity_factor: r4(comp.elasticity_factor), growth_pct: comp.growth_pct, growth_mult: r4(comp.growth_mult), maturity_mult: r4(comp.maturity_mult), breadth_mult: r4(comp.breadth_mult) };
      r.iqr_lo_usd = Math.max(1, Math.round(r.implied_value_usd * Math.exp(stats.residual_p25)));
      r.iqr_hi_usd = Math.min(1e14, Math.round(r.implied_value_usd * Math.exp(stats.residual_p75)));
    });
    sandboxRows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    sandboxRows.forEach(function (r, i) { r.rank = i + 1; });
    top1Label();
  }
  function bindSandbox() {
    ['s-elasticity', 's-growth', 's-spread'].forEach(function (id) {
      $(id).addEventListener('input', function () { recompute(); renderTable(); });
    });
    $('sandbox-reset').addEventListener('click', function () {
      $('s-elasticity').value = R.params.elasticity;
      $('s-growth').value = R.params.growth_weight;
      $('s-spread').value = R.params.maturity_spread;
      recompute();
      renderTable();
    });
  }

  function rowsForTier(tier) {
    if (tier === 'live') return R.live;
    if (tier === 'excluded') return R.excluded;
    if (tier === 'watchlist') return sandboxRows.filter(function (r) { return r.tier === 'watchlist'; });
    if (tier === 'early') return sandboxRows.filter(function (r) { return r.tier === 'early'; });
    return sandboxRows;
  }
  function rebuildSelects() {
    var cats = {}, chains = {};
    rowsForTier(state.tier).forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      (r.chains || []).forEach(function (c) { chains[c] = 1; });
    });
    function fill(sel, keys, label) {
      sel.innerHTML = '<option value="">' + esc(label) + '</option>' + Object.keys(keys).sort().map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('');
    }
    fill($('category'), cats, 'All categories');
    fill($('chain'), chains, 'All chains');
    $('category').value = cats[state.cat] ? state.cat : '';
    $('chain').value = chains[state.chain] ? state.chain : '';
    state.cat = $('category').value;
    state.chain = $('chain').value;
  }
  function filteredRows() {
    var q = state.q.toLowerCase();
    return rowsForTier(state.tier).filter(function (r) {
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && (r.category || '') !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      return true;
    });
  }

  var HEADERS = { ranked: ['M<sub>cat</sub>', 'Implied FDV · P25–P75', 'Farm plan'], live: ['MCap/TVL', 'Market cap', 'Status'], excluded: ['Category', 'Chains', 'Excluded because'] };
  HEADERS.watchlist = HEADERS.ranked;
  HEADERS.early = HEADERS.ranked;
  var ACCESSORS = {
    ranked: { rank: 'rank', name: 'name', tvl_usd: 'tvl_usd', change_7d: 'change_7d', age_days: 'age_days', category_multiple: 'm.category_multiple', implied_value_usd: 'implied_value_usd' },
    live: { rank: 'rank', name: 'name', tvl_usd: 'tvl_usd', change_7d: 'change_7d', category_multiple: 'ratio', implied_value_usd: 'mcap_usd' },
    excluded: { rank: 'rank', name: 'name', tvl_usd: 'tvl_usd', change_7d: 'change_7d', age_days: 'age_days', category_multiple: 'category', implied_value_usd: function (r) { return (r.chains || []).length; } },
  };
  ACCESSORS.watchlist = ACCESSORS.ranked;
  ACCESSORS.early = ACCESSORS.ranked;
  function getVal(r, path) {
    if (typeof path === 'function') return path(r);
    var v = r, parts = path.split('.');
    for (var i = 0; i < parts.length; i++) v = v[parts[i]];
    return v;
  }
  function setHeaders() {
    var h = HEADERS[state.tier] || HEADERS.ranked;
    $('h-mcat').innerHTML = h[0];
    $('h-fdv').innerHTML = h[1];
    $('h-farm').innerHTML = h[2];
    var ths = document.querySelectorAll('#table thead th.sortable');
    for (var i = 0; i < ths.length; i++) {
      var key = ths[i].getAttribute('data-key');
      ths[i].className = 'sortable' + (ACCESSORS[state.tier][key] ? '' : ' hidden') + (key === state.sortKey ? (state.sortDir > 0 ? ' sorted-asc' : ' sorted-desc') : '');
    }
  }
  function sortRows(rows) {
    var acc = ACCESSORS[state.tier], key = acc[state.sortKey] ? state.sortKey : 'rank', dir = state.sortDir, path = acc[key];
    return rows.slice().sort(function (a, b) {
      var va = getVal(a, path), vb = getVal(b, path);
      if (key === 'name' || (key === 'category_multiple' && state.tier === 'excluded')) {
        var sa = String(va === null || va === undefined ? '' : va).toLowerCase(), sb = String(vb === null || vb === undefined ? '' : vb).toLowerCase();
        return dir * (sa < sb ? -1 : sa > sb ? 1 : 0);
      }
      var na = va === null || va === undefined ? -Infinity : va, nb = vb === null || vb === undefined ? -Infinity : vb;
      return dir * (na - nb) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    });
  }
  function iqrBar(r) {
    var lo = Math.log(r.iqr_lo_usd), hi = Math.log(r.iqr_hi_usd), mid = Math.log(r.implied_value_usd);
    var start = Math.max(0, Math.min(1, (mid - lo) / Math.max(1e-9, hi - lo)));
    return '<span class="iqr-bar"><span class="iqr-fill" style="left:' + (start * 82).toFixed(2) + '%;right:0"></span></span>';
  }
  function farmCell(r) {
    var f = r.farm;
    return '<span class="num"><b>' + fmtUsd(f.capital_usd) + '</b></span> dep · <span class="num">$' + f.gas_weekly_usd.toFixed(2) + ' gas/wk</span> · ' + f.hold_days + 'd hold';
  }
  function rowHtml(r) {
    var cls = r.rank <= 3 && state.tier !== 'live' && state.tier !== 'excluded' ? ' class="rank-' + r.rank + '"' : '';
    var badge = r.tier ? '<span class="tier-badge tier-' + r.tier + '">' + (r.tier === 'watchlist' ? 'watchlist' : 'early') + '</span>' : '';
    var chains = r.chains && r.chains.length > 3 ? r.chains.slice(0, 3).join(', ') + ' +' + (r.chains.length - 3) : (r.chains || []).join(', ');
    var d = fmtDelta(r.change_7d);
    var mCell = state.tier === 'live' ? r.ratio.toFixed(3) : state.tier === 'excluded' ? esc(r.category || 'uncategorized') : r.model.category_multiple.toFixed(3);
    var fCell, farmCellHtml;
    if (state.tier === 'live') { fCell = fmtUsd(r.mcap_usd); farmCellHtml = 'traded — market value, not a model claim'; }
    else if (state.tier === 'excluded') {
      fCell = (r.chains || []).length + ' chains';
      farmCellHtml = (r.reasons || []).map(function (rs) { return '<span class="reason-chip">' + esc(rs) + '</span>'; }).join('');
    } else {
      fCell = '<span class="fdv-main">' + fmtUsd(r.implied_value_usd) + '</span><span class="fdv-iqr">' + fmtUsd(r.iqr_lo_usd) + ' – ' + fmtUsd(r.iqr_hi_usd) + '</span>' + iqrBar(r);
      farmCellHtml = farmCell(r);
    }
    return '<tr' + cls + ' data-slug="' + esc(r.slug) + '"' + (state.tier !== 'live' && state.tier !== 'excluded' ? ' tabindex="0"' : '') + '><td class="rank-cell num">' + r.rank + '</td>' +
      '<td class="proto-cell"><div>' + badge + '<span class="proto-name">' + esc(r.name) + '</span></div><div class="proto-sub">' + esc(r.category || 'uncategorized') + ' · ' + esc(chains || 'no chains') + '</div></td>' +
      '<td class="num num-r">' + fmtUsd(r.tvl_usd) + '</td><td class="num num-r ' + d.cls + '">' + d.text + '</td>' +
      '<td class="num num-r">' + (state.tier === 'live' ? 'n/a' : fmtAge(r.age_days)) + '</td><td class="num num-r">' + mCell + '</td>' +
      '<td class="fdv-cell num num-r">' + fCell + '</td><td class="farm-cell">' + farmCellHtml + '</td></tr>';
  }
  function renderTable() {
    setHeaders();
    var rows = sortRows(filteredRows());
    $('match-count').textContent = rows.length + ' / ' + rowsForTier(state.tier).length;
    var cap = state.tier === 'excluded' ? 40 : 120;
    var shown = rows.slice(0, cap), html = '';
    if (rows.length === 0) html = '<tr class="empty-row"><td colspan="8">No protocols match the current filters.</td></tr>';
    else {
      for (var i = 0; i < shown.length; i++) html += rowHtml(shown[i]);
      if (rows.length > cap) html += '<tr class="empty-row"><td colspan="8">' + (rows.length - cap) + ' more rows match — narrow the filters to see them.</td></tr>';
    }
    $('tbody').innerHTML = html;
  }
  function bindToolbar() {
    var tabs = document.querySelectorAll('#tabs .tab'), i;
    for (i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (ev) {
        var btn = ev.currentTarget, j;
        for (j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
        btn.classList.add('active');
        state.tier = btn.getAttribute('data-tier');
        state.sortKey = 'rank';
        state.sortDir = 1;
        rebuildSelects();
        renderTable();
      });
    }
    $('search').addEventListener('input', function (ev) { state.q = ev.target.value.trim(); renderTable(); });
    $('category').addEventListener('change', function (ev) { state.cat = ev.target.value; renderTable(); });
    $('chain').addEventListener('change', function (ev) { state.chain = ev.target.value; renderTable(); });
    var ths = document.querySelectorAll('#table thead th.sortable');
    for (var k = 0; k < ths.length; k++) {
      ths[k].addEventListener('click', function (ev) {
        var key = ev.currentTarget.getAttribute('data-key');
        if (state.sortKey === key) state.sortDir = -state.sortDir;
        else { state.sortKey = key; state.sortDir = key === 'name' ? 1 : (key === 'rank' ? 1 : -1); }
        renderTable();
      });
    }
    $('tbody').addEventListener('click', function (ev) {
      var tr = ev.target.closest('tr[data-slug]');
      if (!tr || state.tier === 'live' || state.tier === 'excluded') return;
      var row = null;
      for (var i = 0; i < sandboxRows.length; i++) if (sandboxRows[i].slug === tr.getAttribute('data-slug')) row = sandboxRows[i];
      if (row) openDrawer(row);
    });
    $('tbody').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var tr = ev.target.closest('tr[data-slug]');
      if (!tr || state.tier === 'live' || state.tier === 'excluded') return;
      var row = null;
      for (var i = 0; i < sandboxRows.length; i++) if (sandboxRows[i].slug === tr.getAttribute('data-slug')) row = sandboxRows[i];
      if (row) { ev.preventDefault(); openDrawer(row); }
    });
  }

  var drawerRow = null;
  function openDrawer(r) {
    drawerRow = r;
    $('d-name').textContent = r.name;
    var tierBadge = $('d-tier');
    tierBadge.textContent = r.tier === 'watchlist' ? 'watchlist' : 'early < $50M';
    tierBadge.className = 'tier-badge tier-' + r.tier;
    $('d-meta').innerHTML = '<span>#' + r.rank + '</span><span class="sep">·</span><span>' + esc(r.slug) + '</span><span class="sep">·</span><span>' + esc(r.category || 'uncategorized') + '</span><span class="sep">·</span><span>' + esc((r.chains || []).join(', ')) + '</span><span class="sep">·</span><span>listed ' + esc(r.listed_at || 'unknown') + '</span>';
    var m = r.model, f = r.farm;
    var cells = [
      ['TVL', fmtUsd(r.tvl_usd), r.change_7d !== null && r.change_7d !== undefined ? '7d ' + (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%' : '7d n/a'],
      ['M_cat ×', m.category_multiple.toFixed(3), (R.stats.categories[m.category] ? 'n=' + R.stats.categories[m.category].n : 'global') + ' anchors'],
      ['Elasticity ×', m.elasticity_factor.toFixed(3), 'ε ' + R.params.elasticity.toFixed(2)],
      ['Growth ×', m.growth_mult.toFixed(3), 'g ' + m.growth_pct + '%'],
      ['Maturity ×', m.maturity_mult.toFixed(3), r.age_days === null ? 'age n/a → median' : fmtAge(r.age_days) + ' tokenless'],
      ['Breadth ×', m.breadth_mult.toFixed(3), (r.chains || []).length + ' chains'],
    ];
    $('d-decomp').innerHTML = cells.map(function (c) {
      return '<div class="cell"><span class="cell-label">' + c[0] + '</span><span class="cell-value num">' + c[1] + '</span><span class="cell-note">' + esc(c[2]) + '</span></div>';
    }).join('');
    $('d-note').textContent = 'multiple ' + (m.category_multiple * m.elasticity_factor * m.growth_mult * m.maturity_mult * m.breadth_mult).toFixed(4) + ' × TVL → implied FDV ' + fmtUsd(r.implied_value_usd) + ' · P25 ' + fmtUsd(r.iqr_lo_usd) + ' – P75 ' + fmtUsd(r.iqr_hi_usd) + ' · capital ' + fmtUsd(f.capital_usd) + ' on ' + f.chain + ' · gas $' + f.gas_setup_usd.toFixed(2) + ' setup, $' + f.gas_weekly_usd.toFixed(2) + '/wk · hold ' + f.hold_days + 'd';
    $('d-comps').innerHTML = (r.comps || []).map(function (c) {
      return '<tr><td>' + esc(c.name) + '<span class="proto-sub"> ' + esc(c.category || 'uncategorized') + ' · ' + esc(c.slug) + '</span></td><td class="num num-r">' + fmtUsd(c.tvl_usd) + '</td><td class="num num-r">' + fmtUsd(c.mcap_usd) + '</td><td class="num num-r">' + c.ratio.toFixed(3) + '</td><td class="num num-r">' + c.overlap + ' / ' + (r.chains || []).length + '</td></tr>';
    }).join('');
    $('d-steps').innerHTML = (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    bindSizing();
    var dlg = $('drawer');
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  function sizingText() {
    var r = drawerRow;
    if (!r) return;
    var usd = state.sizing, share = (usd / r.tvl_usd) * 100;
    var gasTotal = r.farm.gas_setup_usd + r.farm.gas_weekly_usd * Math.ceil((r.farm.hold_days || 45) / 7);
    var drag = (gasTotal / usd) * 100;
    $('d-sizing-out').innerHTML = 'pool share <b class="num">' + share.toFixed(4) + '%</b> · gas drag <b class="num">' + drag.toFixed(2) + '%</b> (' + fmtUsd(gasTotal) + ' over ' + r.farm.hold_days + 'd on ' + esc(r.farm.chain) + ')';
  }
  function bindSizing() {
    var btns = document.querySelectorAll('#d-sizing .size-btn'), i;
    for (i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', parseInt(btns[i].getAttribute('data-usd'), 10) === state.sizing);
      btns[i].onclick = (function (btn) {
        return function () {
          state.sizing = parseInt(btn.getAttribute('data-usd'), 10);
          for (var j = 0; j < btns.length; j++) btns[j].classList.remove('active');
          btn.classList.add('active');
          sizingText();
        };
      })(btns[i]);
    }
    sizingText();
  }
  $('d-close').addEventListener('click', function () {
    var dlg = $('drawer');
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  });

  fillKpis();
  recompute();
  rebuildSelects();
  bindSandbox();
  bindToolbar();
  var qp = new URLSearchParams(location.search);
  if (qp.get('tier')) {
    var want = qp.get('tier'), tabEls = document.querySelectorAll('#tabs .tab');
    for (var t = 0; t < tabEls.length; t++) if (tabEls[t].getAttribute('data-tier') === want) tabEls[t].click();
  }
  if (qp.get('cat')) { state.cat = qp.get('cat'); $('category').value = state.cat; renderTable(); }
  if (qp.get('chain')) { state.chain = qp.get('chain'); $('chain').value = state.chain; renderTable(); }
  if (qp.get('q')) { state.q = qp.get('q'); $('search').value = state.q; renderTable(); }
  renderTable();
  if (qp.get('shot') === 'detail') {
    var row = sandboxRows.filter(function (r) { return r.rank === parseInt(qp.get('rank') || '1', 10); })[0];
    if (row) openDrawer(row);
  }
})();
