// SCONE geometry extractor.
//
// SCONE uses a dictionary syntax (`key value;`, `block { … }`). This parser is
// brace-aware rather than a single mega-regex: it strips comments, walks every
// leaf `name { … }` block, and classifies it (pinUniverse / latUniverse /
// cellUniverse / rootUniverse / surface / cell). It then resolves the universe
// hierarchy, finds the core lattice, and recursively places assemblies → pins.
//
// For a full core (BEAVRS-scale, ~55k pins) it switches to "disc mode" — one
// full-height cylinder per pin position, coloured by material and tagged with a
// logical component — so the webview can instance it and offer layer toggles.
// For a single assembly (≤ FULL_LAYER_LIMIT pins) it emits the full concentric
// shells per pin (fuel / gap / clad / moderator …). Vessel/barrel surfaces are
// rendered as faint shells so a reactor reads as a reactor.

import { CylinderSpec, Component, ComponentId, ParseResult } from '../types';
import { emitLayers, materialColor, materialComponent, componentColor } from '../palette';

interface LeafBlock {
    name: string;
    inner: string;
}

interface PinDef {
    name: string;
    radii: number[];
    fills: string[];
}

interface LatDef {
    name: string;
    pitch: number;
    nx: number;
    ny: number;
    grid: number[][];
}

interface SurfaceDef {
    id: number;
    type: string;
    radius?: number;
    halfwidth?: number;
}

const FULL_LAYER_LIMIT = 4000; // above this, draw one disc per pin
const MAX_CYLINDERS = 200000;

export function extractSconeCylinders(text: string): CylinderSpec[] {
    return parseScone(text).cylinders;
}

