// The tripwire is only worth something if it actually fires. These are the
// positive controls: each one must be caught, in-process and in a child.
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { describe, expect, it } from 'vitest';
import { runNode } from '../support/cli.js';
import {
  NetworkAccessError,
  takeAttempts,
  TRIPWIRE_EXIT_CODE,
  TRIPWIRE_MARKER,
} from '../support/network-tripwire.mjs';

// TEST-NET-1 (RFC 5737) and the reserved .invalid TLD: never routable, even if the tripwire failed.
const ip = '192.0.2.1';
const host = 'nocap.invalid';

describe('network tripwire in the test process', () => {
  it.each<[string, () => unknown]>([
    ['net.connect', () => net.connect(9, ip)],
    ['net.Socket#connect', () => new net.Socket().connect(9, ip)],
    ['net.Socket#connect (unix socket)', () => new net.Socket().connect('/var/run/docker.sock')],
    ['net.Server#listen', () => net.createServer().listen(0)],
    ['tls.connect', () => tls.connect(443, ip)],
    ['http.get', () => http.get(`http://${ip}/`)],
    ['https.request', () => https.request(`https://${ip}/`)],
    ['http2.connect', () => http2.connect(`https://${ip}`)],
    ['dgram.createSocket', () => dgram.createSocket('udp4')],
    [
      'dns.lookup',
      () => {
        dns.lookup(host, () => undefined);
      },
    ],
    [
      'dns.resolve4',
      () => {
        dns.resolve4(host, () => undefined);
      },
    ],
    ['dns.promises.lookup', () => dns.promises.lookup(host)],
    [
      'dns.Resolver#resolveTxt',
      () => {
        new dns.Resolver().resolveTxt(host, () => undefined);
      },
    ],
    ['fetch', () => fetch(`https://${host}/`)],
    [
      'WebSocket',
      () =>
        new (Reflect.get(globalThis, 'WebSocket') as new (url: string) => unknown)(`wss://${host}`),
    ],
  ])('blocks %s', (_, attempt) => {
    expect(attempt).toThrow(NetworkAccessError);
    expect(takeAttempts()).toHaveLength(1);
  });

  it('records attempts that the caller swallows', () => {
    try {
      net.connect(9, ip);
    } catch {
      // Deliberately ignored, as careless code might.
    }
    expect(takeAttempts()).toEqual([`network access attempted: net.connect -> ${ip}:9`]);
  });
});

describe('network tripwire in a spawned process', () => {
  it.each([
    ['a swallowed net.connect', `try { require('node:net').connect(9, '${ip}') } catch {}`],
    ['fetch', `fetch('https://${host}/').catch(() => {})`],
    ['dns.lookup', `require('node:dns').lookup('${host}', () => {})`],
    ['http.get', `try { require('node:http').get('http://${ip}/') } catch {}`],
  ])('exits on %s', (_, script) => {
    const result = runNode(['-e', script]);
    expect(result.status).toBe(TRIPWIRE_EXIT_CODE);
    expect(result.stderr).toContain(TRIPWIRE_MARKER);
  });

  it('covers named ESM imports of built-ins', () => {
    const script = `import { lookup } from 'node:dns'; try { lookup('${host}', () => {}) } catch {}`;
    const result = runNode(['--input-type=module', '-e', script]);
    expect(result.status).toBe(TRIPWIRE_EXIT_CODE);
  });

  it('leaves offline code alone', () => {
    const result = runNode(['-e', "require('node:fs').readFileSync(process.execPath)"]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain(TRIPWIRE_MARKER);
  });
});
