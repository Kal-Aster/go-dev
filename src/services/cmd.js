const log = require('../logger');
const { BaseService } = require('./base');
const { buildColoredPrefix, buildColoredTag } = require('../service-colors');
const { waitForReady } = require('./ready-check');

class CmdService extends BaseService {
  /**
   * Per-process cache of in-flight or completed service-as-preCommand runs.
   * Key: `${serviceName}:${resolvedMode}`. Value: Promise<void> for the run.
   */
  static _serviceCommandCache = new Map();

  constructor(name, mode, config, onExit, extraArgs) {
    super(name, mode, config, onExit, extraArgs);
    this.processes = [];
  }

  static _normalizeCommands(commands) {
    if (Array.isArray(commands) && typeof commands[0] === 'string') {
      return [{ command: commands, directory: undefined }];
    }
    if (Array.isArray(commands)) {
      return commands.map(c => (Array.isArray(c)
        ? { command: c, directory: undefined }
        : { command: c.command, directory: c.directory }
      ));
    }
    return [{ command: commands.command, directory: commands.directory }];
  }

  static _resolveServiceMode(serviceName, requestedMode) {
    const allServices = BaseService._servicesMap;
    const service = allServices?.[serviceName];
    if (!service) {
      throw new Error(`Service '${serviceName}' referenced as preCommand not found in configuration.`);
    }
    const mode = (service.type === 'hybrid'
      ? requestedMode ?? service.defaultMode ?? 'dev'
      : requestedMode ?? 'dev');
    const config = (service.type === 'hybrid'
      ? service.modes?.[mode]
      : (mode === 'dev' ? service : undefined));
    if (config == null) {
      throw new Error(`Mode '${mode}' not found in service '${serviceName}'.`);
    }
    if (config.type !== 'cmd') {
      throw new Error(
        `preCommand service '${serviceName}:${mode}' must be of type 'cmd', got '${config.type}'.`,
      );
    }
    return { mode, config };
  }

  static _runServiceAsPreCommand(serviceName, requestedMode, fromContext) {
    const { mode, config } = CmdService._resolveServiceMode(serviceName, requestedMode);
    const key = `${serviceName}:${mode}`;
    const existing = CmdService._serviceCommandCache.get(key);
    if (existing) {
      log.info(`[${fromContext}] preCommand service '${key}' already in flight or completed; awaiting.`);
      return existing;
    }

    const promise = (async () => {
      const ctx = buildColoredTag(serviceName, mode);
      log.info(`[${ctx}] Running as preCommand service...`);

      if (config.preCommands && config.preCommands.length > 0) {
        for (const pre of config.preCommands) {
          await CmdService._runPreCommand(pre, ctx);
        }
      }

      const normalized = CmdService._normalizeCommands(config.commands);
      const useIndex = normalized.length > 1;
      await Promise.all(normalized.map(({ command, directory }, index) => {
        const [cmd, ...args] = command;
        const prefix = buildColoredPrefix(serviceName, mode, useIndex ? index : null);
        return CmdService._processManager.runInheritedPrefixed(cmd, args, { cwd: directory }, prefix);
      }));

      log.info(`[${ctx}] preCommand service completed.`);
    })();

    CmdService._serviceCommandCache.set(key, promise);
    return promise;
  }

  static async _runPreCommand(pre, fromContext) {
    if (!Array.isArray(pre) && pre != null && typeof pre === 'object' && pre.service != null) {
      try {
        await CmdService._runServiceAsPreCommand(pre.service, pre.mode, fromContext);
      } catch (error) {
        throw new Error(
          `[${fromContext}] Pre-command service '${pre.service}${pre.mode ? `:${pre.mode}` : ''}' failed: ${error.message}`,
        );
      }
      return;
    }

    const { cmdArgs, directory } = (Array.isArray(pre)
      ? { cmdArgs: pre }
      : { cmdArgs: pre.command, directory: pre.directory });
    try {
      await CmdService._processManager.runInheritedPrefixed(
        cmdArgs[0],
        cmdArgs.slice(1),
        { cwd: directory },
        fromContext,
      );
    } catch (error) {
      log.debug({ cmdArgs });
      throw new Error(
        `[${fromContext}] Pre-command failed: ${cmdArgs.join(' ')}: ${error.message}`,
      );
    }
  }

