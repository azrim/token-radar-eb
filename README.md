# Token Radar — Empirical Bayes Pre-Token Valuation Terminal

![token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/azrim/token-radar-eb/rank.svg)
![reward](https://make.fun/badge/token-radar-01/azrim/token-radar-eb/reward.svg)

A token launch radar for make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01) bounty: it ranks pre-token protocols by expected token claim (`Implied Value = Value if it launches × Launch odds`) fitted directly on the snapshot's traded anchors and standalone launch records, and evaluates whether farming each protocol is net positive after 12 weeks of chain gas and bridge costs. Every implied value is this model's own empirical claim, never a price or a guarantee of a token launch.

## 1. Deterministic 758-Protocol Partition

Every record in the sealed `2026-11-14` DefiLlama snapshot (`758` protocols) is accounted for deterministically with zero hardcoded protocol names or slugs:

- **198 Ranked Pre-Token Protocols** — all clean standalone pre-token protocols (`token_symbol == null`), spanning:
  - **40 Watchlist (`≥ $50M` TVL)** — 100% (`40/40`) of `snapshot.watchlist`.
  - **20 Off-List Clean (`≥ $50M` TVL)** — standalone pre-token protocols above the $50M floor not listed in `snapshot.watchlist`.
  - **138 Below Floor (`< $50M` TVL)** — clean early-stage standalone pre-token protocols.
- **119 Unique Traded Anchors** — non-CEX protocols with both positive `mcap_usd` and `tvl_usd`, deduplicated one-per-ticker by largest TVL (`92` clean standalone anchors used for nearest-neighbor comparables).
- **297 Token Sub-Pools & CEX Records** — `288` token-bearing sub-pools without standalone `mcap_usd` plus `9` centralized exchanges.
- **144 Excluded Pre-Token Derivatives** — bridges (`Bridge`, `Canonical Bridge`), liquid staking/restaking (`Liquid Staking`, `Liquid Restaking`, `Restaked BTC`), versioned pool splits (`V2`/`v2`/`2.0`), wrapped/staked wrappers, and exchange-prefixed products (`Binance`, `Coinbase`, `Bybit`, `Kraken`, `Bitget`, `OKX`, `Bitfinex`, `Gemini`).

Total: `198 + 119 + 297 + 144 = 758` snapshot records.

## 2. Two-Part Valuation Model (`comps-2`)

### Part A — Conditional Valuation (`Value if it launches`)

Fitted by ordinary least squares with empirical-Bayes shrinkage on the `119` unique traded anchors:

```
ln(MCap_cond) = a + b · ln(TVL · (1 + g_7d)^w) + ln(M_cat)
```

- **Sub-linear Size Curve (`a = 6.12`, `b = 0.567`)**: OLS slope shrunk `18%` toward sub-linear conservatism so multi-billion TVL protocols do not extrapolate linearly.
- **7-Day Forward TVL Momentum (`w = 0.35`)**: 7-day TVL growth winsorized to `[-45%, +85%]`.
- **Empirical-Bayes Category Premium (`M_cat`, `k = 10`, `min_n = 5`)**: Category log-residual median shrunk toward `0` with pseudo-count `k = 10` so thin categories revert safely toward the global size curve.

### Part B — Cure-Rate Survival Launch Odds (`P(launch | category, age)`)

Estimated across all `442` clean standalone protocols (`244` launched + `198` pre-token):

- **Baseline Launch Rate**: Category launch share shrunk toward the mature `2yr+` standalone cohort launch rate (`79.4%`) with pseudo-count `k = 8`.
- **Tokenless Age Hazard**: Remaining launch odds decay exponentially as a protocol remains tokenless past listing (`exp(-age_days / 720)` above the cure floor), bounded in `[12%, 88%]`.
- **Held-Out Launch Accuracy**: Leave-one-out classification across all `442` standalone protocols calls **71.7% right (`317/442`)** against a **55.2% base rate**.

### Uncertainty Bands, 200-Refit Rank Stability & Nearest Traded Comparables

- **Multiplicative Error Bands**: Leave-one-out log residuals on the `119` traded anchors define each protocol's empirical **P25–P75** (`50%`) and **P10–P90** (`80%`) implied-value intervals.
- **Bootstrap Rank Range**: `200` deterministic `80%` subsample refits re-estimate `(a, b, M_cat, launch_odds)` and record every protocol's `[P10, P90]` rank range (`#1..#7` for `#1 Bittensor dTAO`).
- **TVL-Scale-First Nearest Comparables**: Each protocol is matched against the `92` clean standalone traded anchors by `dist = |Δ ln TVL| + 0.85·(category mismatch) − 0.35·(shared chains)` so multi-hundred-million protocols pair with scale-appropriate comparables.

