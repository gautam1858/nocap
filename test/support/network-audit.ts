// Static half of the no-network guarantee: walks the AST of shipped code and
// flags anything that could open a connection. The runtime tripwire only sees
// code paths that tests exercise; this sees every line.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: 'network-module' | 'network-global' | 'dynamic-module' | 'native-binding';
  readonly detail: string;
}

const NETWORK_MODULES = new Set([
  // Node built-ins. `inspector` opens a debugging WebSocket server.
  'dgram',
  'dns',
  'http',
  'http2',
  'https',
  'inspector',
  'net',
  'tls',
  // Common client libraries, in case one arrives transitively.
  'axios',
  'cross-fetch',
  'got',
  'http-proxy-agent',
  'https-proxy-agent',
  'isomorphic-fetch',
  'ky',
  'needle',
  'node-fetch',
  'proxy-agent',
  'request',
  'socket.io-client',
  'superagent',
  'undici',
  'ws',
]);

const NETWORK_GLOBALS = new Set([
  'fetch',
  'WebSocket',
  'EventSource',
  'XMLHttpRequest',
  'navigator',
]);
const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'self', 'window']);

export function moduleBase(specifier: string): string {
  const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  const parts = bare.split('/');
  return (bare.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
}

/** True when the identifier names a property or member rather than referencing a binding. */
function isMemberName(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) {
    return (ts.isPropertyAccessExpression(parent) ? parent.name : parent.right) === id;
  }
  if (ts.isBindingElement(parent) || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
    return parent.propertyName === id;
  }
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === id
  );
}

function isGlobalObject(node: ts.Expression): boolean {
  return ts.isIdentifier(node) && GLOBAL_OBJECTS.has(node.text);
}

export function auditSource(fileName: string, text: string): Finding[] {
  const scriptKind = /\.[mc]?tsx?$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const findings: Finding[] = [];

  const report = (node: ts.Node, rule: Finding['rule'], detail: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ file: fileName, line: line + 1, rule, detail });
  };

  const checkSpecifier = (node: ts.Node, specifier: string): void => {
    if (NETWORK_MODULES.has(moduleBase(specifier))) report(node, 'network-module', specifier);
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkSpecifier(node, node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      checkSpecifier(node, node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if (isImport || isRequire) {
        const [arg] = node.arguments;
        if (arg && ts.isStringLiteralLike(arg)) checkSpecifier(node, arg.text);
        else
          report(
            node,
            'dynamic-module',
            `${isImport ? 'import' : 'require'}() with a computed specifier`,
          );
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'process' &&
        (callee.name.text === 'binding' || callee.name.text === '_linkedBinding')
      ) {
        report(node, 'native-binding', `process.${callee.name.text}()`);
      }
    } else if (ts.isElementAccessExpression(node) && isGlobalObject(node.expression)) {
      const key = node.argumentExpression;
      if (!ts.isStringLiteralLike(key))
        report(node, 'network-global', 'computed global property access');
      else if (NETWORK_GLOBALS.has(key.text)) report(node, 'network-global', key.text);
    } else if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const viaGlobalObject =
        ts.isPropertyAccessExpression(parent) &&
        parent.name === node &&
        isGlobalObject(parent.expression);
      if (NETWORK_GLOBALS.has(node.text) && (viaGlobalObject || !isMemberName(node))) {
        report(node, 'network-global', node.text);
      } else if (node.text === 'createRequire' && !isMemberName(node)) {
        report(node, 'dynamic-module', 'createRequire');
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return findings;
}

export function listFiles(dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => extensions.some((ext) => entry.endsWith(ext)) && !entry.endsWith('.d.ts'))
    .map((entry) => join(dir, entry))
    .filter((file) => statSync(file).isFile())
    .sort();
}

export function auditFiles(files: readonly string[], root: string): string[] {
  return files.flatMap((file) =>
    auditSource(file, readFileSync(file, 'utf8')).map(
      (f) => `${relative(root, f.file)}:${String(f.line)} ${f.rule}: ${f.detail}`,
    ),
  );
}

interface PackageJson {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readPackageJson(dir: string): PackageJson {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson;
}

function resolvePackageDir(name: string, fromDir: string): string | undefined {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/** Every installed package reachable from the root's runtime dependencies. */
export function runtimeDependencyDirs(root: string): string[] {
  const found = new Set<string>();
  const queue: { name: string; from: string; optional: boolean }[] = [];
  const enqueue = (dir: string): void => {
    const pkg = readPackageJson(dir);
    for (const name of Object.keys(pkg.dependencies ?? {}))
      queue.push({ name, from: dir, optional: false });
    for (const name of Object.keys(pkg.optionalDependencies ?? {}))
      queue.push({ name, from: dir, optional: true });
  };
  enqueue(root);
  for (let next = queue.shift(); next; next = queue.shift()) {
    const dir = resolvePackageDir(next.name, next.from);
    if (!dir) {
      // Optional platform packages are legitimately absent; a missing required one means the audit would be incomplete.
      if (next.optional) continue;
      throw new Error(`cannot resolve runtime dependency ${next.name} from ${next.from}`);
    }
    if (found.has(dir)) continue;
    found.add(dir);
    enqueue(dir);
  }
  return [...found].sort();
}
