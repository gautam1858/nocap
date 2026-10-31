import { describe, expect, it } from 'vitest';
import { checkCommand } from '../../src/guard/destructive.js';

const PROJECT = '/home/dev/app';
const rule = (command: string, project: string | undefined = PROJECT) =>
  checkCommand(command, project)?.rule;

describe('destructive command detection', () => {
  it.each([
    ['rm -rf /', 'destructive-rm'],
    ['rm -rf /etc', 'destructive-rm'],
    ['rm -rf ~', 'destructive-rm'],
    ['rm -rf ~/Documents', 'destructive-rm'],
    ['rm -rf $HOME/stuff', 'destructive-rm'],
    ['rm -rf "$DIR/"', 'destructive-rm'],
    ['sudo rm -rf /var', 'destructive-rm'],
    ['rm -rf /home/dev/other', 'destructive-rm'],
    ['cd /tmp && rm -rf ../../etc', 'destructive-rm'],
    ['rm -fr /usr', 'destructive-rm'],
    ['rm --recursive --force /opt', 'destructive-rm'],
    ['psql -c "DROP TABLE users"', 'sql-drop'],
    ['mysql -e "TRUNCATE TABLE sessions"', 'sql-drop'],
    ['psql -c "DELETE FROM users"', 'sql-delete-all'],
    ['terraform destroy -auto-approve', 'infra-destroy'],
    ['tofu destroy', 'infra-destroy'],
    ['pulumi destroy --yes', 'infra-destroy'],
    ['kubectl delete namespace prod', 'k8s-delete'],
    ['helm uninstall api', 'k8s-delete'],
    ['railway down', 'paas-delete'],
    ['flyctl apps destroy myapp', 'paas-delete'],
    ['heroku apps:destroy -a prod', 'paas-delete'],
    ['vercel rm my-deployment', 'paas-delete'],
    ['supabase db reset', 'paas-delete'],
    ['aws s3 rb s3://bucket --force', 'cloud-delete'],
    ['gcloud sql instances delete prod-db', 'cloud-delete'],
    ['docker system prune -a -f', 'docker-prune'],
    ['docker volume rm data', 'docker-prune'],
    ['git push --force origin main', 'force-push'],
    ['git push -f origin master', 'force-push'],
    ['git push origin :main', 'branch-delete-remote'],
    [':(){ :|:& };:', 'fork-bomb'],
    ['dd if=/dev/zero of=/dev/sda bs=1M', 'disk-wipe'],
    ['mkfs.ext4 /dev/nvme0n1', 'disk-wipe'],
    ['chmod -R 777 /', 'chmod-root'],
    ['git clean -fdx', 'git-clean-all'],
  ])('blocks %s', (command, expected) => {
    expect(rule(command)).toBe(expected);
  });

  it.each([
    'rm -rf node_modules',
    'rm -rf ./dist',
    'rm -rf build/*',
    'rm -rf /home/dev/app/tmp',
    'rm -rf src/generated',
    'rm file.txt',
    'rm -f stale.log',
    'npm test',
    'git commit -m "fix"',
    'git push origin feature/x',
    'git push --force-with-lease origin main',
    'psql -c "SELECT * FROM users"',
    'psql -c "DELETE FROM users WHERE id = 1"',
    'kubectl get pods',
    'docker ps -a',
    'terraform plan',
    'ls -la && cat README.md',
    'echo "rm -rf /" >> notes.txt',
  ])('allows %s', (command) => {
    expect(rule(command)).toBeUndefined();
  });

  it('blocks an absolute rm outside the project even when the project is unknown', () => {
    expect(rule('rm -rf /etc', undefined)).toBe('destructive-rm');
  });

  it('allows a project-relative rm when the project is unknown', () => {
    expect(rule('rm -rf dist', undefined)).toBeUndefined();
  });
});
