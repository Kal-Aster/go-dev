'use strict';

// go-dev TUI spike — terminal-kit (pure JS, non-React).
//
// Two screens, mirroring the real design:
//   1. SELECT  — two hand-rolled tabs ("Presets" / "Services"). terminal-kit has
//                no native tab widget, so we draw the tab bar ourselves. This is
//                an honest data point on the per-feature cost.
//   2. LOGS    — a scrollable TextBox fed by a high-volume fake source, with a
//                library-vs-service filter. TextBox + appendLog/setContent does
//                the heavy lifting here, which is terminal-kit's strong suit.
//
// Run interactively:  npm start
// Smoke test (CI/PTY): node index.js --smoke   (build UI, pump logs, auto-exit)

const termkit = require('terminal-kit');
const term = termkit.terminal;
const { FakeLogSource, SERVICES } = require('../shared/fake-log-source');

const SMOKE = process.argv.includes('--smoke');

// ---- shared log model (this is the "log bus" go-dev would grow) -------------
const RING_CAP = 2000;
const ring = [];           // { source, kind, level, line }
let showCore = true;       // 'f' toggles library/core logs
let serviceFilter = null;  // 1-4 -> a single service; null = all services
let pinnedToBottom = true; // false once the user scrolls up
let received = 0;

function levelColor(level) {
  switch (level) {
    case 'error': return '^r';
    case 'warn': return '^y';
    case 'debug': return '^K';
    default: return '^g';
  }
}

function visibleLines() {
  const out = [];
  for (const e of ring) {
    if (e.kind === 'core' && !showCore) continue;
    if (serviceFilter && e.kind === 'service' && e.source !== serviceFilter) continue;
    const tag = e.kind === 'core' ? '^c[core]^:' : `^b[${e.source}]^:`;
    out.push(`${tag} ${levelColor(e.level)}${e.level}^: ${e.line}`);
  }
  return out;
}

// ---- UI ---------------------------------------------------------------------
let screen = 'select';       // 'select' | 'logs'
let activeTab = 0;           // 0 = Presets, 1 = Services
const TABS = ['Presets', 'Services & Modes'];
const PRESETS = ['api', 'dedup', 'basic'];

let document, logBox, headerText, bodyText, footerText;

function buildUI() {
  term.fullscreen(true);
  document = term.createDocument();

  headerText = new termkit.Text({ parent: document, x: 0, y: 0, content: '', contentHasMarkup: true });
  bodyText = new termkit.Text({ parent: document, x: 0, y: 2, content: '', contentHasMarkup: true });

  logBox = new termkit.TextBox({
    parent: document,
    x: 0, y: 2,
    width: term.width,
    height: term.height - 4,
    scrollable: true,
    vScrollBar: true,
    contentHasMarkup: true,
    hidden: true,
  });

  footerText = new termkit.Text({
    parent: document,
    x: 0, y: term.height - 1,
    content: '', contentHasMarkup: true,
  });

  renderSelect();
}

function renderSelect() {
  const tabBar = TABS.map((t, i) =>
    i === activeTab ? `^#^k ${t} ^:` : `^K ${t} ^:`
  ).join('  ');
  headerText.setContent(`^+go-dev^:  ${tabBar}`, true);

  let body;
  if (activeTab === 0) {
    body = PRESETS.length
      ? '  Preset disponibili (↑↓ + invio per avviare):\n\n' +
        PRESETS.map(p => `   ^b•^: ${p}`).join('\n')
      : '  Nessun preset definito — usa la tab Services.';
  } else {
    body = '  Servizi disponibili (spazio per (de)selezionare, m per modalità):\n\n' +
      SERVICES.map(s => `   ^g[x]^: ${s}   ^Kmode: dev^:`).join('\n');
  }
  bodyText.setContent(body, true);
  footerText.setContent('^K tab^: cambia tab   ^K invio^: vai ai log   ^K q^: esci', true);
}

function renderLogs() {
  headerText.setContent(
    `^+go-dev · logs^:   core:${showCore ? '^gON^:' : '^rOFF^:'}` +
    `   filtro:${serviceFilter ? '^b' + serviceFilter + '^:' : 'tutti'}` +
    `   ^K(${received} righe)^:`,
    true
  );
  const lines = visibleLines();
  logBox.setContent(lines.join('\n'), true, true);
  if (pinnedToBottom) logBox.scrollToBottom(true);
  logBox.draw();
  footerText.setContent(
    '^K f^: libreria on/off   ^K 1-4^: filtra servizio   ^K a^: tutti   ' +
    '^K ↑↓/pgup^: scorri   ^K g/G^: cima/fondo   ^K b^: indietro   ^K q^: esci',
    true
  );
}

function goToLogs() {
  screen = 'logs';
  bodyText.hide();
  logBox.show();
  logBox.y = 2;
  logBox.outerHeight = term.height - 4;
  renderLogs();
}

function goToSelect() {
  screen = 'select';
  logBox.hide();
  bodyText.show();
  renderSelect();
}

// ---- input ------------------------------------------------------------------
function onKey(name) {
  if (name === 'CTRL_C' || name === 'q') return shutdown(0);

  if (screen === 'select') {
    if (name === 'TAB' || name === 'RIGHT') { activeTab = (activeTab + 1) % TABS.length; renderSelect(); }
    else if (name === 'LEFT') { activeTab = (activeTab + TABS.length - 1) % TABS.length; renderSelect(); }
    else if (name === 'ENTER') goToLogs();
    return;
  }

  // logs screen
  switch (name) {
    case 'f': showCore = !showCore; renderLogs(); break;
    case 'a': case '0': serviceFilter = null; renderLogs(); break;
    case '1': case '2': case '3': case '4':
      serviceFilter = SERVICES[Number(name) - 1] || null; renderLogs(); break;
    case 'UP': pinnedToBottom = false; logBox.scroll(0, 1); break;
    case 'DOWN': logBox.scroll(0, -1); break;
    case 'PAGE_UP': pinnedToBottom = false; logBox.scroll(0, logBox.outerHeight); break;
    case 'PAGE_DOWN': logBox.scroll(0, -logBox.outerHeight); break;
    case 'g': pinnedToBottom = false; logBox.scrollTo(0, 0); break;
    case 'G': pinnedToBottom = true; logBox.scrollToBottom(); break;
    case 'b': goToSelect(); break;
  }
}

// ---- lifecycle --------------------------------------------------------------
const source = new FakeLogSource({ intervalMs: 8, burst: 3 });
source.on('log', (e) => {
  received++;
  ring.push(e);
  if (ring.length > RING_CAP) ring.shift();
});

let renderTimer = null;
function startRenderLoop() {
  renderTimer = setInterval(() => { if (screen === 'logs') renderLogs(); }, 33); // ~30fps
}

function shutdown(code) {
  source.stop();
  if (renderTimer) clearInterval(renderTimer);
  term.grabInput(false);
  term.fullscreen(false);
  term.hideCursor(false);
  if (SMOKE) console.log(`[smoke] terminal-kit ok — received=${received} ring=${ring.length}`);
  setTimeout(() => process.exit(code), 50);
}

function main() {
  buildUI();
  term.grabInput(true);
  term.hideCursor(true);
  term.on('key', onKey);
  source.start();
  startRenderLoop();

  if (SMOKE) {
    // Drive the real code path without a human: jump to logs, toggle a filter, exit.
    setTimeout(goToLogs, 300);
    setTimeout(() => { showCore = false; }, 700);
    setTimeout(() => { serviceFilter = SERVICES[0]; }, 1000);
    setTimeout(() => shutdown(0), 1500);
  }
}

main();
