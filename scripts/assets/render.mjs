// Regenerates everything in docs/assets from real nocap output.
//
//   npm run build && npm run assets
//
// Needs Chromium via Playwright, the JetBrains Mono font files, and a Python
// with fonttools and brotli (for the wordmark paths and the embedded font
// subset). Point JETBRAINS_MONO_DIR and PYTHON at them if they live elsewhere.
// None of this is needed to build, test or run nocap.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'docs/assets');
const fontDir = process.env.JETBRAINS_MONO_DIR ?? '/usr/share/fonts/truetype/jetbrains-mono';
const python = process.env.PYTHON ?? 'python3';
const { chromium } = createRequire(import.meta.url)('playwright');

const ORANGE = '#FF5F1F';
const INK = '#121214';

mkdirSync(out, { recursive: true });
const fontFile = (weight) => join(fontDir, `JetBrainsMono-${weight}.ttf`);
// Pages rendered with setContent cannot load file:// fonts, so the screenshots
// rely on JetBrains Mono being installed; the animated SVG embeds a subset.
const MONO = `'JetBrains Mono',monospace`;

// ---------------------------------------------------------------- logo

function wordmark(text, weight) {
  const raw = execFileSync(
    python,
    ['-I', join(root, 'scripts/assets/font.py'), 'paths', fontFile(weight), text],
    {
      encoding: 'utf8',
    },
  );
  return JSON.parse(raw);
}

// An orange flight recorder with a polygraph trace across it.
function mark(x = 0, y = 0, size = 128) {
  const s = size / 128;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="4" y="4" width="120" height="120" rx="26" fill="${ORANGE}"/>
    <rect x="4" y="4" width="120" height="120" rx="26" fill="url(#sheen)"/>
    ${[20, 108].flatMap((cx) => [20, 108].map((cy) => `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${INK}" fill-opacity="0.22"/>`)).join('')}
    <polyline points="17,67 38,67 47,45 57,91 67,29 77,79 84,67 98,67" fill="none" stroke="${INK}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="106" cy="67" r="6" fill="${INK}"/>
  </g>`;
}

const sheen = `<defs><linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity="0.12"/></linearGradient></defs>`;

function logo(color) {
  const w = wordmark('nocap', 'ExtraBold');
  const scale = 64 / w.xHeight;
  const width = Math.ceil(150 + w.advance * scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 128" width="${width}" height="128" role="img" aria-label="nocap">
  ${sheen}${mark()}
  <path transform="translate(150 96) scale(${scale.toFixed(5)})" fill="${color}" d="${w.d}"/>
</svg>\n`;
}

