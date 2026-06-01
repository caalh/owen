import * as vscode from 'vscode';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { getSupabaseClient } from './client';

interface CommunityModel {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    code: string | null;
    reactor_type: string | null;
    body: string | null;
    status: string | null;
}

const DISABLED_MESSAGE =
    'Community Library is disabled. Set `owen.community.enabled` and configure ' +
    '`owen.supabase.url`/`owen.supabase.anonKey` to enable.';

function languageFilter(value: string | null | undefined): string | null {
    if (!value) return null;
    const norm = value.toLowerCase();
    if (norm.includes('mcnp')) return 'mcnp';
    if (norm.includes('openmc')) return 'openmc';
    if (norm.includes('serpent')) return 'serpent';
    if (norm.includes('scone')) return 'scone';
    return null;
}

export function registerSearchReactorLibrary(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.searchReactorLibrary', async () => {
        const cfg = vscode.workspace.getConfiguration('owen');
        if (!cfg.get<boolean>('community.enabled', false)) {
            vscode.window.showInformationMessage(DISABLED_MESSAGE);
            return;
        }

        const client = getSupabaseClient();
        if (!client) {
            vscode.window.showWarningMessage(
                'OWEN: Community Library is enabled but Supabase credentials are missing. ' +
                'Set `owen.supabase.url` and `owen.supabase.anonKey`.',
            );
            return;
        }

        const editor = vscode.window.activeTextEditor;
        const detected = editor ? detectMonteCarloLanguage(editor.document) : null;

        let query = client
            .from('models')
            .select('id, slug, title, description, code, reactor_type, body, status')
            .eq('status', 'approved')
            .limit(100);

        if (detected) {
            query = query.ilike('code', `%${detected}%`);
        }

        const result = await vscode.window.withProgress<{
            data: CommunityModel[] | null;
            error: { message: string } | null;
        }>(
            { location: vscode.ProgressLocation.Window, title: 'OWEN: searching Community Library…' },
            async () => {
                const { data, error } = await query;
                return { data: (data as CommunityModel[] | null) ?? null, error };
            },
        );

        if (result.error) {
            vscode.window.showErrorMessage(`OWEN: community search failed: ${result.error.message}`);
            return;
        }
        const rows = result.data ?? [];
        if (rows.length === 0) {
            vscode.window.showInformationMessage('OWEN: no approved community models found.');
            return;
        }

        const pick = await vscode.window.showQuickPick(
            rows.map<vscode.QuickPickItem & { _row: CommunityModel }>((row) => ({
                label: row.title,
                description: [languageFilter(row.code), row.reactor_type].filter(Boolean).join(' • '),
                detail: row.description ?? '',
                _row: row,
            })),
            {
                placeHolder: detected
                    ? `Approved community models matching ${detected}`
                    : 'Approved community models',
                matchOnDescription: true,
                matchOnDetail: true,
            },
        );
        if (!pick) return;

        const body = pick._row.body ?? '';
        if (!body) {
            vscode.window.showWarningMessage('OWEN: selected model has no body to insert.');
            return;
        }

        const action = await vscode.window.showQuickPick(
            [
                { label: 'Insert at cursor', value: 'insert' as const },
                { label: 'Open in new untitled document', value: 'open' as const },
            ],
            { placeHolder: 'How would you like to use this model?' },
        );
        if (!action) return;

        if (action.value === 'insert' && editor) {
            const padded = body.endsWith('\n') ? body : body + '\n';
            await editor.edit((eb) => eb.insert(editor.selection.active, padded));
        } else {
            const doc = await vscode.workspace.openTextDocument({
                content: body,
                language: detected ?? undefined,
            });
            await vscode.window.showTextDocument(doc);
        }
    });
}
