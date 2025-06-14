const { BaseService } = require('./base');

class DockerService extends BaseService {
  /** @type {Map<string, string[]>} */
  static _servicesToStop = new Map();

  static async cleanup() {
    if (!DockerService._processManager) {
      console.warn('[DockerService] ProcessManager not initialized, skipping static cleanup.');
      return;
    }

    if (DockerService._servicesToStop.size > 0) {
      console.log('[DockerService] Stopping all docker services from used compose files...');
      for (const [composeFile, services] of this._servicesToStop.entries()) {
        try {
          console.log(`[DockerService] Stopping services ${services.map(service => `'${service}'`).join(', ')} of '${composeFile}'`);
          DockerService._processManager.runSync(
            'docker',
            ['compose', '-f', composeFile, 'stop', ...services],
            { stdio: 'inherit' },
          );
        } catch (error) {
          console.error(
            `[DockerService] Failed to stop services of '${composeFile}': ${error.message}`,
          );
        }
      }
      DockerService._servicesToStop.clear();
    } else {
      console.log('[DockerService] No docker services were started by orchestrator, skipping global stop.');
    }
  }

  constructor(name, mode, config) {
    super(name, mode, config);
    this.dockerServiceName = config.service;
    this.dockerComposeFile = config.composeFile;
    this.containerName = null;
  }

  async start() {
    console.log(`[${this.name}:${this.mode}] Starting docker service '${this.dockerServiceName}' (using ${this.dockerComposeFile})...`);

    let status = this._getContainerStatus();
    if (status === 'running') {
      console.log(
        `[${this.name}:${this.mode}] Docker container for '${this.dockerServiceName}' is already running.`,
      );
    } else {
      console.log(`[${this.name}:${this.mode}] Bringing up docker service '${this.dockerServiceName}'...`);
      try {
        const servicesBeforeStart = this._getCurrentlyRunningServices();
        await DockerService._processManager.runInherited(
          'docker',
          ['compose', '-f', this.dockerComposeFile, 'up', this.dockerServiceName, '-d'],
        );
        const servicesAfterStart = this._getCurrentlyRunningServices();
        let servicesOfComposeFile = DockerService._servicesToStop.get(this.dockerComposeFile);
        if (servicesOfComposeFile == null) {
          servicesOfComposeFile = [];
        }
        const newServices = servicesAfterStart.filter(service => {
          return !(
            servicesBeforeStart.includes(service) ||
            servicesOfComposeFile.includes(service)
          );
        });
        DockerService._servicesToStop.set(
          this.dockerComposeFile,
          servicesOfComposeFile.concat(newServices)
        );
        console.log(`[${this.name}:${this.mode}] Docker service '${this.dockerServiceName}' brought up.`);
        if (newServices.length > 1) {
          console.log(`[${this.name}:${this.mode}] Dependency service${newServices.length > 2 ? 's' : ''} for '${this.dockerServiceName}': ${newServices.filter(service => service.name !== this.dockerServiceName).join(', ')}`);
        }
      } catch (error) {
        throw new Error(
          `[${this.name}:${this.mode}] Failed to bring up docker service '${this.dockerServiceName}': ${error.message}`,
        );
      }
    }

    if (this.config.healthCheck) {
      console.log(`[${this.name}:${this.mode}] Checking healthiness for '${this.dockerServiceName}'...`);
      try {
        await this._checkServiceHealthiness();
        console.log(`[${this.name}:${this.mode}] Docker service '${this.dockerServiceName}' is healthy.`);
      } catch (error) {
        throw new Error(
          `[${this.name}:${this.mode}] Health check failed for '${this.dockerServiceName}': ${error.message}`,
        );
      }
    } else {
      console.log(`[${this.name}:${this.mode}] Skipping health check for '${this.dockerServiceName}'.`);
    }
  }

  async stop() {
    console.log(`[${this.name}:${this.mode}] Relying on orchestrator's static docker compose stop for '${this.dockerServiceName}'.`);
    this.containerName = null;
  }

  async checkHealth() {
    return await this._checkServiceHealthiness();
  }

  _getCurrentlyRunningServices() {
    try {
      const services = DockerService._processManager.runSync(
        'docker',
        ['compose', '-f', this.dockerComposeFile, 'ps', '--services'],
      );
      return (services
        .split('\n')
        .map(serviceName => serviceName.trim())
        .filter(serviceName => serviceName !== '')
      );
    } catch (error) {
      // console.warn(...);
    }
    return null;
  }

  _getContainerName() {
    if (this.containerName) {
      return this.containerName;
    }
    try {
      const name = DockerService._processManager.runSync(
        'docker',
        ['compose', '-f', this.dockerComposeFile, 'ps', '-a', '-q', this.dockerServiceName],
      );
      if (name) {
        this.containerName = name;
        return name;
      }
    } catch (error) {
      // console.warn(...);
    }
    return null;
  }

  _getContainerStatus() {
    const containerName = this._getContainerName();
    if (!containerName) {
      return null;
    }
    try {
      return DockerService._processManager.runSync(
        'docker',
        ['container', 'inspect', '-f', '{{.State.Status}}', containerName],
      );
    } catch (error) {
      // console.warn(...);
      return null;
    }
  }

  async _checkServiceHealthiness(maxAttempts = 30, delayMs = 1000) {
    const containerName = this._getContainerName();
    if (!containerName) {
      throw new Error(`[${this.name}:${this.mode}] Cannot check health: Container for '${this.dockerServiceName}' not found.`);
    }

    console.log(`[${this.name}:${this.mode}] Checking healthiness for '${containerName}'`);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      try {
        const healthStatus = DockerService._processManager.runSync(
          'docker',
          ['container', 'inspect', '-f', '{{.State.Health.Status}}', containerName],
          { stdio: 'pipe' }
        );

        if (healthStatus === 'healthy' || healthStatus === 'none') {
          console.log(`[${this.name}:${this.mode}] Container '${containerName}' healthy!`);
          return true;
        }

        if (healthStatus === 'starting' || healthStatus === 'unhealthy') {
          continue;
        }

        throw new Error(`[${this.name}:${this.mode}] Container '${containerName}' is in unexpected health state: ${healthStatus}`);
      } catch (error) {
        throw new Error(`[${this.name}:${this.mode}] Failed to check health for '${containerName}': ${error.message}`);
      }
    }

    throw new Error(`[${this.name}:${this.mode}] Service '${this.dockerServiceName}' wasn't healthy in time after ${maxAttempts} attempts.`);
  }
}

module.exports = { DockerService };