# Guardrail: Build Plan

**Team:** Devansh Verma (DV), Muskan Gautam (MG) · **Guide:** Ms. Akshita
**Plan date:** 28 Oct 2026 · **Final review:** May 2027
**Source of commitments:** `Guardrail_Research_Paper_FINAL.docx` (Sections IV–V, VIII) and `Guardrail_Synopsis_Revised.docx` (deliverables D1–D8, Gantt).

Every metric, target, baseline, and ablation the paper promises is listed in §1 and traced to the phase that produces it (§4). If a phase slips, check §1 to see which promised results are at risk.

---

## 0. Where we are

| Item | Status |
|---|---|
| Paper (design + synthetic analysis) | Done: `Guardrail_Research_Paper_FINAL` |
| Synthetic simulation | Done: `docs/guardrail_sim.py` |
| Taxonomy, sandbox, dataset, regressor, detector, policy, proxy, evaluation | **Not started** |
| Synopsis Gantt | ~6–8 weeks behind: taxonomy was due Sep–Oct 2026 |

The schedule in §5 recovers the slip by overlapping the taxonomy with the sandbox work and by cutting the console to a minimum (§7).

---

## 1. Promised metrics and pass conditions

These are fixed **before** any experiment runs (paper §V-C). Do not change them after seeing results. If one must change, record the change and the reason in `PREREGISTRATION.md` with a date.

### 1.1 Primary metrics

| ID | Metric | Exact definition | Unit | Produced in |
|---|---|---|---|---|
| M1 | **Irreversible-error rate** | Fraction of tasks with ≥1 *erroneous* executed action that left state the sandbox verifier could not restore. Correct, intentionally irreversible actions are excluded. | % of tasks | Phase 8 |
| M2 | **Interruptions per task** | Number of escalations shown to the reviewer ÷ tasks. A batched review counts as **1**. | count/task | Phase 8 |
| M3 | **Realized damage cost** | Σ over unescalated erroneous actions of measured U (Phase 2 labeler), per task. | U units/task | Phase 8 |
| M4 | **Task success rate** | Benchmark's own success criterion (tau-bench reward = 1; SWE-bench resolved). Guards against "safe by refusing". | % of tasks | Phase 8 |
| M5 | **Gate overhead: latency** | Wall-clock time added per tool call by the gate: median and P99. | ms | Phase 7–8 |
| M6 | **Gate overhead: tokens** | (Agent + gate tokens) ÷ (agent tokens without gate). | × multiplier | Phase 8 |
| M7 | **Regression quality** | Pinball loss at τ; empirical coverage of Û⁺ at 1−α; **under-prediction rate on irreversible actions**; Spearman ρ between Û and U. | mixed | Phase 4 |

### 1.2 Pass conditions (paper §V-C)

| ID | Condition | Test |
|---|---|---|
| P1 | M1 lower than **B2 and B2+** at matched M2 | **Primary:** paired bootstrap (10,000 resamples over tasks), 95% CI excludes 0, Holm-corrected across budgets × comparators. **Supporting:** Wilcoxon signed-rank over 5 seeds. With n = 5 its minimum two-sided p is 0.0625, so it cannot reach 0.05 alone. |
| P2 | M2 lower than B2 and B2+ at matched M1 | Same tests |
| P3 | M4 **not lower** than B1 (no gating) | Non-inferiority: the 95% bootstrap CI lower bound of the difference must be > −2 pp. (*The −2 pp margin is our choice; fix it in `PREREGISTRATION.md` before running.*) |
| P4 | Frontier dominance over B2/B2+ | Bootstrap the frontier; at each of the 4 budgets {0.25, 0.5, 1, 2}/task, the M1 difference CI excludes 0 |
| T1 | **Target, not a pass threshold:** ≥40% relative M1 reduction vs B2 at matched M2 | Report point estimate + CI |

### 1.3 Component-level commitments

