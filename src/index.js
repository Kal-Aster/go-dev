const Orchestrator = require('./orchestrator');

const orchestrator = new Orchestrator();
orchestrator.start(process.argv[2]);