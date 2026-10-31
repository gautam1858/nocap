import type { SessionAnalysis } from '../analyzers/analyze.js';
import { toDocket, type Docket, type DocketOptions } from './docket.js';
import { MONO, stampColor, THEMES, verdictColor, type Theme, type ThemeName } from './theme.js';

export interface CardOptions extends DocketOptions {
  readonly theme?: ThemeName;
}

const W = 880;
const PAD = 34;
const LINE = 26;
const CHAR = 8.4; // approximate monospace advance at 15px

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const COLS = Math.floor((W - PAD * 2) / CHAR);

interface Line {
  readonly svg: string;
  readonly height: number;
}

/** Renders a self-contained SVG card. No external fonts, scripts or network. */
export function renderCardSvg(analysis: SessionAnalysis, options: CardOptions = {}): string {
  const theme = THEMES[options.theme ?? 'dark'];
  const d = toDocket(analysis, options);
  const lines: Line[] = [];
  let y = 0;

  const push = (svg: string, height: number): void => {
    lines.push({ svg, height });
    y += height;
  };
  const text = (x: number, dy: number, content: string, attrs: string): string =>
    `<text x="${String(x)}" y="${String(y + dy)}" ${attrs} xml:space="preserve">${content}</text>`;

  // Header band.
  const headerH = 78;
  push(
    `<rect x="0" y="0" width="${String(W)}" height="${String(headerH)}" fill="${theme.headerBg}"/>` +
      text(
        PAD,
        30,
        esc('NOCAP · INCIDENT DOCKET'),
        `fill="${theme.accent}" font-weight="700" font-size="13" letter-spacing="3"`,
      ) +
      text(
        PAD,
        56,
        esc(d.subtitle),
        `fill="${theme.headerFg}" font-weight="800" font-size="20" letter-spacing="1"`,
      ) +
      text(
        W - PAD,
        34,
        esc(d.number),
        `fill="${theme.headerMuted}" font-size="13" letter-spacing="1" text-anchor="end"`,
      ) +
      text(
        W - PAD,
        54,
        esc(d.agent),
        `fill="${theme.headerMuted}" font-size="12" letter-spacing="1" text-anchor="end"`,
      ),
    headerH,
  );

  y += 20;
  for (const row of d.rows) {
    push(
      text(PAD, 15, esc(row.key), `fill="${theme.muted}" font-size="13" letter-spacing="1"`) +
        text(
          PAD + 150,
          15,
          esc(row.value),
          `fill="${theme.ink}" font-weight="700" font-size="15"`,
        ) +
        text(PAD + 270, 15, esc(clip(row.note, COLS - 33)), `fill="${theme.muted}" font-size="14"`),
      LINE,
    );
  }

  y += 6;
  push(dashed(theme), 20);

  const c = d.claimsLine;
  const seg = (label: string, n: number, color: string): string =>
    `<tspan fill="${theme.muted}">${esc(label)} </tspan><tspan fill="${color}" font-weight="700">${String(n)}</tspan>`;
  push(
    text(
      PAD,
      15,
      `${seg('CLAIMS', c.audited, theme.ink)}<tspan>   </tspan>${seg('BACKED', c.backed, theme.green)}<tspan>   </tspan>${seg('NARROWED', c.narrowed, theme.amber)}<tspan>   </tspan>${seg('STALE', c.stale, theme.amber)}<tspan>   </tspan>${seg('CONTRADICTED', c.contradicted, theme.red)}`,
      `font-size="13" letter-spacing="1"`,
    ),
    LINE + 4,
  );

  for (const claim of d.claims) {
    const color = verdictColor(theme, claim.verdict);
    push(
      text(PAD, 15, esc(claim.time), `fill="${theme.muted}" font-size="13"`) +
        text(
          PAD + 80,
          15,
          esc(clip(`"${claim.sentence}"`, COLS - 26)),
          `fill="${theme.ink}" font-size="14"`,
        ) +
        text(
          W - PAD,
          15,
          esc(claim.verdictLabel),
          `fill="${color}" font-weight="800" font-size="13" letter-spacing="1" text-anchor="end"`,
        ),
      LINE,
    );
    for (const ev of claim.evidence.slice(0, 2)) {
      push(
        text(
          PAD + 80,
          13,
          esc(`↳ ${clip(ev, COLS - 20)}`),
          `fill="${theme.muted}" font-size="12.5"`,
        ),
        20,
      );
    }
  }
  if (d.hiddenClaims > 0) {
    push(
      text(
        PAD + 80,
        13,
        esc(`+ ${String(d.hiddenClaims)} more`),
        `fill="${theme.muted}" font-size="12.5"`,
      ),
      20,
    );
  }

  y += 6;
  push(dashed(theme), 20);
  push(
    text(PAD, 15, 'TEST INTEGRITY', `fill="${theme.muted}" font-size="13" letter-spacing="1"`) +
      text(
        PAD + 150,
        16,
        esc(d.integrity),
        `fill="${gradeColor(theme, d.integrity)}" font-weight="800" font-size="17"`,
      ) +
      text(PAD + 270, 15, esc(d.integrityNote), `fill="${theme.muted}" font-size="14"`),
    LINE,
  );
  push(
    text(PAD, 15, 'NEAR MISSES', `fill="${theme.muted}" font-size="13" letter-spacing="1"`) +
      text(
        PAD + 150,
        15,
        String(d.nearMisses),
        `fill="${d.nearMisses > 0 ? theme.amber : theme.ink}" font-weight="700" font-size="15"`,
      ) +
      text(
        PAD + 270,
        15,
        esc(d.nearMisses > 0 ? 'blocked by the guard' : 'none'),
        `fill="${theme.muted}" font-size="14"`,
      ),
    LINE,
  );

  // Probable cause block. The box is inset and uses a larger font, so it wraps
  // at fewer columns than the body.
  y += 10;
  const causeLines = wrap(d.probableCause, Math.floor((W - PAD * 2 - 40) / 9.6));
  const causeH = 18 + causeLines.length * 22 + 14;
  const causeText = causeLines
    .map((ln, i) =>
      text(
        PAD + 18,
        30 + i * 22,
        esc(ln),
        `fill="${theme.ink}" font-size="16" font-weight="${i === 0 ? '700' : '400'}"`,
      ),
    )
    .join('');
  push(
    `<rect x="${String(PAD)}" y="${String(y)}" width="${String(W - PAD * 2)}" height="${String(causeH)}" fill="${theme.causeBg}"/>` +
      `<rect x="${String(PAD)}" y="${String(y)}" width="5" height="${String(causeH)}" fill="${theme.accent}"/>` +
      text(
        PAD + 18,
        12,
        'PROBABLE CAUSE',
        `fill="${theme.accent}" font-weight="800" font-size="11" letter-spacing="2"`,
      ) +
      causeText,
    causeH + 10,
  );

  // Footer.
  push(
    text(PAD, 14, esc(d.footerLeft), `fill="${theme.muted}" font-size="12"`) +
      text(
        W - PAD,
        14,
        esc(d.footerRight),
        `fill="${theme.muted}" font-size="12" text-anchor="end"`,
      ),
    28,
  );

  const H = Math.ceil(y + 10);
  const stamp = renderStamp(d, theme, H);
  const body = lines.map((l) => l.svg).join('\n');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(W)} ${String(H)}" width="${String(W)}" height="${String(H)}" font-family="${MONO}" role="img" aria-label="nocap Probable Cause card for ${esc(d.number)}">`,
    `<rect width="${String(W)}" height="${String(H)}" rx="6" fill="${theme.paper}"/>`,
    ruled(theme, H),
    body,
    stamp,
    `</svg>`,
    '',
  ].join('\n');
}

