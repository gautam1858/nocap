import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const readJson = (p: string): Record<string, unknown> =>
  JSON.parse(read(p)) as Record<string, unknown>;
const pkgVersion = (JSON.parse(read('package.json')) as { version: string }).version;

describe('Claude Code plugin manifests', () => {
  it('the marketplace lists the nocap plugin, pointing at a real directory', () => {
    const market = readJson('.claude-plugin/marketplace.json');
    expect(market.name).toBe('nocap');
    const plugins = market.plugins as { name: string; source: string; version: string }[];
    expect(plugins).toHaveLength(1);
    const [plugin] = plugins;
    expect(plugin?.name).toBe('nocap');
    expect(existsSync(join(root, plugin?.source ?? '', '.claude-plugin/plugin.json'))).toBe(true);
  });

  it('plugin.json is valid and its version matches the package', () => {
    const plugin = readJson('plugin/.claude-plugin/plugin.json');
    expect(plugin.name).toBe('nocap');
    expect(plugin.version).toBe(pkgVersion);
  });

  it('the marketplace version matches the package', () => {
    const plugins = readJson('.claude-plugin/marketplace.json').plugins as { version: string }[];
    expect(plugins[0]?.version).toBe(pkgVersion);
  });

  it('ships the /nocap and /nocap-guard commands with frontmatter', () => {
    for (const name of ['nocap', 'nocap-guard']) {
      const body = read(`plugin/commands/${name}.md`);
      expect(body.startsWith('---\n')).toBe(true);
      expect(body).toContain('description:');
    }
  });

  it('wires the guard into both hook events via the CLI', () => {
    const hooks = readJson('plugin/hooks/hooks.json').hooks as Record<string, unknown[]>;
    expect(Object.keys(hooks).sort()).toEqual(['PreToolUse', 'UserPromptSubmit']);
    expect(JSON.stringify(hooks)).toContain('nocap guard run');
  });
});

describe('CI action and workflow files are present and well-formed', () => {
  it('the review action references a pinned github-script and posts a sticky comment', () => {
    const action = read('.github/actions/nocap-review/action.yml');
    expect(action).toContain('using: composite');
    expect(action).toMatch(/github-script@[0-9a-f]{40}/);
    expect(action).toContain('nocap-review'); // the sticky marker
  });

  it('the review workflow runs on pull_request with comment permission', () => {
    const wf = read('.github/workflows/nocap-review.yml');
    expect(wf).toContain('pull_request');
    expect(wf).toContain('pull-requests: write');
    expect(wf).toContain('./.github/actions/nocap-review');
  });

  it('the release workflow publishes with provenance on a tag', () => {
    const wf = read('.github/workflows/release.yml');
    expect(wf).toContain('tags:');
    expect(wf).toContain('npm publish --provenance --access public');
    expect(wf).toContain('id-token: write');
  });
});
