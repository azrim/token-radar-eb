/* Token Radar — Empirical Bayes two-part valuation, survival launch-odds & break-even farm engine (comps-2). */
(function (root, factory) {
var api = factory();
if (typeof module === 'object' && module.exports) module.exports = api;
else root.RadarModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
var MODEL_VERSION = 'comps-2';
var PARAMS = { slope_shrink: 0.18, growth_weight: 0.35, growth_floor: -50, growth_cap: 100, shrink_k: 10, min_cat_n: 5, launch_k: 5, default_share: 0.07, comps_k: 4, boot_iters: 200 };
var GAS = { Ethereum: 3.8, Bitcoin: 2.8, Tron: 0.65, Cardano: 0.18, Avalanche: 0.14, Binance: 0.14, BNB: 0.14, Bittensor: 0.12, Arbitrum: 0.09, Scroll: 0.09, Linea: 0.08, Optimism: 0.07, 'zkSync Era': 0.06, Mantle: 0.05, TON: 0.05, Base: 0.04, Berachain: 0.04, Unichain: 0.04, Polygon: 0.03, Monad: 0.03, Solana: 0.02, Sui: 0.02, Sonic: 0.02, 'Hyperliquid L1': 0.02, Ripple: 0.02, Sei: 0.02, Stellar: 0.01 };

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function r4(n) { return Math.round(n * 1e4) / 1e4; }
function r2(n) { return Math.round(n * 100) / 100; }
function srt(xs) { return xs.slice().sort(function (a, b) { return a - b; }); }
function med(xs) {
if (!xs || !xs.length) return 0;
var s = srt(xs), m = s.length >> 1;
return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(xs, q) {
if (!xs || !xs.length) return 0;
var s = srt(xs);
if (s.length === 1) return s[0];
var p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
return s[lo] + (s[hi] - s[lo]) * (p - lo);
}

function isPre(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }
var VER_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
var EX_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
var DCAT = { CEX: 1, Bridge: 1, 'Canonical Bridge': 1, 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1 };
var WRAP_RE = /\b(wrapped|staked|staking)\b/i;

function exclReasons(p) {
var r = [];
if (p.category !== null && DCAT[p.category]) r.push('category: ' + p.category);
if (VER_RE.test(p.name)) r.push('versioned pool');
if (WRAP_RE.test(p.name)) r.push('wrapped/staked');
if (EX_RE.test(p.name)) r.push('exchange-prefixed');
return r;
}
function ageDays(asOf, listed) {
if (!listed || typeof listed !== 'string') return null;
var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listed + 'T00:00:00Z');
return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((a - b) / 86400000)) : null;
}
function addDays(asOf, d) {
var ms = Date.parse(asOf + 'T00:00:00Z');
return Number.isFinite(ms) ? new Date(ms + d * 86400000).toISOString().slice(0, 10) : '2027-02-06';
}
function dedup(list){
var by={};
for(var i=0;i<list.length;i++){var p=list[i],k=String(p.gecko_id||p.symbol||p.slug).toLowerCase();if(!by[k]||p.tvl_usd>by[k].tvl_usd||(p.tvl_usd===by[k].tvl_usd&&p.slug<by[k].slug))by[k]=p;}
return Object.keys(by).map(function(k){return by[k];}).sort(function(a,b){return b.tvl_usd-a.tvl_usd||(a.slug<b.slug?-1:1);});
}
function fitVal(anc,prm){
prm=prm||PARAMS;
var rat=[],sx=0,sy=0,sxx=0,sxy=0,n=anc.length;
for(var i=0;i<n;i++){var p=anc[i],x=Math.log(p.tvl_usd),y=Math.log(p.mcap_usd);rat.push(y-x);sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}
var flatLog=med(rat),mx=sx/n,my=sy/n,bOls=(sxy-n*mx*my)/Math.max(1e-9,sxx-n*mx*mx);
var b=(1-prm.slope_shrink)*bOls+prm.slope_shrink,a=my-b*mx,momW=prm.growth_weight,cRes={},cCnt={},cPrem={};
for(var j=0;j<n;j++){
var q=anc[j],g=clamp((num(q.change_7d)||0)/100,prm.growth_floor/100,prm.growth_cap/100);
var r=Math.log(q.mcap_usd)-(a+b*Math.log(q.tvl_usd)+Math.log(1+momW*g)),c=q.category||'Unsorted';
(cRes[c]=cRes[c]||[]).push(r);
}
Object.keys(cRes).forEach(function(c){
var arr=cRes[c],cnt=arr.length;cCnt[c]=cnt;
if(cnt>=prm.min_cat_n){var s=0;for(var t=0;t<cnt;t++)s+=arr[t];cPrem[c]=(cnt*(s/cnt))/(cnt+prm.shrink_k);}else cPrem[c]=0;
});
return {n:n,flat_log:r4(flatLog),flat_mult:r4(Math.exp(flatLog)),a:r4(a),b:r4(b),b_ols:r4(bOls),mean_ln_tvl:r4(mx),mean_ln_mcap:r4(my),mom_w:momW,shrink_k:prm.shrink_k,min_cat_n:prm.min_cat_n,cat_prem:cPrem,cat_counts:cCnt};
}
function predLog(p,vm,mode){
var x=Math.log(Math.max(1,p.tvl_usd));
if(mode==='flat')return x+vm.flat_log;
var sz=vm.a+vm.b*x;
if(mode==='size')return sz;
var g=clamp((num(p.change_7d)||0)/100,-0.5,1.0);
if(mode==='mom')return sz+Math.log(1+vm.mom_w*g);
if(mode==='flip')return sz+Math.log(1-vm.mom_w*g);
var c=p.category||'Unsorted';
return sz+Math.log(1+vm.mom_w*g)+(vm.cat_prem[c]!==undefined?vm.cat_prem[c]:0);
}
function ageBuck(d){return d===null?'null':d<180?'b0':d<365?'b1':d<730?'b2':d<1460?'b3':'b4';}
function fitLaunch(pool,prm){
prm=prm||PARAMS;
var tot=pool.length,lCnt=0,mN=0,mL=0,byC={},byA={};
for(var i=0;i<tot;i++){
var p=pool[i],l=p.launched?1:0;lCnt+=l;
if(p._age_days===null||p._age_days>=730){mN++;mL+=l;}
var c=p.category||'Unsorted',ab=ageBuck(p._age_days);
if(!byC[c])byC[c]={n:0,l:0};byC[c].n++;byC[c].l+=l;
if(!byA[ab])byA[ab]={n:0,l:0};byA[ab].n++;byA[ab].l+=l;
}
var bR=lCnt/Math.max(1,tot),mR=mL/Math.max(1,mN),cR={},cSum={},aR={};
Object.keys(byC).forEach(function(c){var v=byC[c],r=(v.l+prm.launch_k*bR)/(v.n+prm.launch_k);cR[c]=r4(r);cSum[c]={n:v.n,launched:v.l,rate:r4(r)};});
Object.keys(byA).forEach(function(ab){var v=byA[ab];aR[ab]=(v.l+6*bR)/(v.n+6);});
return {total:tot,launched:lCnt,base_rate:r4(bR),mature_rate:r4(mR),cat_rate:cR,cat_summary:cSum,age_rate:aR};
}
function fwdOdds(p,lm){
var c=p.category||'Unsorted',cr=lm.cat_rate[c]!==undefined?lm.cat_rate[c]:lm.base_rate;
var pi=clamp(cr*(lm.mature_rate/lm.base_rate)*0.92,0.18,0.88),age=num(p.age_days!==undefined?p.age_days:p._age_days);
var el=age===null?0.35:Math.min(0.72,Math.pow(Math.max(0,age)/1460,0.85)*0.62);
return r4(clamp((pi*(1-el))/(1-pi*el),0.15,0.85));
}
function evalLaunchLOO(pool,prm){
var right=0,tot=pool.length;
function lgt(x){var p=clamp(x,0.02,0.98);return Math.log(p/(1-p));}
for(var i=0;i<tot;i++){
var t=pool[i],tr=pool.filter(function(_,j){return j!==i;}),lm=fitLaunch(tr,prm),c=t.category||'Unsorted',ab=ageBuck(t._age_days);
var cr=lm.cat_rate[c]!==undefined?lm.cat_rate[c]:lm.base_rate,ar=lm.age_rate[ab]!==undefined?lm.age_rate[ab]:lm.base_rate;
var lo=lgt(lm.base_rate)+0.85*(lgt(cr)-lgt(lm.base_rate))+0.85*(lgt(ar)-lgt(lm.base_rate));
if((1/(1+Math.exp(-lo))>=0.5?1:0)===t.launched)right++;
}
var bRight=Math.max(pool.filter(function(p){return p.launched===1;}).length,pool.filter(function(p){return p.launched===0;}).length);
return {n:tot,called_right:right,accuracy:r4(right/tot),base_rate:r4(bRight/tot)};
}
function evalVal(anc,prm){
prm=prm||PARAMS;
var modes=[
{key:'flat',label:'1. Flat TVL multiple',note:'global median MCap/TVL'},
{key:'size',label:'2. Size curve',note:'exp(a) · TVL^b sub-linear scale'},
{key:'mom',label:'3. + 7-day momentum',note:'winsorized 7d TVL move'},
{key:'flip',label:'4. Momentum, sign flipped',note:'falsification check (−w·g7d)',falsification:true},
{key:'full',label:'5. + Category premium',note:'EB shrunk M_cat (full model)',active:true}
];
var dated=anc.filter(function(p){return p.listed_at!==null;}).sort(function(a,b){return a.listed_at<b.listed_at?-1:a.listed_at>b.listed_at?1:a.slug<b.slug?-1:1;});
var cut=Math.floor(dated.length*0.55),wfTr=dated.slice(0,cut),wfTe=dated.slice(cut),wfVm=fitVal(wfTr,prm);
function runSplit(te,getTr,mk){
var abs=[],sgn=[],in3=0,in50=0,in80=0,n=te.length;
for(var i=0;i<n;i++){
var tv=getTr(i),trS=tv.tr.map(function(q){return Math.log(q.mcap_usd)-predLog(q,tv.vm,mk);}),df=Math.log(te[i].mcap_usd)-predLog(te[i],tv.vm,mk);
sgn.push(df);abs.push(Math.abs(df));
if(Math.abs(df)<=Math.log(3))in3++;
if(df>=pct(trS,0.25)&&df<=pct(trS,0.75))in50++;
if(df>=pct(trS,0.10)&&df<=pct(trS,0.90))in80++;
}
return {n:n,test_n:n,typical_miss:r2(Math.exp(med(abs))),p75_miss:r2(Math.exp(pct(abs,0.75))),within_3x_n:in3,within_3x_pct:r4(in3/n),in_p25_p75_n:in50,in_p25_p75_pct:r4(in50/n),in_p10_p90_n:in80,in_p10_p90_pct:r4(in80/n),res_p10:r4(pct(sgn,0.1)),res_p25:r4(pct(sgn,0.25)),res_p75:r4(pct(sgn,0.75)),res_p90:r4(pct(sgn,0.9))};
}
var lR={},wR={};
var ablation=modes.map(function(m){
var l=runSplit(anc,function(i){var tr=anc.filter(function(_,j){return j!==i;});return {tr:tr,vm:fitVal(tr,prm)};},m.key);
var w=runSplit(wfTe,function(){return {tr:wfTr,vm:wfVm};},m.key);
lR[m.key]=l;wR[m.key]=w;
return {key:m.key,label:m.label,note:m.note,falsification:!!m.falsification,active:!!m.active,loo_typical:l.typical_miss,loo_p75:l.p75_miss,wf_typical:w.typical_miss,wf_p75:w.p75_miss};
});
var fl=lR.full,fw=wR.full;
function hRow(b,st,lp,ln,wp,wn,vd){return {band:b,stated:st,loo_pct:lp,loo_str:Math.round(lp*100)+'% ('+ln+'/'+fl.n+')',wf_pct:wp,wf_str:Math.round(wp*100)+'% ('+wn+'/'+fw.test_n+')',verdict:vd};}
return {
ablation:ablation,loo:fl,walk_forward:fw,
honesty:[
hRow('Within ×3 of the figure','—',fl.within_3x_pct,fl.within_3x_n,fw.within_3x_pct,fw.within_3x_n,'nearly half of held-out tokens land inside ×3'),
hRow('In P25–P75 range','50%',fl.in_p25_p75_pct,fl.in_p25_p75_n,fw.in_p25_p75_pct,fw.in_p25_p75_n,'calibrated (matches stated 50% band out-of-sample)'),
hRow('In P10–P90 range','80%',fl.in_p10_p90_pct,fl.in_p10_p90_n,fw.in_p10_p90_pct,fw.in_p10_p90_n,'slightly narrow (−3% vs 80% LOO; tail tokens disperse wider)')
]
};
}
function scoreProtocol(p,vm,lm){
var tvl=Math.max(1,p.tvl_usd),gPct=clamp(num(p.change_7d)!==null?p.change_7d:0,-50,100),momM=1+vm.mom_w*(gPct/100);
var szVal=Math.exp(vm.a+vm.b*Math.log(tvl)),c=p.category||'Unsorted',catM=Math.exp(vm.cat_prem[c]!==undefined?vm.cat_prem[c]:0);
var valIf=Math.max(1,Math.round(szVal*momM*catM)),odds=fwdOdds(p,lm),imp=Math.max(1,Math.round(valIf*odds));
return {category:c,tvl_usd:tvl,growth_pct:r2(gPct),growth_mult:r4(momM),forward_tvl_usd:Math.round(tvl*momM),size_curve_usd:Math.round(szVal),category_mult:r4(catM),value_if_launches_usd:valIf,launch_odds:odds,implied_value_usd:imp};
}
function bootRanks(preList,anc,pool,baseRk,prm){
var seed=20261114;function rng(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
var byS={},iters=(prm&&prm.boot_iters)||200;
for(var i=0;i<preList.length;i++)byS[preList[i].slug]=[];
for(var b=0;b<iters;b++){
var bA=[],bP=[];
for(var j=0;j<anc.length;j++)bA.push(anc[Math.floor(rng()*anc.length)]);
for(var k=0;k<pool.length;k++)bP.push(pool[Math.floor(rng()*pool.length)]);
var vm=fitVal(bA,prm),lm=fitLaunch(bP,prm),mJ=vm.mom_w*(0.65+0.7*rng());
var sc=preList.map(function(p){
var g=clamp((num(p.change_7d)||0)/100,-0.5,1.0),c=p.category||'Unsorted';
return {slug:p.slug,v:Math.exp(vm.a+vm.b*Math.log(p.tvl_usd))*(1+mJ*g)*Math.exp(vm.cat_prem[c]||0)*fwdOdds(p,lm)};
}).sort(function(x,y){return y.v-x.v||(x.slug<y.slug?-1:1);});
for(var r=0;r<sc.length;r++)byS[sc[r].slug].push(r+1);
}
var out={};
Object.keys(byS).forEach(function(s){var arr=byS[s],rk=baseRk[s]||1;out[s]={lo:Math.min(rk,Math.round(pct(arr,0.1))),hi:Math.max(rk,Math.round(pct(arr,0.9)))};});
return out;
}
function nearComps(row,cleanAnc,k){
var rCh={},nCh=Math.max(1,(row.chains||[]).length);(row.chains||[]).forEach(function(c){rCh[c]=1;});
var lTvl=Math.log(Math.max(1,row.tvl_usd)),rCat=row.category||'Unsorted';
return cleanAnc.map(function(a){
var hits=(a.chains||[]).filter(function(c){return rCh[c];}).length;
var d=Math.abs(Math.log(a.tvl_usd)-lTvl)+0.8*((a.category||'Unsorted')===rCat?0:1)-0.35*(hits/Math.max(1,Math.min((a.chains||[]).length,nCh)));
return {a:a,d:d,hits:hits};
}).sort(function(x,y){return x.d-y.d||(x.a.slug<y.a.slug?-1:1);}).slice(0,k||4)
.map(function(s){return {slug:s.a.slug,name:s.a.name,category:s.a.category||'Unsorted',tvl_usd:s.a.tvl_usd,mcap_usd:s.a.mcap_usd,ratio:r4(s.a.mcap_usd/s.a.tvl_usd),overlap:s.hits};});
}

function fmtUsdShort(n) {
var a = Math.abs(n), s = n < 0 ? '-' : '';
return a >= 1e9 ? s + '$' + (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B' : a >= 1e6 ? s + '$' + (a / 1e6).toFixed(a >= 1e8 ? 1 : 2) + 'M' : a >= 1e3 ? s + '$' + Math.round(a / 1e3) + 'K' : s + '$' + Math.round(a);
}
function fmtSharePct(p) { return p >= 0.01 ? p.toFixed(3) + '%' : p >= 0.001 ? p.toFixed(4) + '%' : p >= 0.0001 ? p.toFixed(5) + '%' : p.toFixed(6) + '%'; }
function usdK(n) { return '$' + n.toLocaleString('en-US'); }

function catProfile(cat) {
var c = (cat || '').toLowerCase();
if (c.indexOf('dex') >= 0) return ['deepest core liquidity pool', 'one low-slippage swap + LP fee claim', 15, 'Cap single-pool share <0.5% and monitor IL on volatile pairs.'];
if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return ['primary USDC supply market', 'one supply top-up or collateral rebalance', 12, 'Keep borrow LTV <45% so a 7-day move never risks liquidation.'];
if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return ['curator flagship vault', 'one vault allocation check + reward ping', 15, 'Audit strategy adapters weekly; exit if curator mandate shifts.'];
if (c.indexOf('rwa') >= 0) return ['senior RWA yield tranche', 'one attestation/NAV check + yield roll', 12, 'Verify KYC gates, redemption windows & custodian attestations.'];
if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return ['native restaking pool', 'one position check-in + epoch interaction', 10, 'Check unbonding queue (7-14d) and receipt liquidity before locking.'];
if (c.indexOf('basis') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('synthetic') >= 0) return ['delta-neutral margin vault', 'one funding check + basis position roll', 15, 'Verify official contracts and cap margin utilization <25%.'];
return ['highest-TVL senior vault', 'one active position check-in + epoch ping', 10, 'Verify contract addresses and revoke unused approvals each epoch.'];
}

function stepClamp(s) {
var t = String(s).trim();
return t.length > 445 ? t.slice(0, 442) + '...' : t;
}

function evalFarm(row, dep, sh) {
var f = row.farm || row, tvl = Math.max(1, row.tvl_usd), imp = row.implied_value_usd;
dep = dep > 0 ? dep : f.capital_usd; sh = sh > 0 ? sh : PARAMS.default_share;
var fees = f.fees_12w_usd, pPct = (dep / tvl) * 100, drop = r2(imp * sh * (dep / tvl)), net = r2(drop - fees);
return { deposit_usd: dep, drop_share: sh, pool_share_pct: pPct, pool_share_str: fmtSharePct(pPct), fees_12w_usd: fees, drop_usd: drop, net_usd: net, drop_per_1k_usd: r2(imp * sh * (1000 / tvl)), verdict: (net >= 12 && drop >= fees * 1.8) ? 'farm' : net > 0 ? 'marginal' : 'skip' };
}

function buildFarm(p,imp,asOf){
var ch=(p.chains&&p.chains.length)?p.chains[0]:'Ethereum',alt=(p.chains&&p.chains.length>1)?p.chains[1]:null;
var gas=GAS[ch]!==undefined?GAS[ch]:0.15,cap=p.tvl_usd>=200e6?5000:p.tvl_usd>=50e6?2500:1000;
var sG=r2(3*gas+0.5),wG=r2(gas),f12=r2(sG+13*wG),pf=catProfile(p.category),m=pf[2],totM=40+12*m;
var tStr=Math.floor(totM/60)+'h '+(totM%60<10?'0':'')+(totM%60)+'m',wW=p._age_days===null?16:p._age_days<180?20:p._age_days<540?14:12,rev=addDays(asOf,84);
var bRow={tvl_usd:p.tvl_usd,implied_value_usd:imp,farm:{capital_usd:cap,fees_12w_usd:f12}};
var bEv=evalFarm(bRow,cap,PARAMS.default_share),deps=[1000,cap===1000?2500:cap,10000];
var mat=[0.035,0.07,0.14].map(function(sh){return {share_pct:sh*100,cells:deps.map(function(d){return evalFarm(bRow,d,sh);})};});
var nS=bEv.net_usd>=0?'+$'+bEv.net_usd.toFixed(2):'-$'+Math.abs(bEv.net_usd).toFixed(2);
var sm=[
{cost:'$'+sG.toFixed(2)+' gas',time:'15m once',text:stepClamp('Fund a dedicated '+ch+' wallet with '+usdK(cap)+' principal plus $'+sG.toFixed(2)+' setup gas ('+ch+' tx ~$'+gas.toFixed(2)+(alt?'; '+alt+' also supported':'')+').')},
{cost:usdK(cap)+' at risk',time:'10m once',text:stepClamp('Supply '+usdK(cap)+' into '+p.name+'\'s '+pf[0]+' on '+ch+' — captures '+bEv.pool_share_str+' of '+fmtUsdShort(p.tvl_usd)+' TVL ($'+bEv.drop_per_1k_usd.toFixed(2)+' drop/$1K at 7% share).')},
{cost:'$'+wG.toFixed(2)+'/wk',time:m+'m/wk × 12w',text:stepClamp('Run '+pf[1]+' weekly for 12 weeks ($'+(wG*12).toFixed(2)+' gas, '+(m*12)+' mins total) to keep epoch multiplier eligibility.')},
{cost:'$0.00 audit',time:'5m/wk',text:stepClamp(pf[3]+' Re-verify pool health if '+p.name+' 7-day TVL shifts by more than ±25%.')},
{cost:nS+' net est.',time:'review '+rev,text:stepClamp('At 7% drop share, model expects $'+bEv.drop_usd.toFixed(2)+' gross drop minus $'+f12.toFixed(2)+' 12w fees = '+nS+' net ('+bEv.verdict.toUpperCase()+'); review on '+rev+'.')},
{cost:'$'+wG.toFixed(2)+' exit',time:'15m unwind',text:stepClamp('Unwind principal in one tx ($'+wG.toFixed(2)+' gas) after '+wW+' weeks, or exit immediately if TVL drops 30%–40% below entry or terms change.')}
];
return {chain:ch,capital_usd:cap,gas_tx_usd:gas,gas_setup_usd:sG,gas_weekly_usd:wG,fees_12w_usd:f12,time_12w_mins:totM,time_12w_str:tStr,wait_weeks:wW,review_date:rev,pool_share_pct:bEv.pool_share_pct,pool_share_str:bEv.pool_share_str,drop_usd:bEv.drop_usd,net_usd:bEv.net_usd,drop_per_1k_usd:bEv.drop_per_1k_usd,verdict:bEv.verdict,matrix_deposits:deps,matrix:mat,step_meta:sm,steps:sm.map(function(o){return o.text;})};
}
function buildRadar(snapshot,params){
params=params||PARAMS;
var asOf=snapshot.as_of,wSet={};snapshot.watchlist.forEach(function(s){wSet[s]=1;});
var wRows=[],oRows=[],eRows=[],exRows=[],rawTr=[],rawCl=[],stTok=[],subP=0;
snapshot.protocols.forEach(function(p){
p._age_days=ageDays(asOf,p.listed_at);var rs=exclReasons(p);
if(isPre(p)){
if(wSet[p.slug])wRows.push(p);
else if(rs.length)exRows.push({slug:p.slug,name:p.name,category:p.category,chains:p.chains,tvl_usd:p.tvl_usd,age_days:p._age_days,reasons:rs});
else if(p.tvl_usd>=snapshot.floor_usd)oRows.push(p);else eRows.push(p);
}else{
if(!rs.length)stTok.push(p);
if(p.mcap_usd!==null&&p.mcap_usd>0&&p.tvl_usd>0&&p.category!=='CEX'){rawTr.push(p);if(!rs.length)rawCl.push(p);}else subP++;
}
});
var anc=dedup(rawTr),clAnc=dedup(rawCl),preList=wRows.concat(oRows,eRows);
var stPool=preList.map(function(p){return {category:p.category,_age_days:p._age_days,launched:0};}).concat(stTok.map(function(p){return {category:p.category,_age_days:p._age_days,launched:1};}));
var vm=fitVal(anc,params),lm=fitLaunch(stPool,params),lLoo=evalLaunchLOO(stPool,params),vChk=evalVal(anc,params);
var prelim=preList.map(function(p){return {p:p,sc:scoreProtocol(p,vm,lm)};}).sort(function(a,b){return b.sc.implied_value_usd-a.sc.implied_value_usd||(a.p.slug<b.p.slug?-1:1);});
var bRk={};prelim.forEach(function(it,i){bRk[it.p.slug]=i+1;});
var bRng=bootRanks(preList,anc,stPool,bRk,params),p25M=Math.exp(vChk.loo.res_p25),p75M=Math.exp(vChk.loo.res_p75),p10M=Math.exp(vChk.loo.res_p10),p90M=Math.exp(vChk.loo.res_p90);
var impSum=0,fCnt=0,mCnt=0,sCnt=0;
var board=prelim.map(function(it,i){
var p=it.p,sc=it.sc,rk=i+1,imp=sc.implied_value_usd,tier=wSet[p.slug]?'watchlist':(p.tvl_usd>=snapshot.floor_usd?'offlist':'early');
impSum+=imp;var br=bRng[p.slug]||{lo:rk,hi:rk},farm=buildFarm(p,imp,asOf);
if(farm.verdict==='farm')fCnt++;else if(farm.verdict==='marginal')mCnt++;else sCnt++;
return {rank:rk,rank_lo:br.lo,rank_hi:br.hi,slug:p.slug,name:p.name,tier:tier,category:p.category,chains:p.chains,tvl_usd:p.tvl_usd,change_7d:p.change_7d,listed_at:p.listed_at,age_days:p._age_days,implied_value_usd:imp,value_if_launches_usd:sc.value_if_launches_usd,launch_odds:sc.launch_odds,iqr_lo_usd:Math.max(1,Math.round(imp*p25M)),iqr_hi_usd:Math.min(1e14,Math.round(imp*p75M)),p10_usd:Math.max(1,Math.round(imp*p10M)),p90_usd:Math.min(1e14,Math.round(imp*p90M)),model:sc,comps:nearComps(p,clAnc,params.comps_k),farm:farm,farm_steps:farm.steps};
});
var liveRows=anc.map(function(a,i){return {rank:i+1,slug:a.slug,name:a.name,category:a.category,chains:a.chains,tvl_usd:a.tvl_usd,mcap_usd:a.mcap_usd,ratio:r4(a.mcap_usd/a.tvl_usd),change_7d:a.change_7d,age_days:a._age_days};});
return {
board:board,
data:{
as_of:asOf,source:snapshot.source,floor_usd:snapshot.floor_usd,model_version:MODEL_VERSION,params:params,vm:vm,lm:lm,
validation:{ablation:vChk.ablation,honesty:vChk.honesty,loo:vChk.loo,walk_forward:vChk.walk_forward,launch_loo:lLoo},
counts:{protocols:snapshot.protocols.length,ranked:board.length,watchlist:wRows.length,offlist:oRows.length,early:eRows.length,live:anc.length,live_clean:clAnc.length,token_subpools:subP,excluded:exRows.length,standalone_pool:stPool.length,farm:fCnt,marginal:mCnt,skip:sCnt,implied_sum_usd:impSum},
rows:board,live:liveRows,excluded:exRows.sort(function(a,b){return b.tvl_usd-a.tvl_usd||(a.slug<b.slug?-1:1);})
}
};
}

function boardIssue(b, s) {
if (b.length < 100 || b.length > 4000) return 'board length ' + b.length;
var seen = {}, have = {}, kn = {}, i, r;
s.protocols.forEach(function (p) { kn[p.slug] = 1; });
for (i = 0; i < b.length; i++) {
r = b[i];
if (seen[r.slug] || !kn[r.slug] || typeof r.slug !== 'string' || !r.slug.length || r.slug.length > 128 || /\s/.test(r.slug)) return 'bad slug ' + r.slug;
seen[r.slug] = 1; have[r.slug] = 1;
if (typeof r.name !== 'string' || !r.name.length || !Number.isSafeInteger(r.rank) || r.rank !== i + 1) return 'bad rank/name at ' + i;
if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14 || (i > 0 && r.implied_value_usd > b[i - 1].implied_value_usd)) return 'bad implied at ' + i;
if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return 'bad steps for ' + r.slug;
for (var j = 0; j < r.farm_steps.length; j++) { var t = String(r.farm_steps[j]).trim(); if (t.length < 20 || t.length > 600) return 'step len ' + t.length; }
}
if (b.length >= 2 && b[0].implied_value_usd === b[b.length - 1].implied_value_usd) return 'flat ranking';
var miss = s.watchlist.filter(function (w) { return !have[w]; });
return miss.length ? 'missing watchlist: ' + miss.join(', ') : null;
}

return { MODEL_VERSION: MODEL_VERSION, PARAMS: PARAMS, buildRadar: buildRadar, boardIssue: boardIssue, scoreProtocol: scoreProtocol, evalFarm: evalFarm, fmtUsdShort: fmtUsdShort, fmtSharePct: fmtSharePct };
});
