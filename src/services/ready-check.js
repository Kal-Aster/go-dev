const net = require('net');
const fs = require('fs');
const path = require('path');
const log = require('../logger');

const MAX_BUFFER = 16 * 1024;

/**
 * Resolves when one of the managed processes prints a line matching `pattern`.
 * Attaches an extra listener on top of the existing prefixing one, so it does
 * not interfere with normal output.
 */
function logMatchCheck(processes, pattern, timeoutMs) {
  const regex = new RegExp(pattern);
  let cleanup = () => {};
  const promise = new Promise((resolve, reject) => {
    let buffer = '';
    const listeners = [];
    const onData = (data) => {
      buffer = (buffer + data.toString()).slice(-MAX_BUFFER);
      if (regex.test(buffer)) {
        resolve();
      }
    };
    for (const proc of processes) {
      for (const stream of [proc.stdout, proc.stderr]) {
        if (!stream) {
          continue;
        }
        stream.on('data', onData);
        listeners.push(stream);
      }
    }
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for log /${pattern}/`));
    }, timeoutMs);
    cleanup = () => {
      clearTimeout(timer);
      for (const stream of listeners) {
        stream.off('data', onData);
      }
    };
  });
  return { promise: promise.finally(() => cleanup()), cancel: () => cleanup() };
}

/** Resolves once `filePath` exists on disk, polling until the timeout. */
function fileCheck(filePath, timeoutMs, pollIntervalMs) {
  const resolved = path.resolve(filePath);
  let cancelled = false;
  const promise = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (!cancelled) {
      if (fs.existsSync(resolved)) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for file '${resolved}'`);
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  })();
  return { promise, cancel: () => { cancelled = true; } };
}

function tryConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

/** Resolves once a TCP connection to `host:port` succeeds, polling until the timeout. */
function portCheck(host, port, timeoutMs, pollIntervalMs) {
  let cancelled = false;
  const promise = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (!cancelled) {
      if (await tryConnect(host, port)) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for ${host}:${port}`);
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  })();
  return { promise, cancel: () => { cancelled = true; } };
}

/**
 * Blocks until the given `readyWhen` conditions are all satisfied for the
 * provided managed processes. Multiple conditions are combined with AND.
 * @param {import('child_process').ChildProcess[]} processes
 * @param {object} readyWhen - Validated `readyWhen` config (with defaults applied).
 * @param {string} coloredId - The service's colored tag, for logging.
 */
async function waitForReady(processes, readyWhen, coloredId) {
  const { logMatch, file, port, host, timeoutMs, pollIntervalMs } = readyWhen;

  const checks = [];
  const labels = [];
  if (logMatch != null) {
    checks.push(logMatchCheck(processes, logMatch, timeoutMs));
    labels.push(`log /${logMatch}/`);
  }
  if (file != null) {
    checks.push(fileCheck(file, timeoutMs, pollIntervalMs));
    labels.push(`file '${file}'`);
  }
  if (port != null) {
    checks.push(portCheck(host, port, timeoutMs, pollIntervalMs));
    labels.push(`${host}:${port}`);
  }

  log.info(`[${coloredId}] Waiting until ready (${labels.join(' AND ')})...`);
  try {
    await Promise.all(checks.map(check => check.promise));
    log.info(`[${coloredId}] Service is ready.`);
  } finally {
    // Stop any still-pending checks so they don't reject after we're done.
    for (const check of checks) {
      check.cancel();
    }
  }
}

module.exports = { waitForReady };
