// Geometry extractor for the 3D preview webview. Ports the GROVES (Python)
// `analysis.py` scene-extraction logic to TypeScript so the OWEN preview can
// render MCNP, OpenMC, Serpent, and SCONE decks. The MCNP path is unchanged
// from v0.1.0; the OpenMC / Serpent / SCONE branches mirror
// `_parse_openmc_python`, `_parse_serpent`, and `_parse_scone` respectively.
//
// Algorithm parity (not "best possible parsing") is the design goal — see
// groves/src/groves/analysis.py for the source of truth.

export interface CylinderSpec {
    /** Axis-of-symmetry mid-point in cm. */
    x: number;
    y: number;
    z: number;
    radius: number;
    height: number;
    /** Inner radius for annular pin layers (default 0). */
    innerRadius?: number;
    /** Hex CSS color used by the webview when present. */
    color?: string;
    /** Opacity (0-1); webview falls back to its default when omitted. */
    opacity?: number;
    /** Human-readable label, useful in tests and debug overlays. */
    label?: string;
    materialId?: string;
    /** Optional surface id from the source deck (MCNP only). */
    surfaceId?: string;
}

// Palette + material-id colors mirror analysis.py exactly so the OWEN preview
// matches the GROVES PyVista scene at the per-cylinder level.
const DEFAULT_PALETTE: readonly string[] = [
    '#f4a261',
    '#2a9d8f',
    '#e76f51',
    '#90be6d',
    '#577590',
    '#f72585',
    '#4cc9f0',
    '#ffbe0b',
];

const DEFAULT_MATERIAL_COLORS: Readonly<Record<number, string>> = {
    1: '#ffb703', // fuel
    2: '#2a9d8f', // guide/water tube
    3: '#8ecae6', // clad
    4: '#4cc9f0', // water/moderator
};

/**
 * Extracts cylinder specs from an input deck. Dispatches to per-language
 * extractors; unknown languages return an empty array and log a warning.
 */
export function extractCylinders(text: string, language: string): CylinderSpec[] {
    switch (language) {
        case 'mcnp':
            return extractMcnpCylinders(text);
        case 'openmc':
            return extractOpenmcCylinders(text);
        case 'serpent':
            return extractSerpentCylinders(text);
        case 'scone':
            return extractSconeCylinders(text);
        default:
            console.warn(`[owen.preview] unknown language ${language}`);
            return [];
    }
}

// ---------------------------------------------------------------------------
// MCNP — unchanged from v0.1.0
// ---------------------------------------------------------------------------

interface MCNPSurface {
    id: string;
    type: 'cz' | 'cx' | 'cy' | 'pz' | 'px' | 'py';
    params: number[];
}

const SURFACE_RE = /^\s*\*?(\d+)\s+(cz|cx|cy|pz|px|py)\s+([-+0-9. eE]+)/i;
const CELL_RE = /^\s*(\d+)\s+(\d+|0)\b([^$]*)/;

function parseSurfaces(text: string): Map<string, MCNPSurface> {
    const map = new Map<string, MCNPSurface>();
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed || /^c(\s|$)/i.test(trimmed)) continue;
        const m = raw.match(SURFACE_RE);
        if (!m) continue;
        const params = m[3]
            .replace(/\$.*$/, '')
            .trim()
            .split(/\s+/)
            .map(parseFloat)
            .filter((n) => !isNaN(n));
        map.set(m[1], { id: m[1], type: m[2].toLowerCase() as MCNPSurface['type'], params });
    }
    return map;
}

function findZPlaneBounds(surfaces: Map<string, MCNPSurface>): { zmin: number; zmax: number } | null {
    const pzs: number[] = [];
    for (const s of surfaces.values()) {
        if (s.type === 'pz') pzs.push(s.params[0]);
    }
    if (pzs.length >= 2) {
        return { zmin: Math.min(...pzs), zmax: Math.max(...pzs) };
    }
    return null;
}

