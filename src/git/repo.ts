import type { Commit, DiffFile, Ref, RepoInfo } from './types';

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
  /** Der Commit, den die Oberfläche zuerst zeigt. */
  start: string;
  /** Der Stand des Repos beim Laden, wie ihn `RepoSource.state` liefert. */
  state: string;
}

/** Eine Quelle für Repo und Vergleiche. */
export interface RepoSource {
  load: () => Promise<RepoData>;
  /** Die Dateien, die sich unterscheiden, nach Pfad sortiert, vom älteren zum neueren Commit. */
  compare: (comparison: Comparison) => Promise<DiffFile[]>;
  /**
   * Ein Text, der sich ändert, sobald sich Commits oder Branches ändern. Die Oberfläche fragt ihn
   * regelmäßig ab und lädt das Repo neu, wenn er nicht mehr zu `RepoData.state` passt.
   */
  state: () => Promise<string>;
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