export function parseScone(rawText: string): ParseResult {
    const warnings: string[] = [];
    const notes: string[] = [];
    const text = stripComments(rawText);
    const blocks = findLeafBlocks(text);

    const pinDefs = new Map<number, PinDef>();
    const latDefs = new Map<number, LatDef>();
    const cellUniCells = new Map<number, number[]>(); // cellUniverse id -> cell ids
    const cellToUniverse = new Map<number, number>(); // cell id -> universe it is filled with
    const surfaces = new Map<number, SurfaceDef>();

    for (const block of blocks) {
        const id = num(field(block.inner, 'id'));
        const type = (field(block.inner, 'type') ?? '').toLowerCase();

        if (type === 'pinuniverse' && id !== null) {
            const radii = numList(paren(block.inner, 'radii'));
            const fills = tokenList(paren(block.inner, 'fills'));
            pinDefs.set(id, { name: block.name, radii, fills });
        } else if (type === 'latuniverse' && id !== null) {
            const pitchVals = numList(paren(block.inner, 'pitch'));
            const shapeVals = numList(paren(block.inner, 'shape'));
            const mapVals = numList(paren(block.inner, 'map'));
            if (pitchVals.length && shapeVals.length >= 2) {
                const nx = Math.round(shapeVals[0]);
                const ny = Math.round(shapeVals[1]);
                const grid: number[][] = [];
                let idx = 0;
                for (let row = 0; row < ny; row++) {
                    const r: number[] = [];
                    for (let col = 0; col < nx; col++) {
                        r.push(idx < mapVals.length ? Math.round(mapVals[idx++]) : 0);
                    }
                    grid.push(r);
                }
                latDefs.set(id, { name: block.name, pitch: pitchVals[0], nx, ny, grid });
            }
        } else if (type === 'celluniverse' && id !== null) {
            cellUniCells.set(id, numList(paren(block.inner, 'cells')));
        } else if (type === 'simplecell' || type === 'cell') {
            // cell that may fill a sub-universe (filltype uni; universe N)
            if (id !== null) {
                const ft = (field(block.inner, 'filltype') ?? '').toLowerCase();
                if (ft === 'uni') {
                    const uni = num(field(block.inner, 'universe'));
                    if (uni !== null) cellToUniverse.set(id, uni);
                }
            }
        } else if (isSurfaceType(type) && id !== null) {
            const radius = num(field(block.inner, 'radius')) ?? undefined;
            const hw = numList(paren(block.inner, 'halfwidth'));
            surfaces.set(id, {
                id,
                type,
                radius: radius ?? undefined,
                halfwidth: hw.length ? hw[0] : undefined,
            });
        }
    }

    if (pinDefs.size === 0 && latDefs.size === 0) {
        warnings.push('No pinUniverse or latUniverse blocks were found — nothing to render. Check that the deck contains a geometry { universes { … } } section.');
        return { cylinders: [], warnings, notes };
    }

    // Resolve a universe id down to a pin id (through cellUniverse shells).
    const resolveCache = new Map<number, number | null>();
    const resolveToPin = (uid: number, depth = 0): number | null => {
        if (pinDefs.has(uid)) return uid;
        if (depth > 12) return null;
        if (resolveCache.has(uid)) return resolveCache.get(uid)!;
        resolveCache.set(uid, null); // guard against cycles
        const cells = cellUniCells.get(uid);
        if (cells) {
            const counts = new Map<number, number>();
            for (const cid of cells) {
                const ref = cellToUniverse.get(cid);
                if (ref === undefined) continue;
                const pin = resolveToPin(ref, depth + 1);
                if (pin !== null) counts.set(pin, (counts.get(pin) ?? 0) + 1);
            }
            // Prefer a pin that actually has geometry (radii) over a bare
            // water-fill pin, so an axial stack that is mostly water but has a
            // fuel segment still resolves to the fuel pin.
            let best: number | null = null;
            let bestScore = -1;
            for (const [pin, n] of counts) {
                const hasGeom = (pinDefs.get(pin)?.radii.filter((r) => r > 0).length ?? 0) > 0;
                const score = n + (hasGeom ? 1000 : 0);
                if (score > bestScore) { bestScore = score; best = pin; }
            }
            resolveCache.set(uid, best);
            return best;
        }
        return null;
    };

    // Core lattice = largest pitch.
    let coreLatId: number | null = null;
    let corePitch = -1;
    for (const [id, lat] of latDefs) if (lat.pitch > corePitch) { corePitch = lat.pitch; coreLatId = id; }

    // Count pin positions to pick viz fidelity.
    const totalPins = countPins(coreLatId, latDefs, resolveToPin);
    const discMode = totalPins > FULL_LAYER_LIMIT;

    // Heights.
    const vessel = collectVessel(surfaces);
    const coreHeight = vessel.height ?? (discMode ? 200 : 40);

    const cylinders: CylinderSpec[] = [];
    let capped = false;

    let subPinPitch = 1.26;
    for (const lat of latDefs.values()) if (lat.pitch < corePitch || corePitch < 0) subPinPitch = Math.min(subPinPitch, lat.pitch);

    const placePin = (uid: number, cx: number, cy: number, label: string): void => {
        if (cylinders.length >= MAX_CYLINDERS) { capped = true; return; }
        const pin = pinDefs.get(uid);
        if (!pin) return;
        const nameLow = pin.name.toLowerCase();
        const isGuide = /guide|\bgt\b/.test(nameLow);
        const isInstr = /instr|thimble/.test(nameLow);
        const isAbsorber = /bp|burn|absorb|poison|control|\bcr\b|rod/.test(nameLow);
        const radii = pin.radii.filter((r) => r > 0);
        if (radii.length === 0) {
            // pure-fill pin (e.g. pinWater) — nothing to draw.
            return;
        }

        if (discMode) {
            // Pick the dominant solid material (skip a leading gas/water fill so
            // fuel pins read as fuel) for the colour, but classify the *component*
            // primarily from the pin name — a guide tube is a guide tube even
            // though its bulk material is Zircaloy.
            let matIdx = 0;
            for (let i = 0; i < pin.fills.length; i++) {
                const c = materialComponent(pin.fills[i] ?? '');
                if (c !== Component.Gap && c !== Component.Moderator) { matIdx = i; break; }
            }
            const matName = pin.fills[matIdx] ?? pin.fills[0] ?? 'unknown';
            let comp: ComponentId;
            let color: string;
            if (isGuide) { comp = Component.GuideTube; color = componentColor(comp); }
            else if (isInstr) { comp = Component.InstrumentTube; color = componentColor(comp); }
            else if (isAbsorber) { comp = Component.Absorber; color = componentColor(comp); }
            else { comp = materialComponent(matName); color = materialColor(matName); }
            cylinders.push({
                label,
                radius: Math.min(subPinPitch * 0.47, Math.max(...radii)),
                height: coreHeight,
                x: cx,
                y: cy,
                z: 0,
                color,
                opacity: 1.0,
                component: comp,
                material: matName,
            });
            return;
        }

        const components: ComponentId[] = [];
        const colors: (string | undefined)[] = [];
        const mats: (string | undefined)[] = [];
        for (let i = 0; i < radii.length; i++) {
            const matName = pin.fills[i] ?? `mat${i}`;
            let comp = materialComponent(matName);
            if (isGuide && comp !== Component.Moderator && comp !== Component.Gap) comp = Component.GuideTube;
            if (isInstr && comp !== Component.Moderator && comp !== Component.Gap) comp = Component.InstrumentTube;
            if (isAbsorber && (comp === Component.Structure || comp === Component.Clad)) comp = Component.Absorber;
            components.push(comp);
            colors.push(materialColor(matName));
            mats.push(matName);
        }
        cylinders.push(...emitLayers(radii, components, cx, cy, 0, coreHeight, label, colors, mats));
    };

    const placeAssembly = (asmUid: number, cx: number, cy: number, label: string): void => {
        const lat = latDefs.get(asmUid);
        if (!lat) {
            const pin = resolveToPin(asmUid);
            if (pin !== null) placePin(pin, cx, cy, label);
            return;
        }
        const x0 = cx - (lat.nx - 1) * lat.pitch / 2;
        const y0 = cy + (lat.ny - 1) * lat.pitch / 2;
        for (let r = 0; r < lat.grid.length; r++) {
            for (let c = 0; c < lat.grid[r].length; c++) {
                const px = x0 + c * lat.pitch;
                const py = y0 - r * lat.pitch;
                const pin = resolveToPin(lat.grid[r][c]);
                if (pin !== null) placePin(pin, px, py, `${label}_r${r}c${c}`);
            }
        }
    };

    if (coreLatId !== null && latDefs.has(coreLatId)) {
        const core = latDefs.get(coreLatId)!;
        const cx0 = -(core.nx - 1) * core.pitch / 2;
        const cy0 = (core.ny - 1) * core.pitch / 2;
        for (let r = 0; r < core.grid.length; r++) {
            for (let c = 0; c < core.grid[r].length; c++) {
                const ax = cx0 + c * core.pitch;
                const ay = cy0 - r * core.pitch;
                const uid = core.grid[r][c];
                if (latDefs.has(uid)) placeAssembly(uid, ax, ay, `asm_r${r}c${c}`);
                else {
                    const pin = resolveToPin(uid);
                    if (pin !== null) placePin(pin, ax, ay, `core_r${r}c${c}`);
                }
            }
        }
        const nested = [...latDefs.values()].some((l) => l.pitch < corePitch);
        if (nested) {
            notes.push(`Resolved a nested core lattice (${core.nx}×${core.ny} assemblies of ${core.name}).`);
        }
    } else if (latDefs.size > 0) {
        let offset = 0;
        for (const [id, lat] of latDefs) {
            placeAssembly(id, offset, 0, `lat${id}`);
            offset += lat.nx * lat.pitch + 5;
        }
    } else {
        // No lattice: lay out pins in a row.
        let offset = 0;
        for (const [id, pin] of pinDefs) {
            placePin(id, offset, 0, pin.name);
            const maxR = pin.radii.length ? Math.max(...pin.radii) : 1;
            offset += maxR * 3 + 0.5;
        }
    }

    if (discMode) {
        notes.push(`Full-core view: ${cylinders.length.toLocaleString()} pins drawn as single discs (one per position). Open a single assembly to see concentric pin layers.`);
    }
    if (capped) {
        warnings.push(`Geometry exceeded the ${MAX_CYLINDERS.toLocaleString()}-primitive safety cap and was truncated. Some pins are not shown.`);
    }

    // Vessel / barrel shells for full-reactor context.
    if (vessel.shells.length && cylinders.length > 0) {
        let footprint = 0;
        for (const cyl of cylinders) footprint = Math.max(footprint, Math.hypot(cyl.x, cyl.y) + cyl.radius);
        for (const s of vessel.shells) {
            if (s.radius && s.radius > footprint * 0.5) {
                cylinders.push({
                    label: `vessel_${s.id}`,
                    radius: s.radius,
                    height: coreHeight,
                    x: 0,
                    y: 0,
                    z: 0,
                    color: componentColor(Component.Vessel),
                    opacity: 0.12,
                    component: Component.Vessel,
                    material: 'Structure',
                });
            }
        }
    }

    return { cylinders, warnings, notes };
}