function extractMcnpCylinders(text: string): CylinderSpec[] {
    const surfaces = parseSurfaces(text);
    const zBounds = findZPlaneBounds(surfaces);
    const defaultHeight = 10.0;
    const cylinders: CylinderSpec[] = [];

    const lines = text.split(/\r?\n/);
    const cellSurfaceUsage = new Map<string, Set<string>>();
    for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed || /^c(\s|$)/i.test(trimmed)) continue;
        const m = raw.match(CELL_RE);
        if (!m) continue;
        const surfRefs = (m[3].match(/-?\d+/g) ?? []).map((s) => s.replace(/^-/, ''));
        for (const ref of surfRefs) {
            if (!cellSurfaceUsage.has(ref)) cellSurfaceUsage.set(ref, new Set());
            cellSurfaceUsage.get(ref)!.add(m[1]);
        }
    }

    for (const surf of surfaces.values()) {
        if (surf.type !== 'cz') continue;
        const radius = surf.params[0];
        if (isNaN(radius) || radius <= 0) continue;

        let height = defaultHeight;
        let zmid = 0;
        if (zBounds) {
            height = zBounds.zmax - zBounds.zmin;
            zmid = (zBounds.zmax + zBounds.zmin) / 2;
        }

        cylinders.push({
            x: 0,
            y: 0,
            z: zmid,
            radius,
            height,
            surfaceId: surf.id,
        });
    }

    return cylinders.sort((a, b) => a.radius - b.radius);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Mirrors `_extract_numbers` in analysis.py. */
function extractNumbers(text: string): number[] {
    const matches = text.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
    if (!matches) return [];
    const out: number[] = [];
    for (const m of matches) {
        const n = Number(m);
        if (!Number.isNaN(n)) out.push(n);
    }
    return out;
}

/** Mirrors `_emit_pin_layers` in analysis.py — concentric annular cylinders. */
function emitPinLayers(
    radii: number[],
    x: number,
    y: number,
    height: number,
    labelPrefix: string,
): CylinderSpec[] {
    const cyls: CylinderSpec[] = [];
    let prevR = 0.0;
    radii.forEach((r, i) => {
        const matId = i + 1;
        const color = DEFAULT_MATERIAL_COLORS[matId] ?? DEFAULT_PALETTE[matId % DEFAULT_PALETTE.length];
        cyls.push({
            label: `${labelPrefix}_L${i}`,
            radius: Math.max(0.05, r),
            height,
            x,
            y,
            z: 0,
            color,
            innerRadius: prevR,
            opacity: 1.0,
        });
        prevR = r;
    });
    return cyls;
}

// ---------------------------------------------------------------------------
// OpenMC — port of `_parse_openmc_python`
// ---------------------------------------------------------------------------

