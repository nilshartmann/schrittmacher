import type { Comparison } from '../git/repo';
import type { Commit, RepoInfo } from '../git/types';
import { stepLabel } from './CommitList';

/**
 * Wie der Diff steht: beide Seiten mit dem Anteil der linken, oder alle Zeilen untereinander, mit
 * oder ohne die entfernten Zeilen.
 */
export type Layout = { mode: 'split'; share: number } | { mode: 'unified'; showRemoved: boolean };

interface HeaderProps {
  info: RepoInfo;
  commits: Commit[];
  comparison: Comparison;
  fontSize: number;
  onFontSize: (change: number) => void;
  filesOpen: boolean;
  onFilesOpen: () => void;
}

/**
 * Die schmale Kopfzeile: links Repo, Worktree, Branch und der gewählte Vergleich, rechts die
 * Schriftgröße.
 * Ganz links klappt ein Knopf die Dateiliste ein und aus.
 */
export function Header(props: HeaderProps) {
  const { info, commits, comparison } = props;
  const to = commits.find((commit) => commit.sha === comparison.to);
  const toIndex = to === undefined ? -1 : commits.indexOf(to);
  const from =
    comparison.from === null
      ? commits[toIndex - 1]
      : commits.find((commit) => commit.sha === comparison.from);
  return (
    <header className="header">
      <button
        type="button"
        className="tool"
        aria-pressed={props.filesOpen}
        aria-label="Dateiliste"
        data-tip={props.filesOpen ? 'Dateiliste einklappen' : 'Dateiliste zeigen'}
        onClick={props.onFilesOpen}
      >
        <SidebarIcon />
      </button>
      <div className="header-where">
        <span className="header-repo" data-tip={info.repo}>
          {info.repo}
        </span>
        <span className="header-sep">/</span>
        <span data-tip="Worktree">⌂ {info.worktree}</span>
        <span className="header-sep">/</span>
        <span data-tip="Branch">⑂ {info.branch}</span>
      </div>
      <div
        className={comparison.from === null ? 'header-comparison' : 'header-comparison header-comparison-free'}
        data-tip={to === undefined ? undefined : to.title}
      >
        <span className="header-step">{from === undefined ? '∅' : stepLabel(from)}</span>
        <span className="header-arrow">→</span>
        <span className="header-step">{to === undefined ? '' : stepLabel(to)}</span>
        {to !== undefined && comparison.from === null && <span className="header-title">{to.title}</span>}
      </div>
      <div className="header-tools">
        <div className="segmented" role="group" aria-label="Schriftgröße">
          <button
            type="button"
            data-tip="Schrift kleiner"
            onClick={() => {
              props.onFontSize(-1);
            }}
          >
            A−
          </button>
          <span className="segmented-value">{props.fontSize}</span>
          <button
            type="button"
            data-tip="Schrift größer"
            onClick={() => {
              props.onFontSize(1);
            }}
          >
            A+
          </button>
        </div>
      </div>
    </header>
  );
}

/** Das Symbol einer Seitenleiste wie in macOS: ein Rahmen mit einem Streifen links. */
function SidebarIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
      <rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="7" y1="1.5" x2="7" y2="14.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
