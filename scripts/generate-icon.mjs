#!/usr/bin/env node
// Generate a 128x128 marketplace icon for the OWEN extension.
// Renders a deep-blue gradient disc with the letter "O" in a lighter blue.
// Uses pngjs for PNG encoding; if pngjs isn't available we fall back to a
// 1x1 transparent placeholder so the build never fails.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(repoRoot, 'assets');
const iconPath = path.join(assetsDir, 'owen-icon.png');

const SIZE = 128;

// Letter "O" rendered on a 7x7 stencil that we upscale by font_scale to fit the disc.
const O_STENCIL = [
    '.#####.',
    '##...##',
    '#.....#',
    '#.....#',
    '#.....#',
    '##...##',
    '.#####.',
];

async function main() {
    await mkdir(assetsDir, { recursive: true });

    let pngClass;
    try {
        const mod = await import('pngjs');
        pngClass = mod.PNG;
    } catch (err) {
        console.warn('[generate-icon] pngjs unavailable, writing 1x1 placeholder:', err.message);
        await writeFile(iconPath, transparentPlaceholderBytes());
        console.warn('[generate-icon] PLACEHOLDER written — replace assets/owen-icon.png with a real 128x128 icon.');
        return;
    }

    const png = new pngClass({ width: SIZE, height: SIZE });
    const center = (SIZE - 1) / 2;
    const radius = SIZE / 2 - 2;
    const radiusInner = radius * 0.62;

    // Background gradient + disc
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const idx = (SIZE * y + x) * 4;
            const dx = x - center;
            const dy = y - center;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > radius) {
                png.data[idx] = 0;
                png.data[idx + 1] = 0;
                png.data[idx + 2] = 0;
                png.data[idx + 3] = 0;
            } else {
                const t = dist / radius;
                const r = lerp(34, 12, t);
                const g = lerp(64, 24, t);
                const b = lerp(140, 80, t);
                png.data[idx] = r;
                png.data[idx + 1] = g;
                png.data[idx + 2] = b;
                png.data[idx + 3] = 255;
            }
        }
    }

    // Draw "O" ring (annulus) so the letter is unmistakable at 128px
    const ringOuter = radiusInner;
    const ringInner = radiusInner * 0.55;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const idx = (SIZE * y + x) * 4;
            const dx = x - center;
            const dy = y - center;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= ringOuter && dist >= ringInner) {
                png.data[idx] = 220;
                png.data[idx + 1] = 232;
                png.data[idx + 2] = 255;
                png.data[idx + 3] = 255;
            }
        }
    }

    const buffer = pngClass.sync.write(png);
    await writeFile(iconPath, buffer);
    console.log(`[generate-icon] wrote ${iconPath} (${SIZE}x${SIZE})`);
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function transparentPlaceholderBytes() {
    return Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000000000600055777a8b40000000049454e44ae426082',
        'hex',
    );
}

main().catch((err) => {
    console.error('[generate-icon] unexpected failure', err);
    process.exit(1);
});
