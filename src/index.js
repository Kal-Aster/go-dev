const Orchestrator = require('./orchestrator');
const { parseCliArgs } = require('./cli-args');

const { presetName, configPath, logLevel, remaining } = parseCliArgs(process.argv.slice(2));

process.argv = [process.argv[0], process.argv[1], presetName, ...remaining];

const orchestrator = new Orchestrator(configPath, { logLevel });
orchestrator.start(presetName);