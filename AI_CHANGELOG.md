# OWEN — AI Changelog

Engineering changelog for the **OWEN** VS Code / Cursor extension, in reverse
chronological order. Each entry records **what** changed, **why**, and any caveats future
maintainers (human or AI) should know.

This is the engineering-level log. User-facing release notes live in `CHANGELOG.md`. The
division-wide changelog is `AI_CHANGELOG.md` in the BelvoirDynamics monorepo root.

> OWEN is mirrored between the monorepo (`BelvoirDynamics/owen/`) and the public repo
> (`caalh/owen`). Changes are applied to both copies — see `AI_MAINTAINER_GUIDE.md` §9.

---

## 2026-06-02 — AI maintainer docs + "Workspace" branding

**AI Agent:** Claude (Cursor IDE)

- **Added AI docs** (this file, `AI_MAINTAINER_GUIDE.md`, `PROJECT_STRUCTURE.md`,
  `AGENTS.md`) so future agents have the same guidance the monorepo provides. They capture
  the activation flow, esbuild bundling, the lazy-Supabase rule, publish steps, the
  retired-name history, and the monorepo ↔ public sync relationship.
- **Branding:** the OWEN tagline is **"Open Workspace for Engineered Neutronics"**. Fixed
  the lagging "Open Workflow…" copies in `README.md` and `CHANGELOG.md` (the `package.json`
  `displayName` had already been updated). Generic "workflow automation" feature phrasing
  and the `src/workflows/` / `.github/workflows/` names were intentionally left unchanged.

---

## 2026-06-02 — `displayName`: "Workflow" → "Workspace"

**AI Agent:** Claude (Cursor IDE)

- Renamed `package.json` `displayName` from "OWEN — Open Workflow for Engineered
  Neutronics" to **"OWEN — Open Workspace for Engineered Neutronics"**. Title-only change;
  the extension `name`, `publisher`, and `owen.*` command ids were unchanged.

---

## 2026-06-02 — Extension id renamed to `owen-neutronics`

**AI Agent:** Claude (Cursor IDE)

- `package.json` `name` changed from `owen` to **`owen-neutronics`** (the bare `owen` id was
  unavailable/ambiguous on the registries). Full extension id is now
  `belvoirdynamics.owen-neutronics`; Marketplace/Open VSX URLs, the README badges, and the
  VSIX filename were updated to match.
- **Caveat:** changing `name` again would orphan existing installs. Treat `owen-neutronics`
  as stable.

---

## 2026-06-02 — Activation fix: esbuild bundling + lazy Supabase import

**AI Agent:** Claude (Cursor IDE)

- **Bug:** the extension failed to activate. A top-level `import` of
  `@supabase/supabase-js` was evaluated at load time and, when the dependency wasn't
  resolvable in the packaged VSIX, took down activation for *every* command — not just the
  community feature.
- **Fix (two parts):**
  1. **esbuild bundling** (`esbuild.js`): `src/extension.ts` is now bundled into a single
     CommonJS `out/extension.js` with `vscode` external. `.vscodeignore` drops
     `node_modules/` and `src/`, so runtime deps must be bundled to ship — esbuild now does
     that.
  2. **Lazy Supabase import** (`src/community/client.ts`): `@supabase/supabase-js` is loaded
     via `await import()` inside `getSupabaseClient()`, behind the `owen.community.enabled`
     flag, so activation can never depend on it.
- **Rule:** keep the Supabase import lazy and keep `@supabase/supabase-js` in
  `dependencies` (so esbuild bundles it). See `AI_MAINTAINER_GUIDE.md` §4 and §6.

---

## 2026-05-26 — v0.1.0 — Initial public release

**AI Agent:** Claude (Cursor IDE)

Initial release of OWEN as the BelvoirDynamics VS Code / Cursor extension (the **OWEN**
brand was reassigned from the former desktop app, now **GROVES**).

- **Languages & syntax highlighting:** MCNP (`.i`, `.mcnp`, `.inp`), Serpent (`.serp`),
  SCONE (`.scone`); OpenMC detected from Python files that `import openmc`.
- **Deep validators** with diagnostic codes for all four codes (ZAID format, density/
  fraction signs, `mt`/S(α,β) hydrogen check, macrobody counts; OpenMC API checks; Serpent
  `cuboid`/`trcl`/`omp`; SCONE `aceNeutronDatabase`, temp-suffix, `pinUniverse`).
- **Lattice Builder** webview → MCNP/OpenMC/Serpent code.
- **3D geometry preview** (Three.js) via `preview/extractor.ts`, a TypeScript port of GROVES'
  `analysis.py` (parity is the design goal).
- **Parameter sweep** (`owen.runSweep`): JSON-driven, per-run mutation, k-eff parsing,
  manifest + TSV.
- **NRDP material insertion** with bundled snapshot + optional live refresh.
- **Tutorial deep-links** to reactormc.net.
- **Community Library** (opt-in, feature-flagged) backed by Supabase, no bundled
  credentials.
- **CI:** GitHub Actions workflow builds the VSIX as a release artifact.
- Rebranded to BelvoirDynamics; publisher `belvoirdynamics`.
