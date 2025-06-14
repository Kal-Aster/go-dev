const Joi = require('joi');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const dependencyEntrySchema = Joi.alternatives().try(
  Joi.string(),
  Joi.object({
    service: Joi.string().required(),
    mode: Joi.string().required()
  })
);

const commandSchema = Joi.array().items(Joi.string().min(1)).min(1);
const commandObjectSchema = Joi.object({
    command: commandSchema,
    directory: Joi.string().min(1).optional(),
    restartOnError: Joi.boolean().optional(),
})
const commandConfigSchema = Joi.alternatives().try(
    commandSchema,
    commandObjectSchema
);

const cmdServiceConfigSchema = Joi.object({
  type: Joi.string().valid('cmd').required(),
  preCommands: Joi.array().items(commandConfigSchema).default([]),
  commands: Joi.alternatives().try(
    commandConfigSchema,
    Joi.array().items(commandObjectSchema).min(1)
  ),
  defaultCommand: Joi.string().default('start'),
  directory: Joi.string(),
  dependencies: Joi.array().items(dependencyEntrySchema).default([]),
  healthCheck: Joi.boolean().default(false)
});

const dockerServiceConfigSchema = Joi.object({
  type: Joi.string().valid('docker').required(),
  service: Joi.string().required(),
  composeFile: Joi.string().default('docker-compose.yml'),
  dependencies: Joi.array().items(dependencyEntrySchema).default([]),
  healthCheck: Joi.boolean().default(true)
});

const serviceSchema = Joi.alternatives().try(
  cmdServiceConfigSchema,
  dockerServiceConfigSchema,
  Joi.object({
    type: Joi.string().valid('hybrid').required(),
    defaultMode: Joi.string(),
    modes: Joi.object().pattern(
      Joi.string(),
      Joi.alternatives().try(
        cmdServiceConfigSchema,
        dockerServiceConfigSchema
      )
    ).min(2).required()
  })
);

const configSchema = Joi.object({
  serviceArgsKeyword: Joi.string().min(1).optional(),
  services: Joi.object().pattern(Joi.string(), serviceSchema).required(),
  presets: Joi.object().pattern(
    Joi.string(),
    Joi.object({
      services: Joi.array().items(Joi.string()).required(),
      modes: Joi.object().pattern(Joi.string(), Joi.string()).default({})
    })
  ).default({})
});

const possibleNames = [
  'go-dev'
].flatMap(baseName => {
  return [
    baseName,
    `.${baseName}`
  ];
}).flatMap(baseName => {
  return [
      baseName,
      `${baseName}.config`
  ];
}).flatMap(baseName => {
  return [
      `${baseName}.yml`,
      `${baseName}.yaml`
  ];
});

function findConfigFile() {
  for (const name of possibleNames) {
    if (fs.existsSync(name)) {
      return name;
    }
  }

  throw new Error(`No config file found. Expected one of: ${possibleNames.join(', ')}`);
}

function loadConfig(configPath) {
  if (!configPath) {
    configPath = findConfigFile();
  }
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  
  const configContent = fs.readFileSync(configPath, 'utf8');
  const config = yaml.load(configContent);

  const { error, value } = configSchema.validate(config);
  
  if (error) {
    throw new Error(`Invalid config: ${error.message}`);
  }
  
  return value;
}

module.exports = { loadConfig };