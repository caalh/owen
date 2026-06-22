// MCNP geometry extractor.
//
// MCNP geometry is constructive solid geometry over quadric surfaces. A full
// universe/`fill`/`lat` expansion is out of scope here; OWEN renders the
// z-axis cylinders that dominate pin/assembly previews:
//   - `cz r`            — cylinder on the z-axis (origin)
//   - `c/z x y r`       — cylinder parallel to z at (x, y)
// Axial extent comes from `pz` planes when present. `lat`/`fill` lattices and
// non-z-axis cylinders are reported, not silently dropped.

import { CylinderSpec, Component, ComponentId, ParseResult } from '../types';
import { componentColor } from '../palette';

interface MCNPSurface {
    id: string;
    type: 'cz' | 'cx' | 'cy' | 'c/z' | 'c/x' | 'c/y' | 'pz' | 'px' | 'py';
    params: number[];
}

const SURFACE_RE = /^\s*\*?(\d+)\s+(c\/z|c\/x|c\/y|cz|cx|cy|pz|px|py)\s+([-+0-9.eE\s]+)/i;

export function extractMcnpCylinders(text: string): CylinderSpec[] {
    return parseMcnp(text).cylinders;
}

export function parseMcnp(text: string): ParseResult {
    const warnings: string[] = [];
    const notes: string[] = [];
    const surfaces = parseSurfaces(text);
    const zBounds = findZPlaneBounds(surfaces);

    let height = 10.0;
    let zmid = 0;
    if (zBounds) {
        height = Math.max(0.1, zBounds.zmax - zBounds.zmin);
        zmid = (zBounds.zmax + zBounds.zmin) / 2;
    }

    const cylinders: CylinderSpec[] = [];
    let offAxis = 0;

    for (const surf of surfaces.values()) {
        if (surf.type === 'cz') {
            const radius = surf.params[0];
            if (radius > 0) cylinders.push(makeCyl(0, 0, zmid, radius, height, surf.id));
        } else if (surf.type === 'c/z') {
            // c/z x y r
            const [x, y, radius] = surf.params;
            if (radius > 0) cylinders.push(makeCyl(x ?? 0, y ?? 0, zmid, radius, height, surf.id));
        } else if (surf.type === 'cx' || surf.type === 'cy' || surf.type === 'c/x' || surf.type === 'c/y') {
            offAxis++;
        }
    }

    // Concentric z-axis cylinders at the same (x,y) get layered components so the
    // toggle UI is meaningful (innermost = fuel … outermost = moderator).
    assignComponents(cylinders);

    if (/\bfill\b|\blat\b/i.test(text)) {
        warnings.push('This deck uses `lat`/`fill` lattices. OWEN does not yet expand MCNP universe/lattice hierarchies, so repeated pins are not instantiated — only the explicitly-defined surfaces are shown.');
    }
    if (offAxis > 0) {
        notes.push(`${offAxis} non-z-axis cylinder(s) (cx/cy/c/x/c/y) were skipped — the preview renders z-axis cylinders only.`);
    }
    if (cylinders.length === 0) {
        warnings.push('No z-axis cylinders (cz / c/z) found. OWEN renders MCNP geometry from z-axis cylinders; macrobodies and other quadrics are not yet supported.');
    } else {
        notes.push(`Rendered ${cylinders.length} z-axis cylinder(s).`);
    }

    return { cylinders, warnings, notes };
}

function makeCyl(x: number, y: number, z: number, radius: number, height: number, surfaceId: string): CylinderSpec {
    return { x, y, z, radius, height, surfaceId, component: Component.Other, material: `surface ${surfaceId}` };
}

/** Group cylinders by (x,y); within a stack, assign fuel→gap→clad→moderator. */
function assignComponents(cylinders: CylinderSpec[]): void {
    const groups = new Map<string, CylinderSpec[]>();
    for (const c of cylinders) {
        const key = `${c.x.toFixed(3)},${c.y.toFixed(3)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(c);
    }
    const ladder: ComponentId[] = [Component.Fuel, Component.Gap, Component.Clad, Component.Moderator];
    for (const group of groups.values()) {
        group.sort((a, b) => a.radius - b.radius);
        let prevR = 0;
        group.forEach((c, i) => {
            const comp = ladder[Math.min(i, ladder.length - 1)];
            c.component = comp;
            c.color = componentColor(comp);
            c.innerRadius = prevR;
            prevR = c.radius;
        });
    }
}

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
