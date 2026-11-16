import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatMarkdownText, loadMarkdown, markdownChanged, saveMarkdown } from '../server/markdown.functions';
import { backupMarkdown } from '../server/repo.functions';
import type { MarkdownFile } from '../server/markdown.functions';
import { MarkdownView, fileScope } from '../viewer/Markdown';
import { marksOf } from '../notes/markdownNotes';
import type { MdMark, MdScope } from '../notes/markdownNotes';
import { NoteIcon, PencilIcon } from '../viewer/Icons';
import { MarkdownEditor } from '../viewer/MarkdownEditor';
import type { EditorHandle } from '../viewer/MarkdownEditor';
import { MarkdownNotesColumn, useMarkdownNotes } from '../viewer/MarkdownNotes';
import { Tooltips } from '../viewer/Tooltips';
import { useRequests } from '../viewer/useRequests';

/** Der Abstand der Fragen, ob sich die Datei geändert hat, in Millisekunden. */
const CHANGE_INTERVAL = 1500;

/** Die Schriftgröße der Ansicht in Pixeln, mit ihren Grenzen; gemerkt wird sie im Browser. */
const FONT_SIZE = { initial: 16, min: 12, max: 28, key: 'schrittmacher.markdown.fontSize' };

/**
 * Die Breite der Textfläche im Editor in Pixeln, mit ihrer kleinsten; `'full'` nimmt die ganze
 * Breite des Fensters. Gemerkt wird sie im Browser.
 */
const EDITOR_WIDTH = { normal: 900, min: 480, key: 'schrittmacher.markdown.editorWidth' };

/**
 * Wann der Editor ungespeicherten Text sichert, in Millisekunden: nach einer Pause im Tippen,
 * spätestens aber eine Weile nach der ersten Änderung seit der letzten Sicherung.
 */
const BACKUP = { pause: 5000, latest: 30000 };

/** Die Breite der Textfläche im Editor. */
type EditorWidth = number | 'full';

/** So lange bleiben die Hinweise einer angeklickten Markierung hervorgehoben, in Millisekunden. */
const FOCUS_DURATION = 1600;

/** Unter diesem Schlüssel merkt sich der Browser, ob die Hinweise eingeschaltet sind. */
const NOTING_KEY = 'schrittmacher.markdown.noting';

export const Route = createFileRoute('/markdown')({
  validateSearch: (search: Record<string, unknown>): { path: string } => ({
    path: typeof search.path === 'string' ? search.path : '',
  }),
  loaderDeps: ({ search }) => ({ path: search.path }),
  loader: ({ deps }) => loadMarkdown({ data: { path: deps.path } }),
  gcTime: 0,
  component: Page,
  errorComponent: ({ error }) => (
    <Frame file={null}>
      <p className="empty">{error instanceof Error ? error.message : String(error)}</p>
    </Frame>
  ),
});

