import { join } from 'node:path';

export interface GuardEnv {
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
}

export function nocapHome({ home, env }: GuardEnv): string {
  return env.NOCAP_HOME ?? join(home, '.nocap');
}

export function guardDir(e: GuardEnv): string {
  return join(nocapHome(e), 'guard');
}

export function stateDir(e: GuardEnv): string {
  return join(guardDir(e), 'state');
}

export function nearMissLog(e: GuardEnv): string {
  return join(guardDir(e), 'near-misses.jsonl');
}
