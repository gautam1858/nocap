import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { analyze, type SessionAnalysis } from '../../analyzers/analyze.js';
import { currentEnvironment, databasePath } from '../../core/paths.js';
import { nearMissesForSession } from '../../guard/nearmiss.js';
import { renderCardHtml, renderCardSvg, type ThemeName } from '../../report/card.js';
import { toDocket } from '../../report/docket.js';
import { svgToPng } from '../../report/render-png.js';
import { shareText } from '../../report/share.js';
import { sessionInfoFromRow, Store } from '../../store/store.js';
import { ExitCode, type Io } from '../io.js';
import { field, styleFor } from '../style.js';

interface Options {
  theme: ThemeName;
  out?: string;
  share: boolean;
  html: boolean;
  png: boolean;
}

function parse(args: readonly string[], io: Io): { session?: string; options: Options } | number {
  try {
    const { values, positionals } = parseArgs({
      args: [...args],
      options: {
        light: { type: 'boolean' },
        dark: { type: 'boolean' },
        out: { type: 'string' },
        share: { type: 'boolean' },
        html: { type: 'boolean' },
        png: { type: 'boolean' },
      },
      allowPositionals: true,
      strict: true,
    });
    return {
      ...(positionals[0] !== undefined ? { session: positionals[0] } : {}),
      options: {
        theme: values.light ? 'light' : 'dark',
        ...(values.out !== undefined ? { out: values.out } : {}),
        share: values.share === true,
        html: values.html === true,
        png: values.png === true || values.share === true,
      },
    };
  } catch (error) {
    io.stderr.write(`nocap card: ${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.usage;
  }
}

function outPath(base: string, dir: string, ext: string, override: string | undefined): string {
  if (override === undefined) return join(dir, `${base}.${ext}`);
  const resolved = isAbsolute(override) ? override : join(dir, override);
  return resolved.endsWith(`.${ext}`)
    ? resolved
    : resolved.replace(/\.(svg|png|html|txt)$/, '') + `.${ext}`;
}

export function cardCommand(args: readonly string[], io: Io): number {
  const parsed = parse(args, io);
  if (typeof parsed === 'number') return parsed;
  const { session, options } = parsed;

  const environment = currentEnvironment();
  const dbPath = databasePath(environment);
  if (!existsSync(dbPath)) {
    io.stderr.write("nocap card: no index yet. Run 'nocap archive' first.\n");
    return ExitCode.failure;
  }
  const store = Store.open(dbPath);
  let analysis: SessionAnalysis;
  try {
    const sessions = store.sessions();
    const row =
      session === undefined
        ? sessions[0]
        : sessions.find((s) => s.id === session || s.id.startsWith(session));
    if (!row) {
      io.stderr.write(
        session === undefined
          ? 'nocap card: no sessions indexed yet.\n'
          : `nocap card: no session matches '${session}'.\n`,
      );
      return ExitCode.failure;
    }
    const guardEnv = { home: process.env.HOME ?? homedir(), env: process.env };
    analysis = analyze(
      sessionInfoFromRow(row),
      store.eventsForSession(row.agent, row.id),
      nearMissesForSession(guardEnv, row.id).length,
    );
  } finally {
    store.close();
  }

  const style = styleFor(io.stdout);
  const docket = toDocket(analysis);
  const dir = process.cwd();
  const svg = renderCardSvg(analysis, { theme: options.theme });
  const svgPath = outPath(docket.number, dir, 'svg', options.out);
  writeFileSync(svgPath, svg);

  const written: { label: string; path: string }[] = [{ label: 'card', path: svgPath }];
  if (options.html) {
    const htmlPath = outPath(docket.number, dir, 'html', options.out);
    writeFileSync(htmlPath, renderCardHtml(analysis, { theme: options.theme }));
    written.push({ label: 'html', path: htmlPath });
  }
  let pngNote: string | undefined;
  if (options.png) {
    const pngPath = outPath(docket.number, dir, 'png', options.out);
    const result = svgToPng(svg, pngPath, environment.env);
    if (result.ok) written.push({ label: 'png', path: pngPath });
    else pngNote = result.reason;
  }
  if (options.share) {
    const txtPath = outPath(docket.number, dir, 'txt', options.out);
    writeFileSync(txtPath, `${shareText(analysis)}\n`);
    written.push({ label: 'post', path: txtPath });
  }

  io.stdout.write(`${style.bold(style.accent(`Probable Cause card — ${docket.number}`))}\n`);
  for (const w of written) io.stdout.write(field(style, w.label, w.path) + '\n');
  if (pngNote) io.stdout.write(field(style, 'png', style.yellow(pngNote)) + '\n');
  io.stdout.write(
    `\n${style.bold(style.accent('PROBABLE CAUSE:'))} ${style.bold(analysis.probableCause)}\n`,
  );
  if (options.share) io.stdout.write(`\n${style.dim('Ready to post:')}\n${shareText(analysis)}\n`);
  return ExitCode.ok;
}
