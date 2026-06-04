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
import { showPalettePreview, postHighlight } from './previewPanel';

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

async function applySelection(language: Language, id: PaletteId): Promise<void> {
    const owenCfg = vscode.workspace.getConfiguration('owen');
    await owenCfg.update(
        `highlight.${language}.palette`,
        PALETTE_LABELS[id],
        vscode.ConfigurationTarget.Global,
    );
    // The configuration-change listener applies the palette, but apply here too
    // so it takes effect even if the value was already set to this label.
    await applyPalettes();

    vscode.window.showInformationMessage(
        `OWEN: ${LANGUAGE_LABELS[language]} highlighting set to "${PALETTE_LABELS[id]}".`,
    );
}

interface PaletteItem extends vscode.QuickPickItem {
    _id: PaletteId;
}

/**
 * Show a live palette Quick Pick wired to the preview panel: as the user moves
 * through the items, the matching block in the preview is outlined/scrolled into
 * view; accepting applies it. Resolves to the chosen palette or undefined.
 */
function pickPaletteWithPreview(language: Language, currentId: PaletteId): Promise<PaletteId | undefined> {
    return new Promise((resolve) => {
        const qp = vscode.window.createQuickPick<PaletteItem>();
        qp.title = `Highlight palette — ${LANGUAGE_LABELS[language]}`;
        qp.placeholder = 'Move to preview a palette · Enter to apply · Esc to cancel';
        qp.matchOnDescription = true;
        qp.items = PALETTE_IDS.map<PaletteItem>((id) => ({
            label: `${id === currentId ? '$(check) ' : ''}${PALETTE_LABELS[id]}`,
            description: PALETTE_DESCRIPTIONS[id],
            _id: id,
        }));
        const activeItem = qp.items.find((i) => i._id === currentId);
        if (activeItem) qp.activeItems = [activeItem];

        let accepted = false;
        qp.onDidChangeActive((items) => {
            if (items[0]) postHighlight(items[0]._id);
        });
        qp.onDidAccept(() => {
            accepted = true;
            const chosen = qp.selectedItems[0]?._id ?? qp.activeItems[0]?._id;
            qp.hide();
            resolve(chosen);
        });
        qp.onDidHide(() => {
            qp.dispose();
            if (!accepted) resolve(undefined);
        });

        // Seed the preview with the current selection before the user moves.
        postHighlight(currentId);
        qp.show();
    });
}

async function chooseHighlightPalette(context: vscode.ExtensionContext): Promise<void> {
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

    // Open the side-by-side preview of all four palettes for this language so the
    // user can compare before choosing.
    showPalettePreview(context, language);

    const chosen = await pickPaletteWithPreview(language, currentId);
    if (!chosen) return;

    await applySelection(language, chosen);
}

/**
 * Register the highlight-palette feature: the picker command, a config listener
 * that re-applies palettes when any owen.highlight.* setting changes, and an
 * initial apply on activation.
 */
export function registerHighlightPalettes(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('owen.chooseHighlightPalette', () => chooseHighlightPalette(context)),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('owen.highlight')) {
                void applyPalettes();
            }
        }),
    );

    void applyPalettes();
}
