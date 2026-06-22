# Changelog

All notable changes to the OWEN VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] — 2026-06-22

Catch invisible whitespace bugs, stay inside MCNP's column limit, reach OWEN from the editor
title bar, and apply a highlight palette with one click.

### Added

- **OWEN: Toggle Invisible Characters.** A new command (Command Palette, the right-click
  **OWEN** submenu, and the editor title-bar menu) flips VS Code's whitespace and
  control-character rendering on/off so you can see spaces, tabs, `¶`, and stray control
  characters — the kind of invisible difference that silently breaks column-sensitive MCNP
  decks. Toggling off restores your previous `editor.renderWhitespace` /
  `editor.renderControlCharacters` values exactly (including "no explicit value").
- **MCNP card-image line-length guard.** MCNP files now show a vertical ruler at the column
  limit, and any line that runs past it is flagged in the **Problems** panel and with an
  in-editor highlight on the overflowing tail — because characters past the limit are silently
  ignored by MCNP, a classic invisible bug. The limit defaults to the classic **80** columns
  and is configurable via **`owen.mcnp.lineLengthLimit`** (set it to `128` for MCNP6.2+). Tab
  expansion is accounted for, so an apparently-short line with a tab is still caught.
- **OWEN in the editor title bar.** A compact **OWEN** menu (beaker icon) now appears at the
  top-right of the editor when you're in an MCNP, Serpent, SCONE, or OpenMC-Python file,
  exposing Validate, Insert Material, Lattice Builder, 3D Preview, Run, Run Sweep, Toggle
  Invisibles, Choose Palette, Tutorial, and Library — the same actions as the right-click
  submenu, one click away.
- **Click-to-apply highlight palettes.** In the palette preview panel
  (**OWEN: Choose Highlight Palette**), each of the four palette cards is now clickable: click
  one (or focus it and press Enter/Space) to apply it immediately, with a hover affordance and
  a **Selected** badge marking the applied palette. The Quick Pick flow still works exactly as
  before.

### Internal

- The parameter-sweep logic (`OWEN: Run Parameter Sweep`) was refactored into a pure,
  vscode-free core (`src/workflows/sweepCore.ts`) and now has unit tests covering parameter
  expansion, regex value substitution, k-eff parsing, and manifest/summary generation. MCNP
  line-length logic is unit-tested too. See `docs/SWEEP_VALIDATION.md` and the extended sweep
  scenario in `docs/OPENMC_EVALUATION.md`.

## [0.1.5] — 2026-06-04

See your highlight colors **before** you pick them.

### Added

- **Live palette preview.** Running **OWEN: Choose Highlight Palette** (Command Palette or
  the right-click **OWEN** submenu) now opens a side panel showing a short, representative
  code sample for the language you picked, rendered in **all four palettes at once** —
  Classic, Solarized, High Contrast, and Pastel — so you can compare them directly. As you
  move through the palette Quick Pick, the matching block in the preview is outlined and
  scrolled into view; press Enter to apply. The samples are real per-language snippets (MCNP
  cells/surfaces/material with a ZAID, OpenMC `Material`/`IndependentSource`/
  `RectangularPrism`, a Serpent `mat`/`surf`/`cell`/`set` deck, and a SCONE dictionary block)
  colored from the exact same scope→color map the editor uses, so the preview matches what
  you'll get. The preview uses your editor's background and monospace font.

## [0.1.4] — 2026-06-04

The OpenMC snippets now pop up **automatically as you type** the prefix — no Ctrl+Space needed.

### Fixed

- **`omc_*` snippets auto-surface while typing.** As of 0.1.2 the snippets showed on
  **Ctrl+Space**, but typing `omc_` in a Python file did not open the suggestion widget with
  them — Pylance's as-you-type / inline suggestion took the slot, so the OWEN items only
  appeared on a manual trigger. The completion provider is now registered with
  **trigger characters** (the lowercase alphabet plus `_`) so the widget opens/refreshes on
  each prefix keystroke; each item carries the correct replacement **range** so `omc_` filters
  to (and is replaced by) the snippet; OWEN items keep a top-biased **`sortText`**; and the
  best matching prefix is **preselected** so it is highlighted ahead of language-server
  completions. Applies to MCNP, Serpent, and SCONE prefixes too. The Python provider still
  only fires in files that import OpenMC (`import openmc`, `import openmc as …`, or
  `from openmc import …`).

