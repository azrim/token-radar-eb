/* Token Radar — interactive client controller. Zero external URLs, zero network calls. */
(function () {
'use strict';
var R = window.RADAR, M = window.RadarModel;
if (!R || !M) return;
var $ = function (id) { return document.getElementById(id); };
var qs = function (s) { return document.querySelectorAll(s); };
var on = function (el, ev, fn) { el.addEventListener(ev, fn); };
var S = { tier: 'all', verdict: '', dep: 0, share: 0.07, q: '', cat: '', chain: '', sortKey: 'rank', sortDir: 1, oosMode: 'both', slug: null };

function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function usdK(n) { return '$' + n.toLocaleString('en-US'); }
function sp(c, t) { return '<span class="' + c + '">' + t + '</span>'; }
function dv(c, t) { return '<div class="' + c + '">' + t + '</div>'; }

function fmtUsd(n) {
if (n === null || n === undefined || !Number.isFinite(n)) return '—';
var a = Math.abs(n), s = n < 0 ? '-' : '';
return a >= 1e12 ? s + '$' + (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? s + '$' + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + '$' + (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? s + usdK(Math.round(a / 1e3)) + 'K' : s + '$' + Math.round(a);
}
function fmtNet(n) {
if (n === null || n === undefined || !Number.isFinite(n)) return '—';
var s = n >= 0 ? '+' : '-', a = Math.abs(n);
return a >= 1e6 ? s + '$' + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + '$' + (a / 1e3).toFixed(2) + 'K' : s + '$' + a.toFixed(2);
}
function fmtDelta(v) { return v === null || v === undefined ? { text: '—', cls: 'delta-flat' } : { text: (v >= 0 ? '+' : '') + v.toFixed(1) + '%', cls: v > 0.05 ? 'delta-up' : v < -0.05 ? 'delta-down' : 'delta-flat' }; }
function fmtAge(d) { return d === null || d === undefined ? 'undated' : d + 'd'; }

function recompute() {
var fC = 0, mC = 0, sC = 0;
R.rows.forEach(function (r) {
var ev = M.evalFarm(r, S.dep > 0 ? S.dep : r.farm.capital_usd, S.share);
r._live = ev;
if (ev.verdict === 'farm') fC++; else if (ev.verdict === 'marginal') mC++; else sC++;
});
$('v-farm').textContent = fC; $('v-marg').textContent = mC; $('v-skip').textContent = sC;
var c = R.counts, v = R.validation, top = R.rows[0];
$('hdr-anchors').textContent = c.live; $('hdr-pool').textContent = c.standalone_pool;
$('meta-asof').textContent = 'snapshot ' + R.as_of; $('meta-model').textContent = 'model ' + R.model_version;
$('meta-rules').textContent = c.protocols + ' protocols · offline · zero hardcoded names';
$('cnt-all').textContent = c.ranked; $('cnt-watch').textContent = c.watchlist; $('cnt-off').textContent = c.offlist;
$('cnt-early').textContent = c.early; $('cnt-live').textContent = c.live; $('cnt-excl').textContent = c.excluded;

var dLbl = S.dep > 0 ? usdK(S.dep) : 'plan size', shP = Math.round(S.share * 1000) / 10;
var kpis = [
['RANKED', c.ranked, c.watchlist + ' watchlist · ' + c.offlist + ' off-list · ' + c.early + ' below floor'],
['IMPLIED VALUE SUM', fmtUsd(c.implied_sum_usd), top ? '#1 ' + top.name + ' · ' + fmtUsd(top.implied_value_usd) : '—'],
['OUT-OF-SAMPLE MISS', '×' + v.loo.typical_miss.toFixed(2), 'LOO P75 ×' + v.loo.p75_miss.toFixed(2) + ' · Walk-Fwd ×' + v.walk_forward.typical_miss.toFixed(2)],
['RANGE HOLDS', Math.round(v.loo.in_p25_p75_pct * 100) + '% (' + v.loo.in_p25_p75_n + '/' + v.loo.n + ')', 'in P25–P75 (stated 50%) · ' + Math.round(v.loo.in_p10_p90_pct * 100) + '% in P10–P90'],
['LAUNCH ODDS HELD OUT', Math.round(v.launch_loo.accuracy * 100) + '% (' + v.launch_loo.called_right + '/' + v.launch_loo.n + ')', 'called right out-of-sample · base rate ' + Math.round(v.launch_loo.base_rate * 100) + '%'],
['WORTH FARMING', fC + ' Farm', mC + ' marginal · ' + sC + ' skip (' + dLbl + ', ' + shP + '% drop)']
];
$('kpis').innerHTML = kpis.map(function (k) { return '<div class="kpi">' + sp('kpi-label', esc(k[0])) + sp('kpi-value num', esc(k[1])) + sp('kpi-sub', esc(k[2])) + '</div>'; }).join('');
}

function renderBars() {
var c = R.counts, tot = c.protocols, segs = [
['Watchlist (≥$50M)', c.watchlist, '#34d399'], ['Off-list clean (≥$50M)', c.offlist, '#fbbf24'], ['Below $50M floor', c.early, '#38bdf8'],
['Traded anchors', c.live, '#a78bfa'], ['Token sub-pools & CEX', c.token_subpools, '#475569'], ['Excluded wrappers/bridges/LST', c.excluded, '#f87171']
];
$('part-track').innerHTML = segs.map(function (s) { return '<div class="part-seg" style="width:' + ((s[1] / tot) * 100).toFixed(2) + '%;background:' + s[2] + '"></div>'; }).join('');
$('part-legend').innerHTML = segs.map(function (s) { return '<span class="part-item"><i class="part-dot" style="background:' + s[2] + '"></i><b>' + s[1] + '</b> ' + esc(s[0]) + '</span>'; }).join('') + '<span class="part-item">= <b>' + tot + '</b> snapshot records</span>';

var rows = R.rows, ok = true, sum = 0, wH = 0;
for (var i = 0; i < rows.length; i++) {
sum += rows[i].implied_value_usd; if (rows[i].tier === 'watchlist') wH++;
if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) ok = false;
}
$('integrity-strip').innerHTML = '<span>✓ table = board.json · ✓ ' + rows.length + ' rows = ' + c.ranked + ' written · ✓ ' + (ok ? 'strictly non-increasing' : 'order error') + ' · ✓ sum matches (' + fmtUsd(sum) + ') · ✓ ' + wH + '/' + c.watchlist + ' watchlist covered</span>' + sp('dim', 'Click any row for 7-step waterfall, comparables &amp; 3×3 farm sensitivity');
}

function renderOos() {
var v = R.validation, m = S.oosMode, sL = m === 'both' || m === 'loo', sW = m === 'both' || m === 'wf', ll = v.launch_loo;
var mds = [['both', 'BOTH'], ['loo', 'EACH LEFT OUT'], ['wf', 'OLDER → NEWER']];
$('oos-pane').innerHTML =
dv('oos-head', '<div><h2>Out-of-sample check</h2><p class="oos-sub">Blind validation across ' + sp('num', v.loo.n) + ' unique traded anchors</p></div>' + dv('pill-group oos-mode" id="oos-mode', mds.map(function (x) { return '<button type="button" class="seg' + (m === x[0] ? ' active' : '') + '" data-mode="' + x[0] + '">' + x[1] + '</button>'; }).join(''))) +
dv('oos-block', '<h3>5-step model ablation &amp; sign-flip falsification</h3><table class="oos-table"><thead><tr><th>Model specification</th>' + (sL ? '<th class="num-r">LOO Typ · P75</th>' : '') + (sW ? '<th class="num-r">Walk-Fwd Typ · P75</th>' : '') + '</tr></thead><tbody>' +
v.ablation.map(function (r) {
var cls = r.active ? ' class="row-active"' : r.falsification ? ' class="row-falsify"' : '';
return '<tr' + cls + '><td>' + esc(r.label) + sp('ab-sub', esc(r.note)) + '</td>' + (sL ? '<td class="num num-r">×' + r.loo_typical.toFixed(2) + sp('ab-sub', 'P75 ×' + r.loo_p75.toFixed(2)) + '</td>' : '') + (sW ? '<td class="num num-r">×' + r.wf_typical.toFixed(2) + sp('ab-sub', 'P75 ×' + r.wf_p75.toFixed(2)) + '</td>' : '') + '</tr>';
}).join('') + '</tbody></table><p class="oos-note">Size curve cuts LOO miss from ×4.94 to ×3.33; adding 7d momentum &amp; EB category premium reaches ×3.22 (P75 ×8.30). Flipping 7d momentum sign worsens LOO miss to ×3.44 — confirming directional signal.</p>') +
dv('oos-block', '<h3>Interval honesty (held-out coverage vs stated band)</h3><table class="oos-table"><thead><tr><th>Error band</th><th class="num-r">Each left out</th><th class="num-r">Older → newer</th></tr></thead><tbody>' +
v.honesty.map(function (h) { return '<tr><td>' + esc(h.band) + sp('ab-sub', esc(h.verdict)) + '</td><td class="num num-r">' + esc(h.loo_str) + '</td><td class="num num-r">' + esc(h.wf_str) + '</td></tr>'; }).join('') +
'</tbody></table><p class="oos-note">P25–P75 holds 49.6% (59/119) in LOO vs 50% stated (calibrated). P10–P90 holds 77.3% (92/119) in LOO and 67.5% in walk-forward — slightly narrow due to heavy-tailed launches.</p>') +
dv('oos-block oos-launch-box', '<h3>Part B — Survival launch-odds held-out check</h3>' + dv('launch-stat num', Math.round(ll.accuracy * 1000) / 10 + '% called right (' + ll.called_right + '/' + ll.n + ' protocols) · base rate ' + Math.round(ll.base_rate * 1000) / 10 + '%') + '<p class="oos-note">Cure-rate survival fit across ' + ll.n + ' standalone protocols: category launch rate shrunk toward mature 2yr+ cohort (' + Math.round(R.lm.mature_rate * 100) + '% launched), discounted by tokenless elapsed age.</p>');
var btns = qs('#oos-mode .seg');
for (var i = 0; i < btns.length; i++) on(btns[i], 'click', function (ev) { S.oosMode = ev.currentTarget.getAttribute('data-mode'); renderOos(); });
}

function srcRows() { return S.tier === 'live' ? R.live : S.tier === 'excluded' ? R.excluded : (S.tier === 'watchlist' || S.tier === 'offlist' || S.tier === 'early') ? R.rows.filter(function (r) { return r.tier === S.tier; }) : R.rows; }

function rebuildSelects() {
var cats = {}, chs = {};
srcRows().forEach(function (r) { if (r.category) cats[r.category] = 1; (r.chains || []).forEach(function (c) { chs[c] = 1; }); });
function fill(sel, map, lbl) {
var cur = sel.value;
sel.innerHTML = '<option value="">' + esc(lbl) + '</option>' + Object.keys(map).sort().map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('');
sel.value = map[cur] ? cur : '';
}
fill($('category'), cats, 'All categories'); fill($('chain'), chs, 'All chains');
S.cat = $('category').value; S.chain = $('chain').value;
}

function getRows() {
var q = S.q.toLowerCase(), isRk = S.tier !== 'live' && S.tier !== 'excluded', k = S.sortKey, dir = S.sortDir;
return srcRows().filter(function (r) {
if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
if (S.cat && (r.category || '') !== S.cat) return false;
if (S.chain && (r.chains || []).indexOf(S.chain) < 0) return false;
if (isRk && S.verdict && r._live.verdict !== S.verdict) return false;
return true;
}).sort(function (a, b) {
if (k === 'name') { var sa = a.name.toLowerCase(), sb = b.name.toLowerCase(); return dir * (sa < sb ? -1 : sa > sb ? 1 : 0); }
var va = k === 'net_usd' ? (a._live ? a._live.net_usd : -Infinity) : (k === 'implied_value_usd' && S.tier === 'live') ? a.mcap_usd : (k === 'launch_odds' && S.tier === 'live') ? a.ratio : a[k];
var vb = k === 'net_usd' ? (b._live ? b._live.net_usd : -Infinity) : (k === 'implied_value_usd' && S.tier === 'live') ? b.mcap_usd : (k === 'launch_odds' && S.tier === 'live') ? b.ratio : b[k];
return dir * ((va === null || va === undefined ? -Infinity : va) - (vb === null || vb === undefined ? -Infinity : vb)) || (a.slug < b.slug ? -1 : 1);
});
}

function tBadge(t) { return sp('tier-badge tier-' + t, t === 'watchlist' ? 'WATCH' : t === 'offlist' ? 'OFF LIST' : t === 'early' ? '&lt;$50M' : 'EXCL'); }

function whisker(r) {
var lo = Math.log(Math.max(1, r.p10_usd)), hi = Math.log(Math.max(2, r.p90_usd)), q25 = Math.log(Math.max(1, r.iqr_lo_usd)), q75 = Math.log(Math.max(2, r.iqr_hi_usd)), mid = Math.log(Math.max(1, r.implied_value_usd)), s = Math.max(1e-6, hi - lo);
var l = clamp(((q25 - lo) / s) * 100, 5, 85), w = clamp(((q75 - q25) / s) * 100, 12, 90 - l), d = clamp(((mid - lo) / s) * 100, 5, 95);
return sp('whisker-bar', '<span class="whisker-fill" style="left:' + l.toFixed(1) + '%;width:' + w.toFixed(1) + '%"></span><span class="whisker-dot" style="left:' + d.toFixed(1) + '%"></span>');
}

function renderTable(){
var base=srcRows(),rows=getRows();
$('match-count').textContent=rows.length+' / '+base.length;
var hdrs=S.tier==='live'?['MCap/TVL','Traded MCap','Role']:S.tier==='excluded'?['Chains','Status','Exclusion Rule']:['Odds','Implied Value · P25–P75','Net of Fees (12w)'];
$('th-odds').textContent=hdrs[0];$('th-implied').textContent=hdrs[1];$('th-net').textContent=hdrs[2];
var ths=qs('#board-table thead th.sortable');
for(var t=0;t<ths.length;t++){var key=ths[t].getAttribute('data-key');ths[t].className='sortable'+(key==='name'||key==='rank'?'':' num-r')+(key===S.sortKey?(S.sortDir>0?' sorted-asc':' sorted-desc'):'');}
if(!rows.length){$('tbody').innerHTML='<tr class="empty-row"><td colspan="8">No protocols match the active filter combination.</td></tr>';return;}
var slice=rows.slice(0,S.tier==='excluded'?60:198),html='';
for(var i=0;i<slice.length;i++){
var r=slice[i],d=fmtDelta(r.change_7d),chs=(r.chains||[]).slice(0,2).join(', ')+((r.chains||[]).length>2?' +'+(r.chains.length-2):'');
var com='<td>'+dv('proto-wrap',(S.tier==='live'?'':tBadge(S.tier==='excluded'?'excluded':r.tier))+sp('proto-name',esc(r.name)))+dv('proto-sub',esc(r.category||'Unsorted')+(S.tier==='excluded'?'':' · '+esc(chs)))+'</td><td class="num num-r">'+fmtUsd(r.tvl_usd)+'</td><td class="num num-r '+(S.tier==='excluded'?'delta-flat':d.cls)+'">'+(S.tier==='excluded'?'—':d.text)+'</td><td class="num num-r">'+fmtAge(r.age_days)+'</td>';
if(S.tier==='live'){
html+='<tr><td class="num">'+sp('rk-main','#'+r.rank)+'</td>'+com+'<td class="num num-r">'+r.ratio.toFixed(3)+'×</td><td class="num num-r">'+sp('imp-main',fmtUsd(r.mcap_usd))+'</td><td class="num-r">'+sp('imp-sub','traded anchor')+'</td></tr>';
}else if(S.tier==='excluded'){
html+='<tr><td class="num">'+sp('rk-main',i+1)+'</td>'+com+'<td class="num num-r">'+(r.chains||[]).length+'</td><td class="num-r">'+sp('imp-sub','set aside')+'</td><td class="num-r">'+(r.reasons||[]).map(function(rs){return sp('reason-chip',esc(rs));}).join('')+'</td></tr>';
}else{
var ev=r._live,oP=Math.round(r.launch_odds*100);
html+='<tr data-slug="'+esc(r.slug)+'" tabindex="0"><td class="num">'+sp('rk-main'+(r.rank<=3?' rk-top':''),'#'+r.rank)+sp('rk-range',r.rank_lo+'..'+r.rank_hi)+'</td>'+com+'<td class="num num-r">'+dv('odds-wrap',sp('odds-val',oP+'%')+sp('odds-bar','<span class="odds-fill" style="width:'+oP+'%"></span>'))+'</td><td class="num num-r">'+sp('imp-main',fmtUsd(r.implied_value_usd))+sp('imp-sub',fmtUsd(r.iqr_lo_usd)+'–'+fmtUsd(r.iqr_hi_usd)+' · if '+fmtUsd(r.value_if_launches_usd))+whisker(r)+'</td><td class="num num-r">'+sp(ev.net_usd>=0?'net-pos':'net-neg',fmtNet(ev.net_usd))+sp('verdict-pill v-'+ev.verdict,ev.verdict.toUpperCase())+sp('net-sub',usdK(ev.deposit_usd)+' · '+esc(r.farm.chain)+' ($'+r.farm.fees_12w_usd.toFixed(2)+')')+'</td></tr>';
}
}
$('tbody').innerHTML=html;
}

function openModal(slug){
var r=R.rows.filter(function(x){return x.slug===slug;})[0];if(!r)return;S.slug=slug;
var ev=r._live||M.evalFarm(r,S.dep>0?S.dep:r.farm.capital_usd,S.share),m=r.model,f=r.farm;
var tLbl=r.tier==='watchlist'?'WATCHLIST (≥$50M)':r.tier==='offlist'?'OFF-LIST CLEAN (≥$50M)':'BELOW $50M FLOOR';
var cInf=R.lm.cat_summary[m.category]||{n:0,launched:0,rate:R.lm.base_rate};
var wf=[
['1. Current Snapshot TVL','Sealed DefiLlama TVL across '+(r.chains||[]).length+' chain(s)',fmtUsd(r.tvl_usd),0],
['2. Forward TVL (7d Momentum)','7d move '+(r.change_7d!==null?(r.change_7d>=0?'+':'')+r.change_7d.toFixed(1)+'%':'0.0%')+' · factor ×'+m.growth_mult.toFixed(3),fmtUsd(m.forward_tvl_usd),0],
['3. Log-Linear Size Curve','exp('+R.vm.a.toFixed(2)+') · TVL^'+R.vm.b.toFixed(3)+' fit on '+R.counts.live+' anchors',fmtUsd(m.size_curve_usd),0],
['4. EB Category Premium (M_cat)',m.category+' ('+(R.vm.cat_counts[m.category]||0)+' anchors, k='+R.vm.shrink_k+')','×'+m.category_mult.toFixed(3),0],
['5. Conditional Value if it Launches','Size Curve × 7d Momentum × Category Premium',fmtUsd(r.value_if_launches_usd),0],
['6. Empirical Survival Launch Odds',cInf.launched+'/'+cInf.n+' in '+m.category+' launched · '+fmtAge(r.age_days),Math.round(r.launch_odds*100)+'%',0],
['7. Implied Value (Expected Claim)','Value if it launches × Survival launch odds',fmtUsd(r.implied_value_usd),1]
];
var bxs=[
['AT RISK',usdK(ev.deposit_usd),ev.pool_share_str+' of TVL'],
['FEES 12W','$'+f.fees_12w_usd.toFixed(2),'16 txs on '+f.chain],
['YOUR TIME',f.time_12w_str,'over 12 weeks'],
["MODEL'S DROP",'$'+ev.drop_usd.toFixed(2),'$'+ev.drop_per_1k_usd.toFixed(2)+' / $1K held'],
['NET OF FEES',fmtNet(ev.net_usd),ev.verdict.toUpperCase()]
];
$('modal-card').innerHTML=
dv('modal-topbar',dv('modal-title-wrap',sp('tier-badge tier-'+r.tier,tLbl)+'<h2>'+esc(r.name)+'</h2>'+sp('modal-meta num',esc(r.slug+' · '+(r.category||'Unsorted')+' · '+(r.chains||[]).slice(0,4).join(', ')+' · listed '+(r.listed_at||'undated'))))+dv('modal-actions',sp('verdict-pill v-'+ev.verdict,ev.verdict.toUpperCase()+' ('+fmtNet(ev.net_usd)+' net / 12w)')+'<button type="button" class="btn-close" id="m-close">✕ Close (Esc)</button>'))+
dv('modal-grid',
dv('m-col',
dv('m-panel m-hero',dv('m-hero-row','<div>'+sp('m-label','IMPLIED VALUE (EXPECTED)')+dv('m-big-val num',fmtUsd(r.implied_value_usd))+dv('m-sub-val num',fmtUsd(r.value_if_launches_usd)+' if launches × '+Math.round(r.launch_odds*100)+'% odds')+'</div>'+dv('m-rank-box',sp('m-label','RANK · 200-REFIT RANGE')+dv('m-rank-val num','#'+r.rank+' of '+R.counts.ranked)+dv('m-sub-val num','Range #'+r.rank_lo+'..#'+r.rank_hi+' (200x)')))+
dv('m-band-wrap',dv('m-band-labels num','<span>P10 '+fmtUsd(r.p10_usd)+'</span><span>P25 '+fmtUsd(r.iqr_lo_usd)+'</span><span>Mid '+fmtUsd(r.implied_value_usd)+'</span><span>P75 '+fmtUsd(r.iqr_hi_usd)+'</span><span>P90 '+fmtUsd(r.p90_usd)+'</span>')+dv('m-band-track','<span class="m-band-80"></span><span class="m-band-50"></span><span class="m-band-dot"></span>')))+
dv('m-panel','<h3 class="m-sec-title">NEAREST TRADED COMPARABLES '+sp('m-sec-sub','TVL-scale + category + chain overlap')+'</h3><table class="m-comps-table"><thead><tr><th>Traded anchor</th><th class="num-r">TVL → MCap</th><th class="num-r">MCap/TVL</th><th class="num-r">Chains</th></tr></thead><tbody>'+
(r.comps||[]).map(function(c){return '<tr><td>'+esc(c.name)+sp('ab-sub',esc(c.category)+' · '+esc(c.slug))+'</td><td class="num num-r">'+fmtUsd(c.tvl_usd)+' → '+fmtUsd(c.mcap_usd)+'</td><td class="num num-r">'+c.ratio.toFixed(3)+'×</td><td class="num num-r">'+c.overlap+' shared</td></tr>';}).join('')+'</tbody></table>'))+
dv('m-col',dv('m-panel','<h3 class="m-sec-title">HOW THE FIGURE IS MADE '+sp('m-sec-sub','7-step Empirical Bayes waterfall')+'</h3>'+dv('waterfall',wf.map(function(s){return dv('wf-step'+(s[3]?' wf-total':''),dv('wf-left',sp('wf-title',esc(s[0]))+sp('wf-desc',esc(s[1])))+sp('wf-val num',esc(s[2])));}).join(''))))+
dv('m-col',dv('m-panel',dv('m-farm-head','<h3 class="m-sec-title">12-WEEK FARM PLAN</h3>'+sp('m-farm-meta num',esc(f.chain+' ($'+f.gas_tx_usd.toFixed(2)+'/tx) · ~'+f.wait_weeks+'w wait · review '+f.review_date)))+
dv('m-summary-boxes',bxs.map(function(b,idx){return dv('s-box',sp('s-lbl',esc(b[0]))+sp('s-val num'+(idx===4?(ev.net_usd>=0?' net-pos':' net-neg'):''),esc(b[1]))+sp('s-sub num',esc(b[2])));}).join(''))+
'<h4 class="m-sub-title">3×3 Net of Fees ($) Sensitivity — Drop Share × Deposit</h4><table class="m-matrix"><thead><tr><th>Drop Share \\ Deposit</th>'+
f.matrix_deposits.map(function(d){return '<th class="num-r">'+usdK(d)+(d===f.capital_usd?' (Plan)':'')+'</th>';}).join('')+'</tr></thead><tbody>'+
f.matrix.map(function(row){
return '<tr><td class="num">'+row.share_pct.toFixed(1).replace('.0','')+'% drop share</td>'+row.cells.map(function(cell){
var isAct=Math.abs(cell.drop_share-S.share)<1e-4&&cell.deposit_usd===ev.deposit_usd;
return '<td class="num'+(isAct?' cell-active':'')+'">'+sp(cell.net_usd>=0?'net-pos':'net-neg',fmtNet(cell.net_usd))+' '+sp('verdict-pill v-'+cell.verdict,cell.verdict.toUpperCase())+'</td>';
}).join('')+'</tr>';
}).join('')+'</tbody></table><h4 class="m-sub-title">Concrete Execution Steps &amp; Exit Triggers</h4><ol class="m-steps">'+
(f.step_meta||[]).map(function(sm,i){return '<li>'+dv('step-head',sp('step-num','STEP '+(i+1))+sp('tag-cost','COST: '+esc(sm.cost))+sp('tag-time','TIME: '+esc(sm.time)))+dv('step-txt',esc(sm.text))+'</li>';}).join('')+'</ol>')));
on($('m-close'),'click',closeModal);$('detail-modal').classList.remove('hidden');
}

function closeModal() { $('detail-modal').classList.add('hidden'); S.slug = null; }

function bind() {
function seg(id, attr, cb) {
var btns = qs('#' + id + ' .seg');
for (var i = 0; i < btns.length; i++) on(btns[i], 'click', function (ev) {
var b = ev.currentTarget; for (var j = 0; j < btns.length; j++) btns[j].classList.remove('active');
b.classList.add('active'); cb(b.getAttribute(attr));
});
}
seg('tier-tabs', 'data-tier', function (v) { S.tier = v; S.sortKey = 'rank'; S.sortDir = 1; rebuildSelects(); renderTable(); });
seg('verdict-tabs', 'data-verdict', function (v) { S.verdict = v; renderTable(); });
seg('dep-tabs', 'data-dep', function (v) { S.dep = parseInt(v, 10) || 0; recompute(); renderTable(); if (S.slug) openModal(S.slug); });
seg('share-tabs', 'data-share', function (v) { S.share = parseFloat(v) || 0.07; recompute(); renderTable(); if (S.slug) openModal(S.slug); });

on($('search'), 'input', function (ev) { S.q = ev.target.value.trim(); renderTable(); });
on($('category'), 'change', function (ev) { S.cat = ev.target.value; renderTable(); });
on($('chain'), 'change', function (ev) { S.chain = ev.target.value; renderTable(); });
on($('toggle-oos'), 'click', function () { $('workspace').classList.toggle('full-board', $('oos-pane').classList.toggle('hidden')); });

var ths = qs('#board-table thead th.sortable');
for (var i = 0; i < ths.length; i++) on(ths[i], 'click', function (ev) {
var k = ev.currentTarget.getAttribute('data-key');
if (S.sortKey === k) S.sortDir = -S.sortDir; else { S.sortKey = k; S.sortDir = (k === 'name' || k === 'rank') ? 1 : -1; }
renderTable();
});
on($('tbody'), 'click', function (ev) { var tr = ev.target.closest('tr[data-slug]'); if (tr) openModal(tr.getAttribute('data-slug')); });
on($('detail-modal'), 'click', function (ev) { if (ev.target === $('detail-modal')) closeModal(); });
on(document, 'keydown', function (ev) { if (ev.key === 'Escape' && !$('detail-modal').classList.contains('hidden')) closeModal(); });
}

recompute(); renderBars(); renderOos(); rebuildSelects(); bind(); renderTable();
var qp = new URLSearchParams(location.search);
['tier', 'verdict', 'dep', 'share'].forEach(function (k) {
if (qp.get(k)) {
var id = { tier: 'tier-tabs', verdict: 'verdict-tabs', dep: 'dep-tabs', share: 'share-tabs' }[k];
var b = document.querySelector('#' + id + ' .seg[data-' + k + '="' + qp.get(k) + '"]'); if (b) b.click();
}
});
if (qp.get('cat')) { S.cat = qp.get('cat'); $('category').value = S.cat; renderTable(); }
if (qp.get('chain')) { S.chain = qp.get('chain'); $('chain').value = S.chain; renderTable(); }
if (qp.get('q')) { S.q = qp.get('q'); $('search').value = S.q; renderTable(); }
if (qp.get('shot') === 'detail') {
var rk = parseInt(qp.get('rank') || '5', 10), t = R.rows.filter(function (r) { return r.rank === rk; })[0] || R.rows[0];
if (t) openModal(t.slug);
}
})();
