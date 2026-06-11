const Orchestrator = require('./orchestrator');
const { parseCliArgs } = require('./cli-args');
const { findConfigFile } = require('./config');
const { resolvePreset } = require('./dependency-resolver');
const { runInteractive } = require('./interactive');
const log = require('./logger');

/**
 * Shared CLI entry flow, used by both `bin/go-dev` and `src/index.js`.
 *
 * Resolves a service selection — from a preset name, or interactively when no
 * preset is given (or `--interactive` is set) — and hands it to the orchestrator.
 *
 * @param {string[]} argv - argv tail (already stripped of node + script path).
 */
async function run(argv) {
  try {
    const { presetName, configPath, logLevel, interactive, remaining } = parseCliArgs(argv);

    const resolvedConfigPath = configPath ?? findConfigFile();
    const orchestrator = new Orchestrator(resolvedConfigPath, { logLevel });

    let selection;
    if (interactive || !presetName) {
      if (!presetName && !process.stdin.isTTY) {
        console.error(
          'Error: no preset given and no interactive terminal. ' +
          'Specify a preset (go-dev <preset>) or run in a TTY to use the interactive selector.'
        );
        process.exit(1);
      }

      selection = await runInteractive(orchestrator.config, {
        configPath: resolvedConfigPath,
        presetName,
      });
      if (!selection) {
        process.exit(0); // user cancelled
      }
    } else {
      selection = { name: presetName, ...resolvePreset(orchestrator.config, presetName) };
    }

    // Keep `remaining` (the `--args-for ...` tail) at argv index >= 3, where the
    // orchestrator's per-service args parser reads it. Index 2 is unused there.
    process.argv = [process.argv[0], process.argv[1], selection.name ?? '', ...remaining];

    await orchestrator.start(selection);
  } catch (error) {
    // Setup-phase failures (bad config, unknown preset, TUI errors). The
    // orchestrator handles its own runtime errors and cleanup internally.
    log.error(`\n❌ ${error.message}`);
    process.exit(1);
  }
}

module.exports = { run };
