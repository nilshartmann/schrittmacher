import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { chunksOf, highlightText, languageOf } from '../diff/highlight';
import type { CodeRange, Language } from '../diff/highlight';
import type { Commit, LinePart } from '../git/types';
import { commitHeading, compareNotes, linesLabel, noteHeading } from '../notes/notes';
import type { Note, NoteInput, NoteLines, Notes } from '../notes/notes';
import { deleteNotes, loadNotes, saveNote } from '../server/repo.functions';
import { WidthSplitter } from './FileList';
import { TrashIcon } from './Icons';

/** Die Grenzen der Breite der Spalte mit den Hinweisen in Pixeln; der Rest bleibt mindestens für den Diff. */
export const NOTES_WIDTH = { min: 220, start: 280, restMin: 400 };

/** Die kleinste Höhe des Felds für einen Hinweis in Pixeln. */
const NOTE_HEIGHT_MIN = 120;

/** Die Zeit in Millisekunden, nach der eine gezogene Höhe gemerkt wird, wenn kein Ziehen mehr folgt. */
const HEIGHT_DELAY = 300;

/** So viele Zeilen des markierten Codes zeigt ein Hinweis in der Spalte. */
const CODE_PREVIEW = 3;

/** So lange zeigt ein Knopf zum Kopieren „Kopiert“, in Millisekunden. */
const COPIED_FOR = 1200;

/** Ein Hinweis, der gerade angelegt wird: zum gewählten Commit und zur gewählten Datei. */
export type NoteDraft = Omit<NoteInput, 'id' | 'text'>;

const MARKDOWN: Language = { name: 'markdown', dialect: '' };

/**
 * In `noteHeading` steht der Code der Zeilen ab dieser Zeile: nach der Überschrift, einer leeren
 * Zeile und dem Zaun des Codeblocks.
 */
const CODE_LINE = 3;

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * Die Hinweise des Repos, zu dem der Worktree gehört, mit Funktionen zum Ändern. Jede Änderung
 * liefert vom Server alle Hinweise zurück, auch die Markdown-Datei.
 */
export function useNotes(worktree: string) {
  const [data, setData] = useState<Notes | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    loadNotes({ data: { worktree } }).then(
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
  }, [worktree]);
  const run = async (call: Promise<Notes>) => {
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
    save: (note: NoteInput) => run(saveNote({ data: { worktree, note } })),
    remove: (id: string) => run(deleteNotes({ data: { worktree, id } })),
    clear: () => run(deleteNotes({ data: { worktree } })),
  };
}

/**
 * Der Commit, zu dem ein Hinweis gehört: zuerst nach dem SHA, nach einem Rebase nach der Nummer des
 * Schritts und ohne Nummer nach dem Titel.
 */
