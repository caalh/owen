// OpenMC geometry extractor.
//
// OpenMC "decks" are Python scripts, so there is no single canonical lattice
// literal. This parser recovers a lattice grid from the three patterns seen in
// real and community decks:
//   1. A literal nested list assigned to `.universes` (`[[F, F, G, …], …]`).
//   2. A symbol grid + `universe_map` dict (`{'F': fuel_pin, 'G': guide_tube}`).
//   3. A NumPy-built map: `arr = np.full((17,17), F)` followed by element
//      assignments (`arr[i,j] = G`) and coordinate-list loops
//      (`for (i, j) in [(2,5), …]: arr[i,j] = G`). This is the dominant style
//      (and exactly what OWEN's own assembly snippet emits) — the previous
//      heuristic could not see it and fell back to a single pin.
//
// Pin layer radii are recovered from scalar assignments and `ZCylinder(r=…)`
// surfaces grouped by role (fuel / clad / gap, guide tube, instrument tube).
// Hex lattices are detected but only laid out on a rectangular approximation.

import { CylinderSpec, Component, ComponentId, ParseResult } from '../types';
import { componentColor, emitLayers, extractNumbers, materialColor } from '../palette';

interface NamedValue {
    name: string;
    value: number;
}

interface PinTemplate {
    radii: number[];
    components: ComponentId[];
    materials: string[];
    /** When false the position is left empty (pure water/moderator). */
    render: boolean;
}

export function extractOpenmcCylinders(text: string): CylinderSpec[] {
    return parseOpenmc(text).cylinders;
}

export function parseOpenmc(text: string): ParseResult {
    const warnings: string[] = [];
    const notes: string[] = [];
    const lines = text.split(/\r?\n/);

    const radiiPool = collectRadii(text, lines);
    const pitch = findPitch(lines);
    const lowerLeft = findLowerLeft(lines);
    const height = findHeight(lines);

    const fuelTemplate = buildTemplate(radiiPool, 'fuel');
    const guideTemplate = buildTemplate(radiiPool, 'guide');
    const instrTemplate = buildTemplate(radiiPool, 'instrument');

    const universeMap = findUniverseMap(text);
    const grid = findLatticeGrid(text) ?? buildNumpyGrid(text);
    const isHex = /HexLattice/.test(text);
    const hasLattice = /RectLattice|HexLattice|\.universes\b/.test(text);

    if (!grid || grid.length === 0) {
        const single = fuelTemplate ?? defaultTemplate('fuel');
        const cyls = emitLayers(single.radii, single.components, 0, 0, 0, height, 'pin', undefined, single.materials);
        if (hasLattice) {
            warnings.push('A lattice was declared but its universe map could not be expanded (it is likely built by a function or comprehension OWEN does not execute). Showing a single representative pin.');
        } else {
            notes.push('No lattice found — rendered a single pin cell.');
        }
        return { cylinders: cyls, warnings, notes };
    }

    const rows = grid.length;
    const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
    const px = pitch[0];
    const py = pitch[1];

    let x0: number;
    let y0: number;
    if (lowerLeft) {
        x0 = lowerLeft[0] + px / 2;
        y0 = lowerLeft[1] + (rows - 1) * py + py / 2; // top row first
    } else {
        x0 = -(cols - 1) * px / 2;
        y0 = (rows - 1) * py / 2;
    }

    const cylinders: CylinderSpec[] = [];
    const MAX = 120000;
    let capped = false;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < grid[r].length; c++) {
            if (cylinders.length >= MAX) { capped = true; break; }
            const token = grid[r][c];
            const role = classifyToken(token, universeMap);
            let template: PinTemplate | null;
            switch (role) {
                case 'guide':
                    template = guideTemplate ?? defaultTemplate('guide');
                    break;
                case 'instrument':
                    template = instrTemplate ?? defaultTemplate('instrument');
                    break;
                case 'empty':
                    template = null;
                    break;
                default:
                    template = fuelTemplate ?? defaultTemplate('fuel');
            }
            if (!template || !template.render) continue;
            const x = x0 + c * px;
            const y = y0 - r * py;
            cylinders.push(
                ...emitLayers(template.radii, template.components, x, y, 0, height, `${role}_r${r}c${c}`, undefined, template.materials),
            );
        }
    }

    notes.push(`Expanded a ${rows}×${cols} lattice (${cylinders.length} pin layers).`);
    if (capped) warnings.push(`Geometry exceeded the ${MAX.toLocaleString()}-primitive cap and was truncated.`);
    if (isHex) {
        notes.push('Hex lattice laid out on a rectangular approximation (axial spacing is exact, hex offset is not).');
        for (const cyl of cylinders) cyl.label = `hexapprox_${cyl.label}`;
    }

    return { cylinders, warnings, notes };
}

