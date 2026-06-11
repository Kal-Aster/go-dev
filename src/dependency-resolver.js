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
 * @returns {{
 *   services: { name: string, mode: string, config: object }[],
 *   dependencies: { name: string, mode: string, config: object, requiredBy: string }[],
 *   conflicts: { service: string, requests: { mode: string, by: string | null }[] }[]
 * }} `conflicts` lists services pulled in under more than one mode (e.g. one as
 *   a primary and another as a dependency). go-dev runs one instance per
 *   service name, so a conflicting selection leaves some dependency unmet.
 */
function resolveServiceExecutionGraph(config, selection) {
  const modes = selection.modes ?? {};

  const services = [];
  const dependencies = [];
  // serviceName -> Map<mode, requestedBy|null> — every mode a service is asked
  // to run in, regardless of which instance actually wins the dedup below.
  const requests = new Map();

  for (const serviceName of selection.services) {
    addService(
      serviceName,
      modes[serviceName],
      null,
    );
  }

  const conflicts = [];
  for (const [service, byMode] of requests) {
    if (byMode.size > 1) {
      conflicts.push({
        service,
        requests: [...byMode].map(([mode, by]) => ({ mode, by })),
      });
    }
  }

  return { dependencies, services, conflicts };

  function addService(serviceName, requestedMode, dependentService) {
    const service = config.services[serviceName];
    if (service == null) {
      throw new Error(`Service named '${serviceName}' not found in configuration.`);
    }

    const mode = (service.type === 'hybrid' ?
      requestedMode ?? service.defaultMode ?? 'dev' :
      requestedMode ?? 'dev'
    );
    const serviceConfig = (service.type === 'hybrid' ?
      service.modes[mode] :
      (mode === 'dev' ? service : undefined)
    );

    if (serviceConfig == null) {
      throw new Error(`Mode named '${mode}' not found in service '${serviceName}'.`);
    }

    // Record the requested mode so conflicting selections can be flagged later,
    // even for the instance that loses the dedup below.
    let requested = requests.get(serviceName);
    if (!requested) {
      requests.set(serviceName, requested = new Map());
    }
    if (!requested.has(mode)) {
      requested.set(mode, dependentService ?? null);
    }

    if (dependentService != null) {
      // One instance per service name: if it's already scheduled (as a primary
      // or another dependency), keep the first. Mode mismatches surface via
      // `conflicts`, not by silently swapping the running mode.
      if (services.some(({ name }) => name === serviceName)) return;
      if (dependencies.some(({ name }) => name === serviceName)) return;
      dependencies.unshift({ name: serviceName, mode, config: serviceConfig, requiredBy: dependentService });
    } else {
      const existingDependencyIndex = dependencies.findIndex(({ name }) => name === serviceName);
      if (existingDependencyIndex >= 0) {
        dependencies.splice(existingDependencyIndex, 1); // promote dependency -> primary
      }
      services.push({ name: serviceName, mode, config: serviceConfig });
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

      addService(
        dependencyName,
        dependencyMode,
        serviceName,
      );
    }
  }
}

module.exports = { resolveServiceExecutionGraph, resolvePreset };