> Tip: if you still prefer snippets pinned above everything else, set
> `"editor.snippetSuggestions": "top"`. OWEN does not change your editor settings.

## [0.1.3] — 2026-06-04

Per-language syntax-highlighting color palettes, plus richer grammars to make them meaningful.

### Added

- **Selectable highlight palettes — 4 per language (16 total).** Each of MCNP, OpenMC,
  Serpent, and SCONE can be independently recolored with one of four palettes: **Classic**
  (VS Code dark default-style), **Solarized** (muted Solarized-inspired), **High Contrast**
  (bright/vivid), and **Pastel** (soft, low-saturation). Pick via the new settings
  `owen.highlight.mcnp.palette`, `owen.highlight.openmc.palette`,
  `owen.highlight.serpent.palette`, `owen.highlight.scone.palette`, or via the command
  **OWEN: Choose Highlight Palette** (also in the editor right-click **OWEN** submenu), which
  walks you through language → palette in a QuickPick.
- **Live recoloring.** OWEN applies the chosen palette by writing scoped
  `editor.tokenColorCustomizations` `textMateRules` that target only OWEN's namespaced scopes,
  re-applying immediately whenever an `owen.highlight.*` setting changes. It merges with — and
  never clobbers — your existing token-color customizations, other extensions' rules, or
  theme-scoped blocks, so palettes compose with your active theme.
- **OpenMC injection grammar.** OpenMC files are Python (`.py` with `import openmc`), so there
  was previously no OWEN-specific coloring. A new `openmc.injection` grammar injected into
  `source.python` scopes the `openmc` module, its classes (`support.class.openmc`), functions
  (`support.function.openmc`), and submodules like `openmc.model`/`openmc.stats`
  (`support.type.openmc`) — leaving the rest of your Python untouched.

### Changed

- **Richer MCNP / Serpent / SCONE grammars.** Scopes were expanded and renamed into clean,
  per-language namespaces (e.g. `entity.name.material.mcnp`, `storage.type.surface.mcnp`,
  `constant.other.zaid.mcnp`, `entity.name.type.serpent`, `entity.name.section.scone`) so the
  palettes have distinct token classes to target. Added more keywords/surface types, block-C
  comments for Serpent, and `!`-style comments for SCONE.

## [0.1.2] — 2026-06-04

Follow-up release: the OpenMC snippets still did not surface after the 0.1.1 underscore
rename, and the right-click menu only exposed three commands.

### Fixed

- **OpenMC snippets now reliably appear.** The 0.1.1 fix (hyphen → underscore prefixes) was
  correct but not sufficient: declarative `contributes.snippets` only show in the suggestion
  widget, where the Python language server's completions routinely out-rank or suppress them,
  so the `omc_*` prefixes still looked dead. OWEN now registers an explicit
  `CompletionItemProvider` (kind `Snippet`) for Python, MCNP, Serpent, and SCONE that loads
  the same snippet JSON and serves the prefixes directly. They now show on **Ctrl+Space** and
  as you type `omc_…`, independent of `editor.snippetSuggestions` / `editor.quickSuggestions`.
  The Python snippets are gated to files that `import openmc`.

### Added

- **Right-click context menu.** All eight OWEN commands (Validate Input File, Insert Material
  from Database, Open Lattice Builder, Open 3D Geometry Preview, Run Simulation, Run Parameter
  Sweep, Open Tutorial, Search Reactor Library) are now grouped under an **OWEN** submenu in
  the editor right-click menu, shown for `mcnp`, `serpent`, `scone`, and `python` files.

## [0.1.1] — 2026-06-02

Maintenance release with three bug fixes found during OpenMC capability testing.

