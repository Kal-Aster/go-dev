'use strict';

// Shared, dependency-free high-volume log generator used by both spikes.
// Mirrors what go-dev's future "log bus" would emit: tagged events
// { source, kind, level, line } where kind is 'service' or 'core' (library).
//
// The point of the spike is to stress the TUI's log pane: many lines per
// second, interleaved sources, so we can judge streaming smoothness.

const { EventEmitter } = require('node:events');

const SERVICES = ['api', 'worker', 'main', 'db'];
const LEVELS = ['info', 'info', 'info', 'warn', 'debug', 'error'];

const SERVICE_LINES = [
  'GET /health 200 1ms',
  'processing job %d',
  'cache miss for key user:%d',
  'flush batch size=%d',
  'connection pool: %d active',
  'emitted event order.created id=%d',
  'slow query took %dms',
  'retrying upstream (attempt %d)',
];

const CORE_LINES = [
  'resolved dependency graph (%d nodes)',
  'service ready gate satisfied',
  'spawned managed process pid=%d',
  'readyWhen: port check ok',
  'preCommand finished in %dms',
];

// Deterministic-ish pseudo counter so we don't need Math.random (and so output
// is reproducible run-to-run, which makes comparing the two spikes fairer).
let seq = 0;
function nextInt(mod) {
  seq = (seq * 1103515245 + 12345) & 0x7fffffff;
  return seq % mod;
}

function fmt(template) {
  return template.replace('%d', String(nextInt(9000) + 100));
}

class FakeLogSource extends EventEmitter {
  constructor({ intervalMs = 8, burst = 3 } = {}) {
    super();
    this.intervalMs = intervalMs; // how often we emit a burst
    this.burst = burst;           // lines per burst -> ~burst/intervalMs * 1000 lines/s
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      for (let i = 0; i < this.burst; i++) this._emitOne();
    }, this.intervalMs);
    // ~375 lines/s at defaults — enough to expose flicker/lag.
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _emitOne() {
    const isCore = nextInt(6) === 0; // ~1 in 6 lines are library/core logs
    const level = LEVELS[nextInt(LEVELS.length)];
    if (isCore) {
      this.emit('log', {
        source: 'core',
        kind: 'core',
        level,
        line: fmt(CORE_LINES[nextInt(CORE_LINES.length)]),
      });
    } else {
      const service = SERVICES[nextInt(SERVICES.length)];
      this.emit('log', {
        source: service,
        kind: 'service',
        level,
        line: fmt(SERVICE_LINES[nextInt(SERVICE_LINES.length)]),
      });
    }
  }
}

module.exports = { FakeLogSource, SERVICES };