function extractOpenmcCylinders(text: string): CylinderSpec[] {
    const lines = text.split(/\r?\n/);

    let pitch: number | null = null;
    let fuelRadius: number | null = null;
    let cladOuterRadius: number | null = null;
    let fuelHeight: number | null = null;
    let latticeSize: [number, number] | null = null;
    const guidePositions = new Set<string>();
    let hasLattice = false;

    for (let i = 0; i < lines.length; i++) {
        const s = lines[i].trim();
        const sl = s.toLowerCase();

        if (sl.includes('rectlattice') || sl.includes('universes')) {
            hasLattice = true;
        }

        if (sl.includes('pitch') && s.includes('=')) {
            const nums = extractNumbers(s);
            if (nums.length && !sl.includes('lattice.pitch')) {
                pitch = nums[0];
            }
        }

        if (
            sl.includes('fuel_radius') ||
            sl.includes('fuel_or') ||
            (s.includes('ZCylinder') && sl.includes('fuel'))
        ) {
            const nums = extractNumbers(s);
            if (nums.length) fuelRadius = nums[0];
        }

        if (sl.includes('fuel_height') || (sl.includes('height') && sl.includes('active'))) {
            if (s.includes('=') && !sl.includes('clad')) {
                const nums = extractNumbers(s);
                if (nums.length) fuelHeight = nums[0];
            }
        }

        if (
            sl.includes('clad_outer') ||
            sl.includes('clad_or') ||
            (s.includes('ZCylinder') && sl.includes('clad'))
        ) {
            const nums = extractNumbers(s);
            if (nums.length) cladOuterRadius = nums[nums.length - 1];
        }

        if (sl.includes('guide_tube_coords') || sl.includes('guide_positions')) {
            let j = i;
            while (j < lines.length) {
                const coordLine = lines[j];
                const matches = coordLine.matchAll(/\((\d+),\s*(\d+)\)/g);
                for (const m of matches) {
                    guidePositions.add(`${m[1]},${m[2]}`);
                }
                if (coordLine.includes(']') && j > i) break;
                j++;
            }
            if (guidePositions.size > 0) {
                let mr = 0;
                let mc = 0;
                for (const key of guidePositions) {
                    const [rs, cs] = key.split(',');
                    const r = parseInt(rs, 10);
                    const c = parseInt(cs, 10);
                    if (r > mr) mr = r;
                    if (c > mc) mc = c;
                }
                mr += 1;
                mc += 1;
                latticeSize = [Math.max(mr, 17), Math.max(mc, 17)];
            }
        }
    }

    if (pitch === null) pitch = 1.26;
    if (fuelRadius === null) fuelRadius = 0.41;
    if (cladOuterRadius === null) cladOuterRadius = fuelRadius < 0.42 ? 0.475 : fuelRadius + 0.05;
    if (fuelHeight === null) fuelHeight = 40.0;

    const pinRadii = [fuelRadius, cladOuterRadius];

    if (!hasLattice || latticeSize === null) {
        return emitPinLayers(pinRadii, 0, 0, fuelHeight, 'pin');
    }

    const [rows, cols] = latticeSize;
    const x0 = -(cols - 1) * pitch / 2.0;
    const y0 = (rows - 1) * pitch / 2.0;
    const cylinders: CylinderSpec[] = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = x0 + c * pitch;
            const y = y0 - r * pitch;
            if (guidePositions.has(`${r},${c}`)) {
                const gtR = cladOuterRadius * 1.2;
                cylinders.push({
                    label: `guide_r${r}c${c}`,
                    radius: gtR,
                    height: fuelHeight,
                    x,
                    y,
                    z: 0,
                    color: DEFAULT_MATERIAL_COLORS[2] ?? DEFAULT_PALETTE[1],
                    innerRadius: 0,
                    opacity: 1.0,
                });
            } else {
                cylinders.push(...emitPinLayers(pinRadii, x, y, fuelHeight, `pin_r${r}c${c}`));
            }
        }
    }

    return cylinders;
}

// ---------------------------------------------------------------------------
// Serpent — port of `_parse_serpent`
// ---------------------------------------------------------------------------

const SERPENT_KEYWORDS = new Set([
    'pin',
    'surf',
    'cell',
    'lat',
    'set',
    'mat',
    'det',
    'dep',
    'plot',
    'mesh',
    'therm',
    'include',
]);

