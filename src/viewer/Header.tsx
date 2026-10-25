import type { Hidden } from '../git/hidden';
import { LOCAL, previousOf } from '../git/repo';
import type { Comparison } from '../git/repo';
import type { Commit, Ref, RepoInfo, Worktree } from '../git/types';
import type { ViewSearch } from '../server/store';
import { stepLabel } from './CommitList';
import { BranchMenu, RecentMenu, RepoMenu, WorktreeMenu } from './ViewMenus';
import type { OpenView } from './ViewMenus';

/**
 * Wie der Diff steht: beide Seiten mit dem Anteil der linken, oder alle Zeilen untereinander, mit
 * oder ohne die entfernten Zeilen.
 */
export type Layout = { mode: 'split'; share: number } | { mode: 'unified'; showRemoved: boolean };

interface HeaderProps {
  info: RepoInfo;
  worktrees: Worktree[];
  refs: Ref[];
  hidden: Hidden;
  onToggleHidden: (path: string) => void;
  commits: Commit[];
  /** Der neueste Commit des Branches; die lokalen Änderungen gelten gegen ihn. */
  start: string;
  comparison: Comparison;
  allBranches: boolean;
  onAllBranches: () => void;
  fontSize: number;
  onFontSize: (change: number) => void;
  filesOpen: boolean;
  onFilesOpen: () => void;
  onOpen: OpenView;
  onShow: (view: ViewSearch) => void;
}

/**
 * Die schmale Kopfzeile: links die Knöpfe für Dateiliste und zuletzt geöffnete Ansichten, dann
 * Repo, Worktree und Branch, je mit einem Menü, und der gewählte Vergleich; rechts die
 * Schriftgröße.
 */
export function Header(props: HeaderProps) {
  const { info, commits, comparison } = props;
  const local = comparison.to === LOCAL;
  const to = commits.find((commit) => commit.sha === comparison.to);
  const from = local
    ? commits.find((commit) => commit.sha === props.start)
    : comparison.from === null
      ? to === undefined
        ? undefined
        : previousOf(commits, to)
      : commits.find((commit) => commit.sha === comparison.from);
  const title = local ? 'Lokale Änderungen' : to?.title;
  return (
    <header className="header">
      <div className="header-start">
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
        <RecentMenu info={info} />
        <button
          type="button"
          className="tool"
          aria-pressed={props.allBranches}
          aria-label="Alle Branches"
          data-tip={
            props.allBranches
              ? `Nur die Commits von ${info.branch ?? 'HEAD'} zeigen`
              : 'Die Commits aller Branches zeigen, außer den ausgeblendeten'
          }
          onClick={props.onAllBranches}
        >
          <GraphIcon />
        </button>
      </div>
      <div className="header-where">
        <RepoMenu info={info} onShow={props.onShow} />
        <span className="header-sep">/</span>
        <WorktreeMenu info={info} worktrees={props.worktrees} onOpen={props.onOpen} />
        <span className="header-sep">/</span>
        <BranchMenu
          info={info}
          refs={props.refs}
          hidden={props.hidden}
          onToggleHidden={props.onToggleHidden}
          onOpen={props.onOpen}
        />
      </div>
      <div
        className={comparison.from === null ? 'header-comparison' : 'header-comparison header-comparison-free'}
        data-tip={title}
      >
        <span className="header-step">{from === undefined ? '∅' : stepLabel(from)}</span>
        <span className="header-arrow">→</span>
        <span className="header-step">{local ? 'Lokal' : to === undefined ? '' : stepLabel(to)}</span>
        {title !== undefined && comparison.from === null && <span className="header-title">{title}</span>}
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

/**
 * Die Kopfzeile, solange keine Ansicht offen ist, etwa beim allerersten Start: nur die zuletzt
 * geöffneten Ansichten und das Repo, dessen Menü schon offen ist.
 */
export function EmptyHeader({ onShow }: { onShow: (view: ViewSearch) => void }) {
  return (
    <header className="header">
      <div className="header-start">
        <RecentMenu info={null} />
      </div>
      <div className="header-where">
        <RepoMenu info={null} initiallyOpen onShow={onShow} />
      </div>
    </header>
  );
}

/** Das Symbol einer Seitenleiste wie in macOS: ein Rahmen mit einem Streifen links. */
/** Zwei Branches, die auseinanderlaufen, wie im Graphen der Commit-Liste. */
function GraphIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5 2.5v13M5 11.5c0-3 8-3 8-6.5V2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="6" r="1.75" fill="currentColor" />
      <circle cx="13" cy="5" r="1.75" fill="currentColor" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
      <rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="7" y1="1.5" x2="7" y2="14.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
