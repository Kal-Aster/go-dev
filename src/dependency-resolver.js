function resolveServiceExecutionGraph(config, presetName) {
  const preset = config.presets[presetName];
  if (!preset) {
    throw new Error(`Preset '${presetName}' not found in configuration.`);
  }

  const services = [];
  const dependencies = [];

  for (const serviceName of preset.services) {
    addService(
      serviceName,
      preset.modes[serviceName],
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
        console.warn(
          `Ignoring dependency '${serviceName}' for '${dependentService}' because it is flagged to be run as service in mode '${existingService.mode}'.`
        );
        return;
      }
    } else {
      const existingDependencyIndex = dependencies.findIndex(({ name }) => {
        return name === serviceName;
      });
      if (existingDependencyIndex >= 0) {
        console.warn(
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
        console.warn(`Skipping dependency '${dependencyName}' for '${serviceName}' because it's already present in dependencies list.`);
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

module.exports = { resolveServiceExecutionGraph };