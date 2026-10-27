# Phase 1: Irreversibility Taxonomy (D1)

**Dates:** 2–22 Nov 2026 · **Lead:** MG (DV labels for agreement) · **Depends on:** Phase 0 notes on tool sets · **Produces:** `spec.md`, `schema.json`, `tools.yaml`, agreement report, tag `taxonomy-v1.0`.
**Metric unlocked:** C1 (κ ≥ 0.6 per axis).

---

## 1.1 Tool inventory (MG, days 1–4)

Build `guardrail/taxonomy/inventory.csv` with one row per write-capable tool:

| Source | How to enumerate |
|---|---|
| tau-bench retail and airline | Every tool class whose `invoke` mutates the env data dict (read-only `get_*`, `find_*`, `list_*`, `calculate` tools excluded) |
| SWE-bench (bash agent) | One tool, `bash`, split into **command families** by the first token and flags: `rm`, `rm -rf`, `mv`, `cp`, `git commit`, `git reset --hard`, `git push --force`, `git branch -D`, `git clean -fd`, file writes (`>`, `sed -i`, editor), package installs |
| Augmented tools (Phase 0 decision) | `delete_backup`, `restore_backup`, `overwrite_primary`, `send_email`, `recall_email`, `issue_refund`, `charge_card`, `rotate_api_key`, `revoke_api_key`, `deploy`, `rollback_deploy` |

Target: at least 60 rows. For bash, each command family is a row, because the taxonomy is per behavior, not per binary.

## 1.2 The specification (MG, days 3–8)

`guardrail/taxonomy/spec.md` must let a person who has never seen the project label a call the same way you would. For each axis, include:

1. A one-sentence definition.
2. Each allowed value with a **decision rule** phrased as a test ("If a single later call restores every changed item to its byte-identical prior value → `exact_inverse`").
3. Three worked examples per value, including at least one borderline case and the reason for the label.

| Axis | Values | Decision rule sketch |
|---|---|---|
| Domain | `fs`, `git`, `ledger`, `outbox` | Which state store the call writes to. A call writing to two stores is labeled by the one with the worse rollback. |
| Rollback | `exact_inverse`, `compensating`, `partial`, `none` | Exact: byte-identical restore. Compensating: a different action offsets the effect but leaves a record (refund after charge). Partial: some state comes back. None: nothing comes back. |
| Externality | `contained`, `cross_org`, `third_party` | Does the effect leave our system? Outbox to an internal address = `cross_org`; to a customer or regulator = `third_party`. |
| Latency sensitivity | half-life in seconds | How quickly reversibility decays: unread email recall window, reflog expiry, payment settlement time |

## 1.3 Schema and annotations (DV, days 5–8)

`guardrail/taxonomy/schema.json` (JSON Schema 2020-12), mirroring `ToolSpec`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["name", "domain", "rollback", "externality", "latency_sensitivity", "destructive"],
  "properties": {
    "name": {"type": "string", "pattern": "^[a-z0-9_.:-]+$"},
    "domain": {"enum": ["fs", "git", "ledger", "outbox"]},
    "rollback": {"enum": ["exact_inverse", "compensating", "partial", "none"]},
    "externality": {"enum": ["contained", "cross_org", "third_party"]},
    "latency_sensitivity": {"type": "number", "minimum": 0},
    "destructive": {"type": "boolean"},
    "notes": {"type": "string"}
  },
  "additionalProperties": false
}
```

`guardrail/taxonomy/tools.yaml`: one entry per inventory row. Loader:

```python
# guardrail/taxonomy/__init__.py
def load_specs(path: str = DEFAULT_PATH) -> dict[str, ToolSpec]:
    """Validate every entry against schema.json; raise on the first invalid one."""
```

Use `float("inf")` for "never decays". In YAML write `.inf`. JSON Schema has no infinity, so the loader maps `.inf` to a large sentinel before validation.

## 1.4 Agreement study (DV + MG, days 9–15)

1. `scripts/sample_iaa.py --n 200 --seed 0`: draw 200 **instances** (tool + concrete args + a one-line state description), stratified by domain (50 each). Instances, not tool names, because the same tool can be reversible or not depending on args (e.g. `git push` vs `git push --force`).
2. Each of you labels all 200 in a separate copy of `iaa_labels_{dv,mg}.csv`, **using only `spec.md`**. No discussion until both files are committed.
3. `scripts/iaa.py`: Cohen's κ per categorical axis (`sklearn.metrics.cohen_kappa_score`). For latency sensitivity, compute weighted κ on log-binned values (bins: <1 min, <1 h, <1 day, <30 days, never).
4. If any axis has κ < 0.6: read the disagreements, **change the spec wording, not the labels**, sample a fresh 50, and repeat. Maximum two rounds.
5. Write `taxonomy/agreement_report.md` with κ per axis per round, the confusion matrix for the worst axis, and the spec changes made.

## 1.5 Freeze (day 15)

- `git tag taxonomy-v1.0`.
- From now on, changes to `spec.md` or `tools.yaml` need a new tag and a note in the agreement report.

## 1.6 Downstream artifacts written now (before any data exists)

- **B4 deny list** (`eval/baselines/denylist.yaml`): written from the spec alone, then frozen. Writing it after seeing the dataset would leak information into the baseline.
- **POLAR ontology for B7** (`eval/baselines/polar_ontology.yaml`): map each tool to POLAR's tiers T1–T5 (exact inverse, bounded reversibility, compensation, irreversibly consumes, external side effect), using POLAR's per-tool decision table.

## Tests

- `test_taxonomy_schema.py`: every `tools.yaml` entry validates; names are unique; every inventory row has an entry.
- `test_iaa.py`: κ = 1 for identical label files, κ ≈ 0 for shuffled ones.

## Exit checklist

- [ ] ≥ 60 tools annotated; schema test green
- [ ] κ ≥ 0.6 on all four axes, or the shortfall documented as a limitation
- [ ] `agreement_report.md` committed
- [ ] `taxonomy-v1.0` tagged
- [ ] B4 deny list and POLAR ontology frozen
