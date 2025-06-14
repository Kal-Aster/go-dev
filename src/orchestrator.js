const { loadConfig } = require('./config');
const { resolveServiceExecutionGraph } = require('./dependency-resolver');
const ProcessManager = require('./process-manager');
const { BaseService } = require('./services/base');
const { CmdService } = require('./services/cmd');
const { DockerService } = require('./services/docker');

const serviceTypeMap = {
  cmd: CmdService,
  docker: DockerService,
};

class Orchestrator {
  constructor(configPath) {
    this.config = loadConfig(configPath);

    this.processManager = new ProcessManager();
    this.activeServiceInstances = new Map();

    BaseService.initialize(this.processManager);
  }

  async start(presetName) {
    try {
      const { dependencies, services: primaryServices } = resolveServiceExecutionGraph(
        this.config,
        presetName,
      );

      console.log(`Starting development environment for preset: ${presetName}`);
      console.log('--- Resolved Dependencies to Start First ---');
      dependencies.forEach(s => console.log(` - ${s.name} (mode: ${s.mode})`));
      console.log('--- Resolved Primary Services to Run ---');
      primaryServices.forEach(s => console.log(` - ${s.name} (mode: ${s.mode})`));

      console.log('\n--- Starting Dependencies ---');
      for (const { name, mode, config } of dependencies) {
        if (this.activeServiceInstances.has(name)) {
          console.log(`[${name}:${mode}] Already active, skipping start.`);
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

      console.log('\n--- Starting Primary Services ---');
      const activePrimaryServices = new Map();
      const primaryServicePromises = [];
      for (const { name, mode, config } of primaryServices) {
        if (this.activeServiceInstances.has(name)) {
          console.log(`[${name}:${mode}] Already active, skipping start.`);
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
        });
        this.activeServiceInstances.set(name, serviceInstance);
        activePrimaryServices.set(name, serviceInstance);
        primaryServicePromises.push(serviceInstance.start());
      }
      await Promise.all(primaryServicePromises);

      console.log('\n--- All services initiated. Press Ctrl+C to stop. ---');

      process.once('SIGINT', this.cleanup.bind(this));
      process.once('SIGTERM', this.cleanup.bind(this));
      process.stdin.resume();

    } catch (error) {
      console.error('\n❌ Orchestrator failed to start:', error.message);
      await this.cleanup(true);
      process.exit(1);
    }
  }

  async cleanup() {
    if (this.processManager.cleanupInProgress) {
      console.log('[Orchestrator] Cleanup already in progress.');
      return;
    }

    console.log('\n[Orchestrator] Initiating graceful cleanup...');

    for (const [name, instance] of this.activeServiceInstances.entries()) {
      try {
        console.log(`[Orchestrator] Requesting instance stop for ${name}:${instance.mode}`);
        await instance.stop();
      } catch (error) {
        console.error(`[Orchestrator] Error stopping instance ${name}:${instance.mode}: ${error.message}`);
      }
    }

    await DockerService.cleanup();
    await this.processManager.cleanupManagedProcesses();

    console.log('[Orchestrator] Cleanup complete.');
    process.exit(0);
  }
}

module.exports = Orchestrator;