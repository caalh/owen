import * as vscode from 'vscode';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { extractCylinders, CylinderSpec } from './extractor';

let currentPanel: vscode.WebviewPanel | undefined;

export function registerGeometryPreview(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.openGeometryPreview', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('OWEN: open an input file before launching the geometry preview.');
            return;
        }
        const language = detectMonteCarloLanguage(editor.document) ?? 'mcnp';
        const cylinders = extractCylinders(editor.document.getText(), language);

        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            currentPanel = vscode.window.createWebviewPanel(
                'owenGeometryPreview',
                'OWEN: 3D Geometry Preview',
                vscode.ViewColumn.Beside,
                { enableScripts: true, retainContextWhenHidden: true },
            );
            currentPanel.onDidDispose(() => { currentPanel = undefined; }, null, context.subscriptions);
            currentPanel.webview.html = buildHtml(currentPanel.webview);
        }

        currentPanel.webview.postMessage({ type: 'cylinders', cylinders, language });
        if (cylinders.length === 0) {
            vscode.window.showInformationMessage(
                language === 'mcnp'
                    ? 'OWEN: no cz cylinders found in the active deck.'
                    : `OWEN: 3D extraction for ${language} is not implemented yet — see the OWEN README ROADMAP.`,
            );
        }
    });
}

function buildHtml(webview: vscode.Webview): string {
    const cspSource = webview.cspSource;
    const nonce = makeNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://unpkg.com; connect-src https://unpkg.com;">
<title>OWEN: 3D Geometry Preview</title>
<style nonce="${nonce}">
  html, body { margin: 0; padding: 0; height: 100%; background: #0b1018; color: #cdd6f4; font-family: -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
  #info { position: absolute; top: 8px; left: 12px; z-index: 10; font-size: 12px; opacity: 0.7; }
  #stage { position: absolute; inset: 0; }
</style>
</head>
<body>
  <div id="info">OWEN: drag to orbit • scroll to zoom • right-click to pan</div>
  <div id="stage"></div>
  <script type="importmap" nonce="${nonce}">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
    }
  }
  </script>
  <script type="module" nonce="${nonce}">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    const stage = document.getElementById('stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1018);

    const camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.01, 5000);
    camera.position.set(8, 8, 8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dl = new THREE.DirectionalLight(0xffffff, 0.85);
    dl.position.set(10, 10, 10);
    scene.add(dl);
    scene.add(new THREE.AxesHelper(2));

    const cylindersGroup = new THREE.Group();
    scene.add(cylindersGroup);

    const palette = [0x89b4fa, 0xf5c2e7, 0xa6e3a1, 0xfab387, 0xf9e2af, 0xcba6f7, 0x94e2d5];

    function clear() {
      while (cylindersGroup.children.length) {
        const child = cylindersGroup.children.pop();
        child.geometry?.dispose();
        child.material?.dispose();
      }
    }

    function render(cylinders) {
      clear();
      const sorted = [...cylinders].sort((a, b) => b.radius - a.radius);
      sorted.forEach((c, idx) => {
        const geo = new THREE.CylinderGeometry(c.radius, c.radius, Math.max(0.01, c.height), 48, 1, true);
        const fillColor = (typeof c.color === 'string' && c.color.length > 0)
          ? new THREE.Color(c.color)
          : new THREE.Color(palette[idx % palette.length]);
        const mat = new THREE.MeshStandardMaterial({
          color: fillColor,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          roughness: 0.4,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(c.x, c.z, c.y);
        cylindersGroup.add(mesh);
      });
      if (sorted.length) {
        // Fit camera to the actual scene extents so lattice/core layouts (which
        // have small per-pin radius but a large overall footprint) frame nicely.
        let maxExtent = 0;
        for (const c of sorted) {
          const ext = Math.max(
            Math.abs(c.x) + c.radius,
            Math.abs(c.y) + c.radius,
            Math.abs(c.z) + c.height / 2
          );
          if (ext > maxExtent) maxExtent = ext;
        }
        const outer = sorted[0];
        const dist = Math.max(maxExtent * 2.5, outer.radius * 4, outer.height * 2.5, 4);
        camera.position.set(dist, dist, dist);
        controls.target.set(0, 0, 0);
        controls.update();
      }
    }

    window.addEventListener('resize', () => {
      camera.aspect = stage.clientWidth / stage.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(stage.clientWidth, stage.clientHeight);
    });

    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && data.type === 'cylinders') {
        render(Array.isArray(data.cylinders) ? data.cylinders : []);
      }
    });
  </script>
</body>
</html>`;
}

function makeNonce(): string {
    let out = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

// Re-export so other modules can use the type.
export type { CylinderSpec };
