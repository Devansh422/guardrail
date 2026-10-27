# Phase 7: Integration: SDK, MCP Proxy, Console (D7)

**Dates:** 15 Feb – 11 Apr 2027 · **Lead:** MG (DV: MCP proxy and overhead benchmark) · **Depends on:** Phases 4–6 · **Produces:** `guardrail/integration/`, the overhead benchmark (M5), and gated benchmark runners for Phase 8.
**New dependencies:** `mcp` (official Python SDK), `fastapi`, `uvicorn`.

---

## 7.1 The `Guard` facade (`integration/guard.py`)

One object assembles everything. The SDK, the proxy and the eval harness all call this, so the gate is **one code path** everywhere.

```python
class Guard:
    def __init__(self, cfg_path: str):
        cfg = load_yaml(cfg_path)
        self.specs = load_specs()
        self.feat, self.cqr, self.perr = load_models(cfg["models"])
        self.graph = ResourceGraph(load_effects())
        self.ctx = load_contextual(cfg["detector"])
        self.policy = GuardPolicy(PolicyConfig(**cfg["policy"]), Budget(...), AuditLog(cfg["audit_path"]))
        self.reviewer = make_reviewer(cfg["reviewer"])          # sim or human
        self.history: list[ToolCall] = []

    def check(self, call: ToolCall, state: dict, sample_fn=None) -> Decision:
        x = self.feat.transform([{"tool": call.tool, "args": call.args, "state": state}])
        u_up = float(self.cqr.upper(x)[0])
        u_amp, amp = amplified_upper(call, u_up, self.graph, self.ctx, history_features(self.history))
        cls = action_class(self.specs, call.tool)
        thr = self.policy.threshold_for(cls)
        if needs_sampling(u_amp, thr) and sample_fn is not None:
            p = float(self.perr.predict(agreement(sample_fn, call), x)[0])
        else:
            p = self.perr.prior(cls)                          # class prior; no extra tokens
        self.policy.budget.tick()
        return self.policy.decide(call, cls, p, u_amp, amp)

    def executed(self, call: ToolCall) -> None:
        self.graph.apply(call); self.history.append(call)
```

`sample_fn(call) -> list[ToolCall]` asks the agent's model for k alternative calls. The SDK and proxy pass it only when the host provides model access; otherwise P_err falls back to the class prior, and this is logged.

## 7.2 Python SDK (`integration/sdk.py`)

```python
guard = Guard("experiments/configs/default.yaml")

@guard.tool(name="fs.delete")
def delete(path: str, trash: bool = True): ...

with guard.session(task_id="t-42"):
    delete("backups/db.bak", trash=False)     # -> check -> escalate or execute
```

- The decorator builds a `ToolCall` from the function name and bound arguments, calls `guard.check`, then either runs the function or raises `Escalated(decision)`.
- With a reviewer attached, it runs or raises according to the verdict. After execution it calls `guard.executed`.
- `session` resets per-task state (graph, history, budget window) and tags audit records with the task ID.
- Async functions are supported by detecting a coroutine function.

## 7.3 MCP proxy (`integration/mcp_proxy.py`), DV

The proxy is an MCP **server** to the agent and an MCP **client** to the real tool server.

```python
# sketch, using the official `mcp` package
from mcp.server import Server
from mcp.client.session import ClientSession

async def run_proxy(downstream_cmd: list[str], guard: Guard):
    async with stdio_client(StdioServerParameters(command=downstream_cmd[0], args=downstream_cmd[1:])) as (r, w), \
               ClientSession(r, w) as down:
        await down.initialize()
        server = Server("guardrail-proxy")

        @server.list_tools()
        async def list_tools():
            return (await down.list_tools()).tools              # unchanged pass-through

        @server.call_tool()
        async def call_tool(name, arguments):
            call = ToolCall(name, arguments, task_id=current_task(), step=next_step())
            d = guard.check(call, state=await probe_state(down))
            if d.action == "escalate" and not await review(call, d):
                return [TextContent(type="text", text=f"Blocked by reviewer: {d.reason}")]
            result = await down.call_tool(name, arguments)
            guard.executed(call)
            return result.content

        await serve_stdio(server)
```

- **Configuration:** the agent points at `guardrail-proxy --downstream "<original server command>"` instead of the original server. That is the "endpoint change only" promise from the paper.
- **`probe_state`:** for the sandbox domains, a read-only call to fetch the state features. For arbitrary servers, empty state, which the featurizer handles as missing.
- **Verify the SDK API** against the installed `mcp` version. Decorator names and transport helpers have changed between releases.

## 7.4 Benchmark runners (`eval/runners/`)

- **tau-bench:** wrap each mutating tool's `invoke` with `guard.check`. A block returns the tool error string `"Blocked by reviewer"`, the same format the env uses for invalid calls, so the agent loop is unchanged. Use the location recorded in `notes_tau_bench.md`.
- **SWE-bench (bash agent):** wrap the command-execution function from `notes_swe_bench.md`. `ToolCall(tool=command_family(cmd), args={"cmd": cmd})`. Destructive commands run inside the Docker sandbox so a real `rm -rf` cannot touch the host.
- **Logging mode** (for Phase 8 record-once): `check` runs fully, the decision is recorded, but the call **always executes**. Counterfactual labels come from the sandbox afterwards.

## 7.5 Overhead benchmark (`scripts/bench_overhead.py`), DV

- 10,000 calls to a no-op tool through: (a) direct, (b) SDK, (c) MCP proxy.
- Report median and P99 **added** latency (b − a, c − a), separately with sampling skipped and with sampling forced (the latter shows the worst case, excluding LLM time, which M6 covers).
- **Decision rule:** if the median added latency for (c) is above the pre-registered limit (50 ms), profile and fix before Phase 8. Likely culprits are embedding computation (cache per tool string), LightGBM per-row prediction (batch where possible) and `fsync` (move it to a background thread with a bounded queue, never drop records).

## 7.6 Minimal console (`integration/console/`), MG

FastAPI with server-rendered HTML, no build step:

| Route | Shows |
|---|---|
| `GET /` | review inbox: pending escalations with call, P_err, Û⁺, amplification, reason; approve/reject buttons |
| `GET /task/{id}` | risk timeline: a table of steps with decision and Ũ⁺ |
| `GET /audit` | audit log viewer, plus `AuditLog.verify` status |

The human reviewer path (`make_reviewer("human_console")`) blocks on the inbox. It is used for the demo only.

## Tests

- `test_sdk.py`: a decorated function runs when the decision is execute; raises `Escalated` when blocked; `session` isolation (no history leakage between tasks).
- `test_mcp_proxy.py`: spin up a tiny downstream MCP server in-process with two tools; tools list identically through the proxy; a blocked call returns the block message and never reaches downstream (assert via a counter).
- `test_equivalence.py`: with a policy that never escalates, gated and ungated runs of 5 tau-bench tasks produce identical final DB hashes.

## Exit checklist

- [ ] SDK and proxy pass their tests
- [ ] Equivalence test green (the gate is transparent when it does not escalate)
- [ ] One tau-bench and one SWE-bench task run through the proxy
- [ ] M5 reported; median under the pre-registered limit
- [ ] Console shows inbox, timeline and audit verification
