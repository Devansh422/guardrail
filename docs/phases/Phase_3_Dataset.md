# Phase 3: Dataset Generation and Labeling (D3)

**Dates:** 30 Nov 2026 – 10 Jan 2027 · **Lead:** MG (DV: trajectory harvesting) · **Depends on:** Phase 2 labeler · **Produces:** ≥ 10,000 labeled actions, composition library, frozen splits, datasheet, `U_irrev`.
**Metrics unlocked:** C2, C6; inputs to M7 and M1.

---

## 3.1 Record format

`data/labeled/actions.jsonl`: one line per labeled call.

```json
{
  "id": "fs-000123",
  "source": "synthetic | trajectory | composition",
  "domain": "fs",
  "tool": "fs.delete",
  "args": {"path": "backups/db.bak", "trash": false},
  "state": {"is_production": true, "sensitivity": "high", "affordances": {"db": ["primary", "backup"]}},
  "history": ["fs.write:primary/db", "..."],
  "label": {"L_measured": 0.0, "L_assumed": 3600.0, "M": 0.0, "S": 0.0,
            "restored": false, "residual_size": 1, "events": []},
  "seed": 7, "taxonomy_version": "v1.0", "config_hash": "sha256:..."
}
```

`state` and `history` are the inputs the regressor and detector will see. Store them now; adding them later means relabeling.

## 3.2 Three sources

| Source | Share | Generator | Purpose |
|---|---|---|---|
| Synthetic random calls | ~60% | `labeling/generate.py` | Coverage of every tool and arg pattern |
| Harvested agent trajectories | ~30% | `labeling/harvest.py` | Natural distribution of real agent calls |
| Composition patterns | ~10% | `labeling/compositions.py` | Detector training (sequence-level labels) |

### Synthetic generator (MG)

```python
def generate(n: int, specs: dict[str, ToolSpec], rng, weights: dict[str, float]) -> Iterator[ToolCall]:
    """Sample tool by weight, then args from that tool's arg sampler, then state features."""
```

- **Cost-weighted sampling:** weight destructive tools ×3 at the start. After every 1,000 labels, check the irreversible share; adjust weights until **≥ 15%** of labels have `restored = false`.
- Arg samplers per tool live next to the domain code (`sandbox/domains/fs.py: sample_args(rng)`), so new tools bring their own.

### Trajectory harvesting (DV)

- Run the agent on stock and augmented tau-bench and SWE-bench tasks with a **logging-only** gate that records every proposed write call plus the env state at that moment.
- Replay each recorded call in the sandbox from the recorded state, and label it.
- These rows carry `source = "trajectory"` and the benchmark task ID, so Phase 8 can keep them out of evaluation tasks if needed.

### Composition library (MG)

At least 12 patterns, each a list of calls whose **sequence** is irreversible while each call alone is recoverable:

| Pattern | Calls |
|---|---|
| backup → primary | `delete_backup(db)` → `overwrite_primary(db)` |
| reflog → force push | `git reflog expire --all` + `git gc --prune=now` → `push --force` |
| key rotation | `revoke_api_key(old)` → `rotate_api_key` fails → service down |
| trash purge | `fs.delete(trash=True)` → `empty_trash` |
| snapshot then deploy | `delete_snapshot(env)` → `deploy(bad)` |
| ... | (to 12+) |

- Label each with `label_sequence`. Also label each prefix, so the detector sees "cheap so far" vs "now fatal".
- Hold out **4 patterns entirely** for Phase 5 evaluation.

## 3.3 Labeling at scale

- `labeling/run.py --n 12000 --workers 8 --seed 0`: multiprocessing pool, one env per worker, reset per label.
- At a 5 s median, 12,000 labels ≈ 17 hours on 1 worker, ~2 hours on 8.
- Checkpoint every 500 rows; resume from the last row on restart.
- `dvc add data/labeled/actions.jsonl` after each batch.

## 3.4 Cost function and U_irrev

```python
# guardrail/cost.py
def undo_cost(lbl: dict, w: tuple[float, float, float]) -> float:
    wL, wM, wS = w
    return wL * (lbl["L_measured"] + lbl["L_assumed"]) + wM * lbl["M"] + wS * lbl["S"]
```

- **Normalization:** scale each weight vector so the median U of `restored = true` rows equals 1.
- **U_irrev** = the 95th percentile of U among `restored = true` rows at the headline weights (1, 1, 1). Freeze it in `experiments/PREREGISTRATION.md` (Deviations section, dated) once computed.

## 3.5 Expert validation (C6), DV + MG

1. `scripts/sample_validation.py --n 150`: stratified by domain × restored.
2. Rubric (`labeling/validation_rubric.md`): given the call, the state and the label, is (a) `restored` correct and (b) U within the right order of magnitude?
3. Both of you judge independently. Report agreement with the sandbox and between the two of you, plus error categories (wrong rollback class, missing side effect, event model unrealistic).
4. Fix systematic labeler bugs, relabel the affected rows, and document what changed.

## 3.6 Splits

`data/splits/v1/` with seed 0:

| Split | Rule | Used for |
|---|---|---|
| train / cal / test | 60 / 20 / 20 by **tool** (no tool in two splits) | Regressor, conformal, unseen-tool eval |
| domain-out ×3 | train on 2 domains, test on the 3rd (`ledger` + `outbox` count as one "transactional" domain to match the paper) | C5 |
| composition holdout | the 4 held-out patterns | Detector eval |

Also produce a random 60/20/20 split for an in-distribution reference number.

## 3.7 Datasheet

`data/DATASHEET.md` in Gebru et al.'s format: motivation, composition (counts per domain, tool, restored), collection process (sandbox, events, assumptions), preprocessing, uses, distribution, maintenance. **List every assumed quantity** (S table, event rates, L_assumed table).

## Tests

- `test_cost.py`: weights scale linearly; normalization makes the median recoverable U = 1.
- `test_generate.py`: the generator respects tool weights (chi-square on 10k draws); every sampled call validates against its spec.
- `test_splits.py`: no tool appears in two splits; composition holdout patterns are absent from train.

## Exit checklist

- [ ] ≥ 10,000 labeled rows; ≥ 15% irreversible
- [ ] ≥ 12 composition patterns, 4 held out
- [ ] C6 validation report committed
- [ ] Splits frozen and DVC-tracked
- [ ] `U_irrev` frozen
- [ ] Datasheet committed
