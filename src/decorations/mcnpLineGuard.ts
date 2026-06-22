import * as vscode from 'vscode';
import { findOverlengthLines, MCNP_DEFAULT_LINE_LIMIT } from './lineLength';

// Visibly flag MCNP card images that exceed the column limit (default 80).
// Two reinforcing signals:
//   1. A language-scoped editor ruler at the limit ([mcnp].editor.rulers), so
//      the user sees the boundary while typing.
//   2. A DiagnosticCollection (Problems panel + squiggle) AND a background
//      decoration on the overflowing tail, because past-limit characters are
//      silently ignored by MCNP — a classic invisible bug.

const DIAGNOSTIC_SOURCE = 'OWEN (MCNP)';

function lineLimit(): number {
    const n = vscode.workspace
        .getConfiguration('owen')
        .get<number>('mcnp.lineLengthLimit', MCNP_DEFAULT_LINE_LIMIT);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : MCNP_DEFAULT_LINE_LIMIT;
}

/**
 * Set [mcnp].editor.rulers to [limit] once, without clobbering a ruler the user
 * already configured for MCNP. Writes to the Global target as a language
 * override so it only affects MCNP files.
 */
async function ensureMcnpRuler(): Promise<void> {
    const limit = lineLimit();
    const editorCfg = vscode.workspace.getConfiguration('editor', { languageId: 'mcnp' });
    const inspected = editorCfg.inspect<number[]>('rulers');
    const existing = inspected?.globalLanguageValue;
    if (Array.isArray(existing) && existing.length > 0) {
        return; // respect the user's own MCNP ruler(s)
    }
    try {
        await editorCfg.update('rulers', [limit], vscode.ConfigurationTarget.Global, true);
    } catch {
        // Non-fatal: a missing/readonly settings target shouldn't break activation.
    }
}

function refreshDiagnostics(
    doc: vscode.TextDocument,
    collection: vscode.DiagnosticCollection,
): void {
    if (doc.languageId !== 'mcnp') {
        collection.delete(doc.uri);
        return;
    }
    const limit = lineLimit();
    const diagnostics: vscode.Diagnostic[] = findOverlengthLines(doc.getText(), limit).map((o) => {
        const range = new vscode.Range(o.line, o.startCol, o.line, doc.lineAt(o.line).text.length);
        const diag = new vscode.Diagnostic(
            range,
            `MCNP card image exceeds ${limit} columns (line is ${o.expandedLength} columns after tab expansion). ` +
                `Characters past column ${limit} are silently ignored by MCNP — split onto a continuation line.`,
            vscode.DiagnosticSeverity.Warning,
        );
        diag.source = DIAGNOSTIC_SOURCE;
        diag.code = 'mcnp-line-too-long';
        return diag;
    });
    collection.set(doc.uri, diagnostics);
}

function refreshDecorations(
    editor: vscode.TextEditor,
    decoration: vscode.TextEditorDecorationType,
): void {
    if (editor.document.languageId !== 'mcnp') {
        editor.setDecorations(decoration, []);
        return;
    }
    const limit = lineLimit();
    const ranges = findOverlengthLines(editor.document.getText(), limit).map((o) => {
        const lineText = editor.document.lineAt(o.line).text;
        return new vscode.Range(o.line, Math.min(o.startCol, lineText.length), o.line, lineText.length);
    });
    editor.setDecorations(decoration, ranges);
}

/**
 * Register the MCNP card-image line-length guard: the language-scoped ruler, a
 * diagnostics collection, and a tail decoration, kept in sync with edits and
 * the active editor.
 */
export function registerMcnpLineGuard(context: vscode.ExtensionContext): void {
    void ensureMcnpRuler();

    const collection = vscode.languages.createDiagnosticCollection('owen-mcnp-line-length');
    const decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editorError.background'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editorWarning.foreground'),
        overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    context.subscriptions.push(collection, decoration);

    const refreshEditor = (editor: vscode.TextEditor | undefined) => {
        if (!editor) return;
        refreshDiagnostics(editor.document, collection);
        refreshDecorations(editor, decoration);
    };

    // Seed any already-open MCNP editors.
    for (const editor of vscode.window.visibleTextEditors) {
        refreshEditor(editor);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => refreshEditor(editor)),
        vscode.workspace.onDidChangeTextDocument((e) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && e.document === editor.document) {
                refreshEditor(editor);
            } else {
                refreshDiagnostics(e.document, collection);
            }
        }),
        vscode.workspace.onDidOpenTextDocument((doc) => refreshDiagnostics(doc, collection)),
        vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('owen.mcnp.lineLengthLimit')) {
                void ensureMcnpRuler();
                for (const editor of vscode.window.visibleTextEditors) {
                    refreshEditor(editor);
                }
            }
        }),
    );
}
