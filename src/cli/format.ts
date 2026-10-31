export function count(n: number): string {
  return n.toLocaleString('en-US');
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count(n)} ${n === 1 ? singular : pluralForm}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'TB'}`;
}

/** "github-token 2, jwt 1", largest first. */
export function tally(counts: ReadonlyMap<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => `${key} ${count(n)}`)
    .join(', ');
}

export function sum(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const n of counts.values()) total += n;
  return total;
}
