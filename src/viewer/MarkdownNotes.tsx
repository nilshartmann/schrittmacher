import { useEffect, useState } from 'react';
import { locateScope, mdNoteHeading, scopeLabel, scopeLines } from '../notes/markdownNotes';
import type { MdNote, MdNoteInput, MdNotes, MdScope } from '../notes/markdownNotes';
import {
  deleteMarkdownNotes,
  loadMarkdownNotes,
  markdownNotesForClaude,
  openMarkdownNotesInClaude,
  saveMarkdownImage,
  saveMarkdownNote,
} from '../server/repo.functions';
import { ChevronIcon, ClaudeIcon, NoteIcon, TrashIcon } from './Icons';
import { Colored, MARKDOWN, NoteTextEditor, NotesFooter } from './Notes';
import { ClaudeDialog } from './NotesClaude';

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Die Hinweise zu einer Markdown-Datei, neu geladen, wenn sich ihr Text ändert. */
export function useMarkdownNotes(path: string, text: string, active: boolean) {
  const [data, setData] = useState<MdNotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) {
      return;
    }
    let current = true;
    loadMarkdownNotes({ data: { path } }).then(
      (loaded) => {
        if (current) {
          setData(loaded);
          setError(null);
        }
      },
      (failure: unknown) => {
        if (current) {
          setError(messageOf(failure));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [path, text, active]);
  const run = async (call: Promise<MdNotes>) => {
    try {
      setData(await call);
      setError(null);
    } catch (failure) {
      setError(messageOf(failure));
      throw failure;
    }
  };
  return {
    notes: data?.notes ?? [],
    file: data?.file ?? '',
    markdown: data?.markdown ?? '',
    error,
    save: (note: MdNoteInput) => run(saveMarkdownNote({ data: { path, note } })),
    remove: (id: string) => run(deleteMarkdownNotes({ data: { path, id } })),
    clear: () => run(deleteMarkdownNotes({ data: { path } })),
  };
}

/** Der Prompt, mit dem der Dialog beginnt; davor setzt der Server den Auftrag, die Hinweise zu lesen. */
function defaultPrompt(name: string): string {
  return `Die Hinweise betreffen die Datei ${name}. Prüf jeden Hinweis gegen seine Stelle und schlag vor, wie du vorgehst. Setz noch nichts um.`;
}

/** Der Inhalt einer Datei als Base64, ohne den Vorspann der Data-URL. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result).replace(/^[^,]*,/, ''));
    };
    reader.onerror = () => {
      reject(new Error('Das Bild ließ sich nicht lesen.'));
    };
    reader.readAsDataURL(file);
  });
}

/** Legt ein eingefügtes Bild als Datei ab und liefert ihren Pfad. */
async function storeImage(path: string, image: File): Promise<string> {
  return saveMarkdownImage({ data: { path, type: image.type, base64: await base64Of(image) } });
}

/** Klappt in der Kopfzeile ein, was Schrittmacher in der Markdown-Datei ergänzt. */
function GeneratedToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="hover-tool md-note-toggle"
      aria-expanded={open}
      aria-label="Ergänzten Markdown-Block ein- und ausklappen"
      data-tip={open ? 'Ergänzten Markdown-Block einklappen' : 'Ergänzten Markdown-Block zeigen'}
      // Das Feld behält den Fokus, sonst speichert es beim Klick auf diesen Knopf.
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      onClick={onToggle}
    >
      <ChevronIcon open={open} />
    </button>
  );
}

/** Scrollt zur ersten Zeile eines Bezugs in der Ansicht. */
function scrollToLine(from: number): void {
  const blocks = [...document.querySelectorAll('.md [data-ref-from]')];
  blocks.find((block) => Number(block.getAttribute('data-ref-to')) >= from)?.scrollIntoView({ block: 'center' });
}

