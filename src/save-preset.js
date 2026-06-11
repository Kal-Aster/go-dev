const fs = require('fs');
const yaml = require('js-yaml');
const { loadConfig } = require('./config');

/**
 * Renders a value as a YAML scalar, quoting it only when it isn't a plain,
 * safe identifier. Service/mode names come from config keys (already safe);
 * user-typed preset names may need quoting.
 */
function scalar(value) {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Builds the YAML block for a single preset entry, indented under `presets:`.
 *
 * @param {string} name
 * @param {{ services: string[], modes?: Record<string, string> }} selection
 * @param {string} indent - leading indentation for the entry key (e.g. '  ').
 */
function buildPresetBlock(name, selection, indent) {
  const step = '  ';
  const lines = [
    `${indent}${scalar(name)}:`,
    `${indent}${step}services: [${selection.services.map(scalar).join(', ')}]`,
  ];

  const modes = selection.modes ?? {};
  const modeEntries = Object.entries(modes).filter(([, mode]) => mode != null);
  if (modeEntries.length > 0) {
    lines.push(`${indent}${step}modes:`);
    for (const [service, mode] of modeEntries) {
      lines.push(`${indent}${step}${step}${scalar(service)}: ${scalar(mode)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Inserts a preset into a raw YAML config, preserving the rest of the file
 * (comments, key order, formatting). Falls back to a full re-dump only when the
 * existing `presets:` key isn't a plain block we can append to.
 *
 * @param {string} raw
 * @param {string} name
 * @param {object} selection
 * @returns {string} the new file content
 */
function insertPreset(raw, name, selection) {
  const lines = raw.split('\n');
  const presetsIndex = lines.findIndex((line) => /^(\s*)presets:\s*$/.test(line));

  // Case A: a plain `presets:` block key exists — insert as its first entry.
  if (presetsIndex >= 0) {
    const baseIndent = lines[presetsIndex].match(/^(\s*)/)[1] + '  ';
    const block = buildPresetBlock(name, selection, baseIndent);
    lines.splice(presetsIndex + 1, 0, block);
    return lines.join('\n');
  }

  // Case B: no `presets:` key at all — append a fresh block at the end.
  const hasPresetsKey = lines.some((line) => /^\s*presets:/.test(line));
  if (!hasPresetsKey) {
    const trimmed = raw.replace(/\s*$/, '');
    const block = buildPresetBlock(name, selection, '  ');
    return `${trimmed}\n\npresets:\n${block}\n`;
  }

  // Case C: `presets:` exists but inline (e.g. `presets: {}`) — re-dump to stay
  // structurally correct. Comments are lost; acceptable for this edge case.
  const parsed = yaml.load(raw) ?? {};
  parsed.presets = parsed.presets ?? {};
  parsed.presets[name] = {
    services: selection.services,
    ...(Object.keys(selection.modes ?? {}).length > 0 ? { modes: selection.modes } : {}),
  };
  return yaml.dump(parsed, { lineWidth: 120 });
}

/**
 * Persists a selection as a named preset in the given config file, then
 * re-validates the file by loading it. On validation failure the original
 * content is restored and the error is re-thrown.
 *
 * @param {string} configPath
 * @param {string} name
 * @param {{ services: string[], modes?: Record<string, string> }} selection
 */
function savePreset(configPath, name, selection) {
  const original = fs.readFileSync(configPath, 'utf8');
  const updated = insertPreset(original, name, selection);

  fs.writeFileSync(configPath, updated, 'utf8');
  try {
    loadConfig(configPath);
  } catch (error) {
    fs.writeFileSync(configPath, original, 'utf8');
    throw new Error(`Failed to save preset '${name}': ${error.message}`);
  }
}

module.exports = { savePreset, insertPreset };
