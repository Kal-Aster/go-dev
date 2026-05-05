const { buildColoredTag } = require('../service-colors');

class BaseService {
  /** @type {import("../process-manager")} */
  static _processManager = null;

  /** @type {object | null} */
  static _servicesMap = null;

  /**
   * Initializes shared state for all service types.
   * This should be called once at application startup.
   * @param {import("../process-manager")} processManagerInstance
   * @param {object} [servicesMap] - The full `services` block from the loaded config, keyed by service name.
   */
  static initialize(processManagerInstance, servicesMap) {
    if (BaseService._processManager) {
      console.warn('BaseService.initialize called multiple times. Skipping.');
      return;
    }
    BaseService._processManager = processManagerInstance;
    BaseService._servicesMap = servicesMap ?? null;
  }

  /**
   * Static method for type-specific cleanup. To be overridden by subclasses.
   * @returns {Promise<void>}
   */
  static async cleanup() {
    console.log(`[${this.name}] No specific static cleanup defined.`);
  }

  /**
   * @param {string} name - The logical name of the service (e.g., 'api', 'frontend').
   * @param {string} mode - The resolved mode for this service (e.g., 'dev', 'docker', 'serve').
   * @param {object} config - The concrete configuration object for this service and mode.
   */
  constructor(name, mode, config, onExit, extraArgs) {
    this.name = name;
    this.mode = mode;
    this.config = config;
    this.onExit = onExit;
    this.extraArgs = extraArgs;
  }

  get coloredId() {
    return buildColoredTag(this.name, this.mode);
  }

  async start() {
    throw new Error(`Service type for '${this.name}' in mode '${this.mode}' must implement start()`);
  }

  async stop() {
    return;
  }

  async checkHealth() {
    return true;
  }
}

module.exports = { BaseService };