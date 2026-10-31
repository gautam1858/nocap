import type { Verdict } from '../analyzers/polygraph.js';
import type { Docket } from './docket.js';

export type ThemeName = 'light' | 'dark';

export interface Theme {
  readonly paper: string;
  readonly ink: string;
  readonly muted: string;
  readonly headerBg: string;
  readonly headerFg: string;
  readonly headerMuted: string;
  readonly dashed: string;
  readonly rule: string;
  readonly accent: string;
  readonly green: string;
  readonly amber: string;
  readonly red: string;
  readonly causeBg: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  light: {
    paper: '#F6F2E8',
    ink: '#1b1b1b',
    muted: '#6b665c',
    headerBg: '#121214',
    headerFg: '#F6F2E8',
    headerMuted: '#9aa0a6',
    dashed: '#b9b2a3',
    rule: 'rgba(0,0,0,0.03)',
    accent: '#FF5F1F',
    green: '#1f7a35',
    amber: '#b45309',
    red: '#c2410c',
    causeBg: '#ece6d6',
  },
  dark: {
    paper: '#14161b',
    ink: '#E6E6E6',
    muted: '#8b949e',
    headerBg: '#0b0d10',
    headerFg: '#F4F4F5',
    headerMuted: '#7d8590',
    dashed: '#30363d',
    rule: 'rgba(255,255,255,0.03)',
    accent: '#FF7A1A',
    green: '#3FB950',
    amber: '#E3B341',
    red: '#FF7B72',
    causeBg: '#1c2027',
  },
};

export function verdictColor(theme: Theme, verdict: Verdict): string {
  switch (verdict) {
    case 'BACKED':
      return theme.green;
    case 'CONTRADICTED':
      return theme.red;
    case 'STALE':
    case 'NARROWED':
      return theme.amber;
    case 'NO_EVIDENCE':
      return theme.muted;
  }
}

export function stampColor(theme: Theme, tone: Docket['stamp']['tone']): string {
  return tone === 'red'
    ? theme.red
    : tone === 'amber'
      ? theme.amber
      : tone === 'green'
        ? theme.green
        : theme.muted;
}

export const MONO =
  "ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";
