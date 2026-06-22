# OWEN — Parameter Sweep Validation Plan

A hands-on plan for validating the **OWEN** parametric sweep
(`OWEN: Run Parameter Sweep` → `owen.runSweep` → `src/workflows/sweep.ts`,
pure core in `src/workflows/sweepCore.ts`). Every step is grounded in the real
extension source — no aspirational features.

The sweep:

1. Reads a JSON config (you pick it in a file dialog).
2. Computes the **cartesian product** of all parameter value lists
   (`cartesian` in `sweepCore.ts`).
3. For each combination, regex-substitutes values into the base file
   (`applyParameters` — replaces **capture group 1**, or the whole match if the
   pattern has no group).
4. Writes the mutated input to `sweep_out/run_NNN/<baseName>` (`runDirName`,
   zero-padded to three digits).
5. Runs each case via the same launch planner as `OWEN: Run Simulation`
   (`planLaunch` — for OpenMC it runs `<owen.openmc.pythonExecutable> <file>`).
6. Scrapes k-eff from stdout (`parseKeff`: Serpent "final estimated … keff",
   OpenMC "Combined k-effective = …", then a generic `k-eff = …` fallback).
7. Writes `sweep-manifest.json` and `sweep-summary.tsv` in the output dir.

> **Language detection:** if the config omits `"language"`, OWEN infers it from
> the **base file extension** (`.i/.mcnp/.inp` → MCNP, `.serp` → Serpent,
> `.scone` → SCONE, `.py` → OpenMC only if it contains `import openmc`, else
> falls back to MCNP). For `.py` base files, **set `"language": "openmc"`
> explicitly** to be safe — see `languageForFile` in `sweep.ts`.

---

## 0. Prerequisites (do this once)

Build the extension and have OpenMC working (the sweep shells out to your
OpenMC Python).

```bash
cd owen
npm install
npm run typecheck     # esbuild does not type-check
npm run compile       # produces out/extension.js
```

Launch the Extension Development Host (**F5**) or install the packaged VSIX.

OpenMC sanity check (in the interpreter `owen.openmc.pythonExecutable` points
at):

```bash
python -c "import openmc; print(openmc.__version__)"
echo $OPENMC_CROSS_SECTIONS   # must be set for any real run
```

> **Without OpenMC + cross sections**, every run still produces a `run_NNN/`
> dir with a mutated input and an `owen-sweep.log`, but k-eff will be `n/a` and
> the exit code non-zero. That validates steps 1–4 and 7 (the pure layout) but
> not the physics. Use the **Automated unit tests** section below to validate
> the pure logic deterministically with no OpenMC at all.

---

## Scoring rubric

| Score | Meaning |
|---|---|
| **Pass** | Behaves as described; outputs correct and usable. |
| **Partial** | Runs but with caveats (k-eff `n/a`, manual fixups, etc.). |
| **Fail** | Errors, does nothing, or produces unusable output. |
| **Blocked** | Couldn't test (no OpenMC, no cross sections, no internet). |

---

## Automated unit tests (no OpenMC needed)

The pure sweep core is unit-tested in `src/test/suite/sweep.test.ts` (Mocha
`tdd` UI, run via `@vscode/test-electron`):

```bash
cd owen
npm run compile
npm test
```

Coverage:

- **Parameter expansion** — single param, two-param cartesian product (first
  param varies slowest), and the empty-schema `[{}]` case.
- **Text substitution** — capture-group-1 replacement preserving surrounding
  text; whole-match replacement when there's no group; multiple independent
  parameters.
- **k-eff parsing** — OpenMC "Combined k-effective", the generic `k-eff = …`
  fallback, an **increasing-enrichment → increasing-k-eff** trend, and the
  **miss → `null`** cases (empty stdout, a segfault line, a missing-XS error)
  which the summary renders as `n/a`.
- **Run layout / manifest / summary** — `run_000/007/123` zero-padding, manifest
  shape (base file, language, schema, all runs), and the TSV (header + one row
  per run, `null` k-eff → `n/a`).

**Pass criteria:** `npm test` reports all sweep suites green.

---

# Manual scenarios

## Canonical base input — `pincell.py`

Use the canonical OpenMC pin cell from
[`OPENMC_EVALUATION.md`](./OPENMC_EVALUATION.md), but make the enrichment a
single regex-addressable token. The relevant lines:

```python
uo2.add_nuclide('U235', 0.040, percent_type='ao')
uo2.add_nuclide('U238', 0.960, percent_type='ao')
```

