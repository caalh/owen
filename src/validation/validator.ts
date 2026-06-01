import * as vscode from 'vscode';
import { detectMonteCarloLanguage, MonteCarloLanguage } from '../util/detectLanguage';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('owen');

type Diags = vscode.Diagnostic[];

/**
 * Entry point used by both the OWEN: Validate Input File command and tests.
 * `dispatch` returns the diagnostics array so tests can introspect it directly.
 */
export function validateInputFile(document: vscode.TextDocument): Diags {
    const diagnostics = dispatch(document);
    diagnosticCollection.set(document.uri, diagnostics);

    if (diagnostics.length === 0) {
        vscode.window.showInformationMessage('OWEN: No issues found.');
    } else {
        vscode.window.showWarningMessage(`OWEN: Found ${diagnostics.length} issue(s).`);
    }
    return diagnostics;
}

export function dispatch(document: vscode.TextDocument): Diags {
    const lang = detectMonteCarloLanguage(document);
    return runValidators(lang, document.getText());
}

/**
 * Pure function form used by tests so we don't need a real TextDocument.
 */
export function runValidators(lang: MonteCarloLanguage | null, text: string): Diags {
    const diagnostics: Diags = [];
    switch (lang) {
        case 'mcnp':
            validateMCNP(text, diagnostics);
            break;
        case 'openmc':
            validateOpenMC(text, diagnostics);
            break;
        case 'serpent':
            validateSerpent(text, diagnostics);
            break;
        case 'scone':
            validateSCONE(text, diagnostics);
            break;
        default:
            break;
    }
    return diagnostics;
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function range(line: number, length: number): vscode.Range {
    return new vscode.Range(line, 0, line, length);
}

function rangeOf(lines: string[], i: number): vscode.Range {
    return range(i, lines[i]?.length ?? 0);
}

function push(diags: Diags, r: vscode.Range, msg: string, sev: vscode.DiagnosticSeverity, code?: string) {
    const d = new vscode.Diagnostic(r, msg, sev);
    d.source = 'owen';
    if (code) d.code = code;
    diags.push(d);
}

function isCommentLine(line: string, lang: 'mcnp' | 'serpent' | 'scone'): boolean {
    const trimmed = line.trimStart();
    if (lang === 'mcnp') return /^c(\s|$)/i.test(trimmed);
    if (lang === 'serpent') return trimmed.startsWith('%');
    if (lang === 'scone') return trimmed.startsWith('!') || trimmed.startsWith('//');
    return false;
}

// ----------------------------------------------------------------------------
// MCNP
// ----------------------------------------------------------------------------

const ZAID_RE = /\b(\d{4,6})\.(\d{2})([cnpht])\b/g;
const MATERIAL_HEADER_RE = /^\s*m(\d+)\s+/i;
const MT_CARD_RE = /^\s*mt(\d+)\s+/i;
const CELL_CARD_RE = /^\s*(\d+)\s+(\d+|0)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)?\s+/;
const MACROBODY_RE = /^\s*(\d+)\s+(\*?)(rpp|rcc|rhp|box|hex|cyl|sph|rec|trc|ell|wed|arb)\b/i;

const MACROBODY_PARAM_COUNTS: Record<string, number> = {
    rpp: 6,
    rcc: 7,
    rhp: 15,
    box: 12,
};

