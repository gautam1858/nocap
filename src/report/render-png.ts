import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type RasterizerKind = 'rsvg-convert' | 'resvg' | 'chromium';

export interface Rasterizer {
  readonly kind: RasterizerKind;
  readonly path: string;
}

function works(path: string, args: readonly string[]): boolean {
  try {
    const r = spawnSync(path, args, { stdio: 'ignore', timeout: 5000 });
    return r.status === 0 || (r.status === null ? false : r.status < 2) || r.error === undefined;
  } catch {
    return false;
  }
}

function chromiumCandidates(env: NodeJS.ProcessEnv): string[] {
  const named = [
    env.NOCAP_CHROME,
    env.PUPPETEER_EXECUTABLE_PATH,
    env.CHROME_PATH,
    env.CHROMIUM_PATH,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  const common = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ];
  return [...named, ...common];
}

/** Finds an installed SVG rasterizer, preferring the fast, lightweight ones. */
export function findRasterizer(env: NodeJS.ProcessEnv = process.env): Rasterizer | undefined {
  if (env.NOCAP_RASTERIZER && existsSync(env.NOCAP_RASTERIZER)) {
    return { kind: 'chromium', path: env.NOCAP_RASTERIZER };
  }
  if (works('rsvg-convert', ['--version'])) return { kind: 'rsvg-convert', path: 'rsvg-convert' };
  if (works('resvg', ['--version'])) return { kind: 'resvg', path: 'resvg' };
  for (const path of chromiumCandidates(env)) {
    if (path.includes('/') ? existsSync(path) : works(path, ['--version']))
      return { kind: 'chromium', path };
  }
  return undefined;
}

function dimensions(svg: string): { width: number; height: number } {
  const w = /width="(\d+)"/.exec(svg);
  const h = /height="(\d+)"/.exec(svg);
  return { width: w ? Number(w[1]) : 880, height: h ? Number(h[1]) : 700 };
}

export interface PngResult {
  readonly ok: boolean;
  readonly rasterizer?: RasterizerKind;
  readonly reason?: string;
}

/** Rasterizes an SVG string to a PNG file. Never throws; returns ok:false with a reason. */
export function svgToPng(
  svg: string,
  outPath: string,
  env: NodeJS.ProcessEnv = process.env,
): PngResult {
  const rasterizer = findRasterizer(env);
  if (!rasterizer) {
    return {
      ok: false,
      reason:
        'no SVG rasterizer found. Install one of: rsvg-convert (librsvg), resvg, or Chrome/Chromium, then re-run. The SVG was still written.',
    };
  }
  const dir = mkdtempSync(join(tmpdir(), 'nocap-png-'));
  try {
    const svgPath = join(dir, 'card.svg');
    writeFileSync(svgPath, svg);
    if (rasterizer.kind === 'rsvg-convert') {
      const r = spawnSync(rasterizer.path, ['-o', outPath, svgPath], { timeout: 20000 });
      return r.status === 0
        ? { ok: true, rasterizer: rasterizer.kind }
        : { ok: false, reason: 'rsvg-convert failed' };
    }
    if (rasterizer.kind === 'resvg') {
      const r = spawnSync(rasterizer.path, [svgPath, outPath], { timeout: 20000 });
      return r.status === 0
        ? { ok: true, rasterizer: rasterizer.kind }
        : { ok: false, reason: 'resvg failed' };
    }
    return chromiumPng(rasterizer.path, svg, svgPath, dir, outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function chromiumPng(
  chrome: string,
  svg: string,
  svgPath: string,
  dir: string,
  outPath: string,
): PngResult {
  const { width, height } = dimensions(svg);
  const html = join(dir, 'card.html');
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style><img src="file://${svgPath}">`,
  );
  const shot = join(dir, 'out.png');
  const r = spawnSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--default-background-color=00000000',
      '--force-device-scale-factor=2',
      `--window-size=${String(width)},${String(height)}`,
      `--screenshot=${shot}`,
      `file://${html}`,
    ],
    { timeout: 30000, stdio: 'ignore' },
  );
  if (r.status !== 0 || !existsSync(shot))
    return { ok: false, reason: 'chromium screenshot failed' };
  renameSync(shot, outPath);
  return { ok: true, rasterizer: 'chromium' };
}
