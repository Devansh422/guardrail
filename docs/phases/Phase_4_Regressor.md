# Phase 4: Undo-Cost Regressor, Conformal Bound, and P_err (D4)

**Dates:** 14 Dec 2026 – 24 Jan 2027 · **Lead:** DV (MG: P_err calibration) · **Depends on:** Phase 3 data (start on the first 3,000 rows) · **Produces:** `guardrail/models/`, evaluation report, Paper I results table.
**Metrics unlocked:** M7, C3; inputs to M5 and M6 (staged screen).
**New dependencies:** `lightgbm`, `scikit-learn`, `sentence-transformers`.

---

## 4.1 Features (`models/features.py`)

```python
class Featurizer:
    def fit(self, rows: list[dict]) -> "Featurizer": ...      # learns vocab, scalers on train only
    def transform(self, rows: list[dict]) -> np.ndarray: ...
```

| Group | Features |
|---|---|
| Structural | tool one-hot (train vocab, plus an `<unk>` bucket); domain; rollback, externality and destructive flag from the taxonomy; arg count; wildcard present (`*`, `-r`, `--all`); number of targets; amount (log1p) for ledger; recipient external? |
| Text | `all-MiniLM-L6-v2` embedding of `"{tool}({sorted arg keys})"`, 384-d. Cache by string. This is what generalizes to **unseen tools**. |
| State | `is_production`, sensitivity (ordinal), number of recovery affordances remaining for the target |

**Leakage check:** no feature may be computed from the label or the post-execution state.

## 4.2 Quantile heads (`models/regressor.py`)

Target: `y = log1p(U)` at the headline weights. Train one model per weight vector in the grid; the training is cheap.

```python
class UndoCostRegressor:
    def __init__(self, tau_lo=0.1, tau_hi=0.9, **lgb_params): ...
    def fit(self, X, y):
        self.lo = lgb.LGBMRegressor(objective="quantile", alpha=self.tau_lo, **self.p).fit(X, y)
        self.hi = lgb.LGBMRegressor(objective="quantile", alpha=self.tau_hi, **self.p).fit(X, y)
        return self
    def predict_interval(self, X) -> tuple[np.ndarray, np.ndarray]:
        return self.lo.predict(X), self.hi.predict(X)
```

- **Hyperparameters:** tune `num_leaves`, `learning_rate`, `n_estimators`, `min_child_samples` on the train split with 5-fold CV, scoring by pinball loss of the upper head. Use the same budget for every weight vector.
- **Fallback:** if LightGBM is unavailable, use `sklearn.ensemble.GradientBoostingRegressor(loss="quantile", alpha=...)`.

## 4.3 Conformalized quantile regression (`models/conformal.py`)

```python
class CQR:
    def __init__(self, model: UndoCostRegressor, alpha: float): ...
    def calibrate(self, X_cal, y_cal):
        lo, hi = self.model.predict_interval(X_cal)
        scores = np.maximum(lo - y_cal, y_cal - hi)
        n = len(scores)
        k = int(np.ceil((n + 1) * (1 - self.alpha)))
        self.q = np.sort(scores)[min(k, n) - 1]
        return self
    def upper(self, X) -> np.ndarray:                 # in U units, what the policy consumes
        _, hi = self.model.predict_interval(X)
        return np.expm1(hi + self.q)
```

- α ∈ {0.10, 0.05}.
- **Mondrian variant (fallback if C3 fails on unseen tools):** compute a separate `q` per domain on the calibration split.
- **Cross-check:** on one split, compare the coverage and `q` against MAPIE's CQR. They should agree to within sampling noise. If not, find the bug before going further.

## 4.4 Evaluation report (`scripts/eval_regressor.py`)

Output `reports/regressor.md` and log to MLflow. One row per (split, α, domain):

| Metric | Definition |
|---|---|
| Pinball loss (τ = 0.9) | on log1p(U) |
| Coverage | mean(U ≤ Û⁺), target 1 − α ± 2 pp (C3) |
| **Under-prediction on irreversible** | among rows with U ≥ U_irrev, the fraction with Û⁺ < U_irrev. **Most important safety number.** |
| Interval width | median of Û⁺ / median of U |
| Spearman ρ | between point estimate and U |

Splits to report: random (in-distribution), tool-held-out (unseen tools), and each domain-out (C5 preview).

## 4.5 Error probability P_err (`models/perr.py`), MG

Two signals, combined and calibrated:

1. **Self-consistency:** sample k = 5 alternative next tool calls from the agent at temperature 0.7, given the same context. Agreement = the fraction matching the proposed call (same tool, same normalized args).
2. **Classifier:** logistic regression on the Featurizer output plus trajectory features (step index, recent errors), trained on harvested trajectories with the Phase 8 error-label rule (build plan §3.1).

```python
class PErr:
    def fit(self, agree, X, is_error):
        self.clf = LogisticRegression(max_iter=1000).fit(np.c_[agree, X], is_error)
        raw = self.clf.predict_proba(np.c_[agree, X])[:, 1]
        self.iso = IsotonicRegression(out_of_bounds="clip").fit(raw, is_error)
    def predict(self, agree, X) -> np.ndarray:
        return self.iso.predict(self.clf.predict_proba(np.c_[agree, X])[:, 1])
```

- Fit the isotonic step on a **separate** calibration split.
- Report ECE (10 bins) and a reliability plot.
- **B2 uses the same agreement signal** as its confidence, so the comparison isolates the decision rule, not the signal quality.

## 4.6 Staged screen (`models/screen.py`)

Purpose: skip expensive k = 5 sampling when the decision is obvious.

```python
def needs_sampling(u_upper: float, threshold: float, p_lo=0.02, p_hi=0.6) -> bool:
    """Escalate-or-execute is the same for every P_err in [p_lo, p_hi]  ->  no sampling needed."""
    return p_lo * u_upper <= threshold <= p_hi * u_upper
```

- If even an optimistic P_err (`p_lo`) gives expected damage above the threshold, the call escalates without sampling. If even a pessimistic one (`p_hi`) stays below it, the call executes without sampling.
- `p_lo` and `p_hi` are the 5th and 95th percentiles of P_err on the dev split.
- **Report the fraction of calls that skip sampling.** That drives M5 and M6.

## Tests

- `test_conformal.py`: on synthetic exchangeable data (e.g. y = x + noise), empirical coverage is within ±2 pp of 1 − α over 200 random seeds (averaged).
- `test_regressor.py`: the upper head ≥ the lower head on ≥ 99% of test rows; predictions are finite.
- `test_featurizer.py`: an unseen tool maps to `<unk>` without error; no label fields are read.
- `test_screen.py`: monotonicity. Raising `u_upper` never turns "escalate without sampling" into "execute".

## Exit checklist

- [ ] C3 met on the random split; per-split coverage reported (including unseen tools)
- [ ] Under-prediction rate on irreversible actions reported
- [ ] CQR matches MAPIE on one split
- [ ] P_err ECE and reliability plot reported
- [ ] Staged-screen skip rate reported
- [ ] `reports/regressor.md` and the MLflow run linked from the Paper I draft