function dashed(theme: Theme): string {
  return `<line x1="${String(PAD)}" y1="8" x2="${String(W - PAD)}" y2="8" stroke="${theme.dashed}" stroke-width="1.4" stroke-dasharray="3 4"/>`;
}

function ruled(theme: Theme, height: number): string {
  const lines: string[] = [];
  for (let yy = 100; yy < height; yy += LINE) {
    lines.push(
      `<line x1="0" y1="${String(yy)}" x2="${String(W)}" y2="${String(yy)}" stroke="${theme.rule}" stroke-width="1"/>`,
    );
  }
  return lines.join('');
}

function gradeColor(theme: Theme, grade: Docket['integrity']): string {
  return grade === 'A' || grade === 'B' ? theme.green : grade === 'C' ? theme.amber : theme.red;
}

function renderStamp(d: Docket, theme: Theme, height: number): string {
  const color = stampColor(theme, d.stamp.tone);
  const cx = W - 180;
  const cy = Math.min(250, height * 0.34);
  const wText = d.stamp.text.length * 15 + 36;
  return (
    `<g transform="translate(${String(cx)} ${String(cy)}) rotate(-11)" opacity="0.8">` +
    `<rect x="${String(-wText / 2)}" y="-26" width="${String(wText)}" height="52" rx="6" fill="none" stroke="${color}" stroke-width="4"/>` +
    `<text x="0" y="9" fill="${color}" font-weight="800" font-size="27" letter-spacing="3" text-anchor="middle">${esc(d.stamp.text)}</text>` +
    `</g>`
  );
}

function wrap(text: string, cols: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > cols && current) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
}

/** A self-contained HTML card: the SVG inlined, centred on a neutral backdrop. */
export function renderCardHtml(analysis: SessionAnalysis, options: CardOptions = {}): string {
  const theme = options.theme ?? 'dark';
  const svg = renderCardSvg(analysis, options);
  const d = toDocket(analysis, options);
  const bg = theme === 'dark' ? '#0b0d10' : '#e9e4d8';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>nocap — ${esc(d.number)}</title>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>html,body{margin:0;height:100%}body{background:${bg};display:flex;align-items:center;justify-content:center;padding:32px;box-sizing:border-box}svg{max-width:100%;height:auto;box-shadow:0 20px 60px rgba(0,0,0,0.4);border-radius:6px}</style>`,
    '</head>',
    `<body>${svg}</body>`,
    '</html>',
    '',
  ].join('\n');
}

export type { ThemeName };