### Fixed

- **OpenMC snippets now fire.** The OpenMC Python snippet prefixes were hyphenated
  (`omc-pin-script`, `omc-settings`, …), and VS Code does not trigger snippet completion on a
  hyphen in Python (where `-` is a word separator), so typing a prefix just inserted plain
  text. Prefixes are now underscore-separated: `omc_material`, `omc_pin`, `omc_lattice`,
  `omc_settings`, `omc_model`, `omc_pin_script`, `omc_assembly_script`.
- **Lattice Builder "Insert at Cursor"** no longer silently does nothing when the Lattice
  Builder panel has focus; it inserts into the last active editor (or a new untitled file).
- **3D Geometry Preview** now renders the pin geometry instead of showing only empty axes.

## [0.1.0] — 2026-05-26

Initial public release of OWEN — Open Workspace for Engineered Neutronics,
the BelvoirDynamics VS Code/Cursor extension for nuclear reactor input files.

### Added

- **Languages & syntax highlighting** for MCNP (`.i`, `.mcnp`, `.inp`), Serpent (`.serp`),
  and SCONE (`.scone`). OpenMC is detected via Python files that `import openmc`.
- **Deep validators** with diagnostic codes:
  - MCNP — ZAID format, density/material sign conventions, `mt`/S(α,β) hydrogen check,
    macrobody parameter counts, `HEX`/`CYL` keyword detection, `imp:n` missing on cells.
  - OpenMC — `Source` → `IndependentSource`, `rectangular_prism` → `RectangularPrism`,
    `Material(temperature=)` flagged, deprecated `openmc_exec_kwargs`,
    `model.run()` return-value misuse.
  - Serpent — `surf rect` → `cuboid`, `trcl` not allowed, `set omp` (use CLI),
    `set egrid` energy-unit heuristic.
  - SCONE — `aceNuclearDatabase` → `aceNeutronDatabase`, `temp` ↔ ZAID temperature
    suffix matching, `pinUniverse` radii/fills length + outer-0.0 check,
    non-ASCII detection, dictionary semicolon rule.
- **Lattice Builder** (unchanged from preview): visual grid → MCNP/OpenMC/Serpent code.
- **NRDP material insertion** — bundled snapshot in VSIX plus optional live override
  via `owen.nrdp.live` / `owen.nrdp.endpoint`. Language-aware (`mcnp` / `serpent` /
  `openmc` codes; SCONE stub generated from composition).
- **Tutorial deep-links** to https://reactormc.net via `OWEN: Open Tutorial`.
- **Parameter sweep** workflow (`OWEN: Run Parameter Sweep`) driven by JSON
  schema, with per-run input mutation, output capture, k-eff parsing
  (MCNP combined keff, OpenMC `Combined k-effective`), manifest + TSV summary.
- **3D geometry preview** webview (Three.js via importmap) — MCNP `cz`
  cylinders rendered as transparent stacked tubes. Other languages: graceful
  empty-state.
- **Community Library** (feature-flagged via `owen.community.enabled`) —
  Supabase-backed approved-model browser with insert-at-cursor or open-as-untitled.
- **Snippets** — significant expansion: full PWR pin cell, 17×17 PWR assembly,
  3×3 criticality array, shielding slab (MCNP); full OpenMC pin and assembly
  Python scripts; SCONE fuel pin, 5×5 assembly, shielding slab tutorials.
- **CI** — GitHub Actions workflow building the VSIX as a release artifact.

### Changed

- Rebranded from DynamicMC to BelvoirDynamics; publisher is now `belvoirdynamics`.
- Repository URL corrected to `https://github.com/caalh/BelvoirDynamics`.
- Removed dead `onLanguage:openmc` activation event; OpenMC routes through the
  shared `detectMonteCarloLanguage` helper.

### Known limitations

- 3D geometry preview is MCNP-only and limited to `cz` cylinders.
- SCONE runner shows guidance for WSL on Windows; no automatic WSL detection yet.
- Community Library has no in-app submission flow (UI is browse + insert only).
