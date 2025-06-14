const { BaseService } = require('./base');

class CmdService extends BaseService {
  constructor(name, mode, config, onExit) {
    super(name, mode, config, onExit);
    this.prefix = `${name}:${mode}:`;
    this.processes = [];
  }

  async start() {
    console.log(`[${this.name}:${this.mode}] Starting cmd service...`);

    const { preCommands, commands } = this.config;
    if (!commands) {
      throw new Error(
        `[${this.name}:${this.mode}] Commands not found for service.`,
      );
    }

    if (preCommands && preCommands.length > 0) {
      console.log(`[${this.name}:${this.mode}] Running pre-commands...`);
      for (const command of preCommands) {
        const { cmdArgs, directory } = (Array.isArray(command) ?
          { cmdArgs: command } :
          { cmdArgs: command.command, directory: command.directory }
        );
        try {
          CmdService._processManager.runSync(cmdArgs[0], cmdArgs.slice(1), {
            cwd: directory,
            stdio: 'inherit',
          });
        } catch (error) {
          console.log({ cmdArgs });
          throw new Error(
            `[${this.name}:${this.mode}] Pre-command failed: ${cmdArgs.join(
              ' ',
            )}: ${error.message}`,
          );
        }
      }
      console.log(`[${this.name}:${this.mode}] Pre-commands completed.`);
    }

    const { cmdArgs, directory } = (Array.isArray(commands) && typeof commands[0] === 'string' ?
      { cmdArgs: [commands], directory: [undefined] } :
      (Array.isArray(commands) ?
        {
          cmdArgs: commands.map(({ command }) => command),
          directory: commands.map(({ directory }) => directory),
        } :
        { cmdArgs: [commands.command], directory: [commands.directory] }
      )
    );

    const useProcessIndex = cmdArgs.length > 1;
    for (let index = 0; index < cmdArgs.length; index++) {
      const command = cmdArgs[index];
      const cwd = directory[index];

      const process = CmdService._processManager.startManagedProcess(
        command[0],
        command.slice(1),
        { cwd },
        (useProcessIndex ?
          `${this.prefix}${index}:` :
          this.prefix
        ),
        true,
        () => this.onExit?.()
      );
  
      if (!process) {
        throw new Error(
          `[${this.name}:${this.mode}] Failed to spawn process: ${command.join(' ')}`,
        );
      }

      this.processes.push(process);
      console.log(
        `[${this.name}:${this.mode}] Process started (PID: ${process.process.pid}).`,
      );
    }
  }

  async stop() {
    const promises = this.processes.map(({ process }) => {
      console.log(`[${this.name}:${this.mode}] Stopping process (PID: ${process.pid}).`);
      return CmdService._processManager.killProcess(process);
    });
    this.processes.splice(0, this.processes.length);

    await Promise.all(promises);
  }
}

module.exports = { CmdService };