function extractSerpentCylinders(text: string): CylinderSpec[] {
    const lines = text.split(/\r?\n/);

    // Pass 1 — gather pin definitions.
    const pins = new Map<string, number[]>();
    const pinMaterials = new Map<string, string[]>();
    let currentPin: string | null = null;

    for (const raw of lines) {
        const s = raw.trim();
        if (!s || s.startsWith('%')) continue;

        const lower = s.toLowerCase();
        if (lower.startsWith('pin ')) {
            const tokens = s.split(/\s+/);
            if (tokens.length >= 2) {
                currentPin = tokens[1];
                pins.set(currentPin, []);
                pinMaterials.set(currentPin, []);
            }
            continue;
        }

        if (currentPin === null) continue;

        const tokens = s.split(/\s+/);
        if (!tokens.length) continue;

        if (SERPENT_KEYWORDS.has(tokens[0].toLowerCase())) {
            // A keyword line terminates the current pin block. The outer-if
            // above already handles `pin ` starts, so we just reset here.
            currentPin = null;
            continue;
        }

        const matName = tokens[0];
        if (tokens.length >= 2) {
            const r = parseFloat(tokens[1]);
            if (!Number.isNaN(r)) {
                pins.get(currentPin)!.push(r);
                pinMaterials.get(currentPin)!.push(matName);
            } else {
                currentPin = null;
            }
        } else {
            // Outermost layer (no radius) — closes the pin block.
            pinMaterials.get(currentPin)!.push(matName);
            currentPin = null;
        }
    }

    // Pass 2 — find the first lattice card and its grid rows.
    const latticeGrid: string[][] = [];
    let latPitch = 1.295;
    let latFound = false;

    for (let i = 0; i < lines.length; i++) {
        const s = lines[i].trim();
        if (!s || s.startsWith('%')) continue;
        if (!s.toLowerCase().startsWith('lat ')) continue;

        const tokens = s.split(/\s+/);
        // lat <id> <type> <x0> <y0> <nx> <ny> <pitch>
        if (tokens.length >= 8) {
            const lp = parseFloat(tokens[7]);
            const nx = parseInt(tokens[5], 10);
            const ny = parseInt(tokens[6], 10);
            if (!Number.isNaN(lp) && !Number.isNaN(nx) && !Number.isNaN(ny)) {
                latPitch = lp;
                latFound = true;
            }
        } else if (tokens.length >= 4) {
            latFound = true;
        }

        let j = i + 1;
        while (j < lines.length) {
            const rowS = lines[j].trim();
            if (!rowS || rowS.startsWith('%')) {
                j++;
                continue;
            }
            const rowTokens = rowS.split(/\s+/);
            if (rowTokens.some((t) => pins.has(t))) {
                latticeGrid.push(rowTokens);
                j++;
            } else {
                break;
            }
        }
        break; // only the first lattice (matches Python)
    }

    const cylinders: CylinderSpec[] = [];
    const defaultHeight = 40.0;

    if (latFound && latticeGrid.length > 0) {
        const nrows = latticeGrid.length;
        const ncols = latticeGrid.reduce((m, r) => Math.max(m, r.length), 0);
        const x0 = -(ncols - 1) * latPitch / 2.0;
        const y0 = (nrows - 1) * latPitch / 2.0;

        for (let rIdx = 0; rIdx < latticeGrid.length; rIdx++) {
            const row = latticeGrid[rIdx];
            for (let cIdx = 0; cIdx < row.length; cIdx++) {
                const pinName = row[cIdx];
                const x = x0 + cIdx * latPitch;
                const y = y0 - rIdx * latPitch;
                const radii = pins.get(pinName);
                if (radii && radii.length) {
                    cylinders.push(
                        ...emitPinLayers(radii, x, y, defaultHeight, `${pinName}_r${rIdx}c${cIdx}`),
                    );
                } else {
                    cylinders.push({
                        label: `${pinName}_r${rIdx}c${cIdx}`,
                        radius: latPitch * 0.35,
                        height: defaultHeight,
                        x,
                        y,
                        z: 0,
                        color: DEFAULT_MATERIAL_COLORS[4] ?? DEFAULT_PALETTE[6],
                        innerRadius: 0,
                        opacity: 0.3,
                    });
                }
            }
        }
    } else {
        let xOffset = 0;
        for (const [pinName, radii] of pins.entries()) {
            if (!radii.length) continue;
            cylinders.push(...emitPinLayers(radii, xOffset, 0, defaultHeight, pinName));
            xOffset += Math.max(...radii) * 3 + 0.5;
        }
    }

    return cylinders;
}