writeFileSync(join(out, 'logo-light.svg'), logo(INK));
writeFileSync(join(out, 'logo-dark.svg'), logo('#F4F4F5'));
writeFileSync(
  join(out, 'mark.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="nocap">${sheen}${mark()}</svg>\n`,
);

// ------------------------------------------------- demo home and real output

const j = (...parts) => parts.join('');
function demoHome() {
  const home = mkdtempSync(join(tmpdir(), 'nocap-demo-'));
  const put = (path, contents) => {
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), contents);
  };
  const fixture = (path) => readFileSync(join(root, 'fixtures', path));
  put(
    '.claude/projects/-home-dev-acme/11111111-2222-4333-8444-555555555555.jsonl',
    fixture('claude-code/2.1.316/basic.jsonl'),
  );
  put('.claude/settings.json', JSON.stringify({ cleanupPeriodDays: 30 }));
  put(
    '.codex/sessions/2026/10/30/rollout-2026-10-30T14-00-00-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl',
    fixture('codex/0.166.0/legacy.jsonl'),
  );
  put(
    '.codex/sessions/2026/10/30/rollout-2026-10-30T16-00-00-0199b2c3-d4e5-7f60-8b9c-1d2e3f4a5b6c.jsonl.zst',
    zstdCompressSync(fixture('codex/0.166.0/paginated.jsonl')),
  );

  // A session that leaks credentials, so the redaction line has something to show.
  // Every secret is fake and assembled at runtime.
  const s = '22222222-3333-4444-8555-666666666666';
  const base = {
    sessionId: s,
    cwd: join(home, 'acme'),
    version: '2.1.316',
    isSidechain: false,
    userType: 'external',
  };
  const env = join(home, 'acme/.env');
  const lines = [
    {
      ...base,
      type: 'user',
      uuid: 'l1',
      timestamp: '2026-10-30T11:00:00.000Z',
      origin: { kind: 'human' },
      message: { role: 'user', content: `deploy with ${j('gh', 'p_', 'Z'.repeat(36))}` },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'l2',
      timestamp: '2026-10-30T11:00:01.000Z',
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_env', name: 'Read', input: { file_path: env } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    {
      ...base,
      type: 'user',
      uuid: 'l3',
      timestamp: '2026-10-30T11:00:02.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_env',
            content: '     1→SESSION_SALT=demo-value-1\n',
          },
        ],
      },
      toolUseResult: {
        type: 'text',
        file: { filePath: env, content: 'SESSION_SALT=demo-value-1\n' },
      },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'l4',
      timestamp: '2026-10-30T11:00:03.000Z',
      message: {
        id: 'm2',
        model: 'claude-opus-5-5',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_db',
            name: 'Bash',
            input: {
              command: `ANTHROPIC_API_KEY=${j('sk-', 'ant-', 'api03-', 'Y'.repeat(40))} psql postgres://admin:${j('demo', '-pass-', '9876')}@db.example.com/prod -c 'select 1'`,
            },
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    {
      ...base,
      type: 'user',
      uuid: 'l5',
      timestamp: '2026-10-30T11:00:04.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_db', content: '1' }],
      },
      toolUseResult: { stdout: '1', stderr: '', interrupted: false, isImage: false },
    },
  ];
  put(
    `.claude/projects/-home-dev-acme/${s}.jsonl`,
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );

  // Installed agents, so doctor can show version detection. Never executed.
  for (const [command, pkg, version] of [
    ['claude', '@anthropic-ai/claude-code', '2.1.316'],
    ['codex', '@openai/codex', '0.166.0'],
  ]) {
    const dir = join(home, '.local/lib/node_modules', pkg);
    put(
      join('.local/lib/node_modules', pkg, 'package.json'),
      JSON.stringify({ name: pkg, version }),
    );
    put(join('.local/lib/node_modules', pkg, 'cli.js'), '');
    mkdirSync(join(home, '.local/bin'), { recursive: true });
    symlinkSync(join(dir, 'cli.js'), join(home, '.local/bin', command));
  }
  return home;
}

function nocap(home, ...args) {
  const result = spawnSync(process.execPath, [join(root, 'dist/cli/index.js'), ...args], {
    encoding: 'utf8',
    env: {
      HOME: home,
      PATH: `${join(home, '.local/bin')}:/usr/bin:/bin`,
      FORCE_COLOR: '1',
      LANG: 'C.UTF-8',
    },
  });
  if (result.stderr) throw new Error(`nocap ${args.join(' ')} wrote to stderr:\n${result.stderr}`);
  return result.stdout.replace(/\n$/, '');
}

const home = demoHome();
const archiveOut = nocap(home, 'archive');
const doctorOut = nocap(home, 'doctor');
rmSync(home, { recursive: true, force: true });

// ------------------------------------------------------- ANSI to markup

const ESC = '\u001b';
const SGR_PART = new RegExp(`(${ESC}\\[[0-9;]*m)`);
const SGR_CODE = new RegExp(`^${ESC}\\[([0-9;]*)m$`);
const SGR_ANY = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

const COLORS = {
  red: '#FF7B72',
  green: '#3FB950',
  yellow: '#E3B341',
  accent: '#FF7A1A',
  fg: '#D7DCE2',
  dim: '#7D8590',
};

