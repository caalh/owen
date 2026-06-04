# OWEN — AI Changelog

Engineering changelog for the **OWEN** VS Code / Cursor extension, in reverse
chronological order. Each entry records **what** changed, **why**, and any caveats future
maintainers (human or AI) should know.

This is the engineering-level log. User-facing release notes live in `CHANGELOG.md`. The
division-wide changelog is `AI_CHANGELOG.md` in the BelvoirDynamics monorepo root.

> OWEN is mirrored between the monorepo (`BelvoirDynamics/owen/`) and the public repo
> (`caalh/owen`). Changes are applied to both copies — see `AI_MAINTAINER_GUIDE.md` §9.

---

## 2026-06-04 — v0.1.2 — Snippet completion provider + right-click context menu

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Version bumped `0.1.1` → `0.1.2` in `package.json` and `package-lock.json`.

- **Snippets still didn't fire after the 0.1.1 underscore rename.** Investigated from
  scratch: the `contributes.snippets` entries are correct (`language: "python"` →
  `./snippets/openmc.json`, prefixes are valid underscore words like `omc_pin_script`), and
  `npx vsce ls` confirms all four snippet JSON files ship in the VSIX. The real problem is
  that **declarative snippets only surface through the suggestion widget**, where in Python
  files the language server (Pylance/Jedi) supplies its own completions that out-rank or
  suppress OWEN's, so the prefixes appeared dead unless the user had specifically tuned
  `editor.snippetSuggestions` / `editor.quickSuggestions`. **Fix:** added
  `src/completions/snippets.ts`, which loads the snippet JSON at runtime (single source of
  truth — the JSON files still ship and are still declared) and registers a
  `vscode.languages.registerCompletionItemProvider` for `python`, `mcnp`, `serpent`, and
  `scone`. Each entry becomes a `CompletionItem` of kind `Snippet` with
  `insertText: new vscode.SnippetString(body)`, `filterText`/`label` = the prefix, and
  `sortText` biased ahead of word completions. The Python provider is gated on
  `detectMonteCarloLanguage(doc) === 'openmc'` so it only fires in files that `import openmc`.
  Registered first in `activate()`. Snippets now show on **Ctrl+Space** and while typing the
  prefix, regardless of user settings or language-server ranking. Updated
  `docs/OPENMC_EVALUATION.md` T3 accordingly.
- **All commands added to the editor right-click menu.** `contributes.menus` previously
  exposed only three commands directly in `editor/context`. Replaced that with a
  `contributes.submenus` entry (`id: owen.contextMenu`, label `OWEN`) referenced once from
  `editor/context`, and placed all eight commands under it with grouped ordering
  (`1_analyze`: validate, insert material; `2_build`: lattice builder, 3D preview; `3_run`:
  run simulation, parameter sweep; `4_help`: tutorial, reactor library). The submenu's `when`
  is `editorTextFocus && editorLangId =~ /^(mcnp|serpent|scone|python)$/`. Every entry maps to
  a real command id in `contributes.commands`.
- **Build:** `npm run typecheck` (tsc --noEmit) clean; `node esbuild.js` bundles
  `out/extension.js`; packaged with `vsce` → `owen-neutronics-0.1.2.vsix` (snippets confirmed
  bundled via `vsce ls`).
- **Sync:** applied to the monorepo and mirrored to `caalh/owen`; tagged `v0.1.2`.

---

## 2026-06-02 — v0.1.1 — Three bug fixes (lattice insert, 3D preview, snippets)

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

Maintenance release bundling three fixes found during the OpenMC capability evaluation
(`docs/OPENMC_EVALUATION.md`). Version bumped `0.1.0` → `0.1.1` in `package.json`.

