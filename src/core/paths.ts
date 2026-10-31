import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Environment {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
}

export function currentEnvironment(): Environment {
  return { env: process.env, home: process.env.HOME ?? homedir() };
}

/** Where nocap keeps its archive and index. Never inside an agent's directory. */
export function nocapHome({ env, home }: Environment): string {
  return env.NOCAP_HOME ?? join(home, '.nocap');
}

export function archiveDir(environment: Environment): string {
  return join(nocapHome(environment), 'archive');
}

export function databasePath(environment: Environment): string {
  return join(nocapHome(environment), 'nocap.sqlite');
}
