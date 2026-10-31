export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  /** International orange, the colour of real flight recorders. */
  accent(text: string): string;
}

const wrap =
  (open: string, close: string) =>
  (text: string): string =>
    `\u001b[${open}m${text}\u001b[${close}m`;

export const plain: Style = {
  bold: (t) => t,
  dim: (t) => t,
  red: (t) => t,
  green: (t) => t,
  yellow: (t) => t,
  accent: (t) => t,
};

const ansi: Style = {
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  red: wrap('31', '39'),
  green: wrap('32', '39'),
  yellow: wrap('33', '39'),
  accent: wrap('38;5;208', '39'),
};

/** Follows https://no-color.org and the FORCE_COLOR convention; otherwise colour only on a terminal. */
export function colorEnabled(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false';
  if (env.TERM === 'dumb') return false;
  return stream.isTTY === true;
}

export function styleFor(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv = process.env): Style {
  return colorEnabled(stream, env) ? ansi : plain;
}

/** A report row: an aligned, dimmed label followed by its value. */
export function field(style: Style, label: string, value: string): string {
  return `  ${style.dim(label.padEnd(10))}${value}`;
}
