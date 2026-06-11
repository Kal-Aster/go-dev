const log = require('./logger');

/**
 * Resolves a named preset to its `{ services, modes }` selection object,
 * throwing if it does not exist. This is the single place that maps a preset
 * name to data — everything downstream operates on the selection object, so a
 * preset is just one way (alongside the interactive TUI) to produce one.
 *
 * @param {object} config
 * @param {string} presetName
 * @returns {{ services: string[], modes: Record<string, string> }}
 */
function resolvePreset(config, presetName) {
  const preset = config.presets[presetName];
  if (!preset) {
    throw new Error(`Preset '${presetName}' not found in configuration.`);
  }
  return preset;
}

/**
 * @param {object} config
 * @param {{ services: string[], modes?: Record<string, string> }} selection
 *   A service selection — same shape as a preset. May come from a preset
 *   (via {@link resolvePreset}) or be built interactively.
 */
function resolveServiceExecutionGraph(config, selection) {
  const modes = selection.modes ?? {};

  const services = [];
  const dependencies = [];

  for (const serviceName of selection.services) {
    addService(
      serviceName,
      modes[serviceName],
      null,
    );
  }

  return { dependencies, services };

  function addService(serviceName, mode, dependentService) {
    const service = config.services[serviceName];
    if (service == null) {
      throw new Error(`Service named '${serviceName}' not found in configuration.`);
    }

    if (dependentService != null) {
      const existingService = services.find(({ name }) => {
        return name === serviceName;
      });
      if (existingService != null) {
        log.warn(
          `Ignoring dependency '${serviceName}' for '${dependentService}' because it is flagged to be run as service in mode '${existingService.mode}'.`
        );
        return;
      }
    } else {
      const existingDependencyIndex = dependencies.findIndex(({ name }) => {
        return name === serviceName;
      });
      if (existingDependencyIndex >= 0) {
        log.warn(
          `Removing service '${serviceName}' from dependencies because it is flagged to be run as service in mode '${dependencies[existingDependencyIndex].mode}'.`
        );
        dependencies.splice(existingDependencyIndex, 1);
      }
    }

    mode = (service.type === 'hybrid' ?
      mode ?? service.defaultMode ?? 'dev' :
      mode ?? 'dev'
    );
    const serviceConfig = (service.type === 'hybrid' ?
      service.modes[mode] :
      (mode === 'dev' ? service : undefined)
    );

    if (serviceConfig == null) {
      throw new Error(`Mode named '${mode}' not found in service '${serviceName}'.`);
    }

    if (dependentService == null) {
      services.push({
        name: serviceName,
        mode,
        config: serviceConfig,
      });
    } else {
      dependencies.unshift({
        name: serviceName,
        mode,
        config: serviceConfig,
      });
    }

    for (let index = serviceConfig.dependencies.length - 1; index >= 0; index--) {
      const dependency = serviceConfig.dependencies[index];
      const {
        service: dependencyName,
        mode: dependencyMode,
      } = (typeof dependency === 'string' ?
        { service: dependency, mode: 'dev' } :
        dependency
      );

      const existingDependencyIndex = dependencies.find(({ name }) => {
        return name === dependencyName;
      });
      if (existingDependencyIndex != null) {
        log.warn(`Skipping dependency '${dependencyName}' for '${serviceName}' because it's already present in dependencies list.`);
        continue;
      }

      addService(
        dependencyName,
        dependencyMode,
        serviceName,
      );
    }
  }
}

/**
 * Summarizes what a selection actually starts: the resolved primary services,
 * their transitive dependencies, and any service-referencing preCommands (which
 * run as setup steps and aren't part of the dependency graph). Useful for
 * previewing a preset/service before launching it.
 *
 * Note: this calls {@link resolveServiceExecutionGraph}, which may emit
 * `log.warn` for dedup cases — silence the logger around the call if a clean
 * output is required (e.g. inside a full-screen TUI).
 *
 * @param {object} config
 * @param {{ services: string[], modes?: Record<string, string> }} selection
 * @returns {{ primary: object[], dependencies: object[], preCommands: { name: string, mode: string, from: string }[] }}
 */
function summarizeSelection(config, selection) {
  const { dependencies, services } = resolveServiceExecutionGraph(config, selection);

  const preCommands = [];
  const seen = new Set();
  for (const entry of [...services, ...dependencies]) {
    for (const pre of entry.config.preCommands ?? []) {
      const isServiceRef = pre && typeof pre === 'object' && !Array.isArray(pre) && pre.service;
      if (!isServiceRef) {
        continue;
      }
      const mode = pre.mode ?? 'dev';
      const key = `${pre.service}:${mode}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      preCommands.push({ name: pre.service, mode, from: entry.name });
    }
  }

  return { primary: services, dependencies, preCommands };
}

module.exports = { resolveServiceExecutionGraph, resolvePreset, summarizeSelection };