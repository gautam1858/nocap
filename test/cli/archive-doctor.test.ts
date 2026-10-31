import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../support/cli.js';
import { createHome, PLANTED_SECRETS, allBytes, type TestHome } from '../support/home.js';
import { TRIPWIRE_MARKER } from '../support/network-tripwire.mjs';
import { join } from 'node:path';

let t: TestHome;
beforeEach(() => {
  t = createHome();
});
afterEach(() => {
  t.cleanup();
});

describe('nocap archive and doctor, end to end', () => {
  it('archives, then doctor reports a clean bill of health', () => {
    const doctorBefore = runCli(['doctor'], { home: t.home });
    expect(doctorBefore.status).toBe(1);
    expect(doctorBefore.stdout).toContain("Run 'nocap archive'");

    const archive = runCli(['archive'], { home: t.home });
    expect(archive.stderr).toBe('');
    expect(archive.status).toBe(0);
    expect(archive.stdout).toContain('2 found: 2 archived, 0 unchanged');
    expect(archive.stdout).toMatch(/redacted\s+\d+ secrets/);

    const doctor = runCli(['doctor'], { home: t.home });
    expect(doctor.stderr).toBe('');
    expect(doctor.stdout).toContain('versions  2.1.316 (2 sessions)');
    expect(doctor.stdout).toContain('0 unparseable, 0 unrecognised record types');
    expect(doctor.stdout).toContain('No problems found.');
    expect(doctor.status).toBe(0);

    for (const secret of Object.values(PLANTED_SECRETS)) {
      expect(allBytes(join(t.home, '.nocap'))).not.toContain(secret);
      expect(archive.stdout + doctor.stdout).not.toContain(secret);
    }
  });

  it('prints JSON on request', () => {
    const result = runCli(['doctor', '--json'], { home: t.home });
    const report = JSON.parse(result.stdout) as { agents: { agent: string; files: number }[] };
    expect(report.agents.map((a) => [a.agent, a.files])).toEqual([
      ['claude-code', 2],
      ['codex', 2],
    ]);
  });

  it('rejects unknown agents and options with a usage error', () => {
    expect(runCli(['archive', '--agent', 'cursor'], { home: t.home })).toMatchObject({ status: 2 });
    expect(runCli(['doctor', '--verbose'], { home: t.home })).toMatchObject({ status: 2 });
  });

  it('never touches the network while doing real work', () => {
    for (const args of [['archive'], ['archive', '--dry-run'], ['doctor'], ['doctor', '--json']]) {
      const result = runCli(args, { home: t.home });
      expect(result.stderr).not.toContain(TRIPWIRE_MARKER);
    }
  });
});

describe('nocap audit, end to end', () => {
  it('errors cleanly before anything is archived', () => {
    const t2 = createHome();
    try {
      const result = runCli(['audit'], { home: t2.home });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Run');
    } finally {
      t2.cleanup();
    }
  });

  it('audits the most recent session after archiving', () => {
    runCli(['archive'], { home: t.home });
    const result = runCli(['audit'], { home: t.home });
    expect(result.stderr).not.toContain(TRIPWIRE_MARKER);
    expect(result.stdout).toContain('PROBABLE CAUSE:');
    expect(result.stdout).toContain('test integrity');
  });

  it('emits JSON with verdict counts', () => {
    runCli(['archive'], { home: t.home });
    const result = runCli(['audit', '--all', '--json'], { home: t.home });
    const analyses = JSON.parse(result.stdout) as { verdicts: Record<string, number> }[];
    expect(Array.isArray(analyses)).toBe(true);
    expect(analyses[0]?.verdicts).toHaveProperty('BACKED');
  });
});
