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
 * snippets show on Ctrl+Space and, crucially, auto-surface in the widget *as the user
 * types the prefix*: trigger characters re-open/refresh the widget on each prefix char,
 * `sortText` ranks OWEN items at the top, and `preselect` highlights the best match so
 * they are not buried under language-server completions (e.g. Pylance).
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

/**
 * Characters that re-trigger the suggestion widget while typing a prefix. Snippet
 * prefixes are identifier-like words (`omc_pin`, `mcnp_cell`, …), so completing on the
 * lowercase alphabet plus `_` means the widget opens/refreshes on every prefix keystroke
 * — not just on Ctrl+Space.
 */
const TRIGGER_CHARACTERS: string[] = [
    ...'abcdefghijklmnopqrstuvwxyz'.split(''),
    '_',
];

/** Matches the identifier-with-underscores word under the cursor (the prefix being typed). */
const PREFIX_WORD_RE = /[A-Za-z_][A-Za-z0-9_]*/;

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
            // Bias OWEN snippets to the very top of the widget, ahead of language-server
            // and word-based completions (whose sortText typically starts with a letter).
            item.sortText = `0_owen_${prefix}`;
            items.push(item);
        }
    }
    return items;
}

export function registerSnippetCompletions(context: vscode.ExtensionContext): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    const output = vscode.window.createOutputChannel('OWEN');
    disposables.push(output);

    let totalLoaded = 0;

    for (const { file, languages } of SNIPPET_SOURCES) {
        const items = loadSnippetFile(context.extensionPath, file);
        if (items.length === 0) {
            output.appendLine(`OWEN: no snippets loaded from ${file}.`);
            continue;
        }
        totalLoaded += items.length;

        for (const language of languages) {
            const provider: vscode.CompletionItemProvider = {
                provideCompletionItems(document, position) {
                    // For Python, only offer OWEN snippets when the file is actually an
                    // OpenMC model (contains `import openmc`); MC languages are always on.
                    if (language === 'python' && detectMonteCarloLanguage(document) !== 'openmc') {
                        return undefined;
                    }

                    // Replace the identifier word under the cursor so `omc_` filters to and
                    // is replaced by the snippet (rather than appending after it).
                    const wordRange = document.getWordRangeAtPosition(position, PREFIX_WORD_RE);
                    const typed = wordRange ? document.getText(wordRange) : '';

                    let preselected = false;
                    for (const item of items) {
                        item.range = wordRange;
                        // Preselect the first item whose prefix the user has started typing,
                        // so the best OWEN match is highlighted ahead of Pylance items.
                        const isMatch =
                            typed.length > 0 && item.filterText?.startsWith(typed) === true;
                        item.preselect = isMatch && !preselected;
                        if (item.preselect) {
                            preselected = true;
                        }
                    }
                    return items;
                },
            };
            disposables.push(
                vscode.languages.registerCompletionItemProvider(
                    { language },
                    provider,
                    ...TRIGGER_CHARACTERS,
                ),
            );
        }
    }

    output.appendLine(`OWEN: snippet completion provider ready (${totalLoaded} snippets loaded).`);

    const combined = vscode.Disposable.from(...disposables);
    context.subscriptions.push(combined);
    return combined;
}
