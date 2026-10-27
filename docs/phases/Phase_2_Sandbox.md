# Phase 2: Rollback-Instrumented Sandbox (D2)

**Dates:** 9 Nov – 13 Dec 2026 · **Lead:** DV (MG builds the ledger and outbox domains) · **Depends on:** Phase 1 spec (draft is enough to start) · **Produces:** `guardrail/sandbox/`, the labeler, and a CI-gated rollback test suite.
**Feeds:** C2 (dataset), M1/M3 (measured U), detector training.

---

## 2.1 Core abstractions (DV, week 1)

```python
# guardrail/sandbox/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass(frozen=True)
class Snapshot:
    domain: str
    items: dict[str, str]        # key -> content hash (or canonical value)

@dataclass
class Residual:
    changed: list[str]           # keys whose value differs
    added: list[str]
    removed: list[str]
    money: float = 0.0           # net ledger difference (ledger domain only)
    def size(self) -> int: return len(self.changed) + len(self.added) + len(self.removed)

@dataclass
class ExecRecord:
    call: ToolCall
    ok: bool
    output: str
    undo_info: dict              # whatever rollback needs, e.g. trash path, old ref, txn id
    t_exec: float                # wall-clock time of execution

class DomainEnv(ABC):
    name: str
    @abstractmethod
    def reset(self, seed: int) -> None: ...               # build a fresh, realistic initial state
    @abstractmethod
    def snapshot(self) -> Snapshot: ...
    @abstractmethod
    def execute(self, call: ToolCall) -> ExecRecord: ...
    @abstractmethod
    def rollback(self, rec: ExecRecord, deadline: float) -> bool: ...
    def diff(self, a: Snapshot, b: Snapshot) -> Residual:  # default: dict diff
        ...
```

**Rule:** `rollback` may only use what a real operator would have, meaning `undo_info`, the trash, the reflog, the ledger's refund API and the outbox recall API. **It must never read the snapshot.** The snapshot exists only for the verifier, otherwise every rollback would trivially succeed.

## 2.2 Domains

### fs (DV)
- State: a temp directory with a seeded tree (projects, configs, backups/, logs).
- `snapshot`: walk the tree; key = relative path, value = SHA-256 of contents plus mode.
- Tools and rollback classes:

| Tool | Execute | Rollback |
|---|---|---|
| `fs.write(path, content)` | write; `undo_info` = previous bytes if the file existed | restore previous bytes (exact) |
| `fs.delete(path, trash=True)` | move to `.trash/` | move back (exact) |
| `fs.delete(path, trash=False)` | unlink | none |
| `fs.rm_rf(dir)` | recursive delete, no trash | none |
| `fs.move(src, dst)` | rename; record whether `dst` existed and its bytes | move back plus restore the overwritten file if recorded (exact) or partial if not |

### git (DV)
- State: a temp repo plus a **bare "remote"** repo, with seeded history and branches. A second clone stands in for a collaborator.
- `snapshot`: all refs (`git for-each-ref`), HEAD, working-tree hashes, and the remote's refs.
- Tools: `commit`, `reset --hard`, `branch -D`, `push`, `push --force`, `clean -fd`.
- Rollback uses the **reflog** (`git reset --hard <old>`; `git branch <name> <sha>`), and for the remote, `push --force` of the old ref.
- Untracked files destroyed by `clean -fd` or `reset --hard` are gone, so the residual is non-empty. That is real partial irreversibility, captured honestly.

### ledger (MG)
- State: SQLite DB with `accounts(id, balance)`, `transactions(id, src, dst, amount, status, ts)`, `fees`.
- Tools: `charge(acct, amount)`, `refund(txn_id)`, `transfer(src, dst, amount)`, `close_account(id)`.
- Rollback is **compensating**: refund or reverse transfer, each charging a fee (from a YAML table). The residual includes the extra transaction rows, and `money` = net fee lost.
- After a settlement window (latency sensitivity), `refund` fails, so rollback is none.

### outbox (MG)
- State: a message queue with `read` flags.
- Tools: `send_email(to, subject, body)`, `post_message(channel, text)`.
- Rollback: `recall` succeeds **only if the message is still unread**. Read status is driven by `events.py`.