/** Splits one line of SGR-coloured text into styled runs. */
function runs(line) {
  const result = [];
  let state = { bold: false, dim: false, color: undefined };
  for (const part of line.split(SGR_PART)) {
    const sgr = SGR_CODE.exec(part);
    if (!sgr) {
      if (part) result.push({ text: part, ...state });
      continue;
    }
    const code = sgr[1];
    state = { ...state };
    if (code === '1') state.bold = true;
    else if (code === '2') state.dim = true;
    else if (code === '22') Object.assign(state, { bold: false, dim: false });
    else if (code === '31') state.color = 'red';
    else if (code === '32') state.color = 'green';
    else if (code === '33') state.color = 'yellow';
    else if (code === '38;5;208') state.color = 'accent';
    else if (code === '39') state.color = undefined;
  }
  return result;
}

const escape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colorOf = (r) =>
  r.color ? COLORS[r.color] : r.dim ? COLORS.dim : r.bold ? '#FFFFFF' : COLORS.fg;

function htmlLine(line) {
  return runs(line)
    .map(
      (r) =>
        `<span style="color:${colorOf(r)};font-weight:${r.bold ? 700 : 400}">${escape(r.text)}</span>`,
    )
    .join('');
}

const prompt = (command) =>
  `<span style="color:${COLORS.green}">~/acme</span> <span style="color:${COLORS.accent}">❯</span> <span style="color:#fff;font-weight:700">${command}</span>`;

// ----------------------------------------------------- terminal screenshots

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });

