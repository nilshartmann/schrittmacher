import type { ReactNode } from 'react';
import type { RepoInfo } from '../git/types';
import type { ViewSearch } from '../server/store';
import { RecentMenu, RepoMenu } from './ViewMenus';

/**
 * Wie der Diff steht: beide Seiten mit dem Anteil der linken, oder alle Zeilen untereinander, mit
 * oder ohne die entfernten Zeilen.
 */
export type Layout = { mode: 'split'; share: number } | { mode: 'unified'; showRemoved: boolean };

interface HeaderProps {
  info: RepoInfo;
  /** Die Knöpfe zum Wechseln von Repo, Worktree und Branch. */
  where: ReactNode;
  allBranches: boolean;
  onAllBranches: () => void;
  fontSize: number;
  onFontSize: (change: number) => void;
  filesOpen: boolean;
  onFilesOpen: () => void;
}

/**
 * Die schmale Kopfzeile: links die Knöpfe für Dateiliste und alle Branches und die Knöpfe zum
 * Wechseln von Repo, Worktree und Branch; rechts die Knöpfe für die Schriftgröße, deren Wert der
 * Tooltip nennt. Den gewählten Vergleich zeigt die Commit-Liste, den zweier Commits zusätzlich die
 * Zeile darunter (`ComparisonBar`).
 */
export function Header(props: HeaderProps) {
  const { info } = props;
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
      <div className="header-start">{props.where}</div>
      <div className="header-tools">
        <div className="segmented" role="group" aria-label="Schriftgröße">
          <button
            type="button"
            aria-label="Schrift kleiner"
            data-tip={`Schrift kleiner (${String(props.fontSize)})`}
            onClick={() => {
              props.onFontSize(-1);
            }}
          >
            A−
          </button>
          <button
            type="button"
            aria-label="Schrift größer"
            data-tip={`Schrift größer (${String(props.fontSize)})`}
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
        <RecentMenu current={null} />
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
