// Colors, material/component classification, and small numeric helpers shared
// by every per-code parser.

import { Component, ComponentId } from './types';

export const DEFAULT_PALETTE: readonly string[] = [
    '#f4a261',
    '#2a9d8f',
    '#e76f51',
    '#90be6d',
    '#577590',
    '#f72585',
    '#4cc9f0',
    '#ffbe0b',
];

/** Canonical color per logical component. */
export const COMPONENT_COLORS: Readonly<Record<string, string>> = {
    [Component.Fuel]: '#ffb703',
    [Component.Gap]: '#ffe4b5',
    [Component.Clad]: '#8ecae6',
    [Component.Moderator]: '#4cc9f0',
    [Component.GuideTube]: '#2a9d8f',
    [Component.InstrumentTube]: '#a3b18a',
    [Component.Absorber]: '#2d2d2d',
    [Component.Structure]: '#b0b0b0',
    [Component.Reflector]: '#9d8189',
    [Component.Vessel]: '#6c757d',
    [Component.Other]: '#577590',
};

export function componentColor(component: ComponentId): string {
    return COMPONENT_COLORS[component] ?? COMPONENT_COLORS[Component.Other];
}

// Material-name -> color (used when a parser knows the raw material name but we
// still want a stable, physically-suggestive color).
const MATERIAL_COLOR_MAP: Readonly<Record<string, string>> = {
    uo2: '#ffb703',
    fuel: '#ffb703',
    mox: '#fb8500',
    water: '#4cc9f0',
    h2o: '#4cc9f0',
    coolant: '#4cc9f0',
    moderator: '#4cc9f0',
    borated: '#4895ef',
    zircaloy: '#8ecae6',
    zirc: '#8ecae6',
    zr: '#8ecae6',
    clad: '#8ecae6',
    helium: '#ffe4b5',
    he: '#ffe4b5',
    air: '#f0f0f0',
    gap: '#ffe4b5',
    ss304: '#b0b0b0',
    ss: '#b0b0b0',
    stainlesssteel: '#b0b0b0',
    steel: '#b0b0b0',
    inconel: '#a0a0a0',
    b4c: '#2d2d2d',
    boron: '#2d2d2d',
    'ag-in-cd': '#c0c0c0',
    agincd: '#c0c0c0',
    borosilicateglass: '#8b6914',
    glass: '#8b6914',
    carbonsteel: '#708090',
    graphite: '#3a3a3a',
};

export function materialColor(materialName: string): string {
    const low = materialName.toLowerCase().replace(/[\s_-]+/g, '');
    for (const key of Object.keys(MATERIAL_COLOR_MAP)) {
        if (low.includes(key.replace(/[-]/g, ''))) return MATERIAL_COLOR_MAP[key];
    }
    let h = 0;
    for (let i = 0; i < materialName.length; i++) {
        h = (h * 31 + materialName.charCodeAt(i)) | 0;
    }
    return DEFAULT_PALETTE[Math.abs(h) % DEFAULT_PALETTE.length];
}

/**
 * Maps a raw material name to a logical component for the toggle UI. This is a
 * heuristic and intentionally conservative; unknown materials fall back to the
 * supplied default (often a positional guess from the parser).
 */
export function materialComponent(materialName: string, fallback: ComponentId = Component.Other): ComponentId {
    const low = materialName.toLowerCase();
    if (/(uo2|mox|fuel|pu239|u235|u238)/.test(low)) return Component.Fuel;
    if (/(zirc|zr|clad)/.test(low)) return Component.Clad;
    if (/(helium|\bhe\b|gap)/.test(low)) return Component.Gap;
    if (/(water|h2o|coolant|moderat|borated)/.test(low)) return Component.Moderator;
    if (/(b4c|boron|ag-?in-?cd|hafnium|absorb)/.test(low)) return Component.Absorber;
    if (/(steel|inconel|ss304|\bss\b|nozzle|support|grid|spring)/.test(low)) return Component.Structure;
    if (/(air|void)/.test(low)) return Component.Gap;
    if (/(glass|borosilicate)/.test(low)) return Component.Absorber;
    if (/(graphite|reflector)/.test(low)) return Component.Reflector;
    return fallback;
}

/** Mirrors `_extract_numbers` in GROVES analysis.py. */
export function extractNumbers(text: string): number[] {
    const matches = text.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
    if (!matches) return [];
    const out: number[] = [];
    for (const m of matches) {
        const n = Number(m);
        if (!Number.isNaN(n)) out.push(n);
    }
    return out;
}

/**
 * Builds nested concentric shells for a pin from a list of outer radii and a
 * parallel list of component ids. The first radius is the innermost layer.
 */
export function emitLayers(
    radii: number[],
    components: ComponentId[],
    x: number,
    y: number,
    z: number,
    height: number,
    labelPrefix: string,
    colors?: (string | undefined)[],
    materials?: (string | undefined)[],
): import('./types').CylinderSpec[] {
    const cyls: import('./types').CylinderSpec[] = [];
    let prevR = 0;
    for (let i = 0; i < radii.length; i++) {
        const r = radii[i];
        if (!(r > 0)) {
            prevR = Math.max(prevR, 0);
            continue;
        }
        const comp = components[i] ?? Component.Other;
        cyls.push({
            label: `${labelPrefix}_L${i}`,
            radius: Math.max(0.02, r),
            height,
            x,
            y,
            z,
            innerRadius: prevR,
            color: colors?.[i] ?? componentColor(comp),
            opacity: 1.0,
            component: comp,
            material: materials?.[i],
        });
        prevR = r;
    }
    return cyls;
}