function Page() {
  const file = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [noting, setNoting] = useState(storedNoting);
  const [scope, setScope] = useState<MdScope | null>(null);
  const [preview, setPreview] = useState<MdScope | null>(null);
  const [draft, setDraft] = useState<MdScope | null>(null);
  const store = useMarkdownNotes(file.path, file.text, noting);
  // Im Editor gehört der Text dem Editor; `saved` ist der Stand zuletzt auf der Platte.
  const [editing, setEditing] = useState(false);
  const [editorWidth, setEditorWidth] = useState(storedEditorWidth);
  const changeEditorWidth = (next: EditorWidth) => {
    setEditorWidth(next);
    try {
      localStorage.setItem(EDITOR_WIDTH.key, String(next));
    } catch {
      // Ohne Speicher im Browser gilt die Breite bis zum Schließen.
    }
  };
  const [edited, setEdited] = useState('');
  const [saved, setSaved] = useState('');
  const dirty = editing && edited !== saved;
  const editor = useRef<EditorHandle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Die letzte Sicherung und seit wann es Text gibt, der noch nicht gesichert ist.
  const lastBackup = useRef<{ text: string; pendingSince: number | null }>({ text: '', pendingSince: null });
  const [backedUp, setBackedUp] = useState<BackedUp | null>(null);
  const runBackup = (text: string) => {
    lastBackup.current = { text, pendingSince: null };
    backupMarkdown({ data: { path: file.path, text } }).then(
      (result) => {
        if (result !== null) {
          setBackedUp(
            result.kind === 'git'
              ? { at: new Date(), where: result.branch, commit: result.commit }
              : { at: new Date(), where: result.path, commit: null },
          );
        }
      },
      (error: unknown) => {
        setNotice(`Sicherung gescheitert: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  };
  useEffect(() => {
    if (!editing || edited === lastBackup.current.text) {
      return;
    }
    const since = lastBackup.current.pendingSince ?? Date.now();
    lastBackup.current.pendingSince = since;
    const delay = Math.min(BACKUP.pause, Math.max(0, since + BACKUP.latest - Date.now()));
    const timer = setTimeout(() => {
      runBackup(edited);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [editing, edited]);
  const save = async () => {
    const text = edited;
    await saveMarkdown({ data: { path: file.path, text } });
    setSaved(text);
    runBackup(text);
    await router.invalidate();
  };
  const formatText = async (text: string): Promise<string> => {
    try {
      setNotice(null);
      return await formatMarkdownText({ data: { path: file.path, text } });
    } catch (error) {
      setNotice(`Formatieren gescheitert: ${error instanceof Error ? error.message : String(error)}`);
      return text;
    }
  };
  const toggleEditing = () => {
    if (!editing) {
      setEdited(file.text);
      setSaved(file.text);
      lastBackup.current = { text: file.text, pendingSince: null };
      setBackedUp(null);
      setNotice(null);
      setEditing(true);
      return;
    }
    if (dirty) {
      void save().then(() => {
        setEditing(false);
      });
    } else {
      setEditing(false);
    }
  };
  // Ungespeicherte Änderungen gehen beim Schließen nicht ohne Rückfrage verloren.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);
  useEffect(() => {
    setScope(null);
    setPreview(null);
    setDraft(null);
    setEditing(false);
  }, [file.path]);
  // Die Zeilen eines Bezugs gelten nur für den Text, in dem er gewählt wurde; ein Entwurf bleibt.
  useEffect(() => {
    setScope((current) => (draft === null ? null : current));
    setPreview(null);
  }, [file.text]);
  const marks = useMemo(() => marksOf(store.notes, file.text), [store.notes, file.text]);
  const [focused, setFocused] = useState<string[]>([]);
  useEffect(() => {
    if (focused.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setFocused([]);
    }, FOCUS_DURATION);
    return () => {
      clearTimeout(timer);
    };
  }, [focused]);
  const showMark = (mark: MdMark) => {
    setFocused(mark.ids);
    setScope(mark.scope);
    document.querySelector(`[data-note-id="${mark.ids[0] ?? ''}"]`)?.scrollIntoView({ block: 'center' });
  };
  const startDraft = (next: MdScope) => {
    setScope(next);
    setDraft(next);
  };
  const endDraft = () => {
    setDraft(null);
    setScope(null);
  };
  // Eine geänderte Datei lädt die Seite neu, etwa während Claude daran schreibt.
  useEffect(() => {
    if (editing) {
      return;
    }
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      markdownChanged({ data: { path: file.path } }).then(
        (changed) => {
          if (changed !== null && changed !== file.changed) {
            void router.invalidate();
          }
        },
        () => {
          // Der Server ist kurz nicht erreichbar; die nächste Frage versucht es wieder.
        },
      );
    }, CHANGE_INTERVAL);
    return () => {
      clearInterval(timer);
    };
  }, [file.path, file.changed, router, editing]);
  return (
    <Frame
      file={file}
      editing={editing}
      status={
        editing && (
          <EditorStatus dirty={dirty} backedUp={backedUp} notice={notice} />
        )
      }
      tools={
        editing && (
          <>
            <button
              type="button"
              className="md-format"
              data-tip="Mit Prettier formatieren (⌘⇧F)"
              onClick={() => {
                editor.current?.format();
              }}
            >
              Formatieren
            </button>
            <WidthControl width={editorWidth} onChange={changeEditorWidth} />
          </>
        )
      }
      dirty={dirty}
      onToggleEditing={toggleEditing}
      noting={noting}
      onToggleNoting={() => {
        setNoting(!noting);
        try {
          localStorage.setItem(NOTING_KEY, String(!noting));
        } catch {
          // Ohne Speicher im Browser gilt die Einstellung bis zum Schließen.
        }
        setScope(null);
        setPreview(null);
        setDraft(null);
      }}
      aside={
        noting &&
        !editing && (
          <MarkdownNotesColumn
            path={file.path}
            name={file.name}
            text={file.text}
            store={store}
            focused={focused}
            draft={draft}
            file={fileScope(file.text)}
            onDraft={startDraft}
            onDraftDone={endDraft}
            onScope={setScope}
            onPreview={setPreview}
          />
        )
      }
    >
      {editing ? (
        <MarkdownEditor
          text={edited}
          width={editorWidth === 'full' ? null : editorWidth}
          minWidth={EDITOR_WIDTH.min}
          onWidth={(next) => {
            changeEditorWidth(next ?? 'full');
          }}
          onChange={setEdited}
          handle={editor}
          onFormat={formatText}
          onSave={() => {
            void save();
          }}
        />
      ) : (
        <MarkdownView
          text={file.text}
          dir={file.dir}
          noting={
            noting
              ? { scope: draft ?? scope, preview, marks, onMark: showMark, drafting: draft !== null, onScope: setScope, onPreview: setPreview, onDraft: startDraft }
              : null
          }
          onOpen={(path) => {
            void navigate({ to: '/markdown', search: { path } });
          }}
        />
      )}
    </Frame>
  );
}

/** Ob die Hinweise beim letzten Mal eingeschaltet waren. */
function storedNoting(): boolean {
  try {
    return localStorage.getItem(NOTING_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Die gemerkte Breite des Editors; ohne Speicher im Browser die normale. */
function storedEditorWidth(): EditorWidth {
  try {
    const value = localStorage.getItem(EDITOR_WIDTH.key);
    if (value === 'full') {
      return 'full';
    }
    const width = Number(value);
    return value !== null && width >= EDITOR_WIDTH.min ? width : EDITOR_WIDTH.normal;
  } catch {
    return EDITOR_WIDTH.normal;
  }
}

/** Die letzte Sicherung: wann, wohin und, in einem Repo, der Commit. */
interface BackedUp {
  at: Date;
  where: string;
  commit: string | null;
}

/** So lange zeigt die Kopfzeile nach einer Sicherung, wohin sie ging, in Millisekunden. */
const BACKUP_FLASH = 4000;

/** Eine Uhrzeit wie `15:58`. */
function timeOf(date: Date): string {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Der Stand im Editor: ob es ungespeicherte Änderungen gibt, wann und wohin zuletzt gesichert
 * wurde, und eine Meldung, wenn Sichern oder Formatieren gescheitert ist.
 */
function EditorStatus({
  dirty,
  backedUp,
  notice,
}: {
  dirty: boolean;
  backedUp: BackedUp | null;
  notice: string | null;
}) {
  // Nach jeder Sicherung steht kurz da, wohin sie ging; danach wieder der gewohnte Stand.
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (backedUp === null) {
      return;
    }
    setFlash(true);
    const timer = setTimeout(() => {
      setFlash(false);
    }, BACKUP_FLASH);
    return () => {
      clearTimeout(timer);
    };
  }, [backedUp]);
  if (notice !== null) {
    return (
      <span className="md-save-state md-save-state-error" data-tip={notice}>
        {notice.split(':')[0]}
      </span>
    );
  }
  const backup = backedUp === null ? null : `gesichert ${timeOf(backedUp.at)}`;
  const tip =
    backedUp === null
      ? undefined
      : `Zuletzt gesichert um ${timeOf(backedUp.at)} in ${backedUp.where}` +
        (backedUp.commit === null ? '' : `, Commit ${backedUp.commit}`);
  if (flash && backedUp !== null) {
    return (
      <span className="md-save-state md-save-state-flash" key={backedUp.at.getTime()} data-tip={tip}>
        {backedUp.commit === null ? (
          'Gesichert als Kopie'
        ) : (
          <>
            Gesichert auf {backedUp.where} <code>{backedUp.commit.slice(0, 7)}</code>
          </>
        )}
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="md-save-state" data-tip={tip}>
        {backup === null ? 'Nicht gespeichert, ⌘S' : `Nicht gespeichert, ${backup}, ⌘S`}
      </span>
    );
  }
  return backup === null ? null : (
    <span className="md-save-state" data-tip={tip}>
      {backup}
    </span>
  );
}

/**
 * Die Knöpfe für die normale und die volle Breite der Textfläche im Editor. Jede andere Breite
 * entsteht durch Ziehen am Strich neben den Zeilennummern.
 */
function WidthControl({ width, onChange }: { width: EditorWidth; onChange: (width: EditorWidth) => void }) {
  return (
    <div className="md-width" role="group" aria-label="Breite des Editors">
      <button
        type="button"
        aria-pressed={width === EDITOR_WIDTH.normal}
        data-tip={`Normale Breite (${String(EDITOR_WIDTH.normal)} px)`}
        onClick={() => {
          onChange(EDITOR_WIDTH.normal);
        }}
      >
        Normal
      </button>
      <button
        type="button"
        aria-pressed={width === 'full'}
        data-tip="Volle Breite"
        onClick={() => {
          onChange('full');
        }}
      >
        Voll
      </button>
    </div>
  );
}

/** Die gemerkte Schriftgröße; ohne Speicher im Browser die anfängliche. */
function storedFontSize(): number {
  try {
    const value = Number(localStorage.getItem(FONT_SIZE.key));
    return value >= FONT_SIZE.min && value <= FONT_SIZE.max ? value : FONT_SIZE.initial;
  } catch {
    return FONT_SIZE.initial;
  }
}

/**
 * Die Kopfzeile mit dem Weg zurück zu den Tabs, dem Namen und Ordner der Datei und der
 * Schriftgröße, darunter der Inhalt. Ein Ordner von `schrittmacher <ordner>` öffnet von hier aus
 * seinen Tab, eine weitere Markdown-Datei ersetzt diese.
 */
function Frame({
  file,
  children,
  noting = false,
  onToggleNoting,
  editing = false,
  dirty = false,
  onToggleEditing,
  tools,
  status,
  aside,
}: {
  file: MarkdownFile | null;
  children: ReactNode;
  editing?: boolean;
  dirty?: boolean;
  onToggleEditing?: () => void;
  /** Weitere Knöpfe in der Kopfzeile, vor der Schriftgröße. */
  tools?: ReactNode;
  /** Der Stand von Speichern und Sicherung, links von den Knöpfen. */
  status?: ReactNode;
  noting?: boolean;
  onToggleNoting?: () => void;
  aside?: ReactNode;
}) {
  const navigate = useNavigate();
  const [fontSize, setFontSize] = useState(storedFontSize);
  useRequests(async (view) => {
    await navigate({ to: '/', search: view });
  });
  const changeFontSize = (step: number) => {
    const next = Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, fontSize + step));
    setFontSize(next);
    try {
      localStorage.setItem(FONT_SIZE.key, String(next));
    } catch {
      // Ohne Speicher im Browser gilt die Größe bis zum Schließen.
    }
  };
  return (
    <div className="app">
      <header className="header">
        <div className="header-start">
          <button
            type="button"
            className="md-back"
            data-tip="Zurück zu den Tabs"
            onClick={() => {
              void navigate({ to: '/' });
            }}
          >
            ‹ Tabs
          </button>
          <span className="bar-separator" />
          {file !== null && (
            <span className="md-where" data-tip={file.path}>
              <span className="md-name">{file.name}</span>
              <span className="md-dir">{file.dir}</span>
            </span>
          )}
        </div>
        <div className="header-tools">
          {status}
          {onToggleEditing !== undefined && (
            <button
              type="button"
              className="md-noting"
              aria-pressed={editing}
              aria-label="Bearbeiten"
              data-tip={editing ? (dirty ? 'Speichern und zur Ansicht' : 'Zur Ansicht') : 'Bearbeiten'}
              onClick={onToggleEditing}
            >
              <PencilIcon />
            </button>
          )}
          {onToggleNoting !== undefined && !editing && (
            <button
              type="button"
              className="md-noting"
              aria-pressed={noting}
              aria-label="Hinweise"
              data-tip={noting ? 'Hinweise ausblenden' : 'Hinweise einblenden'}
              onClick={onToggleNoting}
            >
              <NoteIcon />
            </button>
          )}
          {tools}
          <div className="font-size" role="group" aria-label="Schriftgröße">
            <button
              type="button"
              aria-label="Schrift kleiner"
              data-tip={`Schrift kleiner (${String(fontSize)})`}
              onClick={() => {
                changeFontSize(-1);
              }}
            >
              A−
            </button>
            <button
              type="button"
              aria-label="Schrift größer"
              data-tip={`Schrift größer (${String(fontSize)})`}
              onClick={() => {
                changeFontSize(1);
              }}
            >
              A+
            </button>
          </div>
        </div>
      </header>
      <div className="md-body">
        <main className="md-scroll" key={file?.path} style={{ fontSize: `${String(fontSize)}px` }}>
          {children}
        </main>
        {aside}
      </div>
      <Tooltips />
    </div>
  );
}
