const { loadConfig } = require('./config');
const { resolveServiceExecutionGraph } = require('./dependency-resolver');
const log = require('./logger');
const ProcessManager = require('./process-manager');
const { buildColoredTag, colorService, colorMode } = require('./service-colors');
const { BaseService } = require('./services/base');
const { CmdService } = require('./services/cmd');
const { DockerService } = require('./services/docker');

const serviceTypeMap = {
  cmd: CmdService,
  docker: DockerService,
};

const bold = (text) => `\x1b[1m${text}\x1b[0m`;

class Orchestrator {
  constructor(configPath, options = {}) {
    this.configPath = configPath;
    this.config = loadConfig(configPath);

    const level = options.logLevel ?? this.config.logLevel;
    if (level) {
      log.setLogLevel(level);
    }

    this.processManager = new ProcessManager();
    this.activeServiceInstances = new Map();

    BaseService.initialize(this.processManager, this.config.services);
  }

  /**
   * @param {{ name?: string, services: string[], modes?: Record<string, string> }} selection
   *   The service selection to run — from a preset or built interactively.
   */
  async start(selection) {
    try {
      const { dependencies, services: primaryServices } = resolveServiceExecutionGraph(
        this.config,
        selection,
      );

      log.info(bold(`Preset: ${selection.name ?? 'selezione personalizzata'}`));
      log.info(`\n${bold('Resolved dependencies')}`);
      dependencies.forEach(s => log.info(` - ${colorService(s.name, s.mode)} (mode: ${colorMode(s.name, s.mode)})`));
      log.info(`\n${bold('Resolved primary services')}`);
      primaryServices.forEach(s => log.info(` - ${colorService(s.name, s.mode)} (mode: ${colorMode(s.name, s.mode)})`));

      const extraArgs = new Map();
      {
        const argsToParse = process.argv.slice(3);
        if (argsToParse.length > 0) {
          log.info(`\n${bold('Gathering arguments')}`);
          const serviceArgsKeyword = `--${this.config.serviceArgsKeyword ?? 'args-for'}`;
          let isGettingService = false;
          let currentService = null;
          let currentIndex = 0;
          let argsToPass = null;
          for (const arg of argsToParse) {
            if (arg === serviceArgsKeyword) {
              isGettingService = true;
              currentService = null;
              currentIndex = 0;
              continue;
            }
            if (currentService == null) {
              if (isGettingService === false) {
                throw new Error(`Invalid arguments, use format: npx go-dev ${selection.name ?? '<preset>'} ${serviceArgsKeyword} <service> <args>`);
              }

              const splitArg = arg.split(':');
              if (splitArg.length > 2) {
                throw new Error(`Invalid service name + index '${arg}': should be <service> or <service>:<command_index>`);
              }

              const index = splitArg.length > 1 ? parseInt(splitArg[1]) : 0;;
              if (splitArg.length > 1 && `${index}` !== splitArg[1]) {
                throw new Error(`Invalid service name + index '${arg}': should be <service> or <service>:<command_index>`);
              }

              currentService = splitArg[0];
              currentIndex = index;
              argsToPass = extraArgs.get(currentService) ?? [];
              extraArgs.set(currentService, argsToPass);
              isGettingService = false;
              continue;
            }

            let args = argsToPass[currentIndex];
            if (args == null) {
              args = [];
              argsToPass[currentIndex] = args;
            }

            args.push(arg);
          }

          for (const [service, indexedArgs] of extraArgs.entries()) {
            indexedArgs.forEach((args, index) => {
              log.info(` - ${service}:${index}: [${args.join(', ')}]`);
            });
          }
        }
      }

      log.info(`\n${bold('Starting dependencies')}`);
      for (const { name, mode, config } of dependencies) {
        if (this.activeServiceInstances.has(name)) {
          log.info(`[${buildColoredTag(name, mode)}] Already active, skipping start.`);
          continue;
        }
        const ServiceClass = serviceTypeMap[config.type];
        if (!ServiceClass) {
          throw new Error(`Unknown service type '${config.type}' for service '${name}'.`);
        }
        const serviceInstance = new ServiceClass(name, mode, config, () => {});
        this.activeServiceInstances.set(name, serviceInstance);
        await serviceInstance.start();
      }

      log.info(`\n${bold('Starting primary services')}`);
      const activePrimaryServices = new Map();
      const primaryServicePromises = [];
      for (const { name, mode, config } of primaryServices) {
        if (this.activeServiceInstances.has(name)) {
          log.info(`[${buildColoredTag(name, mode)}] Already active, skipping start.`);
          continue;
        }
        const ServiceClass = serviceTypeMap[config.type];
        if (!ServiceClass) {
          throw new Error(`Unknown service type '${config.type}' for service '${name}'.`);
        }
        const serviceInstance = new ServiceClass(name, mode, config, () => {
          activePrimaryServices.delete(name);
          if (activePrimaryServices.size > 0) {
            return;
          }

          this.cleanup();
        }, extraArgs.get(name));
        this.activeServiceInstances.set(name, serviceInstance);
        activePrimaryServices.set(name, serviceInstance);
        primaryServicePromises.push(serviceInstance.start());
      }
      await Promise.all(primaryServicePromises);

      log.info(`\n${bold('Ready')} (press Ctrl+C to stop)`);

      process.once('SIGINT', this.cleanup.bind(this));
      process.once('SIGTERM', this.cleanup.bind(this));
      process.stdin.resume();

    } catch (error) {
      log.error('\n❌ Orchestrator failed to start:', error.message);
      await this.cleanup(true);
      process.exit(1);
    }
  }

  async cleanup() {
    if (this.processManager.cleanupInProgress) {
      log.debug('[Orchestrator] Cleanup already in progress.');
      return;
    }

    log.info(`\n${bold('Shutting down')}`);

    for (const [name, instance] of this.activeServiceInstances.entries()) {
      try {
        log.info(` - ${buildColoredTag(name, instance.mode)}`);
        await instance.stop();
      } catch (error) {
        log.error(` - ${buildColoredTag(name, instance.mode)}: ${error.message}`);
      }
    }

    await DockerService.cleanup();
    await this.processManager.cleanupManagedProcesses();

    log.info(`\n${bold('Done')}`);
    process.exit(0);
  }
}

module.exports = Orchestrator;