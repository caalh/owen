import * as vscode from 'vscode';
import * as path from 'path';
import { detectMonteCarloLanguage } from '../util/detectLanguage';

const TERMINAL_NAME = 'OWEN: Run';

function getOrCreateTerminal(cwd: string): vscode.Terminal {
    const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
    if (existing) return existing;
    return vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
}

function quoteArg(value: string): string {
    if (process.platform === 'win32') {
        return value.includes(' ') ? `"${value}"` : value;
    }
    return value.includes(' ') ? `'${value.replace(/'/g, "'\\''")}'` : value;
}

interface LaunchPlan {
    executable: string;
    args: string[];
    info?: string;
}

export function planLaunch(
    language: ReturnType<typeof detectMonteCarloLanguage>,
    filePath: string,
    cfg: vscode.WorkspaceConfiguration,
): LaunchPlan | null {
    switch (language) {
        case 'mcnp':
            return {
                executable: cfg.get<string>('mcnp.executable') || 'mcnp6',
                args: [`inp=${path.basename(filePath)}`],
            };
        case 'openmc':
            return {
                executable: cfg.get<string>('openmc.pythonExecutable') || 'python',
                args: [path.basename(filePath)],
            };
        case 'serpent':
            return {
                executable: cfg.get<string>('serpent.executable') || 'sss2',
                args: [path.basename(filePath)],
            };
        case 'scone':
            return {
                executable: cfg.get<string>('scone.executable') || 'scone',
                args: [path.basename(filePath)],
                info: process.platform === 'win32'
                    ? 'SCONE typically requires WSL on Windows. See the OWEN README ROADMAP for setup notes.'
                    : undefined,
            };
        default:
            return null;
    }
}

export async function runSimulation(document: vscode.TextDocument): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('owen');
    const filePath = document.uri.fsPath;
    const workDir = cfg.get<string>('simulation.workingDirectory') || path.dirname(filePath);
    const language = detectMonteCarloLanguage(document);

    if (!language) {
        vscode.window.showWarningMessage('OWEN: Unsupported file type for simulation.');
        return;
    }

    const plan = planLaunch(language, filePath, cfg);
    if (!plan) {
        vscode.window.showWarningMessage('OWEN: Unable to plan launch for this file.');
        return;
    }

    if (plan.info) {
        vscode.window.showInformationMessage(`OWEN: ${plan.info}`);
    }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `OWEN: launching ${plan.executable}…` },
        async () => {
            const terminal = getOrCreateTerminal(workDir);
            terminal.show(true);
            const cmd = [plan.executable, ...plan.args].map(quoteArg).join(' ');
            terminal.sendText(`cd ${quoteArg(workDir)}`);
            terminal.sendText(cmd);
        },
    );

    vscode.window.showInformationMessage(
        `OWEN: Launched ${plan.executable} for ${path.basename(filePath)} (${language}).`,
    );
}