async function shoot(html, file, selector, size = { width: 1400, height: 1000 }) {
  await page.setViewportSize(size);
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>${html.css}</style>${html.body}`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.locator(selector).screenshot({ path: join(out, file), omitBackground: true });
}

const terminalCss = `
  body{margin:0;background:transparent}
  .stage{display:inline-block;padding:44px;background:radial-gradient(120% 140% at 0% 0%,#ff5f1f55 0%,#ff5f1f00 45%),linear-gradient(135deg,#1a1d24,#0b0d10)}
  .window{background:#0D1117;border:1px solid #30363d;border-radius:12px;box-shadow:0 30px 80px #000a,0 0 0 1px #0006;overflow:hidden}
  .bar{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#161b22;border-bottom:1px solid #21262d}
  .dot{width:12px;height:12px;border-radius:50%}.r{background:#ff5f56}.y{background:#ffbd2e}.g{background:#27c93f}
  .title{margin-left:auto;margin-right:auto;transform:translateX(-30px);color:#7d8590;font:500 13px ${MONO}}
  pre{margin:0;padding:18px 22px 22px;font:400 15px/1.55 ${MONO};color:${COLORS.fg}}`;

const terminal = (command, output, title = 'nocap') => ({
  css: terminalCss,
  body: `<div class="stage"><div class="window"><div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">${title}</span></div><pre>${prompt(command)}\n${output.split('\n').map(htmlLine).join('\n')}</pre></div></div>`,
});

await shoot(terminal('nocap archive', archiveOut, 'nocap archive'), 'archive.png', '.stage');
await shoot(terminal('nocap doctor', doctorOut, 'nocap doctor'), 'doctor.png', '.stage', {
  width: 1400,
  height: 1300,
});

// ------------------------------------------------------- animated terminal

execFileSync(python, [
  '-I',
  join(root, 'scripts/assets/font.py'),
  'subset',
  fontFile('Regular'),
  join(tmpdir(), 'jbm-400.woff2'),
]);
execFileSync(python, [
  '-I',
  join(root, 'scripts/assets/font.py'),
  'subset',
  fontFile('Bold'),
  join(tmpdir(), 'jbm-700.woff2'),
]);
const embedded = [400, 700]
  .map(
    (w) =>
      `@font-face{font-family:'JBM';font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(join(tmpdir(), `jbm-${w}.woff2`)).toString('base64')}) format('woff2')}`,
  )
  .join('');

function animatedTerminal(scenes) {
  const FONT = 14;
  const LINE = 21;
  const CHAR = FONT * 0.6;
  const PAD = 20;
  const TOP = 40;
  const TYPE_PER_CHAR = 0.07;
  const LINE_GAP = 0.055;
  const HOLD = 4.5;

  // Plan the timeline: type the command, reveal output line by line, hold, next scene.
  // Start typing almost at once: a visitor should never see an empty window.
  let t = 0.15;
  const planned = scenes.map((scene) => {
    const start = t;
    const typed = start + scene.command.length * TYPE_PER_CHAR;
    const lines = scene.output
      .split('\n')
      .map((text, i) => ({ text, at: typed + 0.35 + i * LINE_GAP }));
    const end = (lines.at(-1)?.at ?? typed) + HOLD;
    t = end + 0.15;
    return { ...scene, start, typed, lines, end };
  });
  const total = t;
  const pct = (s) => `${((s / total) * 100).toFixed(3)}%`;
  const rows = Math.max(...planned.map((s) => s.lines.length + 1));
  const cols = Math.max(
    ...planned.flatMap((s) => s.lines.map((l) => l.text.replace(SGR_ANY, '').length)),
    60,
  );
  const width = Math.ceil(cols * CHAR + PAD * 2);
  const height = TOP + rows * LINE + PAD;

  let css = '';
  let body = '';
  let id = 0;
  // step-end holds each keyframe's value until the next one, so lines appear
  // and vanish instantly instead of fading in across the whole loop.
  const visible = (from, to) => {
    const name = `k${String(id++)}`;
    css += `@keyframes ${name}{0%{opacity:0}${pct(from)}{opacity:1}${pct(to)}{opacity:0}}.${name}{opacity:0;animation:${name} ${total.toFixed(2)}s step-end infinite}`;
    return name;
  };

  for (const scene of planned) {
    const y0 = TOP + LINE - 6;
    const promptWidth = '~/acme ❯ '.length * CHAR;
    const cmdName = visible(scene.start, scene.end);
    const typeName = `t${id++}`;
    const steps = scene.command.length;
    css += `@keyframes ${typeName}{0%,${pct(scene.start)}{transform:translateX(0)}${pct(scene.typed)},100%{transform:translateX(${(steps * CHAR).toFixed(1)}px)}}.${typeName}{animation:${typeName} ${total.toFixed(2)}s steps(${steps},end) infinite}`;
    body += `<g class="${cmdName}"><text x="${PAD}" y="${y0}"><tspan fill="${COLORS.green}">~/acme</tspan> <tspan fill="${COLORS.accent}">❯</tspan> <tspan fill="#fff" font-weight="700">${escape(scene.command)}</tspan></text>`;
    body += `<rect class="${typeName}" x="${(PAD + promptWidth).toFixed(1)}" y="${y0 - FONT}" width="${(steps * CHAR + CHAR).toFixed(1)}" height="${LINE}" fill="#0D1117"/></g>`;
    scene.lines.forEach((line, i) => {
      if (!line.text) return;
      const spans = runs(line.text)
        .map(
          (r) =>
            `<tspan fill="${colorOf(r)}"${r.bold ? ' font-weight="700"' : ''}>${escape(r.text)}</tspan>`,
        )
        .join('');
      body += `<text class="${visible(line.at, scene.end)}" x="${PAD}" y="${y0 + (i + 1) * LINE}" xml:space="preserve">${spans}</text>`;
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="nocap archive and nocap doctor running on a demo home directory">
<style>${embedded}text{font-family:'JBM','JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:${FONT}px;white-space:pre}${css}</style>
<rect width="${width}" height="${height}" rx="12" fill="#0D1117"/>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="none" stroke="#30363d"/>
<circle cx="22" cy="20" r="6" fill="#ff5f56"/><circle cx="42" cy="20" r="6" fill="#ffbd2e"/><circle cx="62" cy="20" r="6" fill="#27c93f"/>
${body}
</svg>\n`;
}

writeFileSync(
  join(out, 'demo.svg'),
  animatedTerminal([
    { command: 'nocap archive', output: archiveOut },
    { command: 'nocap doctor', output: doctorOut },
  ]),
);

// ------------------------------------------------------ card design preview

const card = {
  css: `
  body{margin:0;background:transparent}
  .stage{display:inline-block;padding:40px;background:linear-gradient(135deg,#1a1d24,#0b0d10)}
  .card{position:relative;width:860px;background:#F6F2E8;color:#1b1b1b;font:400 15px/1.5 ${MONO};border-radius:6px;box-shadow:0 30px 80px #000a;overflow:hidden;
    background-image:repeating-linear-gradient(0deg,#0000 0 27px,#00000008 27px 28px)}
  .head{display:flex;justify-content:space-between;align-items:flex-end;background:${INK};color:#F6F2E8;padding:18px 28px}
  .head b{font-weight:800;letter-spacing:.14em}.head small{color:#9aa0a6;letter-spacing:.08em}
  .org{color:${ORANGE};font-weight:800;letter-spacing:.2em;font-size:13px}
  .body{padding:22px 28px 10px}
  .row{display:grid;grid-template-columns:170px 120px 1fr;padding:3px 0}
  .k{color:#6b665c;letter-spacing:.08em}.v{font-weight:700}
  hr{border:0;border-top:1.5px dashed #b9b2a3;margin:14px 0}
  .claims{display:flex;gap:26px;font-weight:700;letter-spacing:.06em;margin-bottom:10px}
  .claims span em{font-style:normal;color:#6b665c;font-weight:400;margin-right:8px}
  .claim{display:grid;grid-template-columns:96px 1fr 130px;padding:4px 0}
  .claim .ev{grid-column:2/4;color:#5a554b;font-size:13.5px}
  .tag{justify-self:end;font-weight:800;letter-spacing:.1em;font-size:13px;padding:1px 8px;border:2px solid}
  .backed{color:#1f7a35;border-color:#1f7a35}.narrowed{color:#b45309;border-color:#b45309}
  .cause{background:#ece6d6;border-left:5px solid ${ORANGE};padding:14px 18px;margin:16px 0 18px;font-size:16px}
  .cause b{letter-spacing:.12em}
  .stamp{position:absolute;right:44px;top:150px;transform:rotate(-12deg);color:#c2410c;border:4px solid #c2410c;border-radius:6px;padding:4px 16px;font:800 30px ${MONO};letter-spacing:.16em;opacity:.82;mix-blend-mode:multiply}
  .foot{display:flex;justify-content:space-between;padding:10px 28px 16px;color:#8a8478;font-size:12px;letter-spacing:.06em}
  .preview{background:${ORANGE};color:${INK};text-align:center;font:800 12.5px ${MONO};letter-spacing:.18em;padding:7px 0}`,
  body: `<div class="stage"><div class="card">
  <div class="preview">DESIGN PREVIEW · SAMPLE DATA · NOT YET IMPLEMENTED</div>
  <div class="head"><div><div class="org">NOCAP · INCIDENT DOCKET</div><b>PROBABLE CAUSE REPORT</b></div><small>NC-261030-0900 · CLAUDE CODE 2.1.316</small></div>
  <div class="body">
    <div class="row"><span class="k">FLIGHT</span><span class="v">1m 30s</span><span>09:00:00 → 09:01:30</span></div>
    <div class="row"><span class="k">COST</span><span class="v">$0.42</span><span>as recorded by the agent</span></div>
    <div class="row"><span class="k">TOOLS FIRED</span><span class="v">7</span><span>Bash 5 · Edit 1 · Write 1</span></div>
    <div class="row"><span class="k">FILES TOUCHED</span><span class="v">2</span><span>src/auth.ts · test/clock.test.ts</span></div>
    <hr>
    <div class="claims"><span><em>CLAIMS AUDITED</em>2</span><span><em>BACKED</em>1</span><span><em>NARROWED</em>1</span><span><em>CONTRADICTED</em>0</span></div>
    <div class="claim"><span>09:00:12</span><span>"Fixing it in src/auth.ts."</span><span class="tag backed">BACKED</span>
      <span class="ev">Edit src/auth.ts applied at 09:00:13</span></div>
    <div class="claim"><span>09:00:50</span><span>"All tests pass"</span><span class="tag narrowed">NARROWED</span>
      <span class="ev">last full run: npm test → exit 1 at 09:00:09<br>only pass: vitest run test/auth.test.ts (1 file) → exit 0 at 09:00:19<br>test/clock.test.ts written after that pass, at 09:00:22</span></div>
    <hr>
    <div class="row"><span class="k">TEST INTEGRITY</span><span class="v">C</span><span>1 test added already skipped (it.skip)</span></div>
    <div class="row"><span class="k">NEAR MISSES</span><span class="v">0</span><span>guard not installed</span></div>
    <div class="cause"><b>PROBABLE CAUSE:</b> The agent reported the suite green on the strength of a single-file run. The last full run failed and was not repeated.</div>
  </div>
  <div class="stamp">NARROWED</div>
  <div class="foot"><span>reenactment of fixtures/claude-code/2.1.316/basic.jsonl (synthetic)</span><span>nocap · 100% local</span></div>
</div></div>`,
};
await shoot(card, 'card-preview.png', '.stage', { width: 1000, height: 1000 });

// ------------------------------------------------------------- badges

async function badge(label, value, color) {
  const widths = await page.evaluate(
    ([a, b]) => {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = '11px Verdana, DejaVu Sans, sans-serif';
      return [ctx.measureText(a).width, ctx.measureText(b).width];
    },
    [label, value],
  );
  const [lw, vw] = widths.map((w) => Math.ceil(w) + 12);
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text><text x="${lw / 2}" y="14">${label}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${escape(value)}</text><text x="${lw + vw / 2}" y="14">${escape(value)}</text></g></svg>\n`;
}

mkdirSync(join(out, 'badges'), { recursive: true });
for (const [file, label, value, color] of [
  ['network.svg', 'network calls', '0', '#2EA043'],
  ['telemetry.svg', 'telemetry', 'none', '#2EA043'],
  ['deps.svg', 'runtime deps', '0', '#2EA043'],
  ['node.svg', 'node', '>= 22.15', '#0969DA'],
  ['license.svg', 'license', 'MIT', '#0969DA'],
]) {
  writeFileSync(join(out, 'badges', file), await badge(label, value, color));
}

// ------------------------------------------------------- social preview

const w = wordmark('nocap', 'ExtraBold');
await shoot(
  {
    css: `body{margin:0}.s{width:1280px;height:640px;display:flex;flex-direction:column;justify-content:center;padding:0 110px;box-sizing:border-box;
      background:radial-gradient(90% 120% at 0% 0%,#ff5f1f40 0%,#ff5f1f00 50%),linear-gradient(135deg,#17191f,#0b0d10);color:#F4F4F5;font-family:${MONO}}
      .t{font-size:40px;font-weight:700;margin-top:44px;line-height:1.3}.t em{font-style:normal;color:${ORANGE}}
      .m{margin-top:30px;color:#8b949e;font-size:24px;letter-spacing:.04em}`,
    body: `<div class="s"><svg viewBox="0 0 ${Math.ceil(150 + w.advance * (64 / w.xHeight))} 128" height="150" width="${Math.round(((150 + w.advance * (64 / w.xHeight)) * 150) / 128)}">${sheen}${mark()}<path transform="translate(150 96) scale(${(64 / w.xHeight).toFixed(5)})" fill="#F4F4F5" d="${w.d}"/></svg>
      <div class="t">Your agent says "all tests pass."<br><em>nocap checks the receipts.</em></div>
      <div class="m">A local black box for coding agents · 100% offline · MIT</div></div>`,
  },
  'social-preview.png',
  '.s',
  { width: 1280, height: 640 },
);

await browser.close();
console.log(`assets written to ${out}`);
