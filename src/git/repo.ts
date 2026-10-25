import type { Hidden } from './hidden';
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
  /** Ob die Liste die Commits aller Branches enthält, die nicht ausgeblendet sind. */
  all: boolean;
  /** Der Commit, den die Oberfläche ohne Wahl zeigt: der neueste des Branches. */
  start: string;
  /** Der Stand des Repos beim Laden, wie ihn `RepoSource.state` liefert. */
  state: string;
}

/** Welche Commits außer denen des Branches geladen werden. */
export interface LoadOptions {
  /** Auch die Commits aller anderen Branches, außer den ausgeblendeten. */
  all: boolean;
  hidden: Hidden;
}

/** Eine Quelle für Repo und Vergleiche. */
export interface RepoSource {
  /** Repo und Commits eines Branches; ohne Branch die Commits von `HEAD`. */
  load: (branch: string | null, options: LoadOptions) => Promise<RepoData>;
  /** Die Dateien, die sich unterscheiden, nach Pfad sortiert, vom älteren zum neueren Commit. */
  compare: (comparison: Comparison) => Promise<DiffFile[]>;
  /**
   * Ein Text, der sich ändert, sobald sich Commits oder Branches ändern. Die Oberfläche fragt ihn
   * regelmäßig ab und lädt das Repo neu, wenn er nicht mehr zu `RepoData.state` passt.
   */
  state: () => Promise<string>;
  worktrees: () => Promise<Worktree[]>;
  /** Die lokalen Branches und die der Remotes, ohne ihre Commits zu laden. */
  branches: () => Promise<Ref[]>;
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
 * Die SHAs der Commits, die vom Commit `tip` aus erreichbar sind, ihn selbst eingeschlossen. Mit
 * `tip` als Spitze des Branches sind das seine Commits, auch wenn die Liste die aller Branches
 * zeigt.
 */
export function reachable(commits: Commit[], tip: string): ReadonlySet<string> {
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const found = new Set<string>();
  const open = [tip];
  for (let sha = open.pop(); sha !== undefined; sha = open.pop()) {
    const commit = bySha.get(sha);
    if (commit !== undefined && !found.has(sha)) {
      found.add(sha);
      open.push(...commit.parents);
    }
  }
  return found;
}

/** Der Vorgänger eines Commits in der Liste: sein erster Parent, falls die Liste ihn enthält. */
export function previousOf(commits: Commit[], commit: Commit): Commit | undefined {
  const parent = commit.parents[0];
  return parent === undefined ? undefined : commits.find((candidate) => candidate.sha === parent);
}

/**
 * Die Kennung eines Commits in der URL und im Gedächtnis einer Ansicht: die Nummer des Schritts,
 * ohne Schritt die ersten sieben Zeichen des SHA. Eine Nummer übersteht einen Rebase. Findet die
 * Nummer einen anderen Commit, etwa denselben Schritt auf `live_coding`, gilt der SHA.
 */
export function commitKey(commit: Commit, commits: Commit[], line: ReadonlySet<string>): string {
  const sha = commit.sha.slice(0, 7);
  if (commit.step === null) {
    return sha;
  }
  return findCommit(commits, commit.step, line)?.sha === commit.sha ? commit.step : sha;
}

/**
 * Der Commit zu einer Kennung: der neueste mit dieser Nummer, sonst der mit diesem Anfang des SHA.
 * Eine Nummer sucht zuerst unter den Commits des Branches (`line`).
 */
export function findCommit(commits: Commit[], key: string, line: ReadonlySet<string>): Commit | undefined {
  return (
    commits.findLast((commit) => commit.step === key && line.has(commit.sha)) ??
    commits.findLast((commit) => commit.step === key) ??
    (key.length >= 7 ? commits.find((commit) => commit.sha.startsWith(key)) : undefined)
  );
}