export function commitOfNote(note: Note, commits: Commit[]): Commit | undefined {
  return (
    commits.find((commit) => commit.sha === note.sha) ??
    (note.step === null
      ? commits.find((commit) => commit.step === null && commit.title === note.title)
      : commits.find((commit) => commit.step === note.step))
  );
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function commitLabel(note: { step: string | null; title: string }): string {
  return note.step === null ? note.title : `${note.step}: ${note.title}`;
}

interface NotesColumnProps {
  notes: Note[];
  commits: Commit[];
  /** Der gewählte Commit; ohne einen, etwa bei den lokalen Änderungen, `null`. */
  sha: string | null;
  /** Die gewählte Datei; ihre Hinweise stehen in der Spalte nicht blasser da. */
  path: string | null;
  draft: NoteDraft | null;
  onDraftDone: () => void;
  onSave: (note: NoteInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClear: () => Promise<void>;
  /** Der Hinweis unter dem Zeiger; seine Zeilen sind im Diff kräftiger hervorgehoben. */
  onActive: (id: string | null) => void;
  /** Wählt Commit und Datei des Hinweises und scrollt zu seinen Zeilen. */
  onShow: (note: Note) => void;
  file: string;
  markdown: string;
  error: string | null;
  width: number;
  onWidth: (width: number) => void;
  /** Die Höhe des Felds für einen Hinweis, siehe `Settings.noteHeight`. */
  noteHeight: number | null;
  onNoteHeight: (height: number) => void;
}

/**
 * Die Hinweise zur Überarbeitung als Spalte rechts vom Diff, wie die Kommentare in Word. Oben steht
 * die Wahl zwischen den Hinweisen des gewählten Commits und allen. Ein Klick auf den Kopf eines
 * Hinweises zeigt seine Stelle, ein Klick auf den Text ändert ihn. Unten stehen die Markdown-Datei
 * und die Knöpfe zum Kopieren und Löschen.
 */
export function NotesColumn(props: NotesColumnProps) {
  const { notes, commits, sha, draft } = props;
  const [all, setAll] = useState(false);
  const ofCommit = notes.filter((note) => sha !== null && commitOfNote(note, commits)?.sha === sha);
  const shown = all ? notes : ofCommit;
  // Alle Hinweise nach Commit, in der Reihenfolge der Historie; Commits, die es nicht mehr gibt, am Ende.
  const groupOf = (note: Note) => commitOfNote(note, commits)?.sha ?? `-${note.sha}`;
  const order = (note: Note) => {
    const index = commits.findIndex((commit) => commit.sha === groupOf(note));
    return index === -1 ? Infinity : index;
  };
  const sorted = [...shown].sort(
    (a, b) => order(a) - order(b) || groupOf(a).localeCompare(groupOf(b)) || compareNotes(a, b),
  );

  const size = { height: props.noteHeight, onHeight: props.onNoteHeight };

  return (
    <>
      <WidthSplitter width={props.width} onWidth={props.onWidth} limits={NOTES_WIDTH} label="Breite der Hinweise" end />
      <aside className="notes-column" style={{ width: props.width }} aria-label="Hinweise">
        <div className="notes-bar">
          <span className="notes-heading">Hinweise</span>
          <div className="notes-scope" role="group" aria-label="Welche Hinweise">
            <button
              type="button"
              aria-pressed={!all}
              data-tip="Die Hinweise zum gewählten Commit"
              onClick={() => {
                setAll(false);
              }}
            >
              Commit <span className="notes-count">{ofCommit.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={all}
              data-tip="Die Hinweise zu allen Commits"
              onClick={() => {
                setAll(true);
              }}
            >
              Alle <span className="notes-count">{notes.length}</span>
            </button>
          </div>
        </div>
        <div className="notes-list">
          {draft !== null && (
            <article className="note note-draft">
              <NoteHead note={draft} withCommit={all || draft.sha !== sha} />
              <NoteEditor
                note={draft}
                size={size}
                initial=""
                onSave={async (text) => {
                  await props.onSave({ ...draft, text });
                  props.onDraftDone();
                }}
                onCancel={props.onDraftDone}
              />
            </article>
          )}
          {sorted.map((note, index) => {
            const commit = commitOfNote(note, commits);
            const before = sorted[index - 1];
            const newCommit = all && (before === undefined || groupOf(before) !== groupOf(note));
            return (
              <Fragment key={note.id}>
                {newCommit && (
                  <div className="notes-commit" data-tip={commit === undefined ? 'Den Commit gibt es nicht mehr' : undefined}>
                    {commitLabel(commit ?? note)}
                  </div>
                )}
                <NoteCard
                  note={note}
                  size={size}
                  gone={commit === undefined}
                  quiet={!all && props.path !== null && note.path !== props.path}
                  onSave={props.onSave}
                  onRemove={props.onRemove}
                  onActive={props.onActive}
                  onShow={props.onShow}
                />
              </Fragment>
            );
          })}
          {sorted.length === 0 && draft === null && (
            <p className="notes-empty">
              {all
                ? 'Es gibt noch keine Hinweise.'
                : sha === null
                  ? 'Hinweise gibt es nur zu Commits.'
                  : 'Zu diesem Commit gibt es noch keine Hinweise. Zeilen im Diff markieren und auf „Hinweis“ klicken, oder mit dem Knopf über dem Diff einen Hinweis zur ganzen Datei anlegen.'}
            </p>
          )}
        </div>
        {props.error !== null && <p className="notes-error">{props.error}</p>}
        <NotesFooter file={props.file} markdown={props.markdown} count={notes.length} onClear={props.onClear} />
      </aside>
    </>
  );
}

/** Der Kopf eines Hinweises: Datei und Zeilen, mit `withCommit` auch der Commit. */
function NoteHead({ note, withCommit }: { note: Pick<Note, 'step' | 'title' | 'path' | 'lines'>; withCommit: boolean }) {
  return (
    <span className="note-head">
      {withCommit && <span className="note-commit">{commitLabel(note)}</span>}
      <span className="note-where">
        <span className="note-file">{nameOf(note.path)}</span>
        <span className="note-lines">{note.lines === null ? 'ganze Datei' : linesLabel(note.lines)}</span>
      </span>
    </span>
  );
}

/** Der markierte Teil je Zeile von `code`, nach dem Index der Zeile; ohne Teil leer. */
function markedParts(lines: NoteLines): Map<number, LinePart[]> {
  const parts = new Map<number, LinePart[]>();
  if (lines.marked === undefined) {
    return parts;
  }
  const { start, end } = lines.marked;
  let offset = 0;
  for (const [index, line] of lines.code.split('\n').entries()) {
    const from = Math.max(start, offset) - offset;
    const to = Math.min(end, offset + line.length) - offset;
    if (from < to) {
      parts.set(index, [{ start: from, end: to }]);
    }
    offset += line.length + 1;
  }
  return parts;
}

/** Bereiche einer Zeile, um `by` Zeichen nach links verschoben und am Anfang abgeschnitten. */
function shifted<T extends { start: number; end: number }>(ranges: T[], by: number): T[] {
  return ranges
    .map((range) => ({ ...range, start: Math.max(0, range.start - by), end: range.end - by }))
    .filter((range) => range.start < range.end);
}

/**
 * Eine Zeile mit den Farben des Codes. Der markierte Teil steht in einem eigenen Element und ist
 * hinterlegt wie ein geänderter Teil im Diff.
 */
function ColoredLine({ text, ranges, parts }: { text: string; ranges: CodeRange[]; parts: LinePart[] }) {
  return chunksOf(text, parts, ranges).map((chunk, chunkIndex) => {
    const pieces = chunk.pieces.map((piece, index) =>
      piece.kind === null ? (
        piece.text
      ) : (
        <span key={index} className={`code-${piece.kind}`}>
          {piece.text}
        </span>
      ),
    );
    return chunk.part ? (
      <span key={chunkIndex} className="note-marked">
        {pieces}
      </span>
    ) : (
      <Fragment key={chunkIndex}>{pieces}</Fragment>
    );
  });
}

/**
 * Text mit den Farben seiner Sprache, Zeile für Zeile, mit einem Umbruch nach jeder Zeile, damit er
 * in einem `pre` steht wie geschrieben. `parts` nennt markierte Teile je Zeile.
 */
function Colored({
  text,
  language,
  parts,
}: {
  text: string;
  language: Language | null;
  parts?: ReadonlyMap<number, LinePart[]>;
}) {
  const ranges = useMemo(() => (language === null ? [] : highlightText(language, text)), [text, language]);
  return text.split('\n').map((line, index) => (
    <Fragment key={index}>
      {index > 0 && '\n'}
      <ColoredLine text={line} ranges={ranges[index] ?? []} parts={parts?.get(index) ?? []} />
    </Fragment>
  ));
}

/**
 * Die ersten Zeilen des Codes mit seinen Farben und dem markierten Teil, ohne die Einrückung, die
 * alle gemeinsam haben, und mit Auslassungszeichen, wenn es mehr sind.
 */
function CodePreview({ lines, path }: { lines: NoteLines; path: string }) {
  const all = lines.code.split('\n');
  const language = languageOf(path, lines.code);
  const ranges = useMemo(() => (language === null ? [] : highlightText(language, lines.code)), [lines.code, language?.name]);
  const parts = markedParts(lines);
  const indent = Math.min(
    ...all.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length),
  );
  const cut = Number.isFinite(indent) ? indent : 0;
  return (
    <pre className="note-code">
      {all.slice(0, CODE_PREVIEW).map((line, index) => (
        <Fragment key={index}>
          {index > 0 && '\n'}
          <ColoredLine
            text={line.slice(cut)}
            ranges={shifted(ranges[index] ?? [], cut)}
            parts={shifted(parts.get(index) ?? [], cut)}
          />
        </Fragment>
      ))}
      {all.length > CODE_PREVIEW && '\n…'}
    </pre>
  );
}

/** Die gemerkte Höhe des Felds für einen Hinweis und wie sie sich ändert. */
interface FieldSize {
  height: number | null;
  onHeight: (height: number) => void;
}

function NoteCard({
  note,
  size,
  gone,
  quiet,
  onSave,
  onRemove,
  onActive,
  onShow,
}: {
  note: Note;
  size: FieldSize;
  /** Den Commit des Hinweises gibt es nicht mehr. */
  gone: boolean;
  /** Der Hinweis gehört zu einer anderen Datei als der gewählten. */
  quiet: boolean;
  onSave: (note: NoteInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onActive: (id: string | null) => void;
  onShow: (note: Note) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <article
      className={`note${quiet ? ' note-quiet' : ''}`}
      onPointerEnter={() => {
        onActive(note.id);
      }}
      onPointerLeave={() => {
        onActive(null);
      }}
    >
      <div className="note-top">
        <button
          type="button"
          className="note-show"
          disabled={gone}
          data-tip={gone ? 'Den Commit gibt es nicht mehr' : note.path}
          onClick={() => {
            onShow(note);
          }}
        >
          <NoteHead note={note} withCommit={false} />
        </button>
        <button
          type="button"
          className="hover-tool note-remove"
          aria-label="Hinweis löschen"
          data-tip="Hinweis löschen"
          onClick={() => {
            void onRemove(note.id);
          }}
        >
          <TrashIcon />
        </button>
      </div>
      {note.lines !== null && !editing && <CodePreview lines={note.lines} path={note.path} />}
      {editing ? (
        <NoteEditor
          note={note}
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

/**
 * Das Feld für den Text eines Hinweises, als Markdown mit Farben. Darüber steht, was Schrittmacher
 * in der Markdown-Datei davor ergänzt: der Commit, die Datei mit den Zeilen, ihr Code und der
 * markierte Teil. Die Farben im Feld zeigt ein `pre` hinter dem durchsichtigen Text der `textarea`;
 * beide haben dieselbe Schrift und denselben Umbruch, und das `pre` gibt die Höhe vor. ⌘↩ speichert,
 * Escape bricht ab; ein leerer Text lässt sich nicht speichern. Mit `saveOnBlur` speichert auch ein
 * Klick daneben.
 */
function NoteEditor({
  note,
  size,
  initial,
  onSave,
  onCancel,
  saveOnBlur = false,
}: {
  note: Pick<Note, 'sha' | 'step' | 'title' | 'path' | 'lines'>;
  size: FieldSize;
  initial: string;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
  saveOnBlur?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Eine von Hand gezogene Höhe steht danach im Stil des Kastens und gilt für jedes weitere Feld.
  const latest = useRef(size);
  latest.current = size;
  useEffect(() => {
    const element = box.current;
    if (element === null) {
      return;
    }
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const drawn = element.style.height === '' ? null : Math.round(parseFloat(element.style.height));
        if (drawn !== null && drawn !== latest.current.height) {
          latest.current.onHeight(drawn);
        }
      }, HEIGHT_DELAY);
    });
    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    const element = field.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
    element?.scrollIntoView({ block: 'nearest' });
  }, []);
  const ready = !busy && text.trim() !== '';
  const generated = `${commitHeading(note)}\n\n${noteHeading(note)}`;
  const generatedParts = useMemo(() => {
    const parts = new Map<number, LinePart[]>();
    if (note.lines !== null) {
      // Die Überschrift des Commits und die leere Zeile danach stehen vor `noteHeading`.
      for (const [index, list] of markedParts(note.lines)) {
        parts.set(index + 2 + CODE_LINE, list);
      }
    }
    return parts;
  }, [note.lines]);
  const save = async () => {
    if (!ready) {
      return;
    }
    setBusy(true);
    try {
      await onSave(text.trim());
    } catch {
      // Den Fehler zeigt die Spalte; der Text bleibt im Feld.
      setBusy(false);
    }
  };
  return (
    <div className="note-editor">
      <div ref={box} className="md-box" style={{ height: size.height ?? undefined, minHeight: NOTE_HEIGHT_MIN }}>
        <pre className="md-generated" data-tip="Ergänzt Schrittmacher in der Markdown-Datei">
          <Colored text={generated} language={MARKDOWN} parts={generatedParts} />
        </pre>
        <div className="md-input">
          <pre className="md-mirror" aria-hidden="true">
            <Colored text={text} language={MARKDOWN} />
            {/* Ein Zeichen nach dem letzten Umbruch, damit eine leere letzte Zeile Höhe hat. */}
            {'\u200b'}
          </pre>
          <textarea
            ref={field}
            className="md-field"
            aria-label="Hinweis"
            placeholder="Was soll sich ändern? (Markdown)"
            spellCheck={false}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.metaKey) {
                event.preventDefault();
                void save();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
            onBlur={(event) => {
              // Ein Klick auf die Knöpfe darunter zählt nicht als Klick daneben.
              if (saveOnBlur && !event.currentTarget.closest('.note-editor')?.contains(event.relatedTarget)) {
                if (ready) {
                  void save();
                } else {
                  onCancel();
                }
              }
            }}
          />
        </div>
      </div>
      <div className="note-actions">
        <button type="button" className="tool tool-small" onClick={onCancel}>
          Abbrechen
        </button>
        <button
          type="button"
          className="tool tool-small tool-primary"
          disabled={!ready}
          data-tip="Speichern (⌘↩)"
          onClick={() => {
            void save();
          }}
        >
          Speichern
        </button>
      </div>
    </div>
  );
}

/**
 * Die Markdown-Datei unter den Hinweisen, mit Knöpfen zum Kopieren ihres Inhalts und ihres Pfads.
 * Der Knopf zum Löschen aller Hinweise fragt mit einem zweiten Klick nach.
 */
function NotesFooter({
  file,
  markdown,
  count,
  onClear,
}: {
  file: string;
  markdown: string;
  count: number;
  onClear: () => Promise<void>;
}) {
  const [copied, setCopied] = useState<'markdown' | 'path' | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (copied === null) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(null);
    }, COPIED_FOR);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  const copy = (what: 'markdown' | 'path') => {
    navigator.clipboard.writeText(what === 'markdown' ? markdown : file).then(
      () => {
        setCopied(what);
      },
      (error: unknown) => {
        console.error('Der Text ließ sich nicht kopieren.', error);
      },
    );
  };
  return (
    <div className="notes-footer">
      <code className="notes-file" data-tip={file}>
        {nameOf(file)}
      </code>
      <div className="notes-tools">
        <button
          type="button"
          className="tool tool-small"
          disabled={count === 0}
          data-tip="Alle Hinweise als Markdown in die Zwischenablage, etwa für Claude"
          onClick={() => {
            copy('markdown');
          }}
        >
          {copied === 'markdown' ? 'Kopiert' : 'Markdown kopieren'}
        </button>
        <button
          type="button"
          className="tool tool-small"
          data-tip="Den Pfad der Markdown-Datei in die Zwischenablage"
          onClick={() => {
            copy('path');
          }}
        >
          {copied === 'path' ? 'Kopiert' : 'Pfad'}
        </button>
        <button
          type="button"
          className={`tool tool-small notes-clear${confirm ? ' tool-danger' : ''}`}
          disabled={count === 0}
          aria-label="Alle Hinweise löschen"
          data-tip={confirm ? 'Noch einmal klicken, um alle Hinweise des Repos zu löschen' : 'Alle Hinweise des Repos löschen'}
          onClick={() => {
            if (confirm) {
              setConfirm(false);
              void onClear();
            } else {
              setConfirm(true);
            }
          }}
          onBlur={() => {
            setConfirm(false);
          }}
        >
          {confirm ? 'Löschen?' : <TrashIcon />}
        </button>
      </div>
    </div>
  );
}
