const fs = require('fs');
const path = require('path');
const os = require('os');

// Where we remember the last launched selection — a single per-user file,
// keyed by config path, kept OUTSIDE the consumer's repo so it never shows up
// in their working tree. Follows XDG state on Linux/macOS, LOCALAPPDATA on
// Windows.
function stateDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'go-dev');
  }
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'go-dev');
}

function stateFile() {
  return path.join(stateDir(), 'last-selections.json');
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {};
  } catch {
    return {}; // missing or corrupt — start fresh
  }
}

// Key by the canonical absolute path of the config file, so the same file
// reached via a relative path, a symlink, or `..` always maps to one entry.
function keyFor(configPath) {
  const absolute = path.resolve(configPath);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute; // file not resolvable (shouldn't happen for a loaded config)
  }
}

/**
 * Returns the last selection launched against this config, or null.
 * @param {string} configPath
 * @returns {{ name?: string, services: string[], modes: Record<string,string> } | null}
 */
function loadLastSelection(configPath) {
  if (!configPath) return null;
  const entry = readAll()[keyFor(configPath)];
  if (!entry || !Array.isArray(entry.services)) return null;
  return { name: entry.name, services: entry.services, modes: entry.modes ?? {} };
}

/**
 * Persists the last launched selection for this config. Best-effort: never lets
 * a persistence failure (e.g. read-only home) break a launch.
 * @param {string} configPath
 * @param {{ name?: string, services: string[], modes?: Record<string,string> }} selection
 */
function saveLastSelection(configPath, selection) {
  if (!configPath || !selection) return;
  try {
    const all = readAll();
    all[keyFor(configPath)] = {
      name: selection.name,
      services: selection.services,
      modes: selection.modes ?? {},
    };
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(all, null, 2), 'utf8');
  } catch {
    // ignore — remembering the selection is a convenience, not a requirement
  }
}

module.exports = { loadLastSelection, saveLastSelection, stateFile };