// ---------------------------------------------------------------------------

function collectRadii(text: string, lines: string[]): NamedValue[] {
    const pool: NamedValue[] = [];

    // Scalar assignments: `fuel_radius = 0.4096`
    for (const line of lines) {
        const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(?:#.*)?$/);
        if (m) {
            const v = Number(m[2]);
            if (!Number.isNaN(v) && v > 0 && v < 50) pool.push({ name: m[1], value: v });
        }
    }

    // ZCylinder surfaces: `clad_outer_surf = openmc.ZCylinder(r=clad_outer)` or
    // `... ZCylinder(r=0.475)`.
    const zRe = /([A-Za-z_]\w*)\s*=\s*openmc\.ZCylinder\s*\(([^)]*)\)/g;
    for (const m of text.matchAll(zRe)) {
        const name = m[1];
        const args = m[2];
        const rm = args.match(/r\s*=\s*([A-Za-z_]\w*|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
        if (!rm) continue;
        const raw = rm[1];
        let value: number | null = null;
        if (/^[A-Za-z_]/.test(raw)) {
            const found = pool.find((p) => p.name === raw);
            if (found) value = found.value;
        } else {
            const n = Number(raw);
            if (!Number.isNaN(n)) value = n;
        }
        if (value !== null && value > 0 && value < 50) pool.push({ name, value });
    }

    return pool;
}

function findPitch(lines: string[]): [number, number] {
    for (const line of lines) {
        if (!/pitch/i.test(line) || !line.includes('=')) continue;
        const nums = extractNumbers(line.replace(/.*?=/, ''));
        if (nums.length >= 2) return [nums[0], nums[1]];
        if (nums.length === 1) return [nums[0], nums[0]];
    }
    return [1.26, 1.26];
}

function findLowerLeft(lines: string[]): [number, number] | null {
    for (const line of lines) {
        if (!/lower_left/i.test(line) || !line.includes('=')) continue;
        const nums = extractNumbers(line.replace(/.*?=/, ''));
        if (nums.length >= 2) return [nums[0], nums[1]];
    }
    return null;
}

function findHeight(lines: string[]): number {
    for (const line of lines) {
        const low = line.toLowerCase();
        if ((low.includes('fuel_height') || (low.includes('height') && low.includes('active'))) && line.includes('=')) {
            const nums = extractNumbers(line.replace(/.*?=/, ''));
            if (nums.length) return Math.abs(nums[0]);
        }
    }
    return 40.0;
}

function findUniverseMap(text: string): Map<string, string> {
    const map = new Map<string, string>();
    // `universe_map = {'F': fuel_pin, 'G': guide_tube, 'I': instr_tube}`
    const dictRe = /\{([^{}]*?['"][^{}]*?)\}/g;
    for (const m of text.matchAll(dictRe)) {
        const body = m[1];
        const pairRe = /['"]([^'"]+)['"]\s*:\s*([A-Za-z_]\w*)/g;
        for (const p of body.matchAll(pairRe)) {
            map.set(p[1], p[2]);
        }
    }
    return map;
}

type Role = 'fuel' | 'guide' | 'instrument' | 'empty';

function classifyToken(token: string, universeMap: Map<string, string>): Role {
    let name = token.trim().replace(/^['"]|['"]$/g, '');
    if (universeMap.has(name)) name = universeMap.get(name)!;
    const low = name.toLowerCase();
    if (/guide/.test(low)) return 'guide';
    if (/instr|instrument/.test(low)) return 'instrument';
    if (/(^|_)tube/.test(low) && !/guide/.test(low)) return 'instrument';
    if (/fuel|pellet/.test(low)) return 'fuel';
    if (/(water|mod|cool|empty|none|void)/.test(low)) return 'empty';
    // Single-letter conventions: F fuel, G guide, I instrument, W/E water.
    if (low === 'g') return 'guide';
    if (low === 'i') return 'instrument';
    if (low === 'f') return 'fuel';
    if (low === 'w' || low === 'e' || low === '0') return 'empty';
    return 'fuel';
}

function buildTemplate(pool: NamedValue[], role: Role): PinTemplate | null {
    let matcher: RegExp;
    if (role === 'fuel') matcher = /(fuel|pellet|gap|clad)/i;
    else if (role === 'guide') matcher = /guide/i;
    else matcher = /(instr|tube)/i;

    const entries = pool.filter((p) => matcher.test(p.name) && (role !== 'instrument' || !/guide/i.test(p.name)));
    if (entries.length === 0) return null;

    // Deduplicate by value, keep first name seen.
    const byValue = new Map<number, string>();
    for (const e of entries) if (!byValue.has(e.value)) byValue.set(e.value, e.name);
    const sorted = [...byValue.entries()].sort((a, b) => a[0] - b[0]);

    const radii = sorted.map((s) => s[0]);
    const components = sorted.map((s) => assignComponent(s[1], role));
    const materials = sorted.map((s) => s[1]);
    return { radii, components, materials, render: true };
}

function assignComponent(name: string, role: Role): ComponentId {
    const low = name.toLowerCase();
    if (role === 'fuel') {
        if (/clad.*out|clad_or|cladding/.test(low)) return Component.Clad;
        if (/clad.*in/.test(low)) return Component.Gap;
        if (/gap/.test(low)) return Component.Gap;
        if (/clad/.test(low)) return Component.Clad;
        if (/fuel|pellet/.test(low)) return Component.Fuel;
        return Component.Fuel;
    }
    if (role === 'guide') {
        if (/in/.test(low)) return Component.Moderator;
        return Component.GuideTube;
    }
    // instrument
    if (/in/.test(low)) return Component.Moderator;
    return Component.InstrumentTube;
}

function defaultTemplate(role: Role): PinTemplate {
    if (role === 'guide') {
        return { radii: [0.5610, 0.6020], components: [Component.Moderator, Component.GuideTube], materials: ['Water', 'Zircaloy'], render: true };
    }
    if (role === 'instrument') {
        return { radii: [0.5590, 0.6050], components: [Component.Moderator, Component.InstrumentTube], materials: ['Water', 'Zircaloy'], render: true };
    }
    return { radii: [0.41, 0.475], components: [Component.Fuel, Component.Clad], materials: ['UO2', 'Zircaloy'], render: true };
}

// ---------------------------------------------------------------------------
// Nested-list grid parser
// ---------------------------------------------------------------------------

/** Returns the best 2D grid of raw tokens found among list-of-lists literals. */
function findLatticeGrid(text: string): string[][] | null {
    let best: string[][] | null = null;
    let bestScore = 0;

    const assignRe = /[\w.]+\s*=\s*\[/g;
    let m: RegExpExecArray | null;
    while ((m = assignRe.exec(text)) !== null) {
        const open = assignRe.lastIndex - 1; // position of '['
        const close = matchBracket(text, open);
        if (close < 0) continue;
        const body = text.slice(open + 1, close);
        const grid = parseRows(body);
        if (grid && grid.length >= 2) {
            const cols = grid.reduce((mx, r) => Math.max(mx, r.length), 0);
            const score = grid.length * cols;
            if (cols >= 2 && score > bestScore) {
                bestScore = score;
                best = grid;
            }
        }
        assignRe.lastIndex = close;
    }
    return best;
}

function matchBracket(text: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Parses inner `[ ... ]` rows from the body of an outer list. */
function parseRows(body: string): string[][] | null {
    const rows: string[][] = [];
    let i = 0;
    while (i < body.length) {
        if (body[i] === '[') {
            const close = matchBracket(body, i);
            if (close < 0) break;
            const inner = body.slice(i + 1, close);
            // Only treat as a row if it has no further nested lists.
            if (!inner.includes('[')) {
                const tokens = inner
                    .split(',')
                    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
                    .filter((t) => t.length > 0);
                if (tokens.length) rows.push(tokens);
            }
            i = close + 1;
        } else {
            i++;
        }
    }
    return rows.length ? rows : null;
}

// ---------------------------------------------------------------------------
// NumPy-built grid parser
// ---------------------------------------------------------------------------

/**
 * Reconstructs a lattice grid from the `np.full((R, C), base)` + assignment
 * idiom. Handles element assignments (`arr[i, j] = X`, `arr[i][j] = X`) and
 * coordinate-list loops (`for (i, j) in [(r,c), …]: arr[i, j] = X`).
 */
function buildNumpyGrid(text: string): string[][] | null {
    const fullRe = /([A-Za-z_]\w*)\s*=\s*np(?:numpy)?\.(?:full|empty|zeros|ones)\s*\(\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*(?:,\s*([A-Za-z_]\w*))?/;
    const m = text.match(fullRe);
    if (!m) return null;
    const arr = m[1];
    const rows = parseInt(m[2], 10);
    const cols = parseInt(m[3], 10);
    const base = m[4] ?? '0';
    if (!(rows > 0 && cols > 0) || rows * cols > 1_000_000) return null;

    const grid: string[][] = [];
    for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(base));

    const setCell = (i: number, j: number, val: string) => {
        if (i >= 0 && i < rows && j >= 0 && j < cols) grid[i][j] = val;
    };

    // Direct element assignments: arr[i, j] = X  /  arr[i][j] = X
    const a = escapeRe(arr);
    const elemRe = new RegExp(`${a}\\s*\\[\\s*(\\d+)\\s*(?:,|\\]\\s*\\[)\\s*(\\d+)\\s*\\]\\s*=\\s*([A-Za-z_]\\w*)`, 'g');
    for (const em of text.matchAll(elemRe)) {
        setCell(parseInt(em[1], 10), parseInt(em[2], 10), em[3]);
    }

    // Coordinate-list loops:
    //   for (i, j) in [(2,5), (2,8), …]:
    //       arr[i, j] = G
    const loopRe = /for\s*\(?\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)?\s+in\s*\[([\s\S]*?)\]\s*:/g;
    for (const lm of text.matchAll(loopRe)) {
        const vi = lm[1];
        const vj = lm[2];
        const listBody = lm[3];
        const after = text.slice((lm.index ?? 0) + lm[0].length);
        // Find the assignment that uses the loop vars within the next few lines.
        const bodyRe = new RegExp(`${a}\\s*\\[\\s*${escapeRe(vi)}\\s*(?:,|\\]\\s*\\[)\\s*${escapeRe(vj)}\\s*\\]\\s*=\\s*([A-Za-z_]\\w*)`);
        const bm = after.slice(0, 600).match(bodyRe);
        if (!bm) continue;
        const val = bm[1];
        const pairRe = /\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
        for (const pm of listBody.matchAll(pairRe)) {
            setCell(parseInt(pm[1], 10), parseInt(pm[2], 10), val);
        }
    }

    return grid;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
