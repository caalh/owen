import * as vscode from 'vscode';

// "OWEN: Toggle Invisible Characters" — flips VS Code's whitespace/control-char
// rendering so users can see spaces/tabs/¶ and catch silent MCNP whitespace
// bugs (e.g. a tab where columns matter, or a stray control character).
//
// We touch ONLY editor.renderWhitespace and editor.renderControlCharacters.
// Prior global values are captured on the first toggle-on and restored verbatim
// on toggle-off, so we never clobber unrelated user settings.

const STATE_ACTIVE = 'owen.invisibles.active';
const STATE_PRIOR_WHITESPACE = 'owen.invisibles.priorWhitespace';
const STATE_PRIOR_CONTROL = 'owen.invisibles.priorControlChars';

// Sentinel meaning "the user had no explicit global value" — restore to that
// (undefined) so the setting reverts to its default rather than a forced value.
const UNSET = '\u0000owen-unset';

async function toggleInvisibleCharacters(context: vscode.ExtensionContext): Promise<void> {
    const editorCfg = vscode.workspace.getConfiguration('editor');
    const active = context.globalState.get<boolean>(STATE_ACTIVE, false);

    if (!active) {
        const wsPrior = editorCfg.inspect<string>('renderWhitespace')?.globalValue;
        const ccPrior = editorCfg.inspect<boolean>('renderControlCharacters')?.globalValue;
        await context.globalState.update(STATE_PRIOR_WHITESPACE, wsPrior ?? UNSET);
        await context.globalState.update(STATE_PRIOR_CONTROL, ccPrior ?? UNSET);

        await editorCfg.update('renderWhitespace', 'all', vscode.ConfigurationTarget.Global);
        await editorCfg.update('renderControlCharacters', true, vscode.ConfigurationTarget.Global);
        await context.globalState.update(STATE_ACTIVE, true);

        vscode.window.showInformationMessage(
            'OWEN: Invisible characters shown — whitespace (spaces/tabs/¶) and control characters are now visible.',
        );
    } else {
        const wsPrior = context.globalState.get<string>(STATE_PRIOR_WHITESPACE, UNSET);
        const ccPrior = context.globalState.get<boolean | string>(STATE_PRIOR_CONTROL, UNSET);

        await editorCfg.update(
            'renderWhitespace',
            wsPrior === UNSET ? undefined : wsPrior,
            vscode.ConfigurationTarget.Global,
        );
        await editorCfg.update(
            'renderControlCharacters',
            ccPrior === UNSET ? undefined : ccPrior,
            vscode.ConfigurationTarget.Global,
        );
        await context.globalState.update(STATE_ACTIVE, false);

        vscode.window.showInformationMessage(
            'OWEN: Invisible characters hidden — restored your previous whitespace/control-character settings.',
        );
    }
}

export function registerToggleInvisibles(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('owen.toggleInvisibleCharacters', () =>
            toggleInvisibleCharacters(context),
        ),
    );
}
