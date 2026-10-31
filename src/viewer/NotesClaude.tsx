import { useEffect, useRef, useState } from 'react';
import { notesForClaude, openNotesInClaude } from '../server/repo.functions';

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Der Prompt, mit dem der Dialog beginnt; davor setzt der Server den Auftrag, die Hinweise zu lesen. */
function defaultPrompt(branch: string): string {
  return [
    `Die Hinweise betreffen die Commits auf ${branch}.`,
    'Prüf jeden Hinweis gegen seinen Commit und schlag vor, wie du vorgehst.',
    'Setz noch nichts um.',
  ].join(' ');
}

/**
 * Der Dialog „In Claude bearbeiten“, siehe `docs/hinweise.md`. Er nennt Ordner und Branch und zeigt
 * Prompt und Hinweise zum Anpassen. Beim Start legt der Server die Hinweise, wie sie hier stehen,
 * als eigene Datei ab und startet Claude Code mit dem Prompt; die Hinweise selbst bleiben, wie sie
 * sind. Mit `id` geht es nur um diesen einen Hinweis.
 */
export function NotesClaudeDialog({
  worktree,
  branch,
  id,
  onClose,
}: {
  worktree: string;
  branch: string;
  id?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt(branch));
  const [markdown, setMarkdown] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    notesForClaude({ data: { worktree, id } }).then(
      (loaded) => {
        setCwd(loaded.cwd);
        setMarkdown(loaded.markdown);
      },
      (failure: unknown) => {
        setError(messageOf(failure));
      },
    );
    // Geladen wird einmal beim Öffnen.
  }, []);
  const start = () => {
    setRunning(true);
    setError(null);
    openNotesInClaude({ data: { worktree, prompt, markdown } }).then(onClose, (failure: unknown) => {
      setError(messageOf(failure));
      setRunning(false);
    });
  };
  return (
    <dialog
      ref={dialog}
      className="sync-dialog claude-dialog"
      aria-labelledby="claude-title"
      onCancel={(event) => {
        if (running) {
          event.preventDefault();
        } else {
          onClose();
        }
      }}
    >
      <h2 id="claude-title">{id === undefined ? 'Hinweise in Claude bearbeiten' : 'Hinweis in Claude bearbeiten'}</h2>
      <dl className="claude-where">
        <dt>Ordner</dt>
        <dd className="sync-path">{cwd ?? '…'}</dd>
        <dt>Branch</dt>
        <dd>{branch}</dd>
      </dl>
      <label className="claude-field">
        <span className="sync-label">Prompt, davor steht „Lies &lt;Datei mit den Hinweisen&gt;.“</span>
        <textarea
          rows={3}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
        />
      </label>
      <label className="claude-field">
        <span className="sync-label">Hinweise, gehen als eigene Datei an Claude</span>
        <textarea
          className="claude-markdown"
          rows={14}
          value={markdown}
          spellCheck={false}
          onChange={(event) => {
            setMarkdown(event.target.value);
          }}
        />
      </label>
      {error !== null && <p className="sync-error">{error}</p>}
      <div className="sync-buttons">
        <button type="button" className="tool" disabled={running} onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className="tool tool-primary"
          disabled={running || cwd === null || prompt.trim() === '' || markdown.trim() === ''}
          onClick={start}
        >
          {running ? 'Startet …' : 'In Claude öffnen'}
        </button>
      </div>
    </dialog>
  );
}
