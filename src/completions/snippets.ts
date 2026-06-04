import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { detectMonteCarloLanguage } from '../util/detectLanguage';

/**
 * Robust snippet delivery via a CompletionItemProvider.
 *
 * Declarative `contributes.snippets` only surface in the suggestion widget, and in
 * Python files they are routinely out-ranked or suppressed by the Python language
 * server's own completions — so the `omc_*` prefixes appear unreliable to users even
 * though the JSON ships in the VSIX. Registering an explicit provider guarantees the
 * snippets show on Ctrl+Space and as the user types the prefix, independent of
 * `editor.snippetSuggestions` / `editor.quickSuggestions` and language-server ranking.
 *
 * The snippet JSON files remain the single source of truth: they are loaded at runtime
 * and mapped to `CompletionItem`s of kind `Snippet`.
 */

interface RawSnippet {
    prefix: string | string[];
    body: string | string[];
    description?: string;
    scope?: string;
}

/** Maps each snippet JSON file to the language(s) it should complete in. */
const SNIPPET_SOURCES: { file: string; languages: string[] }[] = [
    { file: 'openmc.json', languages: ['python'] },
    { file: 'mcnp.json', languages: ['mcnp'] },
    { file: 'serpent.json', languages: ['serpent'] },
    { file: 'scone.json', languages: ['scone'] },
];

function asLines(value: string | string[]): string {
    return Array.isArray(value) ? value.join('\n') : value;
}

function loadSnippetFile(extensionPath: string, file: string): vscode.CompletionItem[] {
    const fullPath = path.join(extensionPath, 'snippets', file);
    let raw: Record<string, RawSnippet>;
    try {
        raw = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, RawSnippet>;
    } catch (err) {
        console.error(`OWEN: failed to load snippet file ${file}:`, err);
        return [];
    }

    const items: vscode.CompletionItem[] = [];
    for (const [name, snippet] of Object.entries(raw)) {
        if (!snippet || !snippet.prefix || !snippet.body) {
            continue;
        }
        const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
        const bodyText = asLines(snippet.body);
        for (const prefix of prefixes) {
            const item = new vscode.CompletionItem(prefix, vscode.CompletionItemKind.Snippet);
            item.insertText = new vscode.SnippetString(bodyText);
            item.filterText = prefix;
            item.detail = name;
            item.documentation = new vscode.MarkdownString(
                `${snippet.description ?? name}\n\n\`\`\`\n${bodyText}\n\`\`\``,
            );
            // Sort OWEN snippets ahead of generic word-based completions.
            item.sortText = `0_owen_${prefix}`;
            items.push(item);
        }
    }
    return items;
}

export function registerSnippetCompletions(context: vscode.ExtensionContext): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    for (const { file, languages } of SNIPPET_SOURCES) {
        const items = loadSnippetFile(context.extensionPath, file);
        if (items.length === 0) {
            continue;
        }

        for (const language of languages) {
            const provider: vscode.CompletionItemProvider = {
                provideCompletionItems(document) {
                    // For Python, only offer OWEN snippets when the file is actually an
                    // OpenMC model (contains `import openmc`); MC languages are always on.
                    if (language === 'python' && detectMonteCarloLanguage(document) !== 'openmc') {
                        return undefined;
                    }
                    return items;
                },
            };
            disposables.push(
                vscode.languages.registerCompletionItemProvider({ language }, provider),
            );
        }
    }

    const combined = vscode.Disposable.from(...disposables);
    context.subscriptions.push(combined);
    return combined;
}
