"""Synthetic sanity check: confidence gating vs consequence-aware gating.
Not benchmark evidence; every distribution below is an assumption stated in the paper."""
import numpy as np, json, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

T, K, R_ACC, IRREV, SILENT = 20000, 20, 0.9, 100.0, 0.25  # tasks, actions/task, reviewer accuracy, irreversibility cut, silent share

def population(rho, seed):
    rng = np.random.default_rng(seed)
    z = rng.multivariate_normal([0, 0], [[1, rho], [rho, 1]], size=(T, K))
    from math import erf
    u01 = 0.5 * (1 + np.vectorize(erf)(z[..., 0] / np.sqrt(2)))
    c = np.clip(np.quantile(rng.beta(8, 2, 200000), u01), 1e-3, 1 - 1e-3)  # confidence, marginal Beta(8,2)
    q = 0.5 * (1 + np.vectorize(erf)(z[..., 1] / np.sqrt(2)))               # cost rank
    U = np.where(q < 0.90, rng.lognormal(0, 0.5, (T, K)),                   # 90% cheap
        np.where(q < 0.98, rng.lognormal(2.5, 0.5, (T, K)),                 # 8% costly but recoverable
                 rng.lognormal(6.5, 0.5, (T, K))))                          # 2% effectively irreversible
    err = rng.random((T, K)) < (1 - c)                                       # calibrated: P_err = 1 - c
    caught = rng.random((T, K)) < R_ACC
    Uhat = U * rng.lognormal(0, 1.0, (T, K))                                 # imperfect undo-cost estimate
    silent = (U >= IRREV) & (rng.random((T, K)) < SILENT)                    # irreversible calls that look cheap in isolation
    Uhat = np.where(silent, rng.lognormal(0, 0.5, (T, K)), Uhat)
    return c, U, Uhat, err, caught

def evaluate(esc, U, err, caught):
    harmful = err & (U >= IRREV) & ~(esc & caught)
    return esc.sum(1).mean(), harmful.any(1).mean() * 100  # interruptions/task, irreversible-error %

def sweep(score, U, err, caught, n=60):
    qs = np.unique(np.quantile(score, np.r_[0, np.geomspace(1e-4, 0.5, n)]))
    return np.array([evaluate(score <= t, U, err, caught) for t in qs])

def at_budget(curve, b=1.0):
    x, y = curve[:, 0], curve[:, 1]
    o = np.argsort(x)
    return float(np.interp(b, x[o], y[o]))

out, curves = {}, {}
for rho, name in [(0.0, "independent"), (-0.3, "correlated")]:
    c, U, Uhat, err, caught = population(rho, 7)
    pol = {
        "B1 No gating": None,
        "B2 Confidence gate": c,                       # escalate when c <= t
        "Consequence only (P_err const.)": -Uhat,
        "Guardrail rule (P_err x U_hat)": -(1 - c) * Uhat,
        "B6 Oracle": -(err * U),
    }
    res = {}
    for k, s in pol.items():
        if s is None:
            res[k] = {"irrev_pct@1": evaluate(np.zeros_like(err), U, err, caught)[1]}
            continue
        cv = sweep(s, U, err, caught)
        curves[(name, k)] = cv
        res[k] = {f"irrev_pct@{b}": at_budget(cv, b) for b in (0.25, 0.5, 1.0, 2.0)}
    out[name] = res
    assert res["Guardrail rule (P_err x U_hat)"]["irrev_pct@1.0"] <= res["B2 Confidence gate"]["irrev_pct@1.0"]

print(json.dumps(out, indent=1))
json.dump(out, open("sim_results.json", "w"), indent=1)

plt.rcParams.update({"font.family": "Times New Roman", "font.size": 9})
fig, ax = plt.subplots(figsize=(3.4, 2.5), dpi=300)
style = {"B2 Confidence gate": ("k", "-", "o"), "Consequence only (P_err const.)": ("0.45", "--", "s"),
         "Guardrail rule (P_err x U_hat)": ("k", "-", "^"), "B6 Oracle": ("0.6", ":", None)}
for k, (col, ls, mk) in style.items():
    cv = curves[("independent", k)]
    o = np.argsort(cv[:, 0]); m = cv[o][cv[o][:, 0] <= 6]
    lab = k.replace("P_err x U_hat", r"$P_{err}\times\hat{U}$").replace("P_err", r"$P_{err}$")
    ax.plot(m[:, 0], m[:, 1], color=col, ls=ls, marker=mk, markevery=5, ms=3, lw=1, label=lab)
ax.axhline(out["independent"]["B1 No gating"]["irrev_pct@1"], color="0.7", lw=0.8, ls="-.", label="B1 No gating")
ax.set_xlabel("Interruptions per task"); ax.set_ylabel("Irreversible-error rate (% of tasks)")
ax.set_xlim(0, 3); ax.set_ylim(0, None); ax.legend(fontsize=6.5, frameon=False, loc="center right"); ax.grid(alpha=0.25, lw=0.5)
fig.tight_layout(); fig.savefig("fig_frontier.png")

# Fig. 1: one population sample in the (confidence, undo cost) plane with both decision boundaries.
c, U, Uhat, err, caught = population(0.0, 11)
c, U = c.ravel()[:3000], U.ravel()[:3000]
fig, ax = plt.subplots(figsize=(3.4, 2.9), dpi=300)
irr = U >= IRREV
ax.scatter(c[~irr], U[~irr], s=2, c="0.65", lw=0, label="Recoverable call")
ax.scatter(c[irr], U[irr], s=6, c="k", marker="x", lw=0.6, label="Irreversible call")
ax.axvline(0.7, color="k", ls="--", lw=0.9, label="Confidence gate ($c$ = 0.7)")
cc = np.linspace(0.3, 0.999, 200)
ax.plot(cc, 15 / (1 - cc), color="k", lw=1.1, label=r"$P_{err}\cdot U = C_{int}$")
ax.set_yscale("log"); ax.set_xlim(0.3, 1.0); ax.set_ylim(0.1, 1e4)
ax.set_xlabel("Model confidence $c$"); ax.set_ylabel("Cost to undo $U$ (log scale)")
ax.legend(fontsize=6.5, frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.2), ncol=2); ax.grid(alpha=0.25, lw=0.5)
fig.tight_layout(); fig.savefig("fig_plane.png", bbox_inches="tight", pad_inches=0.03)