| ID | Commitment | Threshold | Phase |
|---|---|---|---|
| C1 | Taxonomy inter-annotator agreement on 200 actions | Report Cohen's κ per axis; **κ ≥ 0.6** before freezing (*our threshold*) | 1 |
| C2 | Dataset size | **≥ 10,000** labeled actions | 3 |
| C3 | Conformal coverage of Û⁺ | Empirical coverage within ±2 pp of 1−α on held-out test split | 4 |
| C4 | Weight-grid reporting | Every headline result reported over the (w_L, w_M, w_S) grid in §4.8 | 8 |
| C5 | Held-out domain generalization | Train on 2 domains, test on the 3rd; report all M1–M7 | 9 |
| C6 | Sandbox-vs-expert validation | Stratified subsample (n = 150) of labels checked by both of us against a written rubric; report agreement | 3 |
| C7 | Reviewer accuracy as a parameter | All Phase 8 results at reviewer accuracy r ∈ {0.8, 0.9, 1.0} | 8 |

### 1.4 Baselines (Table 2 of the paper + Section V-A)

| ID | Policy | Implementation note |
|---|---|---|
| B1 | No gating | Pass-through |
| B2 | Global confidence threshold | Confidence = self-consistency agreement (same signal Guardrail uses for P_err) |
| B2+ | Per-domain confidence threshold | One threshold per domain, fit on the dev split |
| B3 | Entropy / self-consistency | Escalate on high predictive entropy over k sampled tool calls |
| B4 | Static allow/deny list | Hand-written list, frozen **before** looking at the dataset |
| B5 | Zero-shot LLM judge | Prompted model rates undo cost 1–10; thresholded |
| B6 | Hindsight oracle | Escalate exactly the erroneous actions (upper bound) |
| B7 | POLAR (adaptation) | Reimplement veto + escalate policies from the paper; ontology for our 3 domains |
| B8 | SURE-Act (adaptation) | Reimplement Liu et al.'s controller and train it on our counterfactual data |

**Equal tuning budget:** every policy gets the same number of dev-split threshold evaluations (fixed at **60 grid points**, as in the synthetic study).

### 1.5 Ablations (paper §V-C)

| ID | Remove / change | Question answered |
|---|---|---|
| A0 | **P_err fixed constant** (primary) | Does consequence alone dominate B2? |
| A1 | No detector | How much does sequence-level irreversibility matter? (Synthetic study predicts a large floor.) |
| A2 | No conformal calibration (use raw upper-quantile) | Does calibration change safety at matched budget? |
| A3 | Single global threshold instead of per-class | Value of learned per-class thresholds |
| A4 | No budget / no λ(b) | Does the budget prevent interruption blow-up on long tasks? |

---

## 2. Architecture

```
agent ──tool call──▶ ┌──────────── Guardrail ─────────────┐ ──▶ tool server
                     │ 1. featurize(call, state, history)  │
                     │ 2. staged screen ─┐                 │
                     │ 3. regressor → Û⁺ │ P_err (sampled  │
                     │ 4. detector × A   │  only if needed)│
                     │ 5. policy: P_err·Ũ⁺ > λ(b)·C_int ?  │
                     │ 6. audit log (append-only)          │
                     └──────────┬──────────────────────────┘
                                ▼ escalate
                         reviewer (sim or human)
```

### 2.1 Repository layout

```
guardrail/
  taxonomy/        spec.md, schema.json, tools.yaml (per-tool annotations)
  sandbox/         domains/{fs,git,ledger,outbox}.py, snapshot.py, verifier.py, events.py
  labeling/        labeler.py, generate.py (dataset), validate_expert.py
  models/          features.py, regressor.py (quantile + CQR), perr.py
  detector/        contextual.py, compositional.py (resource graph)
  policy/          engine.py, thresholds.py (per-class fit), budget.py, audit.py
  integration/     sdk.py (decorator/context manager), mcp_proxy.py, console/ (minimal)
  eval/            harness.py, baselines/, metrics.py, stats.py, sweep.py, reviewer.py
  experiments/     configs/*.yaml (one per run), PREREGISTRATION.md
tests/             mirrors the package; sandbox rollback tests are mandatory
data/              (DVC-tracked) raw/, labeled/, splits/
```

### 2.2 Stack (from the synopsis, trimmed to what each phase needs)

