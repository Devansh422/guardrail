# Phase 6: Escalation Policy Engine (D6)

**Dates:** 1 Feb – 7 Mar 2027 · **Lead:** DV (MG: audit log and reviewer simulator) · **Depends on:** Phases 4–5 · **Produces:** `guardrail/policy/`, simulated reviewer, and the ability to run ablations A3 and A4.

---

## 6.1 Decision rule (`policy/engine.py`)

```python
@dataclass
class PolicyConfig:
    c_int: float = 1.0                  # pre-registered
    rate_per_100: float = 5.0           # escalation cap
    kappa: float = 3.0                  # lambda(b) = 1 + kappa * (1 - b_rem / b_tot) ** 2
    batch_window: int = 10              # actions
    thresholds: dict[str, float] | None = None   # per action class; None -> global c_int
    use_budget: bool = True             # ablation A4
    per_class: bool = True              # ablation A3

class GuardPolicy:
    def __init__(self, cfg: PolicyConfig, budget: "Budget", audit: "AuditLog"): ...
    def decide(self, call: ToolCall, cls: str, p_err: float, u_upper: float, amp: float) -> Decision:
        base = (self.cfg.thresholds or {}).get(cls, self.cfg.c_int) if self.cfg.per_class else self.cfg.c_int
        lam = self.budget.lam() if self.cfg.use_budget else 1.0
        thr = lam * base
        esc = p_err * u_upper > thr and (not self.cfg.use_budget or self.budget.can_spend())
        d = Decision("escalate" if esc else "execute", p_err, u_upper, amp, thr,
                     reason=f"{p_err:.3f}*{u_upper:.2f} {'>' if esc else '<='} {thr:.2f}")
        if esc and self.cfg.use_budget: self.budget.spend()
        self.audit.append(call, d)
        return d
```

**Action class** = `"{domain}:{rollback}"` from the taxonomy (at most 16 classes). That keeps per-class thresholds estimable from the data.

**Budget exhausted.** When `can_spend()` is false, the rule above executes the call. That is the honest "budget" semantics, but it is dangerous for catastrophic calls. Add a **hard floor**: if `u_upper ≥ U_irrev × 10`, escalate regardless of budget. Pre-register this; it is a design choice reviewers will ask about.

## 6.2 Budget (`policy/budget.py`)

```python
class Budget:
    """Rate cap: at most `rate_per_100` escalations per 100 actions, measured over a sliding window."""
    def __init__(self, rate_per_100: float, window: int = 100, kappa: float = 3.0): ...
    def tick(self) -> None: ...          # call once per proposed action
    def can_spend(self) -> bool: ...
    def spend(self) -> None: ...
    def lam(self) -> float:              # 1 when unused, rising toward 1 + kappa as it depletes
        used = self.used_in_window / max(self.cap_in_window, 1e-9)
        return 1.0 + self.kappa * min(used, 1.0) ** 2
```

Rate-based with a sliding window, so a 300-step SWE-bench task is not starved by escalations spent in its first 20 steps.

## 6.3 Batching (`policy/batching.py`)

- A **non-blocking** escalation is one whose call can safely wait. Taxonomy rule: `latency_sensitivity ≥ 1 h` and the agent can continue with other steps. These are queued.
- The queue flushes as **one review** when it reaches `batch_window` actions of age or when a blocking escalation arrives.
- **M2 counts reviews, not calls.** A batch of 3 counts as 1.
- **Verdict application:** approved calls execute in their original order. Rejected calls are reported back to the agent as a tool error (`"blocked by reviewer"`), which is the same path SWE-bench and tau-bench use for failed tools.

## 6.4 Per-class threshold fitting (`policy/thresholds.py`)

```python
def fit_thresholds(records, classes, grid, c_int, reviewer_acc) -> dict[str, float]:
    """For each class independently, pick the threshold on `grid` minimizing realized cost
    = sum(U of unescalated errors) + c_int * (number of reviews) on the dev split."""
```

- `grid`: 60 log-spaced values, the same tuning budget every baseline gets.
- Fit on **dev** trajectories only. Store the result in the run's MLflow artifacts.
- Coordinate-descent refinement across classes is optional, and only if independent fitting overfits rare classes. For those, fall back to the global threshold whenever a class has fewer than 30 dev examples.

## 6.5 Audit log (`policy/audit.py`), MG

Append-only JSONL with **hash chaining**:

```python
class AuditLog:
    def append(self, call: ToolCall, d: Decision, verdict: str | None = None) -> None:
        rec = {"ts": time.time(), "call": asdict(call), "decision": asdict(d),
               "verdict": verdict, "prev": self._last_hash}
        line = json.dumps(rec, sort_keys=True)
        self._last_hash = hashlib.sha256(line.encode()).hexdigest()
        self._fh.write(line + "\n"); self._fh.flush(); os.fsync(self._fh.fileno())
    @staticmethod
    def verify(path) -> bool: ...        # recompute the chain; False if any line was edited or removed
```

Open with mode `"a"`, never `"w"`. `fsync` on each append, because an audit log that loses its last lines in a crash defeats its purpose.

## 6.6 Simulated reviewer (`eval/reviewer.py`), MG

```python
class SimReviewer:
    def __init__(self, accuracy: float, rng): ...
    def review(self, calls: list[ToolCall], is_error: list[bool]) -> list[bool]:   # True = approve
        # correct verdict with prob `accuracy`: reject errors, approve non-errors
```

- Accuracy r ∈ {0.8, 0.9, 1.0} (C7).
- An optional **human mode** (CLI prompt) exists for the demo only, never for metrics.

## Tests

- `test_budget.py`: never exceeds `rate_per_100` in any window of 100 ticks (property test with random spend attempts); `lam()` is 1 at start and monotone non-decreasing as `used` grows.
- `test_engine.py`: the rule matches the hand-computed `P_err·U⁺ > λ·C_int` on a table of cases; the hard floor escalates even with an empty budget; flags off (`use_budget=False`, `per_class=False`) give A3/A4 behavior.
- `test_batching.py`: 3 non-blocking escalations inside the window make 1 review; a blocking escalation flushes the queue.
- `test_audit.py`: `verify` is True on an untouched log, and False after editing any single byte or deleting any line.
- `test_reviewer.py`: empirical accuracy within ±2 pp of r over 10,000 draws.

## Exit checklist

- [ ] All tests above green
- [ ] Per-class thresholds fit on dev and stored
- [ ] Hard-floor rule pre-registered
- [ ] A3 and A4 switch on via config
- [ ] An end-to-end dry run on 20 harvested trajectories produces a valid, verifiable audit log
