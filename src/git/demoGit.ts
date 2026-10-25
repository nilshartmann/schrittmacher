import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { MemoryRepo, StoredCommit } from './demoRepo';
import { runGit } from './process';

/** Das Verzeichnis mit den Testdaten; es wird bei jedem Start des Servers neu angelegt. */
export const DEMO_BASE = join(tmpdir(), 'schrittmacher-testdaten');

/**
 * Die Umgebung für den Aufbau. Ohne die Konfiguration des Benutzers laufen keine Hooks und keine
 * Signaturen, und mit festen Namen und Zeitpunkten sind die SHAs bei jedem Aufbau dieselben.
 */
function environment(date: string): Record<string, string> {
  return {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Nils Hartmann',
    GIT_AUTHOR_EMAIL: 'testdaten@schrittmacher.invalid',
    GIT_COMMITTER_NAME: 'Nils Hartmann',
    GIT_COMMITTER_EMAIL: 'testdaten@schrittmacher.invalid',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

/**
 * Baut die Testdaten als echtes Repo auf und liefert den Pfad des Worktrees mit dem Branch der
 * Commits. Daneben liegt das Repo selbst, mit einem anderen Branch ausgecheckt, wie bei einem
 * Workshop mit Worktrees. Geschrieben wird dabei nur im eigenen Verzeichnis unter `tmpdir()`.
 */
export async function buildDemoRepo(repo: MemoryRepo): Promise<string> {
  const main = join(DEMO_BASE, repo.info.repo);
  const worktree = join(DEMO_BASE, `${repo.info.repo}-worktrees`, repo.info.branch);
  await rm(DEMO_BASE, { recursive: true, force: true });
  await mkdir(main, { recursive: true });
  const git = (args: string[], date = repo.commits[0]?.date ?? '') => runGit(main, args, environment(date));

  await git(['init', '--quiet', `--initial-branch=${repo.info.branch}`]);
  const shas = new Map<string, string>();
  const commit = async (stored: StoredCommit) => {
    for (const [path, text] of Object.entries(stored.files)) {
      const file = join(main, path);
      if (text === null) {
        await rm(file);
      } else {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, text);
      }
    }
    const message = stored.step === null ? stored.title : `${stored.step}: ${stored.title}`;
    await git(['add', '--all']);
    await git(['commit', '--quiet', '--no-verify', `--message=${message}`], stored.date);
    shas.set(stored.sha, (await git(['rev-parse', 'HEAD'])).trim());
  };
  for (const stored of repo.commits) {
    await commit(stored);
  }
  for (const side of repo.side) {
    const base = shas.get(side.base);
    if (base === undefined) {
      throw new Error(`Ein Branch zweigt bei einem Commit ab, den es nicht gibt: ${side.base}`);
    }
    await git(['switch', '--quiet', '--detach', base]);
    for (const stored of side.commits) {
      await commit(stored);
    }
  }

  for (const ref of repo.refs) {
    const sha = shas.get(ref.sha);
    if (sha === undefined) {
      throw new Error(`Der Branch '${ref.name}' zeigt auf einen Commit, den es nicht gibt.`);
    }
    if (ref.kind === 'remote') {
      await git(['update-ref', `refs/remotes/${ref.name}`, sha]);
    } else if (ref.name !== repo.info.branch) {
      await git(['branch', ref.name, sha]);
    }
  }
  const other = repo.refs.find((ref) => ref.kind === 'local' && ref.name !== repo.info.branch);
  await git(other === undefined ? ['switch', '--quiet', '--detach'] : ['switch', '--quiet', other.name]);
  await git(['worktree', 'add', '--quiet', worktree, repo.info.branch]);
  return worktree;
}
