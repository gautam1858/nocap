// node:sqlite prints an ExperimentalWarning on first use in Node 22 and 24.
// It is noise for CLI users; every other warning still gets through. This
// module must be imported before anything that loads node:sqlite.
const emitWarning = process.emitWarning.bind(process);

process.emitWarning = (warning: string | Error, ...rest: unknown[]): void => {
  const message = typeof warning === 'string' ? warning : warning.message;
  const type =
    typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
  const name = typeof warning === 'string' ? type : warning.name;
  if (name === 'ExperimentalWarning' && message.includes('SQLite')) return;
  (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
};