/**
 * Die Hinweise als Spalte rechts der Markdown-Ansicht: oben das Feld für einen neuen Hinweis,
 * darunter die Hinweise der Reihe nach, unten die gesammelte Markdown-Datei. Siehe
 * `docs/markdown-hinweise.md`.
 */
export function MarkdownNotesColumn({
  path,
  name,
  text,
  store,
  focused,
  draft,
  file,
  onDraft,
  onDraftDone,
  onScope,
  onPreview,
}: {
  path: string;
  name: string;
  text: string;
  store: ReturnType<typeof useMarkdownNotes>;
  /** Die Hinweise einer eben angeklickten Markierung im Text. */
  focused: string[];
  draft: MdScope | null;
  file: MdScope;
  onDraft: (scope: MdScope) => void;
  onDraftDone: () => void;
  onScope: (scope: MdScope | null) => void;
  onPreview: (scope: MdScope | null) => void;
}) {
  const [height, setHeight] = useState<number | null>(null);
  const [showGenerated, setShowGenerated] = useState(false);
  const toggleGenerated = () => {
    setShowGenerated(!showGenerated);
  };
  const pasteImage = (image: File) => storeImage(path, image);
  const [claude, setClaude] = useState<{ id?: string } | null>(null);
  const size = { height, onHeight: setHeight };
  const located = store.notes
    .map((note) => ({ note, where: locateScope(note, text) }))
    .sort((a, b) => (a.where?.from ?? Infinity) - (b.where?.from ?? Infinity) || a.note.created.localeCompare(b.note.created));
  return (
    <aside className="notes-column md-notes" aria-label="Hinweise">
      <div className="notes-bar">
        <span className="notes-heading">Hinweise</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Hinweis zur ganzen Datei"
          data-tip={draft === null ? 'Hinweis zur ganzen Datei' : 'Erst den offenen Hinweis speichern oder abbrechen'}
          disabled={draft !== null}
          onPointerEnter={() => {
            if (draft === null) {
              onPreview(file);
            }
          }}
          onPointerLeave={() => {
            onPreview(null);
          }}
          onClick={() => {
            window.getSelection()?.removeAllRanges();
            onPreview(null);
            onDraft(file);
          }}
        >
          <NoteIcon size={16} />
        </button>
      </div>
      <div className="notes-list">
        {draft !== null && (
          <article className="note note-draft">
            <div className="note-top">
              <MdNoteHead scope={draft} where={draft} />
              <GeneratedToggle open={showGenerated} onToggle={toggleGenerated} />
            </div>
            <NoteTextEditor
              generated={showGenerated ? mdNoteHeading(draft) : null}
              onPasteImage={pasteImage}
              size={size}
              initial=""
              onSave={async (noteText) => {
                await store.save({ ...draft, text: noteText });
                onDraftDone();
              }}
              onCancel={onDraftDone}
            />
          </article>
        )}
        {located.map(({ note, where }) => (
          <MdNoteCard
            key={note.id}
            note={note}
            where={where}
            focused={focused.includes(note.id)}
            size={size}
            showGenerated={showGenerated}
            onToggleGenerated={toggleGenerated}
            onPasteImage={pasteImage}
            onSave={store.save}
            onRemove={store.remove}
            onScope={onScope}
            onPreview={onPreview}
            onClaude={() => {
              setClaude({ id: note.id });
            }}
          />
        ))}
        {located.length === 0 && draft === null && (
          <p className="notes-empty">
            Noch keine Hinweise. Text markieren und auf „Hinweis“ klicken oder links neben einem Block das Symbol nehmen. Das
            Symbol oben gilt für die ganze Datei.
          </p>
        )}
      </div>
      {store.error !== null && <p className="notes-error">{store.error}</p>}
      <NotesFooter
        file={store.file}
        markdown={store.markdown}
        count={store.notes.length}
        claudePrompt={`Lies ${store.file}.\n\n${defaultPrompt(name)}\n`}
        onClear={store.clear}
        onClaude={() => {
          setClaude({});
        }}
      />
      {claude !== null && (
        <ClaudeDialog
          title={claude.id === undefined ? 'Hinweise in Claude bearbeiten' : 'Hinweis in Claude bearbeiten'}
          rows={[{ label: 'Datei', value: path }]}
          initialPrompt={defaultPrompt(name)}
          load={() => markdownNotesForClaude({ data: { path, id: claude.id } })}
          start={(prompt, markdown) => openMarkdownNotesInClaude({ data: { path, prompt, markdown } })}
          onClose={() => {
            setClaude(null);
          }}
        />
      )}
    </aside>
  );
}

