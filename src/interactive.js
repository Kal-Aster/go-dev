const termkit = require('terminal-kit');
const { savePreset } = require('./save-preset');
const { summarizeSelection } = require('./dependency-resolver');
const log = require('./logger');

/**
 * Full-screen interactive selection TUI (terminal-kit).
 *
 * Two tabs — "Presets" and "Services & Modes" — let the user either launch an
 * existing preset or compose a custom selection (toggle services, pick a mode
 * for hybrid services), optionally saving it back as a new preset.
 *
 * Runs to completion *before* the orchestrator takes over stdout, then fully
 * restores the terminal. Resolves to a selection `{ name?, services, modes }`,
 * or `null` if the user cancels (q / Esc / Ctrl+C).
 *
 * @param {object} config - the loaded, validated go-dev config.
 * @param {{ configPath: string, presetName?: string }} options
 * @returns {Promise<{ name?: string, services: string[], modes: Record<string,string> } | null>}
 */
function runInteractive(config, { configPath, presetName } = {}) {
  const term = termkit.terminal;
  const serviceNames = Object.keys(config.services ?? {});
  const presetNames = Object.keys(config.presets ?? {});

  const isHybrid = (name) => config.services[name].type === 'hybrid';
  const modesFor = (name) => (isHybrid(name) ? Object.keys(config.services[name].modes) : ['dev']);
  const defaultModeFor = (name) =>
    isHybrid(name)
      ? config.services[name].defaultMode ?? modesFor(name)[0] ?? 'dev'
      : 'dev';

  // --- state ---------------------------------------------------------------
  const selected = new Set();
  const chosenMode = new Map();
  for (const name of serviceNames) chosenMode.set(name, defaultModeFor(name));

  // Pre-populate from a preset when forced interactive with a preset given.
  if (presetName && config.presets?.[presetName]) {
    const preset = config.presets[presetName];
    for (const s of preset.services) selected.add(s);
    for (const [s, m] of Object.entries(preset.modes ?? {})) chosenMode.set(s, m);
  }

  const TABS = ['Services & Modes', 'Presets'];
  let activeTab = 0; // land on Services & Modes; Tab switches to Presets
  let cursor = 0;
  let message = '';

  // --- rendering -----------------------------------------------------------
  function drawHeader() {
    term.moveTo(1, 1).styleReset().bold('go-dev')(' — selezione servizi');
    term.moveTo(1, 2);
    TABS.forEach((label, i) => {
      if (i === activeTab) term.bgBrightWhite.black(` ${label} `);
      else term.bgGray.white(` ${label} `);
      term('  ');
    });
  }

  function drawPresets() {
    term.moveTo(1, 4)('Preset disponibili — ↑/↓ scegli, invio avvia:');
    if (presetNames.length === 0) {
      term.moveTo(3, 6).gray('(nessun preset definito — usa la tab Services & Modes)');
      return;
    }
    presetNames.forEach((name, i) => {
      const marker = i === cursor ? '❯' : ' ';
      const services = (config.presets[name].services ?? []).join(', ');
      term.moveTo(2, 6 + i);
      const text = `${marker} ${name}`;
      if (i === cursor) term.brightCyan(text);
      else term(text);
      term.gray(`   services: ${services}`);
    });
  }

  function drawServices() {
    term.moveTo(1, 4)('Servizi — spazio: on/off, m: modalità, invio: avvia:');
    if (serviceNames.length === 0) {
      term.moveTo(3, 6).gray('(nessun servizio definito)');
      return;
    }
    serviceNames.forEach((name, i) => {
      const marker = i === cursor ? '❯' : ' ';
      const box = selected.has(name) ? '[x]' : '[ ]';
      term.moveTo(2, 6 + i);
      const text = `${marker} ${box} ${name}`;
      if (i === cursor) term.brightCyan(text);
      else term(text);
      const mode = isHybrid(name) ? chosenMode.get(name) : 'dev';
      term.gray(`   mode: ${mode}${isHybrid(name) ? ' (m per cambiare)' : ''}`);
    });
  }

  // Selection the bottom panel previews for the highlighted item.
  function previewSelection() {
    if (activeTab === 0) {
      const svc = serviceNames[cursor];
      if (!svc) return null;
      return {
        title: `servizio "${svc}"`,
        selection: { services: [svc], modes: isHybrid(svc) ? { [svc]: chosenMode.get(svc) } : {} },
      };
    }
    const preset = presetNames[cursor];
    if (!preset) return null;
    return {
      title: `preset "${preset}"`,
      selection: { services: config.presets[preset].services, modes: config.presets[preset].modes ?? {} },
    };
  }

  // Bottom panel: full resolved list (primary + dependencies + preCommand
  // services) for whatever item is highlighted, on either tab.
  function drawPanel(top) {
    term.moveTo(1, top).styleReset().gray('─'.repeat(Math.min(term.width, 64)));

    const preview = previewSelection();
    if (!preview) return;

    let summary;
    const previousLevel = log.getLogLevel();
    try {
      log.setLogLevel('error'); // silence resolver dedup warnings while previewing
      summary = summarizeSelection(config, preview.selection);
    } catch (error) {
      term.moveTo(3, top + 1).styleReset().red(`⚠ ${error.message}`);
      return;
    } finally {
      log.setLogLevel(previousLevel);
    }

    term.moveTo(1, top + 1).styleReset().bold(`Avvia (${preview.title}):`);

    let row = top + 2;
    const put = (label, style) => {
      if (row >= term.height - 1) return;
      term.moveTo(3, row++).styleReset();
      style(label);
    };
    for (const s of summary.primary) put(`${s.name}:${s.mode}   (primario)`, (t) => term.brightWhite(t));
    for (const d of summary.dependencies) put(`${d.name}:${d.mode}   (dipendenza)`, (t) => term.white(t));
    for (const p of summary.preCommands) put(`${p.name}:${p.mode}   (preCommand di ${p.from})`, (t) => term.yellow(t));
    if (summary.primary.length === 0) put('(nessun servizio)', (t) => term.gray(t));
  }

  function render() {
    term.clear();
    drawHeader();
    if (activeTab === 0) drawServices();
    else drawPresets();

    const panelTop = 6 + Math.max(serviceNames.length, presetNames.length, 1) + 1;
    drawPanel(panelTop);

    if (message) {
      term.moveTo(1, term.height - 1).styleReset().yellow(message);
    }
    term.moveTo(1, term.height).styleReset().gray(
      ' ←/→ tab   ↑/↓ muovi   spazio on/off   m modalità   invio avvia   q esci'
    );
  }

  // --- helpers -------------------------------------------------------------
  function currentList() {
    return activeTab === 0 ? serviceNames : presetNames;
  }

  function cycleMode(name) {
    if (!isHybrid(name)) return;
    const modes = modesFor(name);
    const next = (modes.indexOf(chosenMode.get(name)) + 1) % modes.length;
    chosenMode.set(name, modes[next]);
  }

  function buildCustomSelection() {
    const services = serviceNames.filter((s) => selected.has(s));
    const modes = {};
    for (const s of services) {
      if (isHybrid(s)) modes[s] = chosenMode.get(s);
    }
    return { name: undefined, services, modes };
  }

  // --- lifecycle -----------------------------------------------------------
  return new Promise((resolve) => {
    let finished = false;

    function cleanup() {
      term.removeListener('key', onKey);
      term.grabInput(false);
      term.hideCursor(false);
      term.fullscreen(false);
    }

    function finish(result) {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(result);
    }

    async function confirmCustom() {
      const selection = buildCustomSelection();
      if (selection.services.length === 0) {
        message = 'Seleziona almeno un servizio (spazio).';
        return render();
      }

      // Hand input over to terminal-kit's prompt helpers for the save flow.
      term.removeListener('key', onKey);
      term.hideCursor(false);

      term.moveTo(1, term.height - 2).styleReset().eraseLine();
      term('Salvare questa selezione come preset? [s/N] ');
      const wantsSave = await term.yesOrNo({ yes: ['s', 'y'], no: ['n', 'ENTER', 'ESCAPE'] }).promise;

      if (wantsSave) {
        term.moveTo(1, term.height - 1).styleReset().eraseLine();
        term('Nome del preset: ');
        const name = ((await term.inputField().promise) || '').trim();
        if (name) {
          try {
            savePreset(configPath, name, selection);
            selection.name = name;
          } catch (error) {
            term.moveTo(1, term.height).styleReset().eraseLine().red(`Errore: ${error.message}`);
            await term.yesOrNo({ yes: ['ENTER', 'y', 's'], no: ['n'] }).promise; // pausa per leggere
          }
        }
      }

      return finish(selection);
    }

    function onKey(name) {
      message = '';

      if (name === 'CTRL_C' || name === 'ESCAPE' || name === 'q') return finish(null);

      if (name === 'TAB' || name === 'LEFT' || name === 'RIGHT') {
        activeTab = (activeTab + 1) % TABS.length;
        cursor = 0;
        return render();
      }

      const list = currentList();
      if (name === 'UP') {
        cursor = list.length ? (cursor - 1 + list.length) % list.length : 0;
        return render();
      }
      if (name === 'DOWN') {
        cursor = list.length ? (cursor + 1) % list.length : 0;
        return render();
      }

      if (activeTab === 1) {
        // Presets tab
        if (name === 'ENTER') {
          const preset = presetNames[cursor];
          if (!preset) return;
          return finish({
            name: preset,
            services: config.presets[preset].services,
            modes: config.presets[preset].modes ?? {},
          });
        }
        return;
      }

      // Services & Modes tab
      const svc = serviceNames[cursor];
      if (!svc) return;
      if (name === ' ' || name === 'SPACE') {
        if (selected.has(svc)) selected.delete(svc);
        else selected.add(svc);
        return render();
      }
      if (name === 'm') {
        cycleMode(svc);
        return render();
      }
      if (name === 'ENTER') return confirmCustom();
    }

    term.fullscreen(true);
    term.grabInput(true);
    term.hideCursor(true);
    term.on('key', onKey);
    render();
  });
}

module.exports = { runInteractive };