## 2.3 External events (MG, week 2)

```python
# guardrail/sandbox/events.py
@dataclass
class EventProcess:
    name: str              # "email_read", "commit_pulled", "payment_settled"
    rate_per_min: float    # exponential arrival; documented in configs/events.yaml
    def fires_before(self, t_minutes: float, rng: np.random.Generator) -> bool:
        return rng.exponential(1 / self.rate_per_min) < t_minutes
```

- `configs/events.yaml` holds every rate with a comment saying it is an assumption.
- Before rollback, the labeler draws a **delay** (how long before anyone notices the mistake), samples which events fire within it, and applies them: mark the email read, or have the collaborator clone pull the ref.
- Record which events fired in `UndoLabel.events`.

## 2.4 Verifier and labeler (DV, week 3)

```python
# guardrail/sandbox/labeler.py
def label(env: DomainEnv, call: ToolCall, spec: ToolSpec, rng, cfg) -> UndoLabel:
    before = env.snapshot()
    rec = env.execute(call)
    delay = rng.exponential(cfg.notice_delay_mean_min)
    fired = apply_events(env, rec, delay, rng, cfg)
    t0 = time.perf_counter()
    ok = env.rollback(rec, deadline=t0 + cfg.rollback_budget_s)
    L = time.perf_counter() - t0 if ok else cfg.rollback_budget_s   # failed = full budget, plus residual
    res = env.diff(before, env.snapshot())
    return UndoLabel(
        L=L,
        M=res.money + monetary_exposure(rec, res),      # ledger residual + fees
        S=S_TABLE[spec.externality],                     # ASSUMPTION, from configs/cost.yaml
        restored=ok and res.size() == 0,
        residual_size=res.size(),
        events=fired,
    )

def label_sequence(env, calls, specs, rng, cfg) -> UndoLabel:
    """Execute all calls, then attempt rollback in reverse order; verify against the first snapshot."""
```

- **L is measured wall-clock rollback time.** Simulated human time (e.g. "contacting the bank") is added from the YAML per rollback class and logged separately. Keep the measured part and the assumed part as two fields, `L_measured` and `L_assumed`, in the raw record. `L` = their sum.
- `S_TABLE` lives in `configs/cost.yaml`, for example `{contained: 0, cross_org: 5, third_party: 50}`, marked as an assumption.

## 2.5 Tests (CI-gated, mandatory)

`tests/sandbox/` with **one test per tool per rollback class**:

```python
@pytest.mark.parametrize("call", REVERSIBLE_CALLS)
def test_reversible_restores_exactly(env_factory, call):
    env = env_factory(call.tool); env.reset(seed=0)
    before = env.snapshot(); rec = env.execute(call)
    assert env.rollback(rec, deadline=time.perf_counter() + 30)
    assert env.diff(before, env.snapshot()).size() == 0

@pytest.mark.parametrize("call", IRREVERSIBLE_CALLS)
def test_irreversible_leaves_residual(env_factory, call): ...

def test_noop_roundtrip_empty(env_factory): ...      # snapshot -> snapshot diff is empty
def test_rollback_never_reads_snapshot(): ...       # monkeypatch Snapshot access inside rollback -> must not be called
def test_email_recall_fails_after_read(): ...
def test_sequence_backup_then_overwrite_irreversible(): ...   # the paper's example, at sequence level
```

Plus a **fuzz test**: 100 random calls in a row on a fresh env with no crash, and every label's fields are finite.

## 2.6 Performance

Exit requires a **median label time under 5 s**. That is what makes 10,000 labels feasible in Phase 3. If git is slow, reuse a template repo via `git clone --local` (hard links) instead of rebuilding history per label.

## Exit checklist

- [ ] All four domains implemented; every `tools.yaml` tool has an `execute` and a `rollback`
- [ ] Rollback test suite green in CI
- [ ] `rollback_never_reads_snapshot` test green
- [ ] 100-call fuzz run without crash
- [ ] Median label time < 5 s (report the measured value)
- [ ] `events.yaml` and `cost.yaml` committed with every assumption commented
