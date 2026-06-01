import * as vscode from 'vscode';

interface TutorialEntry {
    path: string;
    title: string;
}
type TutorialIndex = Record<string, TutorialEntry[]>;

const SECTION_LABELS: Record<string, string> = {
    mcnp: 'MCNP',
    openmc: 'OpenMC',
    serpent: 'Serpent',
    scone: 'SCONE',
    fundamentals: 'Fundamentals',
};

async function loadIndex(extensionUri: vscode.Uri): Promise<TutorialIndex> {
    const uri = vscode.Uri.joinPath(extensionUri, 'data', 'tutorial-links.json');
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
        return (parsed && typeof parsed === 'object') ? parsed as TutorialIndex : {};
    } catch (err) {
        console.warn('[owen.openTutorial] failed to read tutorial-links.json', err);
        return {};
    }
}

export function registerOpenTutorial(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.openTutorial', async () => {
        const index = await loadIndex(context.extensionUri);
        const sections = Object.keys(index).filter((k) => Array.isArray(index[k]) && index[k].length > 0);
        if (sections.length === 0) {
            vscode.window.showErrorMessage(
                'OWEN: tutorial index is empty. Run `npm run export-tutorials` to regenerate it.',
            );
            return;
        }

        const sectionPick = await vscode.window.showQuickPick(
            sections.map<vscode.QuickPickItem & { _key: string }>((k) => ({
                label: SECTION_LABELS[k] ?? k,
                description: `${index[k].length} pages`,
                _key: k,
            })),
            { placeHolder: 'Choose a tutorial section' },
        );
        if (!sectionPick) return;

        const entries = index[sectionPick._key];
        const pagePick = await vscode.window.showQuickPick(
            entries.map<vscode.QuickPickItem & { _entry: TutorialEntry }>((e) => ({
                label: e.title,
                description: e.path,
                _entry: e,
            })),
            { placeHolder: `Open a ${sectionPick.label} tutorial in your browser`, matchOnDescription: true },
        );
        if (!pagePick) return;

        const cfg = vscode.workspace.getConfiguration('owen');
        const endpoint = cfg.get<string>('nrdp.endpoint', 'https://reactormc.net/data');
        const base = new URL(endpoint).origin || 'https://reactormc.net';
        const url = `${base}${pagePick._entry.path}`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
    });
}
