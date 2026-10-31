// Replaces every Node API that can open a connection, resolve a hostname or
// listen on a port with one that records the attempt and throws. Loaded into
// every test worker and preloaded into every spawned CLI process, so a code
// path that reaches for the network fails the suite even if it swallows the
// error.
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

const INSTALLED = Symbol.for('nocap.networkTripwire');

/** Exit code and stderr marker used by the preload in spawned processes. */
export const TRIPWIRE_EXIT_CODE = 97;
export const TRIPWIRE_MARKER = 'NOCAP_NETWORK_TRIPWIRE';

/** @type {string[]} */
const attempts = [];

export class NetworkAccessError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'NetworkAccessError';
  }
}

/** @param {unknown[]} args */
function describeTarget(args) {
  const [first, second] = args;
  if (typeof first === 'number')
    return `${typeof second === 'string' ? second : 'localhost'}:${first}`;
  if (typeof first === 'string') return first;
  if (first instanceof URL) return first.href;
  if (typeof first === 'object' && first !== null) {
    const o = /** @type {Record<string, unknown>} */ (first);
    if (typeof o.url === 'string') return o.url;
    if (typeof o.path === 'string' && o.port === undefined) return o.path;
    const host = o.hostname ?? o.host ?? 'localhost';
    return o.port === undefined ? String(host) : `${String(host)}:${String(o.port)}`;
  }
  return 'unknown target';
}

/**
 * @param {object} target
 * @param {string} key
 * @param {string} label
 * @param {(message: string) => void} onAttempt
 */
function block(target, key, label, onAttempt) {
  if (!(key in target)) return;
  Object.defineProperty(target, key, {
    configurable: true,
    writable: true,
    /** @param {unknown[]} args */
    value: function blocked(...args) {
      const message = `network access attempted: ${label} -> ${describeTarget(args)}`;
      attempts.push(message);
      onAttempt(message);
      throw new NetworkAccessError(message);
    },
  });
}

/**
 * @param {(message: string) => void} [onAttempt] Called before the error is thrown.
 */
export function install(onAttempt = () => undefined) {
  const g = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (globalThis));
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;

  block(net.Socket.prototype, 'connect', 'net.Socket#connect', onAttempt);
  block(net.Server.prototype, 'listen', 'net.Server#listen', onAttempt);
  block(net, 'connect', 'net.connect', onAttempt);
  block(net, 'createConnection', 'net.createConnection', onAttempt);
  block(tls, 'connect', 'tls.connect', onAttempt);
  block(dgram, 'createSocket', 'dgram.createSocket', onAttempt);
  block(http, 'request', 'http.request', onAttempt);
  block(http, 'get', 'http.get', onAttempt);
  block(https, 'request', 'https.request', onAttempt);
  block(https, 'get', 'https.get', onAttempt);
  block(http2, 'connect', 'http2.connect', onAttempt);

  // Class methods are non-enumerable, hence getOwnPropertyNames over Object.keys.
  const resolvers = [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype];
  for (const resolver of resolvers) {
    for (const key of Object.getOwnPropertyNames(resolver)) {
      const isQuery =
        key === 'lookup' ||
        key === 'lookupService' ||
        key === 'reverse' ||
        key.startsWith('resolve');
      const value = /** @type {Record<string, unknown>} */ (resolver)[key];
      if (isQuery && typeof value === 'function') block(resolver, key, `dns.${key}`, onAttempt);
    }
  }

  for (const key of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
    block(globalThis, key, key, onAttempt);
  }

  // Without this, `import { lookup } from 'node:dns'` keeps the original binding.
  syncBuiltinESMExports();
}

/** Returns and clears the attempts recorded so far. */
export function takeAttempts() {
  return attempts.splice(0, attempts.length);
}
