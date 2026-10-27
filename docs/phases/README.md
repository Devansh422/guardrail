# Guardrail: Phase Implementation Guides

These guides turn [`../Guardrail_Build_Plan.md`](../Guardrail_Build_Plan.md) into build instructions. Read the build plan first: it holds the **metrics, pass conditions, baselines and dates**. These files hold **how to build each part**.

| Phase | Guide | Dates | Lead | Deliverable |
|---|---|---|---|---|
| 0 | [Setup](Phase_0_Setup.md) | 2–8 Nov 2026 | DV + MG | Repo, CI, pre-registration |
| 1 | [Taxonomy](Phase_1_Taxonomy.md) | 2–22 Nov | MG | D1 |
| 2 | [Sandbox](Phase_2_Sandbox.md) | 9 Nov – 13 Dec | DV | D2 |
| 3 | [Dataset](Phase_3_Dataset.md) | 30 Nov – 10 Jan 2027 | MG | D3 |
| 4 | [Regressor + conformal](Phase_4_Regressor.md) | 14 Dec – 24 Jan | DV | D4 |
| 5 | [Detector](Phase_5_Detector.md) | 11 Jan – 14 Feb | MG | D5 |
| 6 | [Policy engine](Phase_6_Policy.md) | 1 Feb – 7 Mar | DV | D6 |
| 7 | [Integration](Phase_7_Integration.md) | 15 Feb – 11 Apr | MG (DV: proxy) | D7 |
| 8 | [Evaluation](Phase_8_Evaluation.md) | 1 Mar – 25 Apr | DV + MG | Main results |
| 9 | [Ablations + write-up](Phase_9_Ablations_Writeup.md) | 5 Apr – 20 May | DV + MG | D8 |

DV = Devansh Verma, MG = Muskan Gautam.

---

## Shared contracts (read before any phase)

Every phase plugs into these types. They live in `guardrail/types.py`, written in Phase 0. **Change them only by a PR that both of you approve**, because every later phase depends on them.

```python
# guardrail/types.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Literal

Domain = Literal["fs", "git", "ledger", "outbox"]
Rollback = Literal["exact_inverse", "compensating", "partial", "none"]
Externality = Literal["contained", "cross_org", "third_party"]

@dataclass(frozen=True)
class ToolSpec:                      # one row of the taxonomy (Phase 1)
    name: str
    domain: Domain
    rollback: Rollback
    externality: Externality
    latency_sensitivity: float       # reversibility half-life in seconds; inf = never decays
    destructive: bool
    notes: str = ""

@dataclass(frozen=True)
class ToolCall:                      # one proposed call (all phases)
    tool: str
    args: dict[str, Any]
    task_id: str
    step: int                        # index within the trajectory

@dataclass
class UndoLabel:                     # sandbox output (Phase 2), dataset row (Phase 3)
    L: float                         # recovery latency, seconds
    M: float                         # monetary exposure, currency units
    S: float                         # social exposure, assigned from externality
    restored: bool                   # residual diff empty after rollback
    residual_size: int               # number of differing items
    events: list[str] = field(default_factory=list)   # external events that fired

@dataclass
class Decision:                      # policy output (Phase 6)
    action: Literal["execute", "escalate"]
    p_err: float
    u_upper: float                   # conformal upper bound, after amplification
    amplification: float
    threshold: float                 # lambda(b) * C_int at decision time
    reason: str
```

`U` is **never stored**. It is computed from `(L, M, S)` and a weight vector at train or eval time (`guardrail/cost.py`, Phase 3), so the weight grid in the build plan can be swept without relabeling.

## Conventions

- Python 3.11, `ruff` + `black`, type hints on public functions, `pytest` for tests.
- One branch per task ID from the build plan (`p2-verifier`). PR review by the other person; CI must be green.
- Every experiment is a YAML file under `experiments/configs/` plus an MLflow run. Never copy numbers into the paper by hand.
- Seeds: `{0,1,2,3,4}`. Any randomness takes an explicit `seed` or `np.random.Generator` argument.
- Anything that is an **assumption** (S values, event rates, U_irrev) lives in YAML with a comment saying so, and is logged with each run.
