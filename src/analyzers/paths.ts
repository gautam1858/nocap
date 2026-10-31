/** Shows a path relative to the session's working directory, so neither the
 * audit nor the card leaks an absolute path. Paths outside the cwd, and ones
 * already rewritten to ~, are left as they are. */
export function displayPath(path: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return path;
  const root = cwd.replace(/\/+$/, '');
  if (path === root) return '.';
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
