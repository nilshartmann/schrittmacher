import { diffLines } from './diff';
import { markParts } from './lineParts';
import type { Commit, DiffFile, Ref, RepoInfo } from './types';

/** Ein Commit mit den Dateien, die er ändert. Eine Datei mit `null` wird gelöscht. */
export interface StoredCommit extends Commit {
  files: Record<string, string | null>;
}

/** Ein Repo im Speicher, wie es der Dummy statt Git benutzt. */
export interface MemoryRepo {
  info: RepoInfo;
  /** Die Commits vom ersten zum letzten. */
  commits: StoredCommit[];
  /** Die Branches mit dem Commit, auf den sie zeigen. */
  refs: Ref[];
}

/** Ein Vergleich von `from` nach `to`. Ohne `from` ist der Vorgänger von `to` gemeint. */
export interface Comparison {
  from: string | null;
  to: string;
}

function indexOf(repo: MemoryRepo, sha: string): number {
  const index = repo.commits.findIndex((commit) => commit.sha === sha);
  if (index < 0) {
    throw new Error(`Commit '${sha}' gibt es im Repo nicht.`);
  }
  return index;
}

/** Der Stand aller Dateien nach dem Commit, leer vor dem ersten. */
function snapshot(repo: MemoryRepo, index: number): Map<string, string> {
  const files = new Map<string, string>();
  for (const commit of repo.commits.slice(0, index + 1)) {
    for (const [path, text] of Object.entries(commit.files)) {
      if (text === null) {
        files.delete(path);
      } else {
        files.set(path, text);
      }
    }
  }
  return files;
}

/**
 * Der Vergleich einer Datei, mit den Teilen jeder geänderten Zeile, die sich von ihrer Partnerzeile
 * unterscheiden. Eine Seite ohne die Datei ist `null`; gibt es sie auf beiden Seiten, hat sie sich
 * geändert.
 */
export function fileDiff(path: string, oldText: string | null, newText: string | null): DiffFile {
  const whole = diffLines(oldText ?? '', newText ?? '');
  markParts(whole);
  return {
    path,
    kind: oldText === null ? 'added' : newText === null ? 'deleted' : 'changed',
    added: whole.filter((line) => line.kind === 'added').length,
    removed: whole.filter((line) => line.kind === 'removed').length,
    whole,
    oldText: oldText ?? '',
    newText: newText ?? '',
  };
}

/** Was die Oberfläche von einem Repo braucht: Kopfzeile, Commits und Branches. */
export interface RepoData {
  info: RepoInfo;
  /** Die Commits vom ersten zum letzten. */
  commits: Commit[];
  refs: Ref[];
  /** Der Commit, den die Oberfläche zuerst zeigt. */
  start: string;
}

/** Eine Quelle für Repo und Vergleiche: das Repo im Speicher oder ein echtes über Git. */
export interface RepoSource {
  load: () => Promise<RepoData>;
  /** Die Dateien, die sich unterscheiden, nach Pfad sortiert, vom älteren zum neueren Commit. */
  compare: (comparison: Comparison) => Promise<DiffFile[]>;
}

/** Das Repo im Speicher als Quelle, für die Testdaten und die Screenshots. */
export function memorySource(repo: MemoryRepo, start: string): RepoSource {
  return {
    load: () =>
      Promise.resolve({
        info: repo.info,
        commits: repo.commits.map(({ files: _files, ...commit }) => commit),
        refs: repo.refs,
        start,
      }),
    compare: (comparison) => Promise.resolve(compare(repo, comparison)),
  };
}

/**
 * Die Dateien, die sich zwischen beiden Commits unterscheiden, nach Pfad sortiert. Liegt `from`
 * nach `to`, werden beide getauscht, damit der Vergleich immer vom älteren zum neueren läuft.
 */
function compare(repo: MemoryRepo, comparison: Comparison): DiffFile[] {
  const toIndex = indexOf(repo, comparison.to);
  const fromIndex = comparison.from === null ? toIndex - 1 : indexOf(repo, comparison.from);
  const older = snapshot(repo, Math.min(fromIndex, toIndex));
  const newer = snapshot(repo, Math.max(fromIndex, toIndex));
  const paths = [...new Set([...older.keys(), ...newer.keys()])].sort();
  return paths
    .filter((path) => older.get(path) !== newer.get(path))
    .map((path) => fileDiff(path, older.get(path) ?? null, newer.get(path) ?? null));
}