/** Der Kopf eines Hinweises: Art, Zeilen und die Überschriften darüber. */
function MdNoteHead({ scope, where }: { scope: MdScope; where: { from: number; to: number } | null }) {
  return (
    <span className="note-head">
      <span className="note-where">
        <span className="note-file">{scopeLabel(scope.kind)}</span>
        {scope.kind !== 'file' && <span className="note-lines">{where === null ? 'Stelle nicht gefunden' : scopeLines(where)}</span>}
      </span>
      {scope.path.length > 0 && <span className="md-note-path">{scope.path.join(' › ')}</span>}
    </span>
  );
}

function MdNoteCard({
  note,
  where,
  focused,
  size,
  showGenerated,
  onToggleGenerated,
  onPasteImage,
  onSave,
  onRemove,
  onScope,
  onPreview,
  onClaude,
}: {
  note: MdNote;
  where: { from: number; to: number } | null;
  focused: boolean;
  size: { height: number | null; onHeight: (height: number) => void };
  showGenerated: boolean;
  onToggleGenerated: () => void;
  onPasteImage: (image: File) => Promise<string>;
  onSave: (note: MdNoteInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onScope: (scope: MdScope | null) => void;
  onPreview: (scope: MdScope | null) => void;
  onClaude: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const current = where === null ? null : { ...note, ...where };
  return (
    <article
      className={focused ? 'note md-note-focused' : 'note'}
      data-note-id={note.id}
      onPointerEnter={() => {
        onPreview(current);
      }}
      onPointerLeave={() => {
        onPreview(null);
      }}
    >
      <div className="note-top">
        <button
          type="button"
          className="note-show"
          disabled={current === null}
          data-tip={current === null ? 'Die Stelle gibt es im aktuellen Stand nicht mehr' : 'Stelle zeigen'}
          onClick={() => {
            if (current !== null) {
              onPreview(null);
              onScope(current);
              scrollToLine(current.from);
            }
          }}
        >
          <MdNoteHead scope={note} where={where} />
        </button>
        {editing && <GeneratedToggle open={showGenerated} onToggle={onToggleGenerated} />}
        <button
          type="button"
          className="hover-tool note-claude"
          aria-label="Hinweis in Claude bearbeiten"
          data-tip="Hinweis in Claude bearbeiten …"
          onClick={onClaude}
        >
          <ClaudeIcon />
        </button>
        <button
          type="button"
          className="hover-tool note-remove"
          aria-label="Hinweis löschen"
          data-tip="Hinweis löschen"
          onClick={() => {
            onPreview(null);
            void onRemove(note.id);
          }}
        >
          <TrashIcon />
        </button>
      </div>
      {note.marked !== null && <mark className="md-note-marked">{note.marked}</mark>}
      {editing ? (
        <NoteTextEditor
          generated={showGenerated ? mdNoteHeading(note, where) : null}
          onPasteImage={onPasteImage}
          size={size}
          initial={note.text}
          onSave={async (text) => {
            if (text !== note.text) {
              await onSave({ ...note, text });
            }
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
          saveOnBlur
        />
      ) : (
        <p
          className="note-text"
          data-tip="Klicken zum Ändern"
          onClick={() => {
            setEditing(true);
          }}
        >
          <Colored text={note.text} language={MARKDOWN} />
        </p>
      )}
    </article>
  );
}
