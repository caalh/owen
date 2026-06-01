import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { detectMonteCarloLanguageFromText, MonteCarloLanguage } from '../util/detectLanguage';
import { planLaunch } from './runner';

export interface SweepParameter {
    name: string;
    values: Array<string | number>;
    /** Regex matched against baseFile. Group 1 is replaced with each parameter value. */
    pattern: string;
}

export interface SweepConfig {
    baseFile: string;
    parameters: SweepParameter[];
    output: { dir: string };
    /** Optional explicit language override; otherwise detected from baseFile extension. */
    language?: MonteCarloLanguage;
}

interface RunRecord {
    index: number;
    parameters: Record<string, string | number>;
    inputFile: string;
    outputDir: string;
    keff?: number | null;
    exitCode: number | null;
    stdoutPath: string;
}

const KEFF_RE = /final\s+estimated\s+combined\s+collision\s*\/\s*absorption\s*\/\s*track[-\s]length\s+keff[^=:\d]*[=:]?\s*([0-9.]+)/i;
const KEFF_OPENMC_RE = /Combined\s+k-?effective\s*=\s*([0-9.]+)/i;
const KEFF_FALLBACK_RE = /\bk-?eff\s*[=:]\s*([0-9.]+)/i;

function parseKeff(text: string): number | null {
    const m = text.match(KEFF_RE) || text.match(KEFF_OPENMC_RE) || text.match(KEFF_FALLBACK_RE);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return isNaN(v) ? null : v;
}

function languageForFile(filename: string, baseText: string): MonteCarloLanguage {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.i' || ext === '.mcnp' || ext === '.inp') return 'mcnp';
    if (ext === '.serp') return 'serpent';
    if (ext === '.scone') return 'scone';
    if (ext === '.py') {
        const detected = detectMonteCarloLanguageFromText(baseText, 'python');
        return detected ?? 'mcnp';
    }
    return 'mcnp';
}

function cartesian(parameters: SweepParameter[]): Record<string, string | number>[] {
    if (parameters.length === 0) return [{}];
    const [head, ...tail] = parameters;
    const rest = cartesian(tail);
    const out: Record<string, string | number>[] = [];
    for (const v of head.values) {
        for (const r of rest) out.push({ [head.name]: v, ...r });
    }
    return out;
}

function applyParameters(text: string, params: Record<string, string | number>, schema: SweepParameter[]): string {
    let out = text;
    for (const p of schema) {
        const value = String(params[p.name]);
        const re = new RegExp(p.pattern);
        out = out.replace(re, (match, group: string | undefined) => {
            if (group === undefined) return value;
            const idx = match.indexOf(group);
            return match.slice(0, idx) + value + match.slice(idx + group.length);
        });
    }
    return out;
}

async function fileBytes(uri: vscode.Uri): Promise<Buffer> {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data);
}

async function writeText(uri: vscode.Uri, text: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}

async function runOne(plan: { executable: string; args: string[] }, cwd: string, stdoutPath: string): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve) => {
        const child = spawn(plan.executable, plan.args, { cwd, shell: false });
        let buffer = '';
        child.stdout?.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); });
        child.stderr?.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); });
        child.on('error', (err) => {
            buffer += `\n[owen.sweep] failed to launch ${plan.executable}: ${err.message}\n`;
            resolve({ exitCode: null, output: buffer });
        });
        child.on('close', async (code) => {
            try {
                await writeText(vscode.Uri.file(stdoutPath), buffer);
            } catch { /* ignore */ }
            resolve({ exitCode: code, output: buffer });
        });
    });
}