function validateMCNP(text: string, diags: Diags): void {
    const lines = text.split(/\r?\n/);
    let densityNoteIssued = false;

    interface MatHeader { line: number; matNum: string; zaids: string[]; signs: Set<'+' | '-'>; }
    const materials = new Map<string, MatHeader>();
    let activeMat: MatHeader | null = null;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (trimmed === '' || isCommentLine(raw, 'mcnp')) {
            if (trimmed === '') activeMat = null;
            continue;
        }

        const mHead = raw.match(MATERIAL_HEADER_RE);
        if (mHead) {
            activeMat = { line: i, matNum: mHead[1], zaids: [], signs: new Set() };
            materials.set(mHead[1], activeMat);
        }

        if (activeMat) {
            let zm: RegExpExecArray | null;
            ZAID_RE.lastIndex = 0;
            while ((zm = ZAID_RE.exec(raw)) !== null) {
                activeMat.zaids.push(zm[1]);
            }
            const fracs = raw.matchAll(/(?:\s|^)([-+]?\d+\.?\d*(?:[eE][-+]?\d+)?)\b/g);
            const numericTokens: string[] = [];
            for (const f of fracs) numericTokens.push(f[1]);
            for (const tok of numericTokens) {
                if (tok.startsWith('-')) activeMat.signs.add('-');
                else if (/^\d|^\+/.test(tok)) activeMat.signs.add('+');
            }
        }

        ZAID_RE.lastIndex = 0;
        const tokens = raw.split(/\s+/);
        for (const tok of tokens) {
            if (/^\d{4,6}\.[A-Za-z0-9]+/.test(tok) && !/^\d{4,6}\.\d{2}[cnpht]$/.test(tok)) {
                push(diags, rangeOf(lines, i),
                    `Invalid ZAID '${tok}'. Expected ZAAA.TTc (e.g. 92235.80c).`,
                    vscode.DiagnosticSeverity.Warning,
                    'mcnp.zaid');
            }
        }

        const macro = raw.match(MACROBODY_RE);
        if (macro) {
            const kind = macro[3].toLowerCase();
            if (kind === 'hex') {
                push(diags, rangeOf(lines, i),
                    'Macrobody "HEX" is not an MCNP keyword — use "RHP" (right hexagonal prism).',
                    vscode.DiagnosticSeverity.Error,
                    'mcnp.macrobody');
            } else if (kind === 'cyl') {
                push(diags, rangeOf(lines, i),
                    'Macrobody "CYL" is not an MCNP keyword — use "RCC" (right circular cylinder).',
                    vscode.DiagnosticSeverity.Error,
                    'mcnp.macrobody');
            } else if (kind in MACROBODY_PARAM_COUNTS) {
                const expected = MACROBODY_PARAM_COUNTS[kind];
                const idIdx = tokens.findIndex((t) => /^\d+$/.test(t));
                const params = tokens
                    .slice(idIdx + 1)
                    .filter((t) => /^[-+]?\d/.test(t));
                if (params.length > 0 && params.length !== expected) {
                    push(diags, rangeOf(lines, i),
                        `${kind.toUpperCase()} expects ${expected} parameters but found ${params.length}.`,
                        vscode.DiagnosticSeverity.Warning,
                        'mcnp.macrobody-params');
                }
            }
        }

        const cell = raw.match(CELL_CARD_RE);
        if (cell && !macro && !mHead && !MT_CARD_RE.test(raw) && !/^\s*\*/.test(raw)) {
            const mat = cell[2];
            const density = cell[3];
            if (mat !== '0' && density && !densityNoteIssued) {
                push(diags, rangeOf(lines, i),
                    'MCNP density sign convention: negative = g/cm³, positive = atoms/barn-cm. (informational, shown once)',
                    vscode.DiagnosticSeverity.Information,
                    'mcnp.density-sign');
                densityNoteIssued = true;
            }
            if (!/imp:n/i.test(raw) && !cellContinuesToImp(lines, i)) {
                push(diags, rangeOf(lines, i),
                    `Cell ${cell[1]} is missing imp:n=… — particles entering this cell may be killed.`,
                    vscode.DiagnosticSeverity.Warning,
                    'mcnp.cell-imp');
            }
        }
    }

    for (const mat of materials.values()) {
        if (mat.signs.has('+') && mat.signs.has('-')) {
            push(diags, range(mat.line, lines[mat.line]?.length ?? 0),
                `Material m${mat.matNum} mixes positive and negative fractions — keep consistent (positive=atom, negative=weight).`,
                vscode.DiagnosticSeverity.Error,
                'mcnp.material-sign');
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const mt = lines[i].match(MT_CARD_RE);
        if (!mt) continue;
        const matNum = mt[1];
        const mat = materials.get(matNum);
        if (!mat) {
            push(diags, rangeOf(lines, i),
                `mt${matNum} references material m${matNum} which is not defined above it.`,
                vscode.DiagnosticSeverity.Error,
                'mcnp.mt-missing-material');
            continue;
        }
        const hasH = mat.zaids.some((z) => z.startsWith('1001') || z.startsWith('1002'));
        if (!hasH) {
            push(diags, rangeOf(lines, i),
                `mt${matNum} (S(α,β) thermal scattering) requires hydrogen in m${matNum}. ` +
                'S(α,β) thermal scattering only applies to hydrogen-bearing materials.',
                vscode.DiagnosticSeverity.Error,
                'mcnp.sab-no-h');
        }
    }
}

