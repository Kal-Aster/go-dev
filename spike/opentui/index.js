// go-dev TUI spike — OpenTUI core imperative API (non-React, Zig-backed).
//
// Same two screens as the terminal-kit spike, so the two are comparable:
//   1. SELECT  — a native TabSelectRenderable ("Presets" / "Services & Modes")
//                + a body Text. This is OpenTUI's selling point: tabs are a
//                first-class widget, not hand-rolled.
//   2. LOGS    — a native ScrollBoxRenderable with stickyScroll pinned to the
//                bottom, fed by the same high-volume fake source, with the same
//                library-vs-service filter.
//
// Run interactively:  npm start
// Smoke test (PTY):    node index.js --smoke
//
// ESM + top-level await: @opentui/core is ESM-only (note "type":"module").

import { createRequire } from 'node:module';
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TabSelectRenderable,
} from '@opentui/core';

const require = createRequire(import.meta.url);
const { FakeLogSource, SERVICES } = require('../shared/fake-log-source');

const SMOKE = process.argv.includes('--smoke');

// ---- shared log model (the "log bus") --------------------------------------
const RING_CAP = 2000;
const ring = [];
let showCore = true;
let serviceFilter = null;
let received = 0;

function visibleLines() {
  const out = [];
  for (const e of ring) {
    if (e.kind === 'core' && !showCore) continue;
    if (serviceFilter && e.kind === 'service' && e.source !== serviceFilter) continue;
    const tag = e.kind === 'core' ? '[core]' : `[${e.source}]`;
    out.push(`${tag} ${e.level} ${e.line}`);
  }
  return out;
}

// ---- renderer + UI ----------------------------------------------------------
const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });
const root = renderer.root;

let screen = 'select';
const PRESETS = ['api', 'dedup', 'basic'];

const header = new TextRenderable(renderer, { content: '', height: 1 });
root.add(header);

// SELECT view ---------------------------------------------------------------
const selectView = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: 'column', padding: 1 });
const tabs = new TabSelectRenderable(renderer, {
  height: 3,
  options: [
    { name: 'Presets', description: 'Avvia da un preset esistente' },
    { name: 'Services & Modes', description: 'Componi una selezione personalizzata' },
  ],
  showDescription: true,
});
const selectBody = new TextRenderable(renderer, { content: '', flexGrow: 1 });
selectView.add(tabs);
selectView.add(selectBody);
root.add(selectView);

// LOGS view -----------------------------------------------------------------
const logsView = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: 'column', visible: false });
const scroll = new ScrollBoxRenderable(renderer, {
  flexGrow: 1,
  stickyScroll: true,
  stickyStart: 'bottom',
  border: true,
});
const logText = new TextRenderable(renderer, { content: '' });
scroll.content.add(logText);
logsView.add(scroll);
root.add(logsView);

const footer = new TextRenderable(renderer, { content: '', height: 1 });
root.add(footer);

// ---- rendering --------------------------------------------------------------
function renderSelect() {
  const tab = tabs.getSelectedIndex();
  header.content = 'go-dev — selezione servizi';
  if (tab === 0) {
    selectBody.content =
      'Preset disponibili (invio per avviare):\n\n' +
      PRESETS.map((p) => `  • ${p}`).join('\n');
  } else {
    selectBody.content =
      'Servizi disponibili (spazio = on/off, m = modalità):\n\n' +
      SERVICES.map((s) => `  [x] ${s}   mode: dev`).join('\n');
  }
  footer.content = ' ←/→ cambia tab   invio: vai ai log   q: esci';
}

function renderLogs() {
  header.content =
    `go-dev · logs   core:${showCore ? 'ON' : 'OFF'}` +
    `   filtro:${serviceFilter ?? 'tutti'}   (${received} righe)`;
  logText.content = visibleLines().join('\n');
  footer.content =
    ' f: libreria on/off   1-4: filtra servizio   a: tutti   ↑↓/pgup: scorri   b: indietro   q: esci';
}

function showSelect() {
  screen = 'select';
  logsView.visible = false;
  selectView.visible = true;
  renderSelect();
}

function showLogs() {
  screen = 'logs';
  selectView.visible = false;
  logsView.visible = true;
  renderLogs();
}

// ---- input ------------------------------------------------------------------
renderer.keyInput.on('keypress', (key) => {
  const n = key.name;
  if (n === 'q' || (key.ctrl && n === 'c')) return shutdown(0);

  if (screen === 'select') {
    if (n === 'left') { tabs.moveLeft(); renderSelect(); }
    else if (n === 'right') { tabs.moveRight(); renderSelect(); }
    else if (n === 'return' || n === 'enter') showLogs();
    return;
  }

  switch (n) {
    case 'f': showCore = !showCore; renderLogs(); break;
    case 'a': case '0': serviceFilter = null; renderLogs(); break;
    case '1': case '2': case '3': case '4':
      serviceFilter = SERVICES[Number(n) - 1] || null; renderLogs(); break;
    case 'up': scroll.scrollBy(-1); break;
    case 'down': scroll.scrollBy(1); break;
    case 'pageup': scroll.scrollBy(-scroll.height); break;
    case 'pagedown': scroll.scrollBy(scroll.height); break;
    case 'b': showSelect(); break;
  }
});

// ---- lifecycle --------------------------------------------------------------
const source = new FakeLogSource({ intervalMs: 8, burst: 3 });
source.on('log', (e) => {
  received++;
  ring.push(e);
  if (ring.length > RING_CAP) ring.shift();
});

let renderTimer = setInterval(() => { if (screen === 'logs') renderLogs(); }, 33);

function shutdown(code) {
  source.stop();
  clearInterval(renderTimer);
  try { renderer.stop(); } catch {}
  try { renderer.destroy?.(); } catch {}
  if (SMOKE) console.log(`[smoke] opentui ok — received=${received} ring=${ring.length}`);
  setTimeout(() => process.exit(code), 50);
}

showSelect();
renderer.start();
source.start();

if (SMOKE) {
  setTimeout(showLogs, 300);
  setTimeout(() => { showCore = false; }, 700);
  setTimeout(() => { serviceFilter = SERVICES[0]; }, 1000);
  setTimeout(() => shutdown(0), 1500);
}
