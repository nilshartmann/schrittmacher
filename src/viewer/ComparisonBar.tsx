import type { Comparison } from '../git/repo';
import type { Commit } from '../git/types';

/**
 * Die Zeile unter der Commit-Liste beim Vergleich zweier Commits, wie in Fork: je Commit Autor, SHA,
 * Datum und Titel, der ältere oben. Die SHAs haben die Farben der entfernten und der neuen Zeilen,
 * weil der ältere Commit die linke und der neuere die rechte Seite des Diffs ist. Ohne zweiten
 * Commit fehlt die Zeile, weil die Liste den Vergleich dann allein zeigt.
 */
export function ComparisonBar({ commits, comparison }: { commits: Commit[]; comparison: Comparison }) {
  const from = commits.find((commit) => commit.sha === comparison.from);
  const to = commits.find((commit) => commit.sha === comparison.to);
  if (from === undefined || to === undefined) {
    return null;
  }
  return (
    <section className="comparison" aria-label="Vergleich zweier Commits">
      <ComparedCommit commit={from} side="old" />
      <ComparedCommit commit={to} side="new" />
    </section>
  );
}

function ComparedCommit({ commit, side }: { commit: Commit; side: 'old' | 'new' }) {
  return (
    <div className="compared">
      <span className="compared-author">{commit.author}</span>
      <span className={`compared-sha compared-sha-${side}`}>{commit.sha.slice(0, 10)}</span>
      <span className="compared-date">{commit.date}</span>
      <span className="compared-title">
        {commit.step !== null && <b>{commit.step}: </b>}
        {commit.title}
      </span>
    </div>
  );
}
