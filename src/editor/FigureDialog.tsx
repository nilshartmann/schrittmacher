import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { saveFigure, suggestFigureName } from './editor.functions';

/** Die Meldung eines Fehlers als Text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Der Inhalt einer Datei als Base64, ohne den Vorspann `data:…;base64,`. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Das Bild ließ sich nicht lesen.'));
    };
    reader.readAsDataURL(file);
  });
}

/** Die Endung, die der Server zum Typ des Bildes vergibt, zur Anzeige neben dem Namen. */
function endingOf(type: string): string {
  return { 'image/jpeg': '.jpg', 'image/svg+xml': '.svg' }[type] ?? `.${type.slice('image/'.length)}`;
}

/** Der Link auf eine Abbildung im Ordner der Datei; ein Name mit Leerzeichen steht in spitzen Klammern. */
function figureLink(name: string): string {
  return `![](${name.includes(' ') ? `<${name}>` : name})`;
}

/**
 * Der Dialog für ein Bild aus der Zwischenablage. Er schlägt den Namen der nächsten Abbildung vor,
 * etwa `abb-013`, und speichert das Bild im Ordner der Datei. Danach steht der Link an der Stelle
 * des Cursors (`onInsert`).
 */
export function FigureDialog({
  image,
  path,
  dir,
  root,
  onInsert,
  onClose,
}: {
  image: File;
  /** Die Markdown-Datei, neben der das Bild landet. */
  path: string;
  dir: string;
  /** Der Workspace, in dem die Nummern gezählt werden; ohne zählt der Ordner der Datei. */
  root: string | null;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview] = useState(() => URL.createObjectURL(image));
  useEffect(() => {
    dialog.current?.showModal();
    suggestFigureName({ data: { path, root } }).then(
      (suggested) => {
        setName((current) => (current === '' ? suggested : current));
        // Der Cursor steht hinter der Nummer, damit sich gleich ein Suffix anhängen lässt.
        requestAnimationFrame(() => {
          field.current?.focus();
          field.current?.setSelectionRange(suggested.length, suggested.length);
        });
      },
      (failure: unknown) => {
        setError(messageOf(failure));
      },
    );
    return () => {
      URL.revokeObjectURL(preview);
    };
  }, []);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '' || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    base64Of(image)
      .then((base64) => saveFigure({ data: { path, name: name.trim(), type: image.type, base64 } }))
      .then(
        (fileName) => {
          onClose();
          onInsert(figureLink(fileName));
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
      className="sync-dialog figure-dialog"
      aria-labelledby="figure-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) {
          onClose();
        }
      }}
    >
      <form onSubmit={save}>
        <h2 id="figure-title">Abbildung einfügen</h2>
        <img className="figure-preview" src={preview} alt="Bild aus der Zwischenablage" />
        <label className="shortlink-label" htmlFor="figure-name">
          Name der neuen Datei
        </label>
        <div className="figure-name">
          <input
            id="figure-name"
            ref={field}
            className="menu-input"
            value={name}
            placeholder="abb-001-beschreibung"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          <span className="figure-ending">{endingOf(image.type)}</span>
        </div>
        <p className="sync-quiet">
          Im Ordner <span className="sync-path">{dir}</span>
        </p>
        {error !== null && <p className="sync-error">{error}</p>}
        <div className="sync-buttons">
          <button type="button" className="tool" disabled={saving} onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="tool tool-primary" disabled={saving || name.trim() === ''}>
            Einfügen
          </button>
        </div>
      </form>
    </dialog>
  );
}
