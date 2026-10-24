import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Ein Repo, gefunden in einer Wurzel oder zuletzt geöffnet. */
export interface RepoEntry {
  name: string;
  /** Der Ordner, in dem `.git` liegt; zugleich der Pfad des ersten Worktrees. */
  path: string;
}

/** So tief wird unter einer Wurzel gesucht, etwa `~/develop/talk/2026-wjax/repo`. */
const DEPTH = 3;

/** Ordner, in denen kein Repo eines Workshops liegt und deren Inhalt groß sein kann. */
const SKIPPED = new Set(['node_modules', 'target', 'build', 'dist']);

/**
 * Die Repos unter den Wurzeln, nach Name sortiert. Ein Ordner mit dem Verzeichnis `.git` ist ein
 * Repo. Darunter wird weiter gesucht, weil ein Repo für einen Workshop die Repos der Teilnehmer
 * enthalten kann. Ein Ordner mit der Datei `.git` ist ein Worktree oder ein Submodul und gehört zu
 * einem anderen Repo. Versteckte Ordner bleiben außen vor.
 */
export async function findRepos(roots: string[]): Promise<RepoEntry[]> {
  const found: RepoEntry[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Ein Ordner ohne Leserecht oder eine Wurzel, die es nicht gibt, enthält kein Repo.
      return;
    }
    const git = entries.find((entry) => entry.name === '.git');
    if (git?.isDirectory() === true) {
      found.push({ name: basename(dir), path: dir });
    } else if (git !== undefined) {
      return;
    }
    if (depth === DEPTH) {
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name))
        .map((entry) => visit(join(dir, entry.name), depth + 1)),
    );
  };
  await Promise.all(roots.map((root) => visit(root, 0)));
  const unique = new Map(found.map((entry) => [entry.path, entry]));
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}