// ---------------------------------------------------------------------------
// Block / field parsing
// ---------------------------------------------------------------------------

function stripComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/!.*$/gm, ' ');
}

/** Finds every `name { … }` block whose body contains no nested `{`. */
function findLeafBlocks(text: string): LeafBlock[] {
    const blocks: LeafBlock[] = [];
    const re = /([A-Za-z_]\w*)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const open = re.lastIndex - 1;
        const close = matchBrace(text, open);
        if (close < 0) continue;
        const inner = text.slice(open + 1, close);
        if (!inner.includes('{')) {
            blocks.push({ name: m[1], inner });
        }
        // do not skip ahead: container blocks should still expose their leaves,
        // which the regex will find on subsequent iterations.
    }
    return blocks;
}

function matchBrace(text: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Returns the value token following `key` (`key value;`). */
function field(inner: string, key: string): string | null {
    const re = new RegExp(`(?:^|[;{\\s])${key}\\s+([^;()]+?)\\s*;`, 'i');
    const m = inner.match(re);
    return m ? m[1].trim() : null;
}

/** Returns the parenthesised content of `key ( … )`. */
function paren(inner: string, key: string): string {
    const re = new RegExp(`${key}\\s*\\(([^)]*)\\)`, 'i');
    const m = inner.match(re);
    return m ? m[1].trim() : '';
}

function numList(s: string): number[] {
    if (!s) return [];
    const out: number[] = [];
    for (const tok of s.split(/\s+/)) {
        const n = Number(tok);
        if (!Number.isNaN(n)) out.push(n);
    }
    return out;
}

function tokenList(s: string): string[] {
    if (!s) return [];
    return s.split(/\s+/).filter((t) => t.length > 0);
}

function num(s: string | null): number | null {
    if (s === null) return null;
    const n = Number(s.trim().split(/\s+/)[0]);
    return Number.isNaN(n) ? null : n;
}

function isSurfaceType(type: string): boolean {
    return /cylinder|sphere|trunccylinder|squarecylinder/.test(type);
}

function countPins(
    coreLatId: number | null,
    latDefs: Map<number, LatDef>,
    resolveToPin: (uid: number) => number | null,
): number {
    if (coreLatId === null || !latDefs.has(coreLatId)) {
        // sum of all lattice cells as a rough proxy
        let total = 0;
        for (const lat of latDefs.values()) total += lat.nx * lat.ny;
        return total;
    }
    const core = latDefs.get(coreLatId)!;
    let total = 0;
    for (const row of core.grid) {
        for (const uid of row) {
            const sub = latDefs.get(uid);
            if (sub) total += sub.nx * sub.ny;
            else if (resolveToPin(uid) !== null) total += 1;
        }
    }
    return total;
}

function collectVessel(surfaces: Map<number, SurfaceDef>): { shells: SurfaceDef[]; height: number | null } {
    const shells: SurfaceDef[] = [];
    let height: number | null = null;
    for (const s of surfaces.values()) {
        if ((s.type.includes('cylinder') || s.type.includes('sphere')) && s.radius) {
            shells.push(s);
        }
        if (s.type.includes('trunccylinder') && s.halfwidth) {
            height = Math.max(height ?? 0, s.halfwidth * 2);
        }
    }
    shells.sort((a, b) => (b.radius ?? 0) - (a.radius ?? 0));
    return { shells, height };
}
