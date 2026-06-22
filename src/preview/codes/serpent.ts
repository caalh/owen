// Serpent geometry extractor.
//
// Parses `pin <name>` blocks (material + optional radius, terminated by a bare
// material) and the first `lat` card with its grid rows. Components and colours
// are derived from the per-layer material name so the toggle UI works. Serpent
// `surf`/`cell` CSG and nested lattices are not expanded (see report) — pin +
// one lattice covers the common assembly.

import { CylinderSpec, ComponentId, ParseResult } from '../types';
import { emitLayers, materialColor, materialComponent } from '../palette';

const SERPENT_KEYWORDS = new Set([
    'pin', 'surf', 'cell', 'lat', 'set', 'mat', 'det', 'dep', 'plot', 'mesh', 'therm', 'include', 'trans',
]);

interface PinDef {
    radii: number[];
    materials: string[];
}

export function extractSerpentCylinders(text: string): CylinderSpec[] {
    return parseSerpent(text).cylinders;
}

export function parseSerpent(text: string): ParseResult {
    const warnings: string[] = [];
    const notes: string[] = [];
    const lines = text.split(/\r?\n/);

    const pins = new Map<string, PinDef>();
    let current: string | null = null;

    for (const raw of lines) {
        const s = raw.trim();
        if (!s || s.startsWith('%')) continue;
        const lower = s.toLowerCase();

        if (lower.startsWith('pin ')) {
            const tokens = s.split(/\s+/);
            current = tokens[1] ?? null;
            if (current) pins.set(current, { radii: [], materials: [] });
            continue;
        }
        if (current === null) continue;

        const tokens = s.split(/\s+/);
        if (SERPENT_KEYWORDS.has(tokens[0].toLowerCase())) { current = null; continue; }

        const matName = tokens[0];
        if (tokens.length >= 2) {
            const r = parseFloat(tokens[1]);
            if (!Number.isNaN(r)) {
                pins.get(current)!.radii.push(r);
                pins.get(current)!.materials.push(matName);
            } else {
                current = null;
            }
        } else {
            pins.get(current)!.materials.push(matName);
            current = null;
        }
    }

    // First lattice card + its grid rows.
    const latticeGrid: string[][] = [];
    let latPitch = 1.295;
    let latFound = false;

    for (let i = 0; i < lines.length; i++) {
        const s = lines[i].trim();
        if (!s || s.startsWith('%') || !s.toLowerCase().startsWith('lat ')) continue;
        const tokens = s.split(/\s+/);
        if (tokens.length >= 8) {
            const lp = parseFloat(tokens[7]);
            if (!Number.isNaN(lp)) { latPitch = lp; latFound = true; }
        } else if (tokens.length >= 4) {
            latFound = true;
        }
        for (let j = i + 1; j < lines.length; j++) {
            const rowS = lines[j].trim();
            if (!rowS || rowS.startsWith('%')) continue;
            const rowTokens = rowS.split(/\s+/);
            if (rowTokens.some((t) => pins.has(t))) latticeGrid.push(rowTokens);
            else break;
        }
        break;
    }

    const cylinders: CylinderSpec[] = [];
    const height = 40.0;

    const place = (pinName: string, x: number, y: number, label: string): void => {
        const pin = pins.get(pinName);
        if (pin && pin.radii.length) {
            const components: ComponentId[] = [];
            const colors: (string | undefined)[] = [];
            const mats: (string | undefined)[] = [];
            for (let i = 0; i < pin.radii.length; i++) {
                const matName = pin.materials[i] ?? `mat${i}`;
                components.push(materialComponent(matName));
                colors.push(materialColor(matName));
                mats.push(matName);
            }
            cylinders.push(...emitLayers(pin.radii, components, x, y, 0, height, label, colors, mats));
        }
    };

    if (latFound && latticeGrid.length > 0) {
        const nrows = latticeGrid.length;
        const ncols = latticeGrid.reduce((m, r) => Math.max(m, r.length), 0);
        const x0 = -(ncols - 1) * latPitch / 2;
        const y0 = (nrows - 1) * latPitch / 2;
        for (let r = 0; r < latticeGrid.length; r++) {
            for (let c = 0; c < latticeGrid[r].length; c++) {
                place(latticeGrid[r][c], x0 + c * latPitch, y0 - r * latPitch, `${latticeGrid[r][c]}_r${r}c${c}`);
            }
        }
        notes.push(`Expanded a ${nrows}×${ncols} lattice.`);
    } else {
        let offset = 0;
        for (const [name, pin] of pins) {
            if (!pin.radii.length) continue;
            place(name, offset, 0, name);
            offset += Math.max(...pin.radii) * 3 + 0.5;
        }
        if (pins.size > 0) notes.push('No lattice card found — laid out pin definitions side by side.');
    }

    if (/\bsurf\b/.test(text) && cylinders.length === 0) {
        warnings.push('Only `surf`/`cell` CSG was found; OWEN renders Serpent geometry from `pin` blocks and `lat` cards, which this deck does not define. Nothing to render.');
    }

    return { cylinders, warnings, notes };
}