## 3. Blind Out-of-Sample Validation & Sign-Flip Falsification

Both **Leave-One-Out (`EACH LEFT OUT`, `119` anchors)** and **Temporal Walk-Forward (`OLDER → NEWER`, train on oldest `60%`, test blindly on newest `40%`)** are computed dynamically in `dashboard/model.js` and rendered in the right-hand verification panel:

| Step / Model Specification | LOO Typical Miss (`P75`) | Walk-Forward Typical Miss (`P75`) |
| --- | --- | --- |
| **1. Flat TVL multiple** (global median MCap/TVL) | `×4.94` (`P75 ×10.21`) | `×4.60` (`P75 ×11.07`) |
| **2. Size curve** (`exp(a) · TVL^b`) | `×3.33` (`P75 ×8.75`) | `×2.78` (`P75 ×10.07`) |
| **3. + 7-day momentum** (winsorized 7d TVL move) | `×3.28` (`P75 ×9.05`) | `×2.79` (`P75 ×10.26`) |
| **4. Momentum, sign flipped** (falsification check) | `×3.44` (`P75 ×8.71`) | `×2.78` (`P75 ×9.68`) |
| **5. + Category premium** (full `comps-2` model) | **`×3.22` (`P75 ×8.30`)** | **`×2.54` (`P75 ×10.46`)** |

- **Interval Honesty Check**: Out-of-sample coverage holds **47% (`56/119`)** within `×3` of the figure, **50% (`59/119`)** inside **P25–P75** (matching the stated `50%` band), and **77% (`92/119`)** inside **P10–P90** (vs stated `80%`).

## 4. Dollar-Netted 12-Week Farm Plans & 3×3 Sensitivity Matrix

Every ranked protocol receives a costed 12-week execution plan and break-even verdict (`71 FARM / 61 MARGINAL / 66 SKIP` at plan size and `7%` drop share):

- **Plan Deposit Sizing**: Scaled to protocol TVL (`$1,000` under `$20M` TVL, `$2,500` for `$20M–$200M`, `$5,000` above `$200M`).
- **Real Chain Gas Table**: Per-transaction costs from Ethereum L1 (`$3.80/tx`) and Bitcoin (`$2.80/tx`) down to Arbitrum/Base/Optimism/Ink/Monad (`$0.04–$0.18/tx`) and Solana/Sui/Aptos (`$0.02–$0.03/tx`), summed across setup + 12 weekly maintenance actions + exit.
- **3×3 Net-of-Fees Matrix**: Evaluates `Net ($) = Expected Drop − 12w Fees` across **Drop Share (`3.5%`, `7%`, `14%`) × Deposit (`$1,000`, `Plan size`, `$10,000`)**, interactive both on the main toolbar and inside every protocol's 3-column detail modal.
- **6 Concrete Execution Steps**: Each `board.json` row includes 6 numbered steps (`40..450` chars) with exact dollar amounts, pool share percentages, deterministic calendar review dates (`2027-02-06` from snapshot `2026-11-14`), and `-30% to -40%` TVL drawdown exit triggers.

## 5. Run & Verify

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22+ standard library only, zero external packages, zero network calls. Generates `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`, and `out/dossier.json`.

| Path | Role |
| --- | --- |
| `main.ts` | CLI entrypoint: loads snapshot, runs `comps-2`, enforces gate invariants, writes outputs |
| `dashboard/model.js` | Self-contained empirical-Bayes valuation, LOO/walk-forward validation, comparables & farm engine |
| `dashboard/index.html`, `app.css`, `app.js` | Offline 1440×900 dark financial terminal with live filters, OOS check & 3-column detail modal |
| `vendor/makefun-board.ts` | Official make.fun dossier bundler (byte-for-byte unchanged) |
| `screenshots/` | `1-board.jpg`, `2-detail.jpg`, `3-filtered.jpg` (`1440×900` JPEG) |

---

Built for the [token-radar-01 bounty on make.fun](https://make.fun/bounty/token-radar-01) ([leaderboard & rules](https://make.fun/c/token-radar-01?ref=05xv4825)).
