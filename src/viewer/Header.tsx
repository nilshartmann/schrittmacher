import type { ReactNode } from 'react';
import type { ViewSearch } from '../server/store';
import { InfoIcon, NoteIcon, SidebarIcon } from './Icons';
import { Timer } from './Timer';
import { RepoMenu } from './ViewMenus';

/**
 * Wie der Diff steht: beide Seiten mit dem Anteil der linken, oder alle Zeilen untereinander, mit
 * oder ohne die entfernten Zeilen.
 */
export type Layout = { mode: 'split'; share: number } | { mode: 'unified'; showRemoved: boolean };

interface HeaderProps {
  /** Die Knöpfe zum Wechseln von Repo, Worktree und Branch. */
  where: ReactNode;
  /** Das Menü, welche Branches die Commit-Liste zeigt. */
  scope: ReactNode;
  fontSize: number;
  onFontSize: (change: number) => void;
  filesOpen: boolean;
  onFilesOpen: () => void;
  infoOpen: boolean;
  onInfoOpen: () => void;
  timerEnd: number | null;
  onTimerEnd: (end: number | null) => void;
  notesOpen: boolean;
  onNotesOpen: () => void;
  /** Die Zahl aller Hinweise des Repos; sie steht neben dem Knopf, solange die Hinweise an sind. */
  notesCount: number;
}

/**
 * Die schmale Kopfzeile: links die Knöpfe für die Dateiliste und die Angaben zum Commit, nach einem
 * Trennstrich der für alle Branches und die Knöpfe zum Wechseln von Repo, Worktree und Branch; rechts der Timer für den
 * Vortrag und die Knöpfe für die Schriftgröße, deren Wert der Tooltip nennt. Den gewählten
 * Vergleich zeigt die Commit-Liste, den zweier Commits zusätzlich die Zeile darunter
 * (`ComparisonBar`).
 */
export function Header(props: HeaderProps) {
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
        <button
          type="button"
          className="bar-tool"
          aria-pressed={props.infoOpen}
          aria-label="Angaben zum Commit"
          data-tip={props.infoOpen ? 'Angaben zum Commit ausblenden (⌘I)' : 'Angaben zum Commit zeigen (⌘I)'}
          onClick={props.onInfoOpen}
        >
          <InfoIcon />
        </button>
        <span className="bar-separator" />
        {props.scope}
        {props.where}
      </div>
      <div className="header-tools">
        <button
          type="button"
          className="bar-tool bar-notes"
          aria-pressed={props.notesOpen}
          aria-label="Hinweise"
          data-tip={
            props.notesOpen
              ? 'Hinweise ausschalten, etwa für den Vortrag'
              : 'Hinweise zur Überarbeitung einschalten'
          }
          onClick={props.onNotesOpen}
        >
          <NoteIcon size={15} />
          {props.notesOpen && props.notesCount > 0 && <span className="bar-count">{props.notesCount}</span>}
        </button>
        <span className="bar-separator" />
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
