# Phase 5: Silent-Irreversibility Detector (D5)

**Dates:** 11 Jan – 14 Feb 2027 · **Lead:** MG (DV: contextual head) · **Depends on:** Phase 3 composition library, Phase 4 regressor · **Produces:** `guardrail/detector/`, a sequence-level evaluation suite, and the ability to run ablation A1.

---

## 5.1 Compositional head: resource graph (`detector/compositional.py`), MG

The synthetic analysis showed that per-call estimators plateau because of "silent" irreversible calls. This head is what can lower that floor.

```python
Affordance = Literal["primary", "backup", "snapshot", "audit_copy", "trash", "reflog", "remote"]

@dataclass
class Resource:
    rid: str                                  # e.g. "db:customers", "git:main", "file:config.yaml"
    alive: set[Affordance]

class ResourceGraph:
    def __init__(self, effects: dict[str, "Effect"]): ...   # tool -> declared effect on affordances
    def resources_touched(self, call: ToolCall) -> list[str]: ...
    def consumes(self, call: ToolCall) -> dict[str, set[Affordance]]: ...   # rid -> affordances removed
    def apply(self, call: ToolCall) -> None: ...            # after the call actually executes
    def remaining_after(self, call: ToolCall) -> dict[str, set[Affordance]]: ...
    def amplification(self, call: ToolCall, a_max: float = 100.0) -> float:
        """1.0 unless the call leaves some touched resource with zero recovery affordances."""
        after = self.remaining_after(call)
        return a_max if any(len(v) == 0 for v in after.values()) else 1.0
```

- **Effects table** (`detector/effects.yaml`): for each tool, which affordances it creates or destroys on which resource, keyed by argument. Example: `delete_backup(db)` removes `backup` from `db:{db}`; `overwrite_primary(db)` removes `primary`; `git gc --prune=now` removes `reflog` from every branch.
- Start with a **binary** amplification (1 or `a_max`), because it is easy to audit. Make it graded only if the binary version fails the exit criteria. `a_max` is a hyperparameter tuned on the dev patterns, not test.
- The graph is per task. Initialize it from the env state at task start (Phase 3 stores `state.affordances`).

## 5.2 Contextual head (`detector/contextual.py`), DV

Predicts a multiplicative factor from trajectory context that the resource graph does not encode (e.g. "an external event already fired": the email was read, the commit was pulled).

```python
class ContextualHead:
    def fit(self, H: np.ndarray, log_ratio: np.ndarray): ...   # target = log(U_seq / U_call)
    def predict(self, H: np.ndarray) -> np.ndarray:             # returns factor >= 1
        return np.maximum(1.0, np.exp(self.model.predict(H)))
```

- **Features H:** last k = 5 tool names (hashed), count of destructive calls so far, events observed so far, steps since the last affordance-creating call.
- **Target:** from the composition library and harvested trajectories, `log(U of the call measured in its sequence / U of the same call measured alone)`.
- **Model:** a small LightGBM regressor. Clip predictions at 1, because the head may only raise cost, never lower it.

## 5.3 Combination

```python
def amplified_upper(call, u_upper, graph, ctx_head, H) -> tuple[float, float]:
    a = max(graph.amplification(call), float(ctx_head.predict(H[None])[0]))
    return a * u_upper, a
```

`max` rather than product, so the two heads do not compound on the same evidence. Note this choice in the paper's Section IV-D if it is kept.

## 5.4 Sequence-level evaluation suite (`eval/detector_suite.py`)

For each composition pattern (dev and held-out):

1. Replay the calls one by one through `ResourceGraph` + `ContextualHead` + the Phase 4 regressor.
2. At each step, compute Ũ⁺ and whether `P_err · Ũ⁺ > C_int` at the headline settings (P_err fixed at the dataset median, to isolate the detector).
3. **Hit** = the fatal call (the one after which the sequence is unrecoverable) crosses the threshold. **False alarm** = an earlier, recoverable prefix call crosses it.

Report per pattern and aggregated: recall on the fatal call (dev / **held-out**), false-alarm rate on prefixes, and the same numbers with the detector off (the Phase 4 regressor alone). The difference is ablation A1's preview.

## 5.5 Overhead

Graph operations must be O(resources touched). Measure median and P99 added time per call. It counts toward M5.

## Tests

- `test_resource_graph.py`:
  - backup → overwrite: amplification 1 on the first call, `a_max` on the second.
  - Reverse order: overwrite with the backup still alive gives amplification 1.
  - A call on an unrelated resource does not change amplification.
  - `apply` is idempotent for read-only tools.
- `test_contextual.py`: output ≥ 1 for any input.
- `test_combination.py`: `amplified_upper` ≥ `u_upper` always.

## Exit checklist

- [ ] `effects.yaml` covers every destructive tool in the taxonomy
- [ ] Recall on **held-out** patterns reported, with and without the detector
- [ ] False-alarm rate on recoverable prefixes reported
- [ ] Added latency per call reported
- [ ] Ablation A1 switch (`detector.enabled: false`) works in eval configs
