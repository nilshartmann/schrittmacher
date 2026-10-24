import { createServerFn } from '@tanstack/react-start';
import { DEMO_REPO } from '../git/demoRepo';
import { gitSource } from '../git/gitRepo';
import { memorySource } from '../git/repo';
import type { Comparison, RepoSource } from '../git/repo';

/**
 * Die Quelle des Servers: das Repo im Worktree aus `SCHRITTMACHER_REPO`, ohne die Variable die
 * Testdaten. Die Funktionen laufen nur im Server, der Browser ruft sie über HTTP auf.
 */
function source(): RepoSource {
  const worktree = process.env.SCHRITTMACHER_REPO;
  return worktree === undefined || worktree === ''
    ? memorySource(DEMO_REPO, 'a6d3e81')
    : gitSource(worktree);
}

export const loadRepo = createServerFn({ method: 'GET' }).handler(() => source().load());

export const compareCommits = createServerFn({ method: 'GET' })
  .validator((comparison: Comparison) => comparison)
  .handler(({ data }) => source().compare(data));