Only the `U235` line is swept; `U238` stays fixed (so the sweep is not
mass-conserving — that's fine for a trend check, see caveats).

---

## S1 — Enrichment sweep, single parameter (the workhorse)

**Goal:** four runs at increasing U-235 enrichment; k-eff should rise
monotonically.

**Config — save as `sweep.json` next to `pincell.py`:**

```json
{
  "baseFile": "pincell.py",
  "language": "openmc",
  "output": { "dir": "sweep_out" },
  "parameters": [
    {
      "name": "enrichment",
      "values": [0.02, 0.03, 0.04, 0.05],
      "pattern": "add_nuclide\\('U235', ([0-9.]+)"
    }
  ]
}
```

**Steps:**
1. Command Palette → **OWEN: Run Parameter Sweep**.
2. Pick `sweep.json`.
3. Watch the progress notification count `run 1/4 … 4/4`.

**Expected / pass criteria:**

- `sweep_out/run_000`, `run_001`, `run_002`, `run_003` each created.
- Each `run_NNN/pincell.py` has the enrichment substituted
  (`run_000` → `0.02`, …, `run_003` → `0.05`); the rest of the file is
  byte-identical to the base.
- Each `run_NNN/owen-sweep.log` contains OpenMC's console output
  (including `Combined k-effective = …`) and a `statepoint.100.h5` sits in the
  run dir.
- `sweep_out/sweep-manifest.json` lists all 4 runs with `parameters`, `keff`,
  `exitCode`, and paths.
- `sweep_out/sweep-summary.tsv` looks like:

  ```
  index   enrichment      exit    keff
  0       0.02            0       0.9xxxx
  1       0.03            0       1.0xxxx
  2       0.04            0       1.1xxxx
  3       0.05            0       1.2xxxx
  ```

  with **k-eff strictly increasing down the column**. Exact values depend on
  your cross-section library/temperature.

**Fail/Partial flags:** k-eff column `n/a` (parser missed OpenMC's stdout, or
OpenMC didn't run → check the log); non-zero `exit`; k-eff not monotonic
(suspect the regex hit the wrong line or a non-mass-conserving artifact).

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## S2 — Two-parameter grid (cartesian product)

**Goal:** confirm the full cartesian product and run ordering. Add pitch (edit
the base so the moderator box width is a token, e.g.
`RectangularPrism(width=1.26, height=1.26 …)` → make `width=([0-9.]+)`
substitutable).

**Config:**

```json
{
  "baseFile": "pincell.py",
  "language": "openmc",
  "output": { "dir": "grid_out" },
  "parameters": [
    { "name": "enrichment", "values": [0.03, 0.05], "pattern": "add_nuclide\\('U235', ([0-9.]+)" },
    { "name": "pitch",      "values": [1.26, 1.40], "pattern": "RectangularPrism\\(width=([0-9.]+)" }
  ]
}
```

**Expected / pass criteria:** **4 runs** in this order (first parameter varies
slowest):

| index | enrichment | pitch |
|---|---|---|
| 000 | 0.03 | 1.26 |
| 001 | 0.03 | 1.40 |
| 002 | 0.05 | 1.26 |
| 003 | 0.05 | 1.40 |

The TSV has both parameter columns. Note: changing `width` alone leaves
`height` (and the source box) at 1.26 — for a real pitch study make both
substitutable. **Caveat documented**, not a bug.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## S3 — k-eff miss path (→ `n/a`)

**Goal:** confirm graceful `n/a` when stdout has no k-eff.

**Steps:** point `baseFile` at a `.py` that prints nothing parseable (e.g. a
script that imports openmc and exits, or deliberately set
`owen.openmc.pythonExecutable` to an interpreter without OpenMC so it errors).
Run S1's config.

**Expected / pass criteria:** runs still produce `run_NNN/` dirs + logs; the
`keff` column is `n/a` and `exit` is non-zero (or `n/a` if the executable
couldn't launch). No crash, manifest still written. This mirrors the
`parseKeff → null` unit cases.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## S4 — Serpent / MCNP base file (language inference)

**Goal:** confirm non-OpenMC languages work and language is inferred from the
extension.

**Steps:** use a Serpent `pincell.serp` with a sweepable enrichment token and a
config that **omits** `"language"`. The base ext `.serp` → Serpent; `planLaunch`
runs `<owen.serpent.executable> <file>`. (Same idea for `.i`/`.inp` → MCNP.)

**Expected / pass criteria:** runs launch the Serpent/MCNP executable; if the
solver is installed and prints its k-eff line, the TSV's k-eff column is
populated via the Serpent/`k-eff` regex. Without the solver installed →
**Blocked** (environment), runs+logs still created.

**Score:** ☐ Pass ☐ Partial ☐ Fail ☐ Blocked — notes: ________________

---

## Known caveats

Honest read of the current code (`sweep.ts` / `sweepCore.ts`):

1. **Substitution is regex-on-text, not semantic.** `applyParameters` replaces
   the **first** match of each pattern per file (capture group 1, or the whole
   match if no group). A pattern that matches multiple lines only rewrites the
   first; an over-broad pattern can hit the wrong token. Test your regex on one
   file first.
2. **Not mass-conserving.** Sweeping only the U-235 fraction (S1) leaves U-238
   fixed, so totals drift. Fine for a trend; for publishable numbers sweep a
   conserving parameterization.
3. **k-eff scraping is regex-based.** Anything that suppresses/redirects the
   solver's console output yields `n/a` (the parser needs the literal
   "Combined k-effective" / Serpent keff / `k-eff =` text in stdout).
4. **Runs are sequential** and **not cancellable** mid-sweep (the progress
   notification has `cancellable: false`). A large grid runs every cell.
5. **Environment-dependent.** Each run uses `planLaunch`, so
   `owen.openmc.pythonExecutable` (and `OPENMC_CROSS_SECTIONS`) /
   `owen.serpent.executable` / `owen.mcnp.executable` must be valid, else runs
   fail for environment reasons (Blocked, not an OWEN bug).
6. **`.py` language inference needs `import openmc`.** A `.py` base without it
   falls back to MCNP — always set `"language": "openmc"` for OpenMC scripts.

---

## Results summary (fill in)

| Scenario | What it checks | Score | Notes |
|---|---|---|---|
| Unit tests | Pure core (expansion, subst, k-eff, layout) | | |
| S1 | Enrichment sweep, k-eff trend | | |
| S2 | Two-parameter cartesian grid | | |
| S3 | k-eff miss → n/a | | |
| S4 | Serpent/MCNP language inference | | |
