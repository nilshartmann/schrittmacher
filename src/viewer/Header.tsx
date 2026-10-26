import type { ReactNode } from 'react';
import type { RepoInfo } from '../git/types';
import type { ViewSearch } from '../server/store';
import { GraphIcon, SidebarIcon } from './Icons';
import { Timer } from './Timer';
import { RepoMenu } from './ViewMenus';

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
  timerEnd: number | null;
  onTimerEnd: (end: number | null) => void;
}

/**
 * Die schmale Kopfzeile: links der Knopf für die Dateiliste, nach einem Trennstrich der für alle
 * Branches und die Knöpfe zum Wechseln von Repo, Worktree und Branch; rechts der Timer für den
 * Vortrag und die Knöpfe für die Schriftgröße, deren Wert der Tooltip nennt. Den gewählten
 * Vergleich zeigt die Commit-Liste, den zweier Commits zusätzlich die Zeile darunter
 * (`ComparisonBar`).
 */
export function Header(props: HeaderProps) {
  const { info } = props;
  return (
    <header className="header">
      <div className="header-start">
        <button
          type="button"
          className="bar-tool"
          aria-pressed={props.filesOpen}
          aria-label="Dateiliste"
          data-tip={props.filesOpen ? 'Dateiliste einklappen' : 'Dateiliste zeigen'}
          onClick={props.onFilesOpen}
        >
          <SidebarIcon />
        </button>
        <span className="bar-separator" />
        <button
          type="button"
          className="bar-tool"
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
        {props.where}
      </div>
      <div className="header-tools">
        <Timer end={props.timerEnd} onEnd={props.onTimerEnd} />
        <span className="bar-separator" />
        <div className="font-size" role="group" aria-label="Schriftgröße">
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
 * Die Kopfzeile, solange keine Ansicht offen ist, etwa beim allerersten Start: nur das Repo,
 * dessen Menü schon offen ist.
 */
export function EmptyHeader({ onShow }: { onShow: (view: ViewSearch) => void }) {
  return (
    <header className="header">
      <div className="header-where">
        <RepoMenu info={null} initiallyOpen onShow={onShow} />
      </div>
    </header>
  );
}