// ---------------------------------------------------------------------------
// SCONE — port of `_parse_scone`
// ---------------------------------------------------------------------------

const SCONE_MAT_COLOR_MAP: Readonly<Record<string, string>> = {
    uo2: '#ffb703',
    fuel: '#ffb703',
    water: '#4cc9f0',
    h2o: '#4cc9f0',
    zircaloy: '#8ecae6',
    zirc: '#8ecae6',
    helium: '#ffe4b5',
    he: '#ffe4b5',
    ss304: '#b0b0b0',
    stainlesssteel: '#b0b0b0',
    inconel: '#a0a0a0',
    b4c: '#2d2d2d',
    'ag-in-cd': '#c0c0c0',
    air: '#f0f0f0',
    borosilicateglass: '#8b6914',
    carbonsteel: '#708090',
};

function sconeMatColor(matName: string): string {
    const low = matName.toLowerCase().replace(/\s+/g, '');
    for (const key of Object.keys(SCONE_MAT_COLOR_MAP)) {
        if (low.includes(key)) return SCONE_MAT_COLOR_MAP[key];
    }
    // Deterministic fallback hash (Python uses hash(); we use a stable djb2-ish hash).
    let h = 0;
    for (let i = 0; i < matName.length; i++) {
        h = (h * 31 + matName.charCodeAt(i)) | 0;
    }
    return DEFAULT_PALETTE[Math.abs(h) % DEFAULT_PALETTE.length];
}

interface SconeLatDef {
    pitch: number;
    nx: number;
    ny: number;
    grid: number[][];
}

