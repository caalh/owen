import * as vscode from 'vscode';

export class LatticeBuilderPanel {
    public static currentPanel: LatticeBuilderPanel | undefined;
    private static readonly viewType = 'owen.latticeBuilder';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _targetEditor: vscode.TextEditor | undefined;

    public static createOrShow(extensionUri: vscode.Uri) {
        const activeEditor = vscode.window.activeTextEditor;
        const column = activeEditor ? activeEditor.viewColumn : undefined;

        if (LatticeBuilderPanel.currentPanel) {
            if (activeEditor) {
                LatticeBuilderPanel.currentPanel._targetEditor = activeEditor;
            }
            LatticeBuilderPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            LatticeBuilderPanel.viewType,
            'OWEN Lattice Builder',
            column || vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        LatticeBuilderPanel.currentPanel = new LatticeBuilderPanel(panel, extensionUri);
        LatticeBuilderPanel.currentPanel._targetEditor = activeEditor;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.webview.html = this._getHtml();

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this._targetEditor = editor;
            }
        }, null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (message) => {
                switch (message.command) {
                    case 'insertCode':
                        this._insertCode(message.code);
                        return;
                }
            },
            null,
            this._disposables
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private async _insertCode(code: string) {
        let editor = vscode.window.activeTextEditor ?? await this._reopenTargetEditor();
        if (!editor) {
            const document = await vscode.workspace.openTextDocument({ content: '' });
            editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        }
        this._targetEditor = editor;

        const position = editor.selection.active;
        await editor.edit((editBuilder) => {
            editBuilder.insert(position, code);
        });
    }

    private async _reopenTargetEditor(): Promise<vscode.TextEditor | undefined> {
        const document = this._targetEditor?.document;
        if (!document || document.isClosed) {
            return undefined;
        }
        return vscode.window.showTextDocument(document, this._targetEditor?.viewColumn, false);
    }