  async start() {
    log.info(`[${this.coloredId}] Starting cmd service...`);

    const { preCommands, commands } = this.config;
    if (!commands) {
      throw new Error(
        `[${this.coloredId}] Commands not found for service.`,
      );
    }

    if (preCommands && preCommands.length > 0) {
      log.info(`[${this.coloredId}] Running pre-commands...`);
      for (const pre of preCommands) {
        await CmdService._runPreCommand(pre, this.coloredId);
      }
      log.info(`[${this.coloredId}] Pre-commands completed.`);
    }

    const { cmdArgs, directory, restartOnError } = (Array.isArray(commands) && typeof commands[0] === 'string' ?
      { cmdArgs: [commands], directory: [undefined], restartOnError: [undefined] } :
      (Array.isArray(commands) ?
        {
          cmdArgs: commands.map(({ command }) => command),
          directory: commands.map(({ directory }) => directory),
          restartOnError: commands.map(({ restartOnError }) => restartOnError),
        } :
        {
          cmdArgs: [commands.command],
          directory: [commands.directory],
          restartOnError: [commands.restartOnError],
        }
      )
    );

    const useProcessIndex = cmdArgs.length > 1;
    const exitedProcess = Array.from({ length: cmdArgs.length });
    for (let index = 0; index < cmdArgs.length; index++) {
      const [command, ...args] = cmdArgs[index];

      const extraArgs = (this.extraArgs?.[index] ?? []).slice();

      const finalArgs = args.map(arg => {
        const regex = /(\\*)\$arg/g;

        let indexesToReplace = [];
        while (true) {
          const match = regex.exec(arg);
          if (match == null) {
            break;
          }

          const backslashes = match[1];

          const startIndex = match.index + backslashes.length;

          if (backslashes.length % 2 === 1) {
            indexesToReplace.unshift({
              startIndex: startIndex - 1,
              endIndex: startIndex + 5,
              replacement: '$arg',
            });
            continue;
          }

          const replacement = extraArgs.shift() ?? '';
          indexesToReplace.unshift({
            startIndex,
            endIndex: startIndex + 4,
            replacement,
          });
        }

        indexesToReplace.forEach(({ startIndex, endIndex, replacement }) => {
          log.debug({ replacement, start: arg.slice(0, startIndex) });
          arg = arg.slice(0, startIndex) + replacement + arg.slice(endIndex);
        });

        return arg;
      }).concat(extraArgs);

      const prefix = buildColoredPrefix(
        this.name,
        this.mode,
        useProcessIndex ? index : null,
      );
      const process = CmdService._processManager.startManagedProcess(
        command,
        finalArgs,
        { cwd: directory[index] },
        prefix,
        restartOnError[index],
        () => {
          exitedProcess[index] = true;
          if (exitedProcess.some(exited => !exited)) {
            return;
          }

          this.onExit?.();
        }
      );
  
      if (!process) {
        throw new Error(
          `[${this.coloredId}] Failed to spawn process: ${command.join(' ')}`,
        );
      }

      this.processes.push(process);
      log.debug(
        `[${this.coloredId}] Process started (PID: ${process.process.pid}).`,
      );
    }

    if (this.config.readyWhen) {
      await waitForReady(
        this.processes.map(({ process }) => process),
        this.config.readyWhen,
        this.coloredId,
      );
    }
  }

  async stop() {
    const promises = this.processes.map(({ process }) => {
      log.debug(`[${this.coloredId}] Stopping process (PID: ${process.pid}).`);
      return CmdService._processManager.killProcess(process);
    });
    this.processes.splice(0, this.processes.length);

    await Promise.all(promises);
  }
}

module.exports = { CmdService };