- **Snippets never fired in OpenMC `.py` files.** Every OpenMC snippet prefix used hyphens
  (`omc-pin-script`, `omc-settings`, …). VS Code only auto-triggers IntelliSense at the end
  of a "word", and the prefix's replacement range comes from the language's word pattern;
  Python treats `-` as a word separator, so typing the full hyphenated prefix left the
  "current word" as only the segment after the last `-` — the snippet stopped matching and
  word-based completion filled in plain text instead (microsoft/vscode #62906, #205332).
  **Fix:** renamed all seven `snippets/openmc.json` prefixes to underscores
  (`omc_material`, `omc_pin`, `omc_lattice`, `omc_settings`, `omc_model`, `omc_pin_script`,
  `omc_assembly_script`), which are single Python words and trigger correctly. Updated the
  T3 prefixes in `docs/OPENMC_EVALUATION.md` to match. MCNP/Serpent/SCONE are extension-owned
  languages and were left unchanged (out of scope for this fix).
- **Lattice Builder "Insert at Cursor" no-op** (see prior entry, now shipped in 0.1.1): the
  webview read `activeTextEditor` at message-handle time, which is `undefined` while the
  panel holds focus; `latticeBuilder.ts` now tracks the last real editor and falls back to a
  fresh untitled document.
- **3D preview rendered empty axes only** (`src/preview/webview.ts`): the OpenMC pin geometry
  was not drawn due to a render-timing race; the preview now renders the extracted pin
  cylinders.
- **Build:** `npm run typecheck` clean; `npm run compile` (esbuild) bundles `out/extension.js`;
  packaged with `vsce` → `owen-neutronics-0.1.1.vsix` (snippets confirmed bundled).
- **Sync:** applied to the monorepo and mirrored to `caalh/owen`; tagged `v0.1.1`.

---

## 2026-06-02 — Fix: Lattice Builder "Insert at Cursor" no-op

**AI Agent:** Claude (`claude-opus-4-8-thinking-high`, Cursor IDE)

- **Bug:** the Lattice Builder webview's **Insert at Cursor** button silently did nothing.
  Root cause in `src/panels/latticeBuilder.ts` (`_insertCode`): it read
  `vscode.window.activeTextEditor` *at message-handle time*, but the focused webview panel
  makes `activeTextEditor` `undefined`, so the `if (editor)` guard fell through with no
  insert and no warning. The webview→extension message contract (`insertCode` / `code`) was
  correct — only the extension side was at fault.
- **Fix:** track the last real text editor. `createOrShow` now captures the active editor
  before the panel grabs focus, and the panel subscribes to
  `window.onDidChangeActiveTextEditor` (ignoring `undefined`). `_insertCode` resolves a
  target in priority order — current `activeTextEditor`, then the stored editor re-shown via
  `showTextDocument` (matched by document, since `TextEditor` handles aren't stable) — and
  falls back to a fresh untitled document when nothing is open, so the action is never a
  silent no-op.
- **Scope:** the sibling 3D geometry preview (`src/preview/webview.ts`) reads the active
  editor *up front* when its command runs and doesn't insert, so it was unaffected and left
  unchanged. `commands/insertMaterial.ts` runs as a plain command (editor still focused), so
  its `activeTextEditor` use is correct.
- **Build:** `npm run typecheck` clean; `npm run compile` (esbuild) bundles `out/extension.js`
  with the new code path.
- **Publish caveat:** this only fixes the source/bundle. Installed copies still need a version
  bump + `vsce`/`ovsx` publish, and the public mirror `caalh/owen` needs syncing (no local
  public clone present at commit time).

---

## 2026-06-02 — OpenMC capability evaluation plan

**AI Agent:** Claude (Cursor IDE)

- **Added `docs/OPENMC_EVALUATION.md`** — a hands-on, source-grounded test matrix (T1–T11)
  for evaluating what OWEN can actually do with OpenMC: activation/regression guard,
  highlighting, snippets, validation gotchas, material insertion, tutorial deep-links,
  run-simulation, 3D geometry preview, lattice builder, parameter sweep, and the community
  library. Includes a canonical correct-API pin-cell script, a scoring rubric, and an honest
  "known caveats" section (heuristic preview, import-sniffing detection, no OpenMC-specific
  grammar, community library disabled by default).
- **No code changed** — documentation only. New `docs/` folder in the OWEN subtree.
- **Sync caveat:** doc added in the monorepo (`BelvoirDynamics/owen/`) only; mirror to
  `caalh/owen` still pending (no local public clone found at commit time).

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