function cellContinuesToImp(lines: string[], start: number): boolean {
    for (let i = start + 1; i < Math.min(lines.length, start + 5); i++) {
        const l = lines[i];
        if (l.trim() === '') return false;
        if (/^\s{5,}/.test(l) && /imp:n/i.test(l)) return true;
        if (/^\s{5,}/.test(l)) continue;
        return false;
    }
    return false;
}

// ----------------------------------------------------------------------------
// OpenMC
// ----------------------------------------------------------------------------

function validateOpenMC(text: string, diags: Diags): void {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/openmc\.Source\s*\(/.test(line)) {
            push(diags, rangeOf(lines, i),
                'openmc.Source() is removed — use openmc.IndependentSource(...) (or openmc.FileSource/CompiledSource).',
                vscode.DiagnosticSeverity.Error,
                'openmc.source');
        }

        if (/openmc\.model\.rectangular_prism\s*\(/.test(line)) {
            push(diags, rangeOf(lines, i),
                'openmc.model.rectangular_prism() is deprecated — use openmc.model.RectangularPrism(width=..., height=...).',
                vscode.DiagnosticSeverity.Warning,
                'openmc.rectprism');
        }

        if (/Material\s*\([^)]*temperature\s*=/.test(line)) {
            push(diags, rangeOf(lines, i),
                'Temperature is set on cells in OpenMC, not on Material. Set cell.temperature = T instead.',
                vscode.DiagnosticSeverity.Error,
                'openmc.mat-temperature');
        }

        if (/\.run\s*\(\s*openmc_exec_kwargs\s*=/.test(line)) {
            push(diags, rangeOf(lines, i),
                'openmc_exec_kwargs= is deprecated — pass threads= (and other args) directly to model.run(threads=N).',
                vscode.DiagnosticSeverity.Warning,
                'openmc.exec-kwargs');
        }

        const runMatch = line.match(/(\w+)\s*=\s*[\w.]*\.run\s*\(/);
        if (runMatch) {
            const varName = runMatch[1];
            for (let j = i + 1; j < Math.min(lines.length, i + 25); j++) {
                if (new RegExp(`\\b${varName}\\b\\.(?:keff|k_combined|tallies|filters|source)`).test(lines[j])) {
                    push(diags, rangeOf(lines, j),
                        `model.run() returns a Path, not a StatePoint. Open it: \`with openmc.StatePoint(${varName}) as sp:\`.`,
                        vscode.DiagnosticSeverity.Error,
                        'openmc.run-return');
                    break;
                }
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Serpent
// ----------------------------------------------------------------------------

function validateSerpent(text: string, diags: Diags): void {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isCommentLine(line, 'serpent')) continue;

        if (/^\s*surf\b[^%]*\brect\b/.test(line)) {
            push(diags, rangeOf(lines, i),
                'Serpent surface type "rect" is not standard — use "cuboid" for a rectangular parallelepiped.',
                vscode.DiagnosticSeverity.Error,
                'serpent.surf-rect');
        }

        if (/^\s*trcl\b/.test(line)) {
            push(diags, rangeOf(lines, i),
                '"trcl" is MCNP syntax. In Serpent, define a coordinate transformation via "trans s ID …".',
                vscode.DiagnosticSeverity.Error,
                'serpent.trcl');
        }

        if (/^\s*set\s+omp\b/.test(line)) {
            push(diags, rangeOf(lines, i),
                '"set omp" is not a Serpent input keyword — pass -omp N on the sss2 CLI instead.',
                vscode.DiagnosticSeverity.Warning,
                'serpent.set-omp');
        }

        const egrid = line.match(/^\s*set\s+egrid\b\s*([\s\S]+)/i);
        if (egrid) {
            const nums = egrid[1].split(/\s+/).map((t) => parseFloat(t)).filter((n) => !isNaN(n));
            if (nums.some((n) => n > 100)) {
                push(diags, rangeOf(lines, i),
                    'Serpent "set egrid" energies are MeV. Values >100 look like eV — convert (e.g. 0.625 eV = 0.625E-6 MeV).',
                    vscode.DiagnosticSeverity.Warning,
                    'serpent.egrid-units');
            }
        }
    }
}

// ----------------------------------------------------------------------------
// SCONE
// ----------------------------------------------------------------------------

const SCONE_TEMP_TO_SUFFIX: Record<string, string> = {
    '300': '.03',
    '600': '.06',
    '900': '.09',
    '1200': '.12',
};

function validateSCONE(text: string, diags: Diags): void {
    const lines = text.split(/\r?\n/);

    interface Block { name: string; type: string | null; temp: string | null; radii: number[] | null; fills: string[] | null; startLine: number; }
    const blockStack: Block[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (let c = 0; c < line.length; c++) {
            const code = line.charCodeAt(c);
            if (code > 127) {
                push(diags, new vscode.Range(i, c, i, c + 1),
                    `Non-ASCII character (U+${code.toString(16).toUpperCase().padStart(4, '0')}) — SCONE expects 7-bit ASCII.`,
                    vscode.DiagnosticSeverity.Error,
                    'scone.non-ascii');
                break;
            }
        }

        if (/aceNuclearDatabase/.test(line)) {
            const col = line.indexOf('aceNuclearDatabase');
            push(diags, new vscode.Range(i, col, i, col + 'aceNuclearDatabase'.length),
                'Typo: should be "aceNeutronDatabase" (Neutron, not Nuclear).',
                vscode.DiagnosticSeverity.Error,
                'scone.ace-typo');
        }

        if (isCommentLine(line, 'scone')) continue;

        const blockMatch = line.match(/^\s*([A-Za-z_][\w]*)\s*\{/);
        if (blockMatch) {
            blockStack.push({
                name: blockMatch[1],
                type: null,
                temp: null,
                radii: null,
                fills: null,
                startLine: i,
            });
        }

        if (blockStack.length > 0) {
            const top = blockStack[blockStack.length - 1];
            const typeM = line.match(/\btype\s+(\w+)/);
            if (typeM) top.type = typeM[1];
            const tempM = line.match(/\btemp\s+(\d+)/);
            if (tempM) top.temp = tempM[1];
            const radiiM = line.match(/\bradii\s*\(([^)]*)\)/);
            if (radiiM) top.radii = radiiM[1].split(/\s+/).map(parseFloat).filter((n) => !isNaN(n));
            const fillsM = line.match(/\bfills\s*\(([^)]*)\)/);
            if (fillsM) top.fills = fillsM[1].split(/\s+/).filter(Boolean);
        }

        const closeIdx = line.indexOf('}');
        if (closeIdx >= 0 && blockStack.length > 0) {
            const closed = blockStack.pop()!;

            if (closed.type === 'pinUniverse') {
                if (closed.radii && closed.fills) {
                    if (closed.radii.length !== closed.fills.length) {
                        push(diags, range(closed.startLine, lines[closed.startLine].length),
                            `pinUniverse "${closed.name}": radii has ${closed.radii.length} entries but fills has ${closed.fills.length}; lengths must match.`,
                            vscode.DiagnosticSeverity.Error,
                            'scone.pin-len');
                    }
                    if (closed.radii.length > 0 && closed.radii[closed.radii.length - 1] !== 0.0) {
                        push(diags, range(closed.startLine, lines[closed.startLine].length),
                            `pinUniverse "${closed.name}": outermost radii value must be 0.0 to mark the infinite outer region.`,
                            vscode.DiagnosticSeverity.Error,
                            'scone.pin-outer');
                    }
                }
            }

            if (closed.temp && Object.prototype.hasOwnProperty.call(SCONE_TEMP_TO_SUFFIX, closed.temp)) {
                const expectedSuffix = SCONE_TEMP_TO_SUFFIX[closed.temp];
                const body = lines.slice(closed.startLine, i + 1).join('\n');
                const zaids = Array.from(body.matchAll(/\b\d{4,6}\.(\d{2})\b/g));
                for (const z of zaids) {
                    const suffix = '.' + z[1];
                    if (suffix !== expectedSuffix) {
                        push(diags, range(closed.startLine, lines[closed.startLine].length),
                            `Material "${closed.name}" has temp ${closed.temp} but ZAID suffix ${suffix} doesn't match expected ${expectedSuffix}.`,
                            vscode.DiagnosticSeverity.Warning,
                            'scone.temp-zaid');
                        break;
                    }
                }
            }
        }
    }

    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const code = raw.split(/!|\/\//)[0];
        for (const ch of code) {
            if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth--;
        }
        const trimmed = code.trim();
        if (!trimmed) continue;
        if (/^[A-Za-z_][\w]*\s*\{/.test(trimmed)) continue;
        if (trimmed === '}' || trimmed.startsWith('}')) continue;
        if (braceDepth === 0) {
            if (!trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith('}')) {
                push(diags, rangeOf(lines, i),
                    'SCONE statements outside blocks must end with ";".',
                    vscode.DiagnosticSeverity.Warning,
                    'scone.semicolon');
            }
        }
    }
}
