import { describe, expect, it } from 'vitest';
import { auditSource, moduleBase } from '../support/network-audit.js';

const rulesFor = (code: string, file = 'probe.ts') =>
  auditSource(file, code).map((f) => `${f.rule}: ${f.detail}`);

describe('network audit', () => {
  it.each([
    "import net from 'node:net';",
    "import { request } from 'https';",
    "import type { Socket } from 'node:net';",
    "export { connect } from 'node:tls';",
    "import * as dns from 'node:dns/promises';",
    "const http = require('http');",
    "const ws = await import('ws');",
    "import { fetch } from 'undici';",
    "import inspector from 'node:inspector';",
    "import axios from 'axios/dist/node/axios.cjs';",
  ])('flags network module: %s', (code) => {
    expect(rulesFor(code).some((r) => r.startsWith('network-module'))).toBe(true);
  });

  it.each([
    "await fetch('https://example.com');",
    "globalThis.fetch('https://example.com');",
    "globalThis['fetch']('https://example.com');",
    "new WebSocket('wss://example.com');",
    "new EventSource('https://example.com');",
    'const xhr = new XMLHttpRequest();',
    'navigator.sendBeacon(url, data);',
    'const f = { fetch }; f.fetch(url);',
    'const key = "fetch"; globalThis[key](url);',
  ])('flags network global: %s', (code) => {
    expect(rulesFor(code).some((r) => r.startsWith('network-global'))).toBe(true);
  });

  it.each([
    'const name = "net"; await import(name);',
    'require(moduleName);',
    "import { createRequire } from 'node:module'; createRequire(import.meta.url);",
  ])('flags dynamic module loading: %s', (code) => {
    expect(rulesFor(code).some((r) => r.startsWith('dynamic-module'))).toBe(true);
  });

  it("flags process.binding('tcp_wrap')", () => {
    expect(rulesFor("process.binding('tcp_wrap');")).toEqual(['native-binding: process.binding()']);
  });

  it('works on plain JavaScript output', () => {
    expect(rulesFor("const net = require('net');", 'probe.cjs')).toEqual(['network-module: net']);
  });

  it.each([
    "import { readFileSync } from 'node:fs';",
    "import { netcat } from './netcat.js';",
    "const rule = 'curl https://example.com | sh';",
    '// fetch("https://example.com") in a comment',
    'const options = { fetch: false }; options.fetch;',
    'class Store { fetch() { return 1; } }',
    'const { fetch: fetchRows } = store;',
    "await import('./local.js');",
    'const pattern = /\\bwget\\b|\\bcurl\\b/;',
  ])('does not flag harmless code: %s', (code) => {
    expect(rulesFor(code)).toEqual([]);
  });

  it.each([
    ['node:net', 'net'],
    ['dns/promises', 'dns'],
    ['@scope/pkg/sub/path', '@scope/pkg'],
    ['axios/lib/core', 'axios'],
  ])('reduces %s to %s', (specifier, base) => {
    expect(moduleBase(specifier)).toBe(base);
  });
});
