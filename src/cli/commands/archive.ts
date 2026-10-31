import { parseArgs } from 'node:util';
import { runArchive, type AgentArchiveReport } from '../../archive/archive.js';
import { AGENTS, type AgentId } from '../../core/event.js';
import { archiveDir, currentEnvironment, type Environment } from '../../core/paths.js';
import { count, plural, sum, tally } from '../format.js';
import { ExitCode, type Io } from '../io.js';

function display(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function renderArchive(
  reports: readonly AgentArchiveReport[],
  environment: Environment,
  dryRun: boolean,
): string {
  const out: string[] = [];
  out.push(
    dryRun
      ? 'Dry run: nothing was written.'
      : `Archive: ${display(archiveDir(environment), environment.home)} (redacted copies; originals untouched)`,
  );
  for (const r of reports) {
    out.push('', r.name);
    if (r.roots.length === 0) {
      out.push('  no session logs found');
      continue;
    }
    out.push(`  logs      ${r.roots.map((root) => display(root, environment.home)).join(', ')}`);
    const done = dryRun ? 'would archive' : 'archived';
    out.push(
      `  files     ${count(r.scanned)} found: ${count(r.archived)} ${done}, ${count(r.unchanged)} unchanged` +
        (r.reindexed > 0 ? `, ${count(r.reindexed)} re-indexed from the archive` : ''),
    );
    if (r.archived + r.reindexed > 0) {
      out.push(`  events    ${count(r.events)} indexed`);
      const secrets = sum(r.redactions);
      out.push(
        `  redacted  ${secrets === 0 ? 'no secrets found' : `${plural(secrets, 'secret')} (${tally(r.redactions)})`}`,
      );
    }
    if (r.errors > 0) out.push(`  warning   ${plural(r.errors, 'line')} could not be parsed`);
    if (r.unknown.size > 0) {
      out.push(
        `  warning   unrecognised record types: ${tally(r.unknown)}. Run 'nocap doctor' for details.`,
      );
    }
  }
  return `${out.join('\n')}\n`;
}

export function archiveCommand(args: readonly string[], io: Io): number {
  let values: { agent?: string[]; 'dry-run'?: boolean; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: {
        agent: { type: 'string', multiple: true },
        'dry-run': { type: 'boolean' },
        json: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    io.stderr.write(`nocap archive: ${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.usage;
  }
  const unknownAgent = values.agent?.find((a) => !AGENTS.includes(a as AgentId));
  if (unknownAgent !== undefined) {
    io.stderr.write(
      `nocap archive: unknown agent '${unknownAgent}'. Expected one of: ${AGENTS.join(', ')}.\n`,
    );
    return ExitCode.usage;
  }
  const environment = currentEnvironment();
  const dryRun = values['dry-run'] === true;
  const reports = runArchive({
    environment,
    ...(values.agent ? { agents: values.agent as AgentId[] } : {}),
    dryRun,
  });
  if (values.json) {
    io.stdout.write(
      `${JSON.stringify(
        reports.map((r) => ({
          ...r,
          unknown: Object.fromEntries(r.unknown),
          redactions: Object.fromEntries(r.redactions),
        })),
        null,
        2,
      )}\n`,
    );
  } else {
    io.stdout.write(renderArchive(reports, environment, dryRun));
  }
  return ExitCode.ok;
}
