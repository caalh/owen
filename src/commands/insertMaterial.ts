import * as vscode from 'vscode';
import { detectMonteCarloLanguage, MonteCarloLanguage } from '../util/detectLanguage';

interface MaterialComposition {
    zaid: string;
    name: string;
    fraction: number;
    isElement?: boolean;
}

interface CommonMaterial {
    slug: string;
    name: string;
    formula?: string;
    category: string;
    density: number;
    description: string;
    composition: MaterialComposition[];
    sab?: string[];
    mcnpCode: string;
    serpentCode: string;
    openmcCode: string;
    notes?: string;
}

let cachedMaterials: CommonMaterial[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadBundled(extensionUri: vscode.Uri): Promise<CommonMaterial[]> {
    const uri = vscode.Uri.joinPath(extensionUri, 'data', 'nrdp-materials.json');
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
        return Array.isArray(parsed) ? parsed as CommonMaterial[] : [];
    } catch (err) {
        console.warn('[owen.insertMaterial] failed to read bundled NRDP snapshot', err);
        return [];
    }
}

async function loadLive(endpoint: string): Promise<CommonMaterial[] | null> {
    try {
        const url = endpoint.replace(/\/$/, '') + '/nrdp-materials.json';
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[owen.insertMaterial] live NRDP returned ${res.status}; falling back to bundled`);
            return null;
        }
        const data = await res.json();
        return Array.isArray(data) ? data as CommonMaterial[] : null;
    } catch (err) {
        console.warn('[owen.insertMaterial] live NRDP fetch failed; falling back to bundled', err);
        return null;
    }
}

async function loadMaterials(extensionUri: vscode.Uri): Promise<CommonMaterial[]> {
    if (cachedMaterials && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cachedMaterials;
    }
    const cfg = vscode.workspace.getConfiguration('owen');
    const live = cfg.get<boolean>('nrdp.live', true);
    const endpoint = cfg.get<string>('nrdp.endpoint', 'https://reactormc.net/data');
    let materials: CommonMaterial[] | null = null;
    if (live) {
        materials = await loadLive(endpoint);
    }
    if (!materials) {
        materials = await loadBundled(extensionUri);
    }
    cachedMaterials = materials;
    cachedAt = Date.now();
    return materials;
}

function codeForLanguage(mat: CommonMaterial, lang: MonteCarloLanguage | null): string {
    switch (lang) {
        case 'openmc':
            return mat.openmcCode || '';
        case 'serpent':
            return mat.serpentCode || '';
        case 'scone':
            return convertToSconeStub(mat);
        case 'mcnp':
        default:
            return mat.mcnpCode || '';
    }
}

function convertToSconeStub(mat: CommonMaterial): string {
    const head = `! ${mat.name} (${mat.density} g/cm3)\n${mat.slug.replace(/[^A-Za-z0-9_]/g, '_')} {`;
    const body = mat.composition.length
        ? `\n  temp 600;\n  composition {\n${mat.composition
            .map((c) => `    ${c.zaid}.06  ${c.fraction.toExponential(6)};`)
            .join('\n')}\n  }`
        : '';
    return `${head}${body}\n}`;
}

export function registerInsertMaterial(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.insertMaterial', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open a file before inserting a material.');
            return;
        }

        const lang = detectMonteCarloLanguage(editor.document);
        const materials = await loadMaterials(context.extensionUri);
        if (materials.length === 0) {
            vscode.window.showErrorMessage(
                'OWEN: NRDP material snapshot is empty. Run `npm run export-nrdp` or check `owen.nrdp.live` / `owen.nrdp.endpoint`.',
            );
            return;
        }

        const items: vscode.QuickPickItem[] = materials
            .filter((m) => codeForLanguage(m, lang).trim().length > 0)
            .map((m) => ({
                label: m.name,
                description: m.formula ? `${m.formula} • ${m.category}` : m.category,
                detail: m.description,
            }));

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: `Insert material (${lang ?? 'unknown language — defaults to MCNP'})`,
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!pick) return;

        const material = materials.find((m) => m.name === pick.label);
        if (!material) return;

        const snippet = codeForLanguage(material, lang);
        const padded = snippet.endsWith('\n') ? snippet : snippet + '\n';
        const insertText = (editor.selection.active.character > 0 ? '\n' : '') + padded;

        await editor.edit((eb) => {
            eb.insert(editor.selection.active, insertText);
        });
    });
}