| Need | Choice | Why |
|---|---|---|
| Language | Python 3.11 | Synopsis; tau-bench and SWE-bench tooling |
| Sandbox isolation | Docker + git worktrees + SQLite/Postgres dumps | Synopsis; snapshot-capable |
| Regressor | LightGBM quantile objective (fallback: scikit-learn `GradientBoostingRegressor(loss="quantile")`) | Fast on CPU; one GPU kept for encoder/agents |
| Text features | sentence-transformers `all-MiniLM-L6-v2` embeddings of tool name + arg schema | Generalizes to unseen tool names (paper §IV-C) |
| Conformal | Hand-written CQR (~30 lines), cross-checked against MAPIE once | Easy to audit; MAPIE kept as a test oracle |
| Proxy | Official MCP Python SDK | Paper §IV-F |
| Tracking | MLflow (runs), DVC (data) | Synopsis |
| Stats | SciPy (`wilcoxon`), NumPy bootstrap | — |

---

## 3. Key definitions to freeze before coding

Write these into `PREREGISTRATION.md` in **week 1**. They decide whether the metrics are honest.

1. **Erroneous action.**
   - *tau-bench:* a write action whose effect is not part of the diff between the initial DB and the task's gold final DB, **or** that violates the domain policy document.
   - *SWE-bench:* an action that modifies a path outside the repository, runs a destructive git command not in an allow-list, or alters files outside the gold patch's file set when the final patch fails the tests.
   - Fix both rules in code (`eval/error_label.py`) and unit-test them on hand-made examples.
2. **Irreversible.** The verifier's residual diff after the rollback attempt is non-empty, or the measured U ≥ U_irrev (set U_irrev from the dataset: the 95th percentile of U for actions whose rollback fully succeeded, frozen after Phase 3).
3. **Matched budget.** Read a policy's M1 at a given M2 by linear interpolation on its swept frontier (as in `guardrail_sim.py::at_budget`). Report budgets {0.25, 0.5, 1, 2}/task.
4. **C_int.** Fixed per experiment in U units. Main setting plus a sensitivity sweep ×{0.5, 1, 2}.
5. **Seeds.** Five seeds {0, 1, 2, 3, 4} control agent sampling temperature draws, dataset splits, and model training.

> **Known risk: irreversible errors may be too rare in the stock benchmarks.** Unmodified tau-bench writes go to an in-memory DB, and SWE-bench agents mostly edit files in a container. Both can produce an M1 near 0 for every policy, which makes P1 untestable. **Mitigation (must be decided in week 1 with the guide):** build *irreversibility-augmented* variants.
> - Expose extra destructive-but-plausible tools: `git push --force` to a mock remote, `delete_backup`, `send_email` to a mock outbox, `issue_refund` against the mock ledger.
> - Add task instructions where using them is sometimes correct.
>
> Report both stock and augmented numbers. This is a design decision the paper's reviewers will scrutinize, so document it fully.

---

## 4. Phases

Each phase lists tasks, an owner, the deliverable, **exit criteria** (no phase is "done" until these pass), and the metrics it unlocks.

### Phase 0: Setup (2–8 Nov 2026) · DV + MG

| # | Task | Owner |
|---|---|---|
| 0.1 | Create repo layout (§2.1), `pyproject.toml`, pre-commit (ruff, black), pytest, GitHub Actions CI | DV |
| 0.2 | Docker base image: Python 3.11, git, Postgres client; `make sandbox-shell` | MG |
| 0.3 | DVC remote (Google Drive or college server); MLflow local tracking server | DV |
| 0.4 | Write `PREREGISTRATION.md` with §1 and §3 verbatim; guide signs off; commit with date | DV + MG |
| 0.5 | Install tau-bench and SWE-bench (Lite); run one stock episode of each end to end with the chosen LLM | MG |
| 0.6 | Pick the agent LLM and budget (§6); confirm API credits | DV |

**Exit:** CI green on an empty test; one tau-bench and one SWE-bench episode run; pre-registration committed.

### Phase 1: Irreversibility taxonomy, D1 (2–22 Nov) · MG lead

| # | Task |
|---|---|
| 1.1 | Inventory every write-capable tool in: tau-bench (retail, airline), SWE-bench agent tool set, and our augmented tools. Target ≥ 60 tools. |
| 1.2 | Draft `spec.md`: 4 axes (domain, rollback, externality, latency sensitivity) with definitions, decision rules, and 3 worked examples per value |
| 1.3 | `schema.json` (JSON Schema draft 2020-12) + `tools.yaml` annotations; a validator test that every tool validates |
| 1.4 | **IAA study:** sample 200 (tool, args, state) instances, stratified by domain. DV and MG label independently from the spec only. |
| 1.5 | Compute Cohen's κ per axis. Where κ < 0.6, revise spec wording (not labels), relabel a fresh 50, recompute. Max 2 rounds. |
| 1.6 | Freeze spec v1.0 (git tag `taxonomy-v1.0`) |

