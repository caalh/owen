#!/usr/bin/env node
// Export NRDP elements + commonMaterials from the sibling reactor-monte-carlo-guide
// repo into JSON snapshots bundled with the OWEN VSIX.
//
// Reads:
//   ../../reactor-monte-carlo-guide/src/data/elements.ts
//   ../../reactor-monte-carlo-guide/src/data/commonMaterials.ts
// Writes:
//   owen/data/nrdp-elements.json
//   owen/data/nrdp-materials.json
//
// Strategy: the source files are TS but the *data* sections are valid JS literals.
// We slice out the array literal between known sentinels and evaluate it inside
// a Function with a stubbed `e(...)` helper for elements. If anything goes wrong
// we write an empty array + log a clear warning so the build never fails.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const guideRoot = path.resolve(repoRoot, '..', '..', 'reactor-monte-carlo-guide');
const dataDir = path.resolve(repoRoot, 'data');

const ELEMENTS_SRC = path.join(guideRoot, 'src', 'data', 'elements.ts');
const MATERIALS_SRC = path.join(guideRoot, 'src', 'data', 'commonMaterials.ts');

async function ensureDir(dir) {
    await mkdir(dir, { recursive: true });
}

function sliceArrayLiteral(source, markerRegex) {
    const m = source.match(markerRegex);
    if (!m) return null;
    const afterMatch = m.index + m[0].length;
    const start = source.indexOf('[', afterMatch);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];
        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') { inBlockComment = false; i++; }
            continue;
        }
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === stringChar) inString = false;
            continue;
        }
        if (inTemplate) {
            if (ch === '\\') { i++; continue; }
            if (ch === '`') inTemplate = false;
            continue;
        }
        if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (ch === '"' || ch === '\'') { inString = true; stringChar = ch; continue; }
        if (ch === '`') { inTemplate = true; continue; }
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return null;
}

async function exportElements() {
    let src;
    try {
        src = await readFile(ELEMENTS_SRC, 'utf8');
    } catch (err) {
        console.warn(`[export-nrdp] elements source missing (${ELEMENTS_SRC}): ${err.message}`);
        return [];
    }
    const literal = sliceArrayLiteral(src, /export\s+const\s+elements\s*:\s*Element\s*\[\]\s*=/);
    if (!literal) {
        console.warn('[export-nrdp] could not locate elements array literal — writing empty');
        return [];
    }
    try {
        const factory = new Function(
            'e',
            `return ${literal};`,
        );
        const e = (z, symbol, name, category, row, col, atomicMass) =>
            ({ z, symbol, name, category, row, col, atomicMass });
        const arr = factory(e);
        if (!Array.isArray(arr)) throw new Error('elements literal did not eval to an array');
        return arr;
    } catch (err) {
        console.warn(`[export-nrdp] failed to eval elements array: ${err.message}`);
        return [];
    }
}

async function exportMaterials() {
    let src;
    try {
        src = await readFile(MATERIALS_SRC, 'utf8');
    } catch (err) {
        console.warn(`[export-nrdp] materials source missing (${MATERIALS_SRC}): ${err.message}`);
        return [];
    }
    const literal = sliceArrayLiteral(
        src,
        /export\s+const\s+commonMaterials\s*:\s*CommonMaterial\s*\[\]\s*=/,
    );
    if (!literal) {
        console.warn('[export-nrdp] could not locate commonMaterials array literal — writing empty');
        return [];
    }
    try {
        const factory = new Function(`return ${literal};`);
        const arr = factory();
        if (!Array.isArray(arr)) throw new Error('commonMaterials literal did not eval to an array');
        return arr;
    } catch (err) {
        console.warn(`[export-nrdp] failed to eval commonMaterials array: ${err.message}`);
        return [];
    }
}

async function main() {
    await ensureDir(dataDir);

    const elements = await exportElements();
    const materials = await exportMaterials();

    const elementsOut = path.join(dataDir, 'nrdp-elements.json');
    const materialsOut = path.join(dataDir, 'nrdp-materials.json');

    await writeFile(elementsOut, JSON.stringify(elements, null, 2) + '\n', 'utf8');
    await writeFile(materialsOut, JSON.stringify(materials, null, 2) + '\n', 'utf8');

    console.log(`[export-nrdp] wrote ${elements.length} elements -> ${elementsOut}`);
    console.log(`[export-nrdp] wrote ${materials.length} materials -> ${materialsOut}`);
}

main().catch((err) => {
    console.error('[export-nrdp] unexpected failure', err);
    process.exit(1);
});
