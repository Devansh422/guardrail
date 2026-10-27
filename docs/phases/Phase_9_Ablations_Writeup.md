# Phase 9: Ablations, Generalization, Release and Write-up (D8)

**Dates:** 5 Apr – 20 May 2027 · **Owners:** DV + MG · **Depends on:** Phase 8 recorded logs and sweep code · **Produces:** ablation and generalization results, updated paper (Paper II), public release, final report, demo.

---

## 9.1 Ablations (`experiments/configs/ablation_*.yaml`)

All ablations run on the **Phase 8 replay logs**, with no new agent runs, except where a component changes what is recorded.

| ID | Change | Config switch | Needs re-record? |
|---|---|---|---|
| A0 (primary) | P_err fixed at the dev-split mean | `policy.p_err_mode: constant` | No |
| A1 | Detector off | `detector.enabled: false` (amp = 1) | No: `u_upper` is logged before amplification |
| A2 | No conformal: use raw τ = 0.9 head | `models.conformal: false` | No: log both values during recording |
| A3 | One global threshold | `policy.per_class: false` | No |
| A4 | No budget, no λ(b) | `policy.use_budget: false` | No |

**Make sure the Phase 8 recording logs `u_upper_raw` (pre-conformal) and `amp` separately.** Otherwise A1 and A2 require a re-record. Add both fields to the record schema in Phase 8.1 if they are missing.

For each ablation, report the same matched-budget table as the main result, plus the **difference from full Guardrail** with a paired-bootstrap CI.

**How to read A0.** If A0 alone dominates B2/B2+ (P1 at all budgets), the central claim holds regardless of how P_err is estimated. Say so explicitly in the paper. If it does not, the paper's claim is weaker, and the paper must say that too.

## 9.2 Held-out domain generalization (C5)

For each of the three domains (fs, git, transactional = ledger + outbox):

1. Retrain the regressor, conformal calibration and contextual head on the **other two** domains (Phase 3 domain-out splits).
2. Refit per-class thresholds only on classes present in the training domains. Unseen classes fall back to the global threshold.
3. Replay the held-out domain's calls and report M1–M4 at matched budgets, plus M7 (coverage, under-prediction on irreversible).

Expect coverage to drop. Mondrian conformal (Phase 4 fallback) is the planned mitigation. Report both.

## 9.3 Paper II: update the paper

Edit `docs/Guardrail_Research_Paper_FINAL.docx` (or move to the venue's IEEE template first):

| Section | Change |
|---|---|
| Abstract | Replace the synthetic numbers with the real headline (M1 at 1/task vs B2 and B2+, with CI) and the P1–P4 outcome |
| IV | Switch future tense to past tense **only for components that were actually built**. Note any design changes (e.g. `max` combination in the detector, hard-floor rule). |
| V | Add the deviations from pre-registration, if any, with reasons |
| VI | Rename to "Experimental Results". Add the real frontiers, tables and ablations. Keep the synthetic study as a short motivation subsection or move it to an appendix. |
| VII | Discuss what passed and what failed; whether A0 dominates; whether B4 matched |
| VIII | Update the threats: replay-vs-live gap, augmentation choice, seed count |
| IX | Rewrite the conclusion around the actual result |
| References | Add the benchmark and tool citations actually used |

Every number in the paper comes from `eval/report.py` output. Diff the paper's numbers against `results/` before submitting.

## 9.4 Release

| Artifact | Where | Notes |
|---|---|---|
| Code | GitHub, tag `v1.0` | README with install, quick-start (SDK + proxy), and "reproduce the paper" commands |
| Taxonomy | `guardrail/taxonomy/` | `spec.md`, `schema.json`, `tools.yaml`, agreement report |
| Dataset | Hugging Face Datasets or Zenodo (DOI) | `actions.jsonl`, splits, datasheet, license (CC BY 4.0 suggested) |
| Models | Release assets or Hugging Face | Regressor, CQR quantiles, P_err calibrator, contextual head |
| Results | `results/` | `sweep.parquet`, the replay logs, MLflow export |

**Reproduce script** (`scripts/reproduce_paper.sh`): `dvc pull` → `eval/sweep.py` → `eval/report.py`, regenerating every figure and table from the released logs without API keys. Re-recording the agent runs is a separate, documented, optional step.

## 9.5 Final report and demo

- **Report:** the department format; reuse the paper's sections plus implementation detail, test summary and timeline vs plan.
- **Demo script (≈ 5 min):**
  1. An agent working through the MCP proxy on the augmented ledger task.
  2. A cheap call executes silently.
  3. A high-cost refund escalates and appears in the console inbox; reject it.
  4. The backup → overwrite sequence: the second call is caught by the detector.
  5. Open the audit log and show chain verification.
  6. Show the frontier figure.
- **Viva prep:** be ready to explain the decision rule, why confidence alone fails, CQR coverage, the replay bias, and every deviation from pre-registration.

## Exit checklist

- [ ] A0–A4 tables with CIs
- [ ] C5 results for all three held-out domains
- [ ] Paper II updated, numbers diffed against `results/`, submitted
- [ ] Release published; `reproduce_paper.sh` tested on a clean machine
- [ ] Final report submitted; demo rehearsed twice
