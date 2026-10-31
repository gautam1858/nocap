export interface Writer {
  write(chunk: string): unknown;
  readonly isTTY?: boolean;
}

export interface Io {
  readonly stdout: Writer;
  readonly stderr: Writer;
}

export const ExitCode = {
  ok: 0,
  failure: 1,
  usage: 2,
} as const;