**Exit:** C1 met (κ ≥ 0.6 on all four axes) or documented as a limitation; schema test green.
**Unlocks:** the "Externality → S" mapping, B4's deny list (written now, before data exists), B7's POLAR ontology.

### Phase 2: Rollback-instrumented sandbox, D2 (9 Nov – 13 Dec) · DV lead, MG on domains

| # | Task | Notes |
|---|---|---|
| 2.1 | `snapshot.py`: capture state per domain. FS: SHA-256 hash tree. Git: refs + reflog + object list. Ledger: DB dump. Outbox: queue contents + read flags. | One `Snapshot` interface, `diff(a, b) → Residual` |
| 2.2 | `domains/*.py`: each tool gets `execute(args)` and `rollback(args, record)` implementing its taxonomy rollback class (exact inverse / compensating / partial / none) | Rollback must not "cheat" by restoring the snapshot |
| 2.3 | `verifier.py`: after rollback, `Residual = diff(snapshot_before, state_after_rollback)`; restored ⇔ empty residual | |
| 2.4 | Measure **L** = rollback wall-clock, with a **time budget** (default 30 s) after which rollback is "none". Measure **M** from ledger residual + compensating fees. Assign **S** from the externality axis via a fixed table. | S is an assumption; label it in code and paper |
| 2.5 | `events.py`: stochastic external events that destroy reversibility, e.g. message read (exponential with documented rate), commit pulled by collaborator (Bernoulli per minute) | Parameters in YAML, logged per label |
| 2.6 | Sequence mode: run a list of actions, verify recovery of the whole sequence. Needed for the detector. | |
| 2.7 | **Tests:** for every tool, (a) rollback of a reversible action restores exactly, (b) an irreversible action leaves non-zero residual, (c) the snapshot→diff round trip on a no-op is empty | Mandatory; CI-gated |

**Exit:** All tools pass 2.7. 100 consecutive random actions run without a sandbox crash. Median label time per action is under 5 s (needed for C2 within budget).

### Phase 3: Dataset generation and labeling, D3 (30 Nov 2026 – 10 Jan 2027) · MG lead

| # | Task |
|---|---|
| 3.1 | `generate.py`: sample (tool, args, initial state) with **cost-weighted sampling**, oversampling destructive tools so ≥ 15% of labels are irreversible (paper §VIII risk 4) |
| 3.2 | Sources: (a) synthetic random calls; (b) calls harvested from real agent trajectories on stock and augmented tau-bench / SWE-bench (gives the natural distribution); (c) the composition-pattern library for the detector (3.5) |
| 3.3 | Label each with the Phase 2 labeler → `{L, M, S, restored, residual_size, events}`. Store JSONL under DVC. |
| 3.4 | **Weight grid:** store L, M, S separately; U is computed at train time for each grid point (§4.8), never baked in |
| 3.5 | Composition-pattern library: ≥ 12 patterns (e.g. delete_backup→overwrite_primary, revoke_key→rotate, force_push→gc), each verified at sequence level |
| 3.6 | **Expert validation (C6):** stratified n = 150; DV and MG judge "is this label right?" with a rubric; report agreement and error categories |
| 3.7 | Splits: by **tool** (unseen-tool generalization) and by **domain** (C5). Freeze `splits/v1` with seed. |
| 3.8 | Datasheet (Gebru et al. format) |

**Exit:** C2 (≥ 10,000 labels) met; ≥ 15% irreversible; C6 reported; splits frozen; U_irrev frozen (§3.2).

### Phase 4: Undo-cost regressor + conformal, D4 (14 Dec 2026 – 24 Jan 2027) · DV lead

