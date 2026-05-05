const LEVELS = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
});

let currentLevel = LEVELS.info;

function setLogLevel(name) {
  if (!Object.prototype.hasOwnProperty.call(LEVELS, name)) {
    throw new Error(
      `Unknown log level '${name}'. Expected one of: ${Object.keys(LEVELS).join(', ')}.`,
    );
  }
  currentLevel = LEVELS[name];
}

function getLogLevel() {
  return Object.keys(LEVELS).find(name => LEVELS[name] === currentLevel);
}

function error(...args) {
  if (currentLevel >= LEVELS.error) console.error(...args);
}

function warn(...args) {
  if (currentLevel >= LEVELS.warn) console.warn(...args);
}

function info(...args) {
  if (currentLevel >= LEVELS.info) console.log(...args);
}

function debug(...args) {
  if (currentLevel >= LEVELS.debug) console.log(...args);
}

module.exports = {
  LEVELS,
  setLogLevel,
  getLogLevel,
  error,
  warn,
  info,
  debug,
};
