import { useState } from 'react';
import type { DiffFile } from '../git/types';
import { commitChanges } from '../server/repo.functions';

/** Was für den nächsten Commit eines Worktrees eingegeben ist. */
export interface Draft {
  /**
   * Die Dateien ohne Haken. Gemerkt werden die abgewählten, damit eine Datei, die neu dazukommt,
   * angehakt ist.
   */
  unchecked: ReadonlySet<string>;
  message: string;
  force: boolean;
}

export const EMPTY_DRAFT: Draft = { unchecked: new Set(), message: '', force: false };

/** Wie der letzte Push eines Worktrees steht; ohne Push gibt es keinen Stand. */
export type PushState =
  | { kind: 'running' }
  | { kind: 'done' }
  | { kind: 'failed'; message: string; force: boolean };

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Die Pfade der angehakten Dateien; bei einer Umbenennung auch der alte, damit er mit wegfällt. */
function checkedPaths(files: DiffFile[], unchecked: ReadonlySet<string>): string[] {
  return files
    .filter((file) => !unchecked.has(file.path))
    .flatMap((file) => (file.oldPath === file.path ? [file.path] : [file.path, file.oldPath]));
}

interface CommitPanelProps {
  worktree: string;
  branch: string;
  files: DiffFile[];
  draft: Draft;
  onDraft: (draft: Draft) => void;
  /** Nach dem Commit, mit seinem SHA und der Angabe, ob mit Force gepusht werden soll. */
  onCommitted: (sha: string, force: boolean) => void;
}

/**
 * Nachricht, Force-Push und der Knopf zum Commit, wie in Fork unter der Dateiliste. Committet
 * werden die angehakten Dateien, ⌘↩ im Feld committet ebenso.
 */
export function CommitPanel({ worktree, branch, files, draft, onDraft, onCommitted }: CommitPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paths = checkedPaths(files, draft.unchecked);
  const ready = !busy && draft.message.trim() !== '' && paths.length > 0;

  const commit = async () => {
    if (!ready) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sha = await commitChanges({ data: { worktree, branch, message: draft.message, paths } });
      onDraft(EMPTY_DRAFT);
      onCommitted(sha, draft.force);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="commit-panel">
      <textarea
        className="commit-message"
        aria-label="Commit-Nachricht"
        placeholder="Commit-Nachricht"
        value={draft.message}
        onChange={(event) => {
          onDraft({ ...draft, message: event.target.value });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.metaKey) {
            event.preventDefault();
            void commit();
          }
        }}
      />
      {error !== null && <p className="commit-error">{error}</p>}
      <div className="commit-actions">
        <label className="commit-force" data-tip="Mit --force-with-lease pushen">
          <input
            type="checkbox"
            checked={draft.force}
            onChange={(event) => {
              onDraft({ ...draft, force: event.target.checked });
            }}
          />
          Force-Push
        </label>
        <button
          type="button"
          className="tool tool-primary"
          disabled={!ready}
          data-tip="Committen und pushen (⌘↩)"
          onClick={() => {
            void commit();
          }}
        >
          {busy ? 'Committet …' : 'Commit'}
        </button>
      </div>
    </div>
  );
}

/** Der Stand des Pushs unter der Dateiliste; nach einem Fehler mit einem Knopf zum Wiederholen. */
export function PushNote({ push, onRetry }: { push: PushState; onRetry: () => void }) {
  return (
    <div className={`push-note push-note-${push.kind}`} role="status">
      {push.kind === 'running' && <span>Push läuft …</span>}
      {push.kind === 'done' && <span>Gepusht</span>}
      {push.kind === 'failed' && (
        <>
          <span className="push-error">Der Push ist gescheitert, der Commit bleibt bestehen. {push.message}</span>
          <button type="button" className="tool" onClick={onRetry}>
            Push wiederholen
          </button>
        </>
      )}
    </div>
  );
}