| # | Task |
|---|---|
| 4.1 | `features.py`: structural (tool one-hot, arg types, destructive flag, wildcard scope, n_targets), embedding of tool name + arg schema, state (is_production, sensitivity tag, recovery affordances remaining) |
| 4.2 | Lower (τ = 0.1) and upper (τ = 0.9) quantile heads; train on log(1+U). Tune on dev only. |
| 4.3 | CQR: conformity scores on the calibration split; Û⁺ = q̂_hi + Q̂_{1−α}; α ∈ {0.1, 0.05} |
| 4.4 | **Report M7:** pinball loss; coverage (C3); **under-prediction rate on irreversible actions** (most important number for safety); Spearman ρ; all of these per domain and on unseen tools |
| 4.5 | `perr.py`: P_err = calibrated combination (isotonic) of self-consistency agreement over k = 5 samples and a logistic classifier on features. Calibrate on dev; report ECE and reliability plot. |
| 4.6 | **Staged screen:** cheap features → if Û⁺ is clearly below or above the threshold band, skip sampling. Measure the fraction of calls that skip (drives M5 and M6). |
| 4.7 | Cross-check CQR against MAPIE on one split (test oracle) |

**Exit:** C3 met; under-prediction rate on irreversible actions reported; Paper I draft (§8) has its results table.

### Phase 5: Silent-irreversibility detector, D5 (11 Jan – 14 Feb 2027) · MG lead

| # | Task |
|---|---|
| 5.1 | `compositional.py`: typed resource graph `{resource → {primary, backup, snapshot, audit_copy}: alive?}` updated from executed calls; for a proposed call, compute affordances consumed; amplification A = big if it consumes the last one |
| 5.2 | `contextual.py`: gradient-boosted model predicting log amplification from trajectory features (last k calls, observed external events) |
| 5.3 | Train and validate on the composition library (3.5) + held-out patterns |
| 5.4 | Sequence-level evaluation suite: for each pattern, does Ũ⁺ = A·Û⁺ cross the threshold on the final, fatal call? Report recall on held-out patterns. |

**Exit:** Recall on held-out composition patterns reported. Ablation A1 is runnable.

### Phase 6: Escalation policy engine, D6 (1 Feb – 7 Mar 2027) · DV lead

