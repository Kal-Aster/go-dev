const { spawn, spawnSync, execSync } = require('child_process');
const prefixLines = require("./prefix-lines");

const isWindows = process.platform === 'win32';

class ProcessManager {
  constructor() {
    this.managedProcesses = new Set();
    this.cleanupInProgress = false;
  }

  /**
   * Runs a command synchronously (blocking).
   * Used for pre-commands, status checks, getting container names.
   * @param {string} command - The command to execute.
   * @param {string[]} args - Arguments for the command.
   * @param {object} [options={}] - Options for spawnSync (e.g., cwd, stdio).
   * @returns {string} The stdout of the command, trimmed.
   * @throws {Error} If the command fails.
   */
  runSync(command, args = [], options = {}) {
    if (this.cleanupInProgress) {
      console.warn(`[ProcessManager] Skipping synchronous command '${command}' during cleanup.`);
      return '';
    }
    console.log(`[ProcessManager] Running sync: ${command} ${args.join(' ')}`);
    try {
      const result = spawnSync(command, args, {
        shell: true,
        encoding: 'utf8',
        ...options,
      });

      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        const stderrOutput = result.stderr ? result.stderr.trim() : 'No stderr output.';
        throw new Error(
          `Command failed with code ${result.status}: ${command} ${args.join(
            ' ',
          )}\n${stderrOutput}`,
        );
      }
      return result.stdout?.trim() ?? '';
    } catch (error) {
      throw new Error(`Failed to run sync command '${command}': ${error.message}`);
    }
  }

  /**
   * Runs a command asynchronously, inheriting stdio.
   * Used for initial 'docker compose up -d' where we want to see immediate output
   * and the process is not meant to be continually managed/restarted by the orchestrator.
   * @param {string} command - The command to execute.
   * @param {string[]} args - Arguments for the command.
   * @param {object} [options={}] - Options for spawn.
   * @returns {Promise<void>} A promise that resolves when the process exits successfully.
   */
  runInherited(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      if (this.cleanupInProgress) {
        console.warn(`[ProcessManager] Skipping inherited command '${command}' during cleanup.`);
        return resolve();
      }
      console.log(`[ProcessManager] Running inherited: ${command} ${args.join(' ')}`);
      const proc = spawn(command, args, {
        shell: true,
        stdio: 'inherit',
        ...options,
      });

      proc.on('error', (err) => {
        console.error(`[ProcessManager] Failed to start inherited command '${command}':`, err);
        reject(err);
      });

      proc.on('exit', (code) => {
        if (code !== 0) {
          reject(
            new Error(`Inherited command '${command}' exited with code ${code}`),
          );
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Starts a long-running, managed process (like 'npx rollup -w').
   * Its output is prefixed, and it can be configured to restart on exit.
   * @param {string} command - The command to execute.
   * @param {string[]} args - Arguments for the command.
   * @param {object} options - Options for spawn (e.g., cwd).
   * @param {string} prefix - Prefix for stdout/stderr lines (e.g., 'frontend:').
   * @param {boolean} restartOnError - Whether to restart the process if it exits with non-zero code.
   * @param {Function} onExit
   * @param {ChildProcess[] | undefined} processReference - An array where to save the process to gain a reference to it.
   * @returns {ChildProcess} The spawned child process instance.
   */
  startManagedProcess(command, args, options, prefix, restartOnError, onExit, processReference) {
    if (this.cleanupInProgress) {
      console.warn(`[ProcessManager] Skipping managed process '${command}' during cleanup.`);
      return null;
    }
    console.log(
      `[ProcessManager] Starting managed process: ${command} ${args.join(
        ' ',
      )} (prefix: ${prefix})`,
    );

    if (processReference == null) {
      processReference = {}
    }

    const startedProcess = spawn(command, args, {
      shell: true,
      stdio: 'pipe',
      ...options,
    });
    processReference.process = startedProcess;

    let lastFormatting = '';
    startedProcess.stdout.on('data', (data) => {
      const result = prefixLines(data.toString(), prefix, lastFormatting);
      lastFormatting = result.lastFormatting;
      process.stdout.write(result.prefixedText);
    });
    startedProcess.stderr.on('data', (data) => {
      const result = prefixLines(data.toString(), prefix, lastFormatting);
      lastFormatting = result.lastFormatting;
      process.stderr.write(result.prefixedText);
    });

    this.managedProcesses.add(startedProcess);

    startedProcess.on('error', (err) => {
      console.error(
        `[ProcessManager] Error starting managed process '${command}': ${err.message}`,
      );
      this.managedProcesses.delete(startedProcess);
    });

    startedProcess.on('exit', (code) => {
      if (!this.managedProcesses.has(startedProcess)) {
        return;
      }

      this.managedProcesses.delete(startedProcess);
      if (this.cleanupInProgress) {
        console.log(
          `[ProcessManager] Managed process '${command}' (PID: ${startedProcess.pid}) exited due to cleanup.`,
        );
        return;
      }

      if (code !== 0) {
        console.error(
          `[ProcessManager] Managed process '${command}' (PID: ${startedProcess.pid}) exited with code ${code}.`,
        );
        if (restartOnError) {
          console.warn(
            `[ProcessManager] Restarting managed process '${command}'...`,
          );
          this.startManagedProcess(command, args, options, prefix, restartOnError, onExit, processReference);
        } else {
          onExit?.();
        }
      } else {
        console.log(
          `[ProcessManager] Managed process '${command}' (PID: ${startedProcess.pid}) exited cleanly.`,
        );
        onExit?.();
      }
    });

    return processReference;
  }

  /**
   * Kills a single child process.
   * On Windows, uses taskkill to kill the entire process tree.
   * @param {ChildProcess} childProcess - The process to kill.
   * @returns {Promise<void>}
   */
  killProcess(childProcess) {
    if (childProcess.killed || childProcess.exitCode != null) {
      return Promise.resolve();
    }

    this.managedProcesses.delete(childProcess);

    if (isWindows) {
      try {
        execSync(`taskkill /T /F /PID ${childProcess.pid}`, { stdio: 'ignore' });
      } catch {
        // Process may have already been terminated by Ctrl+C signal propagation - this is OK
      }
      return Promise.resolve();
    }

    // On Unix, use SIGTERM with timeout fallback to SIGKILL
    return new Promise((resolve) => {
      let exited = false;
      let timeoutId = null;
      
      const onExit = () => {
        exited = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        resolve();
      };
      childProcess.on('exit', onExit);

      timeoutId = setTimeout(() => {
        if (exited) {
          return;
        }

        console.error(`[ProcessManager] Timeout reached for process interruption ${childProcess.pid}`);
        try {
          childProcess.kill('SIGKILL');
        } catch (e) {
          console.error(`[ProcessManager] Error force killing process ${childProcess.pid}: ${e.message}`);
        }
        resolve();
      }, 500);

      try {
        childProcess.kill('SIGTERM');
      } catch (e) {
        console.error(`[ProcessManager] Error signaling process ${childProcess.pid}: ${e.message}`);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve();
      }
    });
  }

  /**
   * Kills all currently managed child processes.
   */
  async cleanupManagedProcesses() {
    if (this.cleanupInProgress) {
      console.log('[ProcessManager] Cleanup of managed processes already in progress, skipping.');
      return;
    }

    this.cleanupInProgress = true;

    console.log('\n[ProcessManager] Initiating cleanup of managed processes...');

    // Filter out already-dead processes
    const processesToKill = [...this.managedProcesses].filter(proc => {
      if (proc.killed || proc.exitCode != null) {
        this.managedProcesses.delete(proc);
        return false;
      }
      return true;
    });
    
    for (const proc of processesToKill) {
      console.log(`[ProcessManager] Killing managed process PID: ${proc.pid}`);
      try {
        if (isWindows) {
          // On Windows, use taskkill to kill the entire process tree
          try {
            execSync(`taskkill /T /F /PID ${proc.pid}`, { stdio: 'ignore' });
          } catch {
            // Process may have already been terminated - this is OK
          }
        } else {
          proc.kill('SIGTERM');
        }
      } catch (e) {
        console.error(`[ProcessManager] Error killing process ${proc.pid}: ${e.message}`);
      }
    }
    
    // On Unix, wait for processes to exit gracefully before using SIGKILL
    if (processesToKill.length > 0 && !isWindows) {
      await new Promise(resolve => setTimeout(resolve, 500));

      for (const proc of [...this.managedProcesses]) {
        if (proc.killed || proc.exitCode != null) {
          this.managedProcesses.delete(proc);
          continue;
        }

        console.warn(`[ProcessManager] Process ${proc.pid} did not exit gracefully, forcing kill.`);
        try {
          proc.kill('SIGKILL');
        } catch (e) {
          console.error(`[ProcessManager] Error forcing kill for process ${proc.pid}: ${e.message}`);
        }
      }
    }

    console.log('[ProcessManager] Managed process cleanup complete.');
  }
}

module.exports = ProcessManager;