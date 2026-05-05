/**
 * Parses go-dev CLI arguments.
 *
 * Recognizes:
 *   <preset>                 — positional preset name (first non-flag arg)
 *   -c <path>, --config <path>, -c=<path>, --config=<path>
 *
 * `-c`/`--config` is only interpreted before the first `--args-for` token.
 * Everything from `--args-for` onward is preserved verbatim in `remaining`
 * so the orchestrator's per-service args parser can consume it untouched.
 *
 * @param {string[]} argv - argv tail (already stripped of node + script path).
 * @returns {{ presetName?: string, configPath?: string, remaining: string[] }}
 */
function parseCliArgs(argv) {
  let presetName;
  let configPath;
  const remaining = [];

  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--args-for') {
      break;
    }

    if (arg === '-c' || arg === '--config') {
      const value = argv[i + 1];
      if (value == null) {
        throw new Error(`'${arg}' flag requires a path argument.`);
      }
      configPath = value;
      i++;
      continue;
    }

    if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
      continue;
    }
    if (arg.startsWith('-c=')) {
      configPath = arg.slice('-c='.length);
      continue;
    }

    if (presetName == null && !arg.startsWith('-')) {
      presetName = arg;
      continue;
    }

    remaining.push(arg);
  }

  for (; i < argv.length; i++) {
    remaining.push(argv[i]);
  }

  return { presetName, configPath, remaining };
}

module.exports = { parseCliArgs };