    public dispose() {
        LatticeBuilderPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OWEN Lattice Builder</title>
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
        h2 { margin-top: 0; }
        .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
        .controls label { font-size: 13px; }
        .controls select, .controls input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 3px; }
        .pin-palette { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
        .pin-btn { padding: 4px 12px; border: 2px solid transparent; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; }
        .pin-btn.active { border-color: var(--vscode-focusBorder); }
        canvas { border: 1px solid var(--vscode-panel-border); cursor: crosshair; display: block; margin-bottom: 12px; }
        .presets { display: flex; gap: 8px; margin-bottom: 12px; }
        .presets button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; }
        .presets button:hover { background: var(--vscode-button-secondaryHoverBackground); }
        #code-preview { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre; overflow-x: auto; max-height: 300px; overflow-y: auto; }
        .insert-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 24px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 8px; }
        .insert-btn:hover { background: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
    <h2>Lattice Builder</h2>
    <div class="controls">
        <label>Grid: <input type="number" id="grid-size" value="17" min="3" max="25" style="width:50px"></label>
        <label>Pitch (cm): <input type="number" id="pitch" value="1.26" step="0.01" min="0.1" style="width:70px"></label>
        <label>Format:
            <select id="format">
                <option value="mcnp">MCNP</option>
                <option value="openmc">OpenMC</option>
                <option value="serpent">Serpent</option>
            </select>
        </label>
    </div>
    <div class="pin-palette" id="palette"></div>
    <div class="presets">
        <button onclick="presetW17()">W 17x17</button>
        <button onclick="presetBWR10()">BWR 10x10</button>
        <button onclick="presetAllFuel()">All Fuel</button>
    </div>
    <canvas id="grid" width="500" height="500"></canvas>
    <pre id="code-preview"></pre>
    <button class="insert-btn" onclick="insertCode()">Insert at Cursor</button>

    <script>
        const vscode = acquireVsCodeApi();
        const PIN_TYPES = [
            { id: 1, label: 'Fuel', color: '#4287f5' },
            { id: 2, label: 'Guide Tube', color: '#f5a742' },
            { id: 3, label: 'Instr. Tube', color: '#42f572' },
            { id: 4, label: 'Water Rod', color: '#42d4f5' },
            { id: 5, label: 'Alt Fuel', color: '#f54242' },
        ];
        let gridSize = 17;
        let grid = [];
        let currentType = 1;
        let painting = false;
        const canvas = document.getElementById('grid');
        const ctx = canvas.getContext('2d');

        function initGrid(n) {
            gridSize = n;
            grid = Array.from({ length: n }, () => Array(n).fill(1));
            render();
            refreshCode();
        }

        function cellSize() { return Math.floor(canvas.width / gridSize); }

        function render() {
            const cs = cellSize();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const colorMap = {};
            PIN_TYPES.forEach(p => colorMap[p.id] = p.color);
            for (let r = 0; r < gridSize; r++) {
                for (let c = 0; c < gridSize; c++) {
                    ctx.fillStyle = colorMap[grid[r][c]] || '#555';
                    ctx.fillRect(c * cs, r * cs, cs, cs);
                }
            }
            ctx.strokeStyle = '#555';
            for (let i = 0; i <= gridSize; i++) {
                ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, gridSize * cs); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, i * cs); ctx.lineTo(gridSize * cs, i * cs); ctx.stroke();
            }
        }

        function cellAt(x, y) {
            const cs = cellSize();
            return [Math.min(Math.floor(y / cs), gridSize - 1), Math.min(Math.floor(x / cs), gridSize - 1)];
        }

        canvas.addEventListener('mousedown', (e) => { painting = true; const [r, c] = cellAt(e.offsetX, e.offsetY); grid[r][c] = currentType; render(); refreshCode(); });
        canvas.addEventListener('mousemove', (e) => { if (!painting) return; const [r, c] = cellAt(e.offsetX, e.offsetY); grid[r][c] = currentType; render(); refreshCode(); });
        canvas.addEventListener('mouseup', () => { painting = false; });

        function buildPalette() {
            const el = document.getElementById('palette');
            el.innerHTML = '';
            PIN_TYPES.forEach(p => {
                const btn = document.createElement('button');
                btn.className = 'pin-btn' + (p.id === currentType ? ' active' : '');
                btn.style.background = p.color;
                btn.style.color = '#111';
                btn.textContent = p.label;
                btn.onclick = () => { currentType = p.id; buildPalette(); };
                el.appendChild(btn);
            });
        }

        const W17_GT = [[2,5],[2,8],[2,11],[3,3],[3,13],[5,2],[5,5],[5,8],[5,11],[5,14],[8,2],[8,5],[8,11],[8,14],[11,2],[11,5],[11,8],[11,11],[11,14],[13,3],[13,13],[14,5],[14,8],[14,11]];

        function presetW17() {
            document.getElementById('grid-size').value = 17;
            initGrid(17);
            W17_GT.forEach(([r, c]) => { grid[r][c] = 2; });
            grid[8][8] = 3;
            render(); refreshCode();
        }

        function presetBWR10() {
            document.getElementById('grid-size').value = 10;
            document.getElementById('pitch').value = '1.295';
            initGrid(10);
            [[3,3],[3,6],[6,3],[6,6]].forEach(([r,c]) => { grid[r][c] = 4; });
            render(); refreshCode();
        }

        function presetAllFuel() { initGrid(gridSize); }

        function refreshCode() {
            const fmt = document.getElementById('format').value;
            const pitch = parseFloat(document.getElementById('pitch').value);
            let code = '';
            if (fmt === 'mcnp') code = genMCNP(pitch);
            else if (fmt === 'openmc') code = genOpenMC(pitch);
            else code = genSerpent(pitch);
            document.getElementById('code-preview').textContent = code;
        }

        function genMCNP(pitch) {
            const half = pitch / 2;
            const k = Math.floor((gridSize - 1) / 2);
            const range = gridSize % 2 === 1 ? '-' + k + ':' + k + ' -' + k + ':' + k + ' 0:0' : '-' + (gridSize/2) + ':' + (gridSize/2-1) + ' -' + (gridSize/2) + ':' + (gridSize/2-1) + ' 0:0';
            let lines = ['c --- ' + gridSize + 'x' + gridSize + ' Lattice (u=10) ---',
                'c  Pin pitch = ' + pitch.toFixed(4) + ' cm',
                '100 0  -10 11 -12 13  lat=1 u=10 imp:n=1 fill=' + range];
            grid.forEach(row => lines.push('    ' + row.join(' ')));
            lines.push('c');
            lines.push('c  Lattice cell surfaces (half-pitch = ' + half.toFixed(4) + ' cm)');
            lines.push('10  px  ' + half.toFixed(4));
            lines.push('11  px -' + half.toFixed(4));
            lines.push('12  py  ' + half.toFixed(4));
            lines.push('13  py -' + half.toFixed(4));
            return lines.join('\\n');
        }

        function genOpenMC(pitch) {
            const names = {1:'fuel_pin',2:'guide_tube',3:'instr_tube',4:'water_rod',5:'alt_fuel'};
            let lines = ['# --- ' + gridSize + 'x' + gridSize + ' Lattice ---',
                'lattice = openmc.RectLattice(name="' + gridSize + 'x' + gridSize + ' lattice")',
                'lattice.pitch = (' + pitch + ', ' + pitch + ')',
                'lattice.lower_left = (' + (-pitch*gridSize/2) + ', ' + (-pitch*gridSize/2) + ')', '',
                'lattice.universes = ['];
            grid.forEach(row => lines.push('    [' + row.map(v => names[v] || 'type_'+v).join(', ') + '],'));
            lines.push(']');
            return lines.join('\\n');
        }

        function genSerpent(pitch) {
            const names = {1:'P1',2:'GT',3:'IT',4:'WR',5:'P2'};
            let lines = ['% --- ' + gridSize + 'x' + gridSize + ' Lattice ---',
                'lat 100 1  0.0 0.0  ' + gridSize + ' ' + gridSize + '  ' + pitch.toFixed(4)];
            grid.forEach(row => lines.push(row.map(v => names[v] || 'U'+v).join(' ')));
            return lines.join('\\n');
        }

        function insertCode() {
            const code = document.getElementById('code-preview').textContent;
            vscode.postMessage({ command: 'insertCode', code: code.replace(/\\\\n/g, '\\n') });
        }

        document.getElementById('grid-size').addEventListener('change', (e) => { initGrid(parseInt(e.target.value)); });
        document.getElementById('pitch').addEventListener('change', refreshCode);
        document.getElementById('format').addEventListener('change', refreshCode);

        buildPalette();
        initGrid(17);
    </script>
</body>
</html>`;
    }
}