export async function runSweepFromConfig(configUri: vscode.Uri): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('owen');
    let configText: string;
    try {
        configText = (await fileBytes(configUri)).toString('utf8');
    } catch (err) {
        vscode.window.showErrorMessage(`OWEN: cannot read sweep config: ${(err as Error).message}`);
        return;
    }

    let parsed: SweepConfig;
    try {
        parsed = JSON.parse(configText) as SweepConfig;
    } catch (err) {
        vscode.window.showErrorMessage(`OWEN: invalid sweep JSON: ${(err as Error).message}`);
        return;
    }

    const configDir = path.dirname(configUri.fsPath);
    const baseFilePath = path.isAbsolute(parsed.baseFile)
        ? parsed.baseFile
        : path.resolve(configDir, parsed.baseFile);
    const outDir = path.isAbsolute(parsed.output.dir)
        ? parsed.output.dir
        : path.resolve(configDir, parsed.output.dir);

    let baseText: string;
    try {
        baseText = (await fileBytes(vscode.Uri.file(baseFilePath))).toString('utf8');
    } catch (err) {
        vscode.window.showErrorMessage(`OWEN: cannot read base file ${baseFilePath}: ${(err as Error).message}`);
        return;
    }

    const language = parsed.language ?? languageForFile(baseFilePath, baseText);
    const combinations = cartesian(parsed.parameters);
    const baseName = path.basename(baseFilePath);

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(outDir));

    const records: RunRecord[] = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `OWEN: parameter sweep (${combinations.length} runs)`,
            cancellable: false,
        },
        async (progress) => {
            for (let i = 0; i < combinations.length; i++) {
                const combo = combinations[i];
                const runDir = path.join(outDir, `run_${String(i).padStart(3, '0')}`);
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(runDir));
                const inputPath = path.join(runDir, baseName);
                const mutated = applyParameters(baseText, combo, parsed.parameters);
                await writeText(vscode.Uri.file(inputPath), mutated);

                const plan = planLaunch(language, inputPath, cfg);
                const stdoutPath = path.join(runDir, 'owen-sweep.log');
                if (!plan) {
                    records.push({
                        index: i,
                        parameters: combo,
                        inputFile: inputPath,
                        outputDir: runDir,
                        keff: null,
                        exitCode: null,
                        stdoutPath,
                    });
                    continue;
                }

                progress.report({
                    message: `run ${i + 1}/${combinations.length} (${Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(', ')})`,
                });

                const { exitCode, output } = await runOne(plan, runDir, stdoutPath);
                records.push({
                    index: i,
                    parameters: combo,
                    inputFile: inputPath,
                    outputDir: runDir,
                    keff: parseKeff(output),
                    exitCode,
                    stdoutPath,
                });
            }
        },
    );

    const summary = {
        baseFile: baseFilePath,
        language,
        parameters: parsed.parameters,
        runs: records,
    };
    const manifestPath = path.join(outDir, 'sweep-manifest.json');
    await writeText(vscode.Uri.file(manifestPath), JSON.stringify(summary, null, 2));

    const tableLines = [
        ['index', ...parsed.parameters.map((p) => p.name), 'exit', 'keff'].join('\t'),
        ...records.map((r) => [
            r.index,
            ...parsed.parameters.map((p) => r.parameters[p.name]),
            r.exitCode ?? 'n/a',
            r.keff ?? 'n/a',
        ].join('\t')),
    ];
    await writeText(vscode.Uri.file(path.join(outDir, 'sweep-summary.tsv')), tableLines.join('\n') + '\n');

    vscode.window.showInformationMessage(
        `OWEN: parameter sweep complete (${records.length} runs). Manifest: ${manifestPath}`,
    );
}

export function registerRunSweep(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.runSweep', async () => {
        const editor = vscode.window.activeTextEditor;
        const defaultUri = editor && editor.document.uri.scheme === 'file'
            ? vscode.Uri.file(path.dirname(editor.document.uri.fsPath))
            : undefined;
        const picks = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            openLabel: 'Select sweep config (.json)',
            filters: { JSON: ['json'] },
            defaultUri,
        });
        if (!picks || picks.length === 0) return;
        await runSweepFromConfig(picks[0]);
    });
}