function extractSconeCylinders(text: string): CylinderSpec[] {
    const fullText = text;

    // --- Pin universes ---
    const pinDefs = new Map<number, number[]>();
    const pinMats = new Map<number, string[]>();
    const pinRe = /(\w+)\s*\{\s*id\s+(\d+)\s*;\s*type\s+pinUniverse\s*;\s*radii\s*\(([^)]+)\)\s*;\s*fills\s*\(([^)]+)\)\s*;\s*\}/gis;
    for (const m of fullText.matchAll(pinRe)) {
        const uid = parseInt(m[2], 10);
        if (Number.isNaN(uid)) continue;
        const radii: number[] = [];
        for (const tok of m[3].trim().split(/\s+/)) {
            const r = parseFloat(tok);
            if (!Number.isNaN(r) && r > 0) radii.push(r);
        }
        pinDefs.set(uid, radii);
        pinMats.set(uid, m[4].trim().split(/\s+/));
    }

    // --- Lattice universes ---
    const latDefs = new Map<number, SconeLatDef>();
    const latRe = /(\w+)\s*\{\s*id\s+(\d+)\s*;\s*type\s+latUniverse\s*;\s*origin\s*\([^)]*\)\s*;\s*pitch\s*\(([^)]+)\)\s*;\s*shape\s*\(([^)]+)\)\s*;\s*padMat\s+\w+\s*;\s*map\s*\(([^)]+)\)\s*;\s*\}/gis;
    for (const m of fullText.matchAll(latRe)) {
        const uid = parseInt(m[2], 10);
        if (Number.isNaN(uid)) continue;
        const pitchTok = m[3].trim().split(/\s+/);
        const shapeTok = m[4].trim().split(/\s+/);
        const pitchX = parseFloat(pitchTok[0]);
        const nx = parseInt(shapeTok[0], 10);
        const ny = parseInt(shapeTok[1], 10);
        if (Number.isNaN(pitchX) || Number.isNaN(nx) || Number.isNaN(ny)) continue;
        const mapVals = m[5].trim().split(/\s+/);
        const grid: number[][] = [];
        let idx = 0;
        for (let row = 0; row < ny; row++) {
            const rowList: number[] = [];
            for (let col = 0; col < nx; col++) {
                if (idx < mapVals.length) {
                    const v = parseInt(mapVals[idx], 10);
                    rowList.push(Number.isNaN(v) ? 0 : v);
                    idx++;
                }
            }
            grid.push(rowList);
        }
        latDefs.set(uid, { pitch: pitchX, nx, ny, grid });
    }

    // --- cellUniverse resolution ---
    const cellToUni = new Map<number, number>();
    const cellToUniRe = /\bid\s+(\d+)\s*;[^}]*?filltype\s+uni\s*;\s*universe\s+(\d+)/gi;
    for (const cm of fullText.matchAll(cellToUniRe)) {
        const cid = parseInt(cm[1], 10);
        const uid = parseInt(cm[2], 10);
        if (!Number.isNaN(cid) && !Number.isNaN(uid)) cellToUni.set(cid, uid);
    }

    const cellUniCells = new Map<number, number[]>();
    const cellUniRe = /\bid\s+(\d+)\s*;\s*type\s+cellUniverse\s*;\s*cells\s*\(([^)]+)\)/gis;
    for (const cm of fullText.matchAll(cellUniRe)) {
        const cuid = parseInt(cm[1], 10);
        if (Number.isNaN(cuid)) continue;
        const cids: number[] = [];
        for (const tok of cm[2].trim().split(/\s+/)) {
            const v = parseInt(tok, 10);
            if (!Number.isNaN(v)) cids.push(v);
        }
        cellUniCells.set(cuid, cids);
    }

    const cellUniToPin = new Map<number, number>();
    for (const [cuid, cids] of cellUniCells.entries()) {
        const counts = new Map<number, number>();
        for (const cid of cids) {
            const ref = cellToUni.get(cid);
            if (ref !== undefined && pinDefs.has(ref)) {
                counts.set(ref, (counts.get(ref) ?? 0) + 1);
            }
        }
        if (counts.size > 0) {
            let bestPin = -1;
            let bestCount = -1;
            for (const [pin, n] of counts.entries()) {
                if (n > bestCount) {
                    bestCount = n;
                    bestPin = pin;
                }
            }
            if (bestPin >= 0) cellUniToPin.set(cuid, bestPin);
        }
    }

    const resolveToPin = (uid: number): number | null => {
        if (pinDefs.has(uid)) return uid;
        const ref = cellUniToPin.get(uid);
        return ref === undefined ? null : ref;
    };

    // --- Core lattice = lattice with largest pitch ---
    let coreLatId: number | null = null;
    let corePitch = 0;
    for (const [uid, lat] of latDefs.entries()) {
        if (lat.pitch > corePitch) {
            corePitch = lat.pitch;
            coreLatId = uid;
        }
    }

    // Count total pin positions to choose viz mode.
    let totalPinPositions = 0;
    if (coreLatId !== null && latDefs.has(coreLatId)) {
        const core = latDefs.get(coreLatId)!;
        for (const arow of core.grid) {
            for (const asmUid of arow) {
                if (latDefs.has(asmUid)) {
                    const asm = latDefs.get(asmUid)!;
                    for (const prow of asm.grid) {
                        for (const mapUid of prow) {
                            if (resolveToPin(mapUid) !== null) totalPinPositions++;
                        }
                    }
                } else if (resolveToPin(asmUid) !== null) {
                    totalPinPositions++;
                }
            }
        }
    }

    const MAX_CYLINDERS = 15000;
    const coreMapMode = totalPinPositions > 500;

    let discRadius = 0;
    let discHeight = 0;

    if (coreMapMode) {
        const subPitches: number[] = [];
        for (const lat of latDefs.values()) {
            if (lat.pitch < corePitch) subPitches.push(lat.pitch);
        }
        const pinPitch = subPitches.length ? Math.min(...subPitches) : 1.26;
        discRadius = pinPitch * 0.45;
        discHeight = pinPitch * 0.25;
    } else {
        let maxPinRadius = 1.0;
        for (const radii of pinDefs.values()) {
            for (const r of radii) {
                if (r > maxPinRadius) maxPinRadius = r;
            }
        }
        discHeight = Math.max(0.5, Math.min(maxPinRadius * 3.0, 4.0));
    }

    const cylinders: CylinderSpec[] = [];

    const placePin = (uid: number, cx: number, cy: number, labelPrefix: string): void => {
        if (cylinders.length >= MAX_CYLINDERS) return;
        const radii = pinDefs.get(uid);
        const mats = pinMats.get(uid) ?? [];
        if (!radii || !radii.length) return;

        if (coreMapMode) {
            const color = sconeMatColor(mats[0] ?? 'unknown');
            cylinders.push({
                label: labelPrefix,
                radius: discRadius,
                height: discHeight,
                x: cx,
                y: cy,
                z: 0,
                color,
            });
        } else {
            let prevR = 0;
            for (let i = 0; i < radii.length; i++) {
                const r = radii[i];
                const matName = mats[i] ?? `mat${i}`;
                cylinders.push({
                    label: `${labelPrefix}_L${i}`,
                    radius: r,
                    height: discHeight,
                    x: cx,
                    y: cy,
                    z: 0,
                    color: sconeMatColor(matName),
                    innerRadius: prevR,
                    opacity: 1.0,
                });
                prevR = r;
            }
        }
    };

    const placeAssembly = (asmUid: number, asmCx: number, asmCy: number, asmLabel: string): void => {
        const lat = latDefs.get(asmUid);
        if (!lat) {
            const pinUid = resolveToPin(asmUid);
            if (pinUid !== null) placePin(pinUid, asmCx, asmCy, asmLabel);
            return;
        }
        const { pitch, nx, ny, grid } = lat;
        const x0 = asmCx - (nx - 1) * pitch / 2.0;
        const y0 = asmCy + (ny - 1) * pitch / 2.0;
        for (let rIdx = 0; rIdx < grid.length; rIdx++) {
            const row = grid[rIdx];
            for (let cIdx = 0; cIdx < row.length; cIdx++) {
                const px = x0 + cIdx * pitch;
                const py = y0 - rIdx * pitch;
                const pinUid = resolveToPin(row[cIdx]);
                if (pinUid !== null) placePin(pinUid, px, py, `${asmLabel}_r${rIdx}c${cIdx}`);
            }
        }
    };

    if (coreLatId !== null && latDefs.has(coreLatId)) {
        const core = latDefs.get(coreLatId)!;
        const cx0 = -(core.nx - 1) * core.pitch / 2.0;
        const cy0 = (core.ny - 1) * core.pitch / 2.0;
        for (let ar = 0; ar < core.grid.length; ar++) {
            const arow = core.grid[ar];
            for (let ac = 0; ac < arow.length; ac++) {
                const asmUid = arow[ac];
                const ax = cx0 + ac * core.pitch;
                const ay = cy0 - ar * core.pitch;
                if (latDefs.has(asmUid)) {
                    placeAssembly(asmUid, ax, ay, `asm_r${ar}c${ac}`);
                } else {
                    const pinUid = resolveToPin(asmUid);
                    if (pinUid !== null) placePin(pinUid, ax, ay, `core_r${ar}c${ac}`);
                }
            }
        }
    } else if (latDefs.size > 0) {
        let offsetX = 0;
        for (const [uid, lat] of latDefs.entries()) {
            placeAssembly(uid, offsetX, 0, `lat${uid}`);
            offsetX += lat.nx * lat.pitch + 5.0;
        }
    } else {
        let offsetX = 0;
        for (const [uid, radii] of pinDefs.entries()) {
            placePin(uid, offsetX, 0, `pin${uid}`);
            const maxR = radii.length ? Math.max(...radii) : 1.0;
            offsetX += maxR * 3 + 0.5;
        }
    }

    return cylinders;
}
