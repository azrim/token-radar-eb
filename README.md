# Token Radar — Empirical Bayes pre-token valuation terminal

![token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/azrim/token-radar-eb/rank.svg)
![reward](https://make.fun/badge/token-radar-01/azrim/token-radar-eb/reward.svg)

A token launch radar for make.fun's [token-radar-01](https://make.fun/c/token-radar-01) bounty: it
ranks pre-token protocols by what a token would be worth if the protocol's record stayed as it is,
and shows what farming each one costs before any of them issues one. The entry's implied value is
its own claim, never a prediction of a launch and never a price.

## The model: empirical-Bayes traded comps

The 758-protocol snapshot splits deterministically into four sets:

- **Ranked pre-token board** — the house watchlist's 40 protocols (TVL ≥ $50M, no token recorded,
  no wrapper/bridge/liquid-staking product) plus 138 clean early protocols below the floor, 178
  rows in all. Excluded derivative categories, versioned pools, wrapped/staked names and
  exchange-prefixed products are tracked for transparency, never ranked (164 rows set aside).
- **Live comps** — the 119 traded protocols with both a market cap and a TVL. They are the market's
  own values, never mixed into the ranked board; they are the curve the model is fit on.

The implied MCap/TVL multiple is fit on those 119 anchors and shrunk per category:

```
FDV  =  TVL · M_cat · (TVL/M0)^(ε−1) · (1 + w·g7d) · ((1−s) + s·age/1095) · (1 + c·ln #chains)
```

- **M_cat** — the category's empirical-Bayes multiple: its traded anchors' log-median MCap/TVL,
  shrunk toward the global log-median with pseudo-count k = 5 (thin categories lean on the market).
- **(TVL/M0)^(ε−1)** — sub-linear size elasticity, ε = 0.72 around the anchors' median TVL: bigger
  protocols carry smaller multiples, the way the traded market actually prices them.
- **(1 + w·g7d)** — the 7-day TVL move, clamped −50%…+100%, weight w = 0.40.
- **((1−s) + s·age/1095)** — tokenless-age maturity from 0.65 to 1.00 over 1,095 days; unknown
  ages take the anchors' median age.
- **(1 + c·ln #chains)** — multi-chain breadth, c = 0.04. No protocol name is ever special-cased.

**Validation** ships with the board: deterministic 5-fold out-of-sample cross-validation (folds by
slug order) and a temporal walk-forward split (train on the oldest 60% by listing day), each
reporting a Spearman rank correlation, a median absolute log error and the empirical P25–P75 band
of the signed log residuals. That residual band becomes every row's implied-value IQR band, and
each pre-token protocol carries its 4 nearest traded DefiLlama comparables, matched on category,
log-TVL distance and chain overlap.

**Farm plans are costed, not slogans.** Every row gets 5 concrete steps: the chain's real
transaction cost (Ethereum L1 vs Arbitrum/Base/Optimism/Solana/Sui/BNB/Bitcoin and friends), a
TVL-scaled deposit ($100–$1,000) with its pool-share percentage, weekly qualifying actions with a
time budget, a category-specific risk guard (impermanent loss, loan-to-value caps, RWA KYC gates,
restaking unbonding cooldowns, curator mandates) and explicit exit triggers over a 30/45/60-day
holding horizon keyed to the protocol's tokenless age.

## The dashboard

A dark obsidian research terminal — no frameworks, no fonts, no network, rendered entirely offline:

- 5-KPI calibration strip: watchlist coverage, ranked count with №1, live comps, both validation
  correlations with the median log error, excluded derivatives.
- An interactive **valuation sandbox** showing the exact formula, with live sliders for TVL
  elasticity, 7-day growth weight and maturity spread, re-ranking the board as you drag.
- Tier tabs (all pre-token / watchlist / early under $50M / live comps / excluded), live search,
  category and chain selectors and a match-count badge.
- A sortable board with TVL, 7-day delta, tokenless age, category multiple, implied FDV with its
  P25–P75 band drawn as a bar, and each farm plan's capital, gas and holding summary.
- A detail drawer per protocol: the valuation decomposition, the four traded comparables, a
  deposit-sizing selector ($250/$1K/$5K/$25K with pool share and gas drag) and the numbered
  costed farm execution timeline.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or later, standard library only, no install. The program writes `out/board.json`,
`out/data.js`, copies `dashboard/` and `screenshots/` beside it and writes `out/dossier.json`.
Open `out/dashboard/index.html` in a browser — the page reads `../data.js`, never the network.

## Layout

| Path | What it is |
| --- | --- |
| `main.ts` | the entrypoint: read, score, verify, write board/data/dossier |
| `dashboard/model.js` | the whole valuation, validation, comparables and farm-plan engine (UMD) |
| `dashboard/index.html`, `app.css`, `app.js` | the offline terminal page |
| `vendor/makefun-board.ts` | make.fun's dossier library, unchanged |
| `screenshots/` | the board, a detail view and a filtered view, 1440×960 |

`implied_value_usd` is this model's own claim about a token a protocol may one day issue. A
protocol whose DefiLlama record shows no token may still have one, and a high rank is a research
queue, not advice.

---

Built for the [token-radar-01 bounty on make.fun](https://make.fun/c/token-radar-01?ref=05xv4825) —
the leaderboard, the live badges and the competition's rules live there.
