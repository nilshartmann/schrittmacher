import { createServerFn } from '@tanstack/react-start';
import { buildDemoRepo } from '../git/demoGit';
import { DEMO_REPO } from '../git/demoRepo';
import { gitSource } from '../git/gitRepo';
import type { Comparison, RepoSource } from '../git/repo';

let current: Promise<RepoSource> | undefined;

/**
 * Die Quelle des Servers: das Repo im Worktree aus `SCHRITTMACHER_REPO`, ohne die Variable die
 * Testdaten als Repo unter `tmpdir()`. Sie wird einmal angelegt und hält ihre Vergleiche vor. Die
 * Funktionen laufen nur im Server, der Browser ruft sie über HTTP auf.
 */
function source(): Promise<RepoSource> {
  if (current === undefined) {
    const worktree = process.env.SCHRITTMACHER_REPO;
    current =
      worktree === undefined || worktree === ''
        ? buildDemoRepo(DEMO_REPO).then((demo) => gitSource(demo, '06b'))
        : Promise.resolve(gitSource(worktree));
    // Scheitert der Aufbau, versucht es die nächste Anfrage noch einmal.
    current.catch(() => {
      current = undefined;
    });
  }
  return current;
}

export const loadRepo = createServerFn({ method: 'GET' }).handler(async () => (await source()).load());

export const compareCommits = createServerFn({ method: 'GET' })
  .validator((comparison: Comparison) => comparison)
  .handler(async ({ data }) => (await source()).compare(data));

export const repoState = createServerFn({ method: 'GET' }).handler(async () => (await source()).state());
