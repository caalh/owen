import * as vscode from 'vscode';
import {
    LANGUAGES,
    LANGUAGE_LABELS,
    Language,
    PALETTE_IDS,
    PALETTE_LABELS,
    PALETTE_DESCRIPTIONS,
    PaletteId,
    MANAGED_SCOPES,
    TextMateRule,
    buildRules,
    paletteIdFromLabel,
} from './palettes';

// Shape of editor.tokenColorCustomizations we care about. The object may also
// carry theme-scoped keys ("[Theme Name]": {...}) and other token settings; we
// preserve all of those untouched and only manage the top-level textMateRules
// whose scope is in MANAGED_SCOPES.
interface TokenColorCustomizations {
    textMateRules?: TextMateRule[];
    [key: string]: unknown;
}

function readSelection(cfg: vscode.WorkspaceConfiguration, language: Language): PaletteId {
    const label = cfg.get<string>(`highlight.${language}.palette`);
    return paletteIdFromLabel(label);
}

/** Is this an OWEN-managed textMate rule (single scope string in our set)? */
function isOwenRule(rule: TextMateRule): boolean {
    return !!rule && typeof rule.scope === 'string' && MANAGED_SCOPES.has(rule.scope);
}

/**
 * Apply the currently-selected palettes by rewriting only OWEN-managed
 * textMateRules in editor.tokenColorCustomizations. Unrelated rules (the user's
 * own, other extensions', theme-scoped blocks) are preserved. Writes to the
 * Global target. No-ops when the result is identical to avoid config churn and
 * change-event loops.
 */
export async function applyPalettes(): Promise<void> {
    const owenCfg = vscode.workspace.getConfiguration('owen');
    const editorCfg = vscode.workspace.getConfiguration('editor');

    const inspected = editorCfg.inspect<TokenColorCustomizations>('tokenColorCustomizations');
    const current: TokenColorCustomizations = inspected?.globalValue ?? {};

    const existingRules = Array.isArray(current.textMateRules) ? current.textMateRules : [];
    const preserved = existingRules.filter((r) => !isOwenRule(r));

    const owenRules: TextMateRule[] = [];
    for (const lang of LANGUAGES) {
        owenRules.push(...buildRules(lang, readSelection(owenCfg, lang)));
    }

    const next: TokenColorCustomizations = {
        ...current,
        textMateRules: [...preserved, ...owenRules],
    };

    if (JSON.stringify(next) === JSON.stringify(current)) {
        return;
    }

    await editorCfg.update(
        'tokenColorCustomizations',
        next,
        vscode.ConfigurationTarget.Global,
    );
}

async function chooseHighlightPalette(): Promise<void> {
    const owenCfg = vscode.workspace.getConfiguration('owen');

    const langPick = await vscode.window.showQuickPick(
        LANGUAGES.map<vscode.QuickPickItem & { _lang: Language }>((lang) => ({
            label: LANGUAGE_LABELS[lang],
            description: `current: ${PALETTE_LABELS[readSelection(owenCfg, lang)]}`,
            _lang: lang,
        })),
        { placeHolder: 'Choose a language to recolor' },
    );
    if (!langPick) return;

    const language = langPick._lang;
    const currentId = readSelection(owenCfg, language);

    const palettePick = await vscode.window.showQuickPick(
        PALETTE_IDS.map<vscode.QuickPickItem & { _id: PaletteId }>((id) => ({
            label: `${id === currentId ? '$(check) ' : ''}${PALETTE_LABELS[id]}`,
            description: PALETTE_DESCRIPTIONS[id],
            _id: id,
        })),
        { placeHolder: `Choose a palette for ${LANGUAGE_LABELS[language]}` },
    );
    if (!palettePick) return;

    await owenCfg.update(
        `highlight.${language}.palette`,
        PALETTE_LABELS[palettePick._id],
        vscode.ConfigurationTarget.Global,
    );
    // The configuration-change listener applies the palette, but apply here too
    // so it takes effect even if the value was already set to this label.
    await applyPalettes();

    vscode.window.showInformationMessage(
        `OWEN: ${LANGUAGE_LABELS[language]} highlighting set to "${PALETTE_LABELS[palettePick._id]}".`,
    );
}

/**
 * Register the highlight-palette feature: the picker command, a config listener
 * that re-applies palettes when any owen.highlight.* setting changes, and an
 * initial apply on activation.
 */
export function registerHighlightPalettes(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('owen.chooseHighlightPalette', chooseHighlightPalette),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('owen.highlight')) {
                void applyPalettes();
            }
        }),
    );

    void applyPalettes();
}
