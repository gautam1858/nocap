import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

export interface PngResult {
  readonly ok: boolean;
  readonly renderer?: 'resvg-wasm' | 'rsvg-convert' | 'resvg' | 'chromium';
  readonly reason?: string;
}

// The bundled wasm renderer needs the fonts the card uses, since it loads no
// system fonts. Both live in the published package.
function asset(path: string): string {
  return fileURLToPath(new URL(`../../assets/${path}`, import.meta.url));
}

let wasmReady: Promise<void> | undefined;
async function ensureWasm(): Promise<void> {
  wasmReady ??= initWasm(
    readFileSync(fileURLToPath(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))),
  );
  await wasmReady;
}

async function resvgWasmPng(svg: string, outPath: string): Promise<boolean> {
  await ensureWasm();
  const fonts = [asset('fonts/jbm-regular.ttf'), asset('fonts/jbm-bold.ttf')]
    .filter(existsSync)
    .map((f) => readFileSync(f));
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: 2 },
    font: { fontBuffers: fonts, defaultFontFamily: 'JetBrains Mono', loadSystemFonts: false },
  });
  writeFileSync(outPath, resvg.render().asPng());
  return true;
}

/**
 * Rasterises an SVG string to a PNG file. The bundled wasm renderer handles it
 * with no external tools; the rest are fallbacks in case it ever fails. Never
 * throws — returns ok:false with a reason.
 */
export async function svgToPng(
  svg: string,
  outPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PngResult> {
  try {
    await resvgWasmPng(svg, outPath);
    return { ok: true, renderer: 'resvg-wasm' };
  } catch (error) {
    const fallback = externalRasterize(svg, outPath, env);
    if (fallback.ok) return fallback;
    return {
      ok: false,
      reason: `could not render PNG: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// -------------------------------------------------- external-tool fallbacks

function works(path: string, args: readonly string[]): boolean {
  try {
    return spawnSync(path, args, { stdio: 'ignore', timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
}

function chromiumPath(env: NodeJS.ProcessEnv): string | undefined {
  const named = [
    env.NOCAP_CHROME,
    env.PUPPETEER_EXECUTABLE_PATH,
    env.CHROME_PATH,
    env.CHROMIUM_PATH,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0 && existsSync(p));
  if (named[0]) return named[0];
  for (const name of ['google-chrome', 'chromium', 'chromium-browser'])
    if (works(name, ['--version'])) return name;
  return undefined;
}

function dimensions(svg: string): { width: number; height: number } {
  const w = /width="(\d+)"/.exec(svg);
  const h = /height="(\d+)"/.exec(svg);
  return { width: w ? Number(w[1]) : 880, height: h ? Number(h[1]) : 700 };
}

function externalRasterize(svg: string, outPath: string, env: NodeJS.ProcessEnv): PngResult {
  const dir = mkdtempSync(join(tmpdir(), 'nocap-png-'));
  try {
    const svgPath = join(dir, 'card.svg');
    writeFileSync(svgPath, svg);
    if (
      works('rsvg-convert', ['--version']) &&
      spawnSync('rsvg-convert', ['-o', outPath, svgPath]).status === 0
    ) {
      return { ok: true, renderer: 'rsvg-convert' };
    }
    if (works('resvg', ['--version']) && spawnSync('resvg', [svgPath, outPath]).status === 0) {
      return { ok: true, renderer: 'resvg' };
    }
    const chrome = chromiumPath(env);
    if (chrome) {
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
      if (r.status === 0 && existsSync(shot)) {
        renameSync(shot, outPath);
        return { ok: true, renderer: 'chromium' };
      }
    }
    return { ok: false, reason: 'no fallback rasterizer available' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