| # | Task |
|---|---|
| 6.1 | `engine.py`: escalate iff P_err·Ũ⁺ > λ(b)·C_int |
| 6.2 | `budget.py`: cap = r escalations per 100 actions; λ(b) = 1 + κ·(1 − b_remaining/b_total)² (form frozen in pre-registration); per-rate, not per-task |
| 6.3 | Batching: non-blocking escalations within a window W (default 10 actions) merge into one review (counts as 1 in M2) |
| 6.4 | `thresholds.py`: per action class, choose the threshold minimizing realized cost (damage + interruptions) on dev, by grid search with the same 60-point budget as baselines |
| 6.5 | `audit.py`: append-only JSONL with hash chaining (each line includes the previous line's SHA-256), so tampering is detectable |
| 6.6 | `reviewer.py`: simulated reviewer with accuracy r (C7); optional human mode for the demo |

**Exit:** Unit tests for the budget (never exceeds the cap), batching, and audit-chain verification; A3/A4 are runnable.

### Phase 7: Integration, D7 (15 Feb – 11 Apr 2027) · MG lead, DV on proxy

| # | Task |
|---|---|
| 7.1 | `sdk.py`: `@guard(tool_name=...)` decorator + `with guard.session(task_id):` context manager |
| 7.2 | `mcp_proxy.py`: MCP server that lists downstream tools unchanged, gates `call_tool`, forwards approved calls; config = downstream endpoint only |
| 7.3 | Overhead benchmark: 10,000 calls through the proxy with a no-op tool → **M5** median and P99 |
| 7.4 | Minimal console (FastAPI + one page): review inbox, per-task timeline, audit log viewer. React is **optional**; plain server-rendered HTML is acceptable. |
| 7.5 | Wire tau-bench and SWE-bench agents through the proxy (eval harness uses the same code path as real use) |

**Exit:** One stock tau-bench task and one SWE-bench task run through the proxy with an identical result to the ungated run when Guardrail never escalates. M5 reported.

> **Decision rule (from the website):** if median added latency > 50 ms (*our number; confirm in pre-registration*), retune the staged screen before Phase 8. Do not evaluate with a gate that would be unusable.

### Phase 8: Main evaluation (1 Mar – 25 Apr 2027) · DV + MG

| # | Task |
|---|---|
| 8.1 | `harness.py`: for each (benchmark variant, seed, policy, threshold) run, record per action: call, P_err, Û⁺, A, decision, reviewer verdict, executed?, error label, U (measured post hoc in sandbox) |
| 8.2 | **Record once, replay many.** Run each agent episode once per seed with a *logging* gate that records every proposed call plus counterfactual labels, then replay all policies and thresholds offline. *Caveat:* replay is exact only if escalation does not change later agent behavior. Run a live validation on a 10% subset for each policy at the matched budget and report the gap. |
| 8.3 | Implement baselines B1–B8 (§1.4) on the replay interface |
| 8.4 | Sweep: 60 thresholds × 9 policies × 5 seeds × weight grid (§4.8) × r ∈ {0.8, 0.9, 1.0} |
| 8.5 | `metrics.py`: M1–M6 per run; `stats.py`: frontier interpolation, paired bootstrap over tasks, Wilcoxon over seeds, non-inferiority for P3 |
| 8.6 | Produce: Pareto frontier figure (one per benchmark variant), Table "M1 at matched M2" with CIs, overhead table |

**Weight grid (§4.8 / C4):** (w_L, w_M, w_S) ∈ {(1,1,0), (1,1,1), (1,1,5), (0.2,1,1), (1,0.2,1)}, normalized so the median recoverable U = 1. Headline = (1,1,1); all others in an appendix table.

**Exit:** P1–P4 evaluated (pass **or** fail; both are reportable), T1 reported, C4 and C7 reported.

### Phase 9: Ablations, generalization, write-up, D8 (5 Apr – 20 May 2027) · DV + MG

| # | Task |
|---|---|
| 9.1 | Ablations A0–A4 on the replay logs (cheap: no new agent runs) |
| 9.2 | **C5:** leave-one-domain-out training of regressor + detector; re-run Phase 8 metrics on the held-out domain |
| 9.3 | Update the paper: replace §VI "Synthetic analysis" with the real results; keep the synthetic study as motivation; update the abstract, conclusion, and threats |
| 9.4 | Release: taxonomy, sandbox, dataset (with datasheet), models, proxy; reproducibility README with exact commands |
| 9.5 | Final report, demo (proxy + console on a scripted scenario), viva prep |

**Exit:** Paper II submitted; repo tagged `v1.0`; demo rehearsed.

---

## 5. Timeline (revised from the synopsis Gantt)

| Weeks (2026–27) | Nov | Dec | Jan | Feb | Mar | Apr | May |
|---|---|---|---|---|---|---|---|
| P0 Setup | ■ | | | | | | |
| P1 Taxonomy (D1) | ■■■ | | | | | | |
| P2 Sandbox (D2) | ■■■ | ■■ | | | | | |
| P3 Dataset (D3) | | ■■■■ | ■ | | | | |
| P4 Regressor (D4) | | ■■ | ■■■ | | | | |
| P5 Detector (D5) | | | ■■■ | ■■ | | | |
| P6 Policy (D6) | | | | ■■■■ | ■ | | |
| P7 Integration (D7) | | | | ■■ | ■■■■ | ■ | |
| P8 Evaluation | | | | | ■■■■ | ■■■ | |
| P9 Ablations + writing (D8) | | | | | | ■■■ | ■■■ |

**Milestones**

| Date | Milestone | Gate (agree with guide) |
|---|---|---|
| 8 Nov 2026 | Pre-registration signed | Definitions in §3 frozen |
| 22 Nov | Taxonomy v1.0 | C1 |
| 13 Dec | Sandbox passes all rollback tests | Phase 2 exit |
| 10 Jan 2027 | Dataset ≥ 10k frozen | C2, C6 |
| 24 Jan | **Paper I** (taxonomy + sandbox + dataset + regressor) submitted to a workshop | Synopsis: "a paper per semester" |
| 7 Mar | Policy engine done | Phase 6 exit |
| 11 Apr | Proxy overhead within budget | M5 decision rule |
| 25 Apr | Main results | P1–P4 evaluated |
| 20 May | **Paper II**, report, demo | D8 |

Slack: the synopsis reserves March–April. Here the slack lives in the overlap between P7 and P8: if P7 slips, P8 can start on the SDK path while the proxy finishes.

---

## 6. Compute and cost budget (estimates; confirm in Phase 0)

| Item | Estimate | Basis / assumption |
|---|---|---|
| Benchmark tasks | tau-bench retail + airline test splits; SWE-bench **Lite** (300) | Use Lite rather than Verified to fit budget |
| Agent episodes | (tau-bench tasks + 300) × 5 seeds × 2 variants (stock, augmented) | Record-once/replay (8.2) avoids ×policies×thresholds |
| P_err sampling | k = 5 extra samples on calls that pass the staged screen | Expect the screen to skip most calls; measure it |
| LLM | One mid-size hosted model for the agent; the same or smaller for B5 | Free tier / academic credits per synopsis; **check credits before Phase 8** |
| GPU | Colab/Kaggle T4 for embeddings + B8 training | Regressor and detector run on CPU |
| Storage | ~100 GB for snapshots, trajectories, logs | Synopsis |

If credits are short: (1) drop to 3 seeds and say so; (2) cut SWE-bench to a 100-task stratified subset; (3) keep the full tau-bench, where the mock DB makes rollback cheap. Each cut is a reported deviation from pre-registration.

---

## 7. What we deliberately do not build

- Full React console: a server-rendered page covers the review inbox, timeline, and audit log.
- Communication and network domains: future work (paper §IX).
- Adversarial prompt-injection defense: out of scope (paper §VIII).
- Real human-reviewer fatigue study: modeled by r only (C7); cited as Turan [29].
- Multi-agent settings: one agent, one task (synopsis scope).

---

## 8. Risks and decision points

| Risk | Early signal | Response |
|---|---|---|
| M1 ≈ 0 on stock benchmarks | Phase 0.5 trial runs show no destructive calls | Augmented variants (§3 box); decide in week 1 |
| Sandbox U diverges from real cost | C6 agreement < 80% | Revise labeler; report agreement as a limitation |
| Too few irreversible labels | < 15% at 5k labels | Increase cost-weighted sampling; add composition patterns |
| Conformal coverage off | C3 fails on the unseen-tool split | Report per-split coverage; use Mondrian (per-domain) conformal |
| B4 matches Guardrail | Phase 8 frontier overlap | **Report it as a finding** (paper §VII says so in advance) |
| Replay ≠ live | 8.2 validation gap > 2 pp | Run live for the headline policies; replay only for sweeps |
| Proxy too slow | M5 median > 50 ms | Retune the screen; cache embeddings per tool |
| Schedule slip | Any phase exit > 1 week late | Cut in the order of §6; tell the guide at the next review |

---

## 9. Working agreement

- **Weekly:** Monday 30-min sync (what passed exit criteria, what is blocked); Friday push with green CI.
- **Guide reviews:** at each milestone in §5, show the exit-criteria checklist rather than a demo.
- **Branches:** `main` protected; one branch per task ID (e.g. `p2-verifier`); PR review by the other person.
- **Reproducibility:** every result in the paper comes from an `experiments/configs/*.yaml` + MLflow run ID + DVC data hash. No numbers are copied by hand.
- **AI assistance:** keep a short log of where AI tools were used (code, text, search). The paper's Acknowledgment must stay accurate as the project evolves.

---

## 10. Traceability: paper promise → where it is delivered

| Paper statement | Delivered in |
|---|---|
| Taxonomy released as spec + JSON schema, IAA on 200 actions (§IV-A) | P1, C1 |
| Snapshot → execute → rollback → residual diff; L measured, M from ledger, S assigned (§IV-B) | P2 |
| Stochastic external events, documented parameters (§IV-B) | P2.5 |
| ≥ 10,000 labeled actions (§IV-B) | P3, C2 |
| Pinball loss τ > 0.5 + CQR, policy uses Û⁺ (§IV-C) | P4 |
| P_err = self-consistency + calibrated classifier; staged gate; overhead measured (§IV-C) | P4.5–4.6, M5–M6 |
| Contextual + compositional heads; composition patterns verified in sandbox (§IV-D) | P5 |
| Per-class thresholds, rate cap, λ(b), batching, imperfect reviewer, audit log (§IV-E) | P6 |
| MCP proxy, SDK, minimal console (§IV-F) | P7 |
| Baselines B1–B6 + POLAR + Liu et al. adaptations, equal tuning budget (§V-A) | §1.4, P8.3 |
| Metrics M1–M7 (§V-B) | §1.1, P8.5 |
| Pass conditions, 40% target, bootstrap + Wilcoxon, 5 seeds, held-out domain, ablations (§V-C) | §1.2, §1.5, P8–P9 |
| Weight grid (§III-A, §VIII) | §4.8, C4 |
