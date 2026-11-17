import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { renameReferencedFile } from './editor.functions';
import type { Reference } from './MarkdownEditor';

/** Die Meldung eines Fehlers als Text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Der Name der Datei aus einer Referenz, ohne Ordner und ohne `<…>`. */
function nameOf(reference: string): string {
  const bare = reference.trim().replace(/^<(.*)>$/, '$1');
  return bare.slice(bare.lastIndexOf('/') + 1);
}

/**
 * Der Dialog zum Umbenennen der Datei hinter einer markierten Referenz, etwa `abb-002.png` in einem
 * Bild (F2). Umbenannt wird im selben Ordner. Danach ersetzt `onRenamed` die Referenz im Text.
 */
export function RenameDialog({
  reference,
  path,
  onRenamed,
  onClose,
}: {
  reference: Reference;
  /** Die Datei im Editor, gegen deren Ordner die Referenz aufgelöst wird. */
  path: string;
  onRenamed: (next: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const initial = nameOf(reference.text);
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    // Ausgewählt ist der Name ohne Endung, wie beim Umbenennen im Baum.
    const dot = initial.lastIndexOf('.');
    field.current?.focus();
    field.current?.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, []);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '' || saving) {
      return;
    }
    if (name.trim() === initial) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    renameReferencedFile({ data: { path, reference: reference.text, name: name.trim() } }).then(
      (next) => {
        // Erst schließen: Solange der Dialog modal offen ist, bekommt der Editor keinen Fokus.
        dialog.current?.close();
        onRenamed(next);
        onClose();
      },
      (failure: unknown) => {
        setSaving(false);
        setError(messageOf(failure));
      },
    );
  };

  return (
    <dialog
      ref={dialog}
      className="sync-dialog"
      aria-labelledby="rename-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) {
          onClose();
        }
      }}
    >
      <form onSubmit={save}>
        <h2 id="rename-title">Datei umbenennen</h2>
        <label className="shortlink-label" htmlFor="rename-name">
          Neuer Name von <span className="sync-path">{reference.text}</span>
        </label>
        <input
          id="rename-name"
          ref={field}
          className="menu-input"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
        <p className="sync-quiet">Die Links auf die Datei in diesem Text ändern sich mit. Gespeichert wird er mit ⌘S.</p>
        {error !== null && <p className="sync-error">{error}</p>}
        <div className="sync-buttons">
          <button type="button" className="tool" disabled={saving} onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="tool tool-primary" disabled={saving || name.trim() === ''}>
            Umbenennen
          </button>
        </div>
      </form>
    </dialog>
  );
}
