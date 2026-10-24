import type { Commit, DiffFile, Ref, RepoInfo, Worktree } from './types';

/** Ein Vergleich von `from` nach `to`. Ohne `from` ist der Vorgänger von `to` gemeint. */
export interface Comparison {
  from: string | null;
  to: string;
}

/** Was die Oberfläche von einem Repo braucht: Kopfzeile, Commits und Branches. */
export interface RepoData {
  info: RepoInfo;
  /** Die Commits vom ersten zum letzten. */
  commits: Commit[];
  refs: Ref[];
  /** Der Commit, den die Oberfläche ohne Wahl zeigt: der neueste. */
  start: string;
  /** Der Stand des Repos beim Laden, wie ihn `RepoSource.state` liefert. */
  state: string;
}

/** Eine Quelle für Repo und Vergleiche. */
export interface RepoSource {
  /** Repo und Commits eines Branches; ohne Branch die Commits von `HEAD`. */
  load: (branch: string | null) => Promise<RepoData>;
  /** Die Dateien, die sich unterscheiden, nach Pfad sortiert, vom älteren zum neueren Commit. */
  compare: (comparison: Comparison) => Promise<DiffFile[]>;
  /**
   * Ein Text, der sich ändert, sobald sich Commits oder Branches ändern. Die Oberfläche fragt ihn
   * regelmäßig ab und lädt das Repo neu, wenn er nicht mehr zu `RepoData.state` passt.
   */
  state: () => Promise<string>;
  worktrees: () => Promise<Worktree[]>;
}

/**
 * Der Vergleich, nachdem das Repo neu geladen wurde, etwa nach einem neuen Commit oder einem
 * Rebase. Ein Commit, den es noch gibt, bleibt gewählt. Für einen umgeschriebenen gilt der neueste
 * Commit mit derselben Nummer des Schritts, ohne Schritt der mit demselben Titel. Fehlt er, zeigt
 * die Oberfläche wieder den Commit `start`. Ein unveränderter Vergleich bleibt dasselbe Objekt.
 */
export function followComparison(
  comparison: Comparison,
  before: Commit[],
  after: Commit[],
  start: string,
): Comparison {
  const follow = (sha: string): string | null => {
    if (after.some((commit) => commit.sha === sha)) {
      return sha;
    }
    const old = before.find((commit) => commit.sha === sha);
    if (old === undefined) {
      return null;
    }
    const same = after.findLast((commit) =>
      old.step === null ? commit.step === null && commit.title === old.title : commit.step === old.step,
    );
    return same?.sha ?? null;
  };
  const to = follow(comparison.to);
  if (to === null) {
    return { from: null, to: start };
  }
  const from = comparison.from === null ? null : follow(comparison.from);
  if (to === comparison.to && from === comparison.from) {
    return comparison;
  }
  return { from: from === to ? null : from, to };
}

/**
 * Die Kennung eines Commits in der URL und im Gedächtnis einer Ansicht: die Nummer des Schritts,
 * ohne Schritt die ersten sieben Zeichen des SHA. Eine Nummer übersteht einen Rebase.
 */
export function commitKey(commit: Commit): string {
  return commit.step ?? commit.sha.slice(0, 7);
}

/** Der Commit zu einer Kennung: der neueste mit dieser Nummer, sonst der mit diesem Anfang des SHA. */
export function findCommit(commits: Commit[], key: string): Commit | undefined {
  return (
    commits.findLast((commit) => commit.step === key) ??
    (key.length >= 7 ? commits.find((commit) => commit.sha.startsWith(key)) : undefined)
  );
}
