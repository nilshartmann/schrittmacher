import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { MarkdownView } from '../viewer/Markdown';
import { Tooltips } from '../viewer/Tooltips';
import { useRequests } from '../viewer/useRequests';
import { backupEditorText, formatEditorText, saveEditorFile } from './editor.functions';
import type { EditorFile } from './editor.functions';
import { MarkdownEditor } from './MarkdownEditor';
import type { EditorHandle } from './MarkdownEditor';

/** Die Schriftgröße in Pixeln, mit ihren Grenzen; gemerkt wird sie im Browser. */
const FONT_SIZE = { initial: 16, min: 12, max: 28, key: 'schrittmacher.editor.fontSize' };

/**
 * Die Breite der Textfläche in Pixeln, mit ihrer kleinsten; `'full'` nimmt die ganze Breite.
 * Gemerkt wird sie im Browser.
 */
const EDITOR_WIDTH = { normal: 900, min: 480, key: 'schrittmacher.markdown.editorWidth' };

/**
 * Die Breite von Text und Vorschau nebeneinander, zusammen und in Pixeln, mit ihrer kleinsten;
 * anfangs die ganze Breite. Gemerkt wird sie im Browser.
 */
const SPLIT_WIDTH = { min: 760, key: 'schrittmacher.editor.splitWidth' };

/** Der Anteil des Texts nebeneinander mit der Vorschau, mit seinen Grenzen. */
const SPLIT_RATIO = { initial: 0.5, min: 0.2, max: 0.8, key: 'schrittmacher.editor.splitRatio' };

/** Unter diesem Schlüssel merkt sich der Browser, was der Editor zeigt. */
const MODE_KEY = 'schrittmacher.editor.mode';

/**
 * Wann der Editor ungespeicherten Text sichert, in Millisekunden: nach einer Pause im Tippen,
 * spätestens aber eine Weile nach der ersten Änderung seit der letzten Sicherung.
 */
const BACKUP = { pause: 5000, latest: 30000 };

/** So lange zeigt die Kopfzeile nach einer Sicherung, wohin sie ging, in Millisekunden. */
const BACKUP_FLASH = 4000;

/** Die Breite der Textfläche. */
type EditorWidth = number | 'full';

/** Was der Editor zeigt: nur den Text, Text und Vorschau nebeneinander oder nur die Vorschau. */
type Mode = 'text' | 'split' | 'preview';

/** Die Arten der Anzeige im Umschalter, in seiner Reihenfolge. */
const MODES: { mode: Mode; label: string; tip: string }[] = [
  { mode: 'text', label: 'Text', tip: 'Nur den Text (⌘1)' },
  { mode: 'split', label: 'Geteilt', tip: 'Text und Vorschau nebeneinander (⌘2)' },
  { mode: 'preview', label: 'Vorschau', tip: 'Nur die Vorschau (⌘3)' },
];

/** Die letzte Sicherung: wann, wohin und, in einem Repo, der Commit. */
interface BackedUp {
  at: Date;
  where: string;
  commit: string | null;
}

/** Liest einen Wert aus dem Speicher im Browser; ohne Speicher `null`. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Schreibt einen Wert in den Speicher im Browser; ohne Speicher gilt er bis zum Schließen. */
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ohne Speicher im Browser gilt der Wert bis zum Schließen.
  }
}

function storedFontSize(): number {
  const value = Number(stored(FONT_SIZE.key));
  return value >= FONT_SIZE.min && value <= FONT_SIZE.max ? value : FONT_SIZE.initial;
}

/** Eine gemerkte Breite; ohne Speicher oder unter der kleinsten `fallback`. */
function storedWidth(key: string, min: number, fallback: EditorWidth): EditorWidth {
  const value = stored(key);
  if (value === 'full') {
    return 'full';
  }
  const width = Number(value);
  return value !== null && width >= min ? width : fallback;
}

function storedRatio(): number {
  const value = Number(stored(SPLIT_RATIO.key));
  return value >= SPLIT_RATIO.min && value <= SPLIT_RATIO.max ? value : SPLIT_RATIO.initial;
}

/**
 * Der Block der Vorschau zu einer Zeile der Datei: der kleinste, der sie umfasst, sonst der letzte
 * davor, etwa für eine leere Zeile zwischen zwei Blöcken.
 */
function blockAt(container: Element, line: number): HTMLElement | null {
  let inside: { element: HTMLElement; size: number } | null = null;
  let before: { element: HTMLElement; to: number } | null = null;
  for (const element of container.querySelectorAll<HTMLElement>('[data-ref-from]')) {
    const from = Number(element.dataset.refFrom);
    const to = Number(element.dataset.refTo);
    if (from <= line && line <= to) {
      if (inside === null || to - from < inside.size) {
        inside = { element, size: to - from };
      }
    } else if (to < line && (before === null || to >= before.to)) {
      before = { element, to };
    }
  }
  return inside?.element ?? before?.element ?? null;
}

function storedMode(): Mode {
  const value = stored(MODE_KEY);
  return value === 'split' || value === 'preview' ? value : 'text';
}

/** Eine Uhrzeit wie `15:58`. */
function timeOf(date: Date): string {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Die Meldung eines Fehlers als Text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Der Editor für eine Markdown-Datei unter `/edit`: Text, Vorschau oder beides nebeneinander, mit
 * Speichern, automatischer Sicherung und Formatieren (`docs/editor.md`). Die Seite hängt nicht an
 * den Tabs von Schrittmacher und kennt keine Hinweise.
 */
export function EditorPage({ file }: { file: EditorFile }) {
  const navigate = useNavigate();
  useRequests(async (view) => {
    await navigate({ to: '/', search: view });
  });
  const [edited, setEdited] = useState(file.text);
  const [saved, setSaved] = useState(file.text);
  const dirty = edited !== saved;
  const [mode, setMode] = useState(storedMode);
  const [fontSize, setFontSize] = useState(storedFontSize);
  const [editorWidth, setEditorWidth] = useState(() =>
    storedWidth(EDITOR_WIDTH.key, EDITOR_WIDTH.min, EDITOR_WIDTH.normal),
  );
  const [splitWidth, setSplitWidth] = useState(() => storedWidth(SPLIT_WIDTH.key, SPLIT_WIDTH.min, 'full'));
  const [ratio, setRatio] = useState(storedRatio);
  const [cursorLine, setCursorLine] = useState(1);
  const frame = useRef<HTMLDivElement>(null);
  const previewScroll = useRef<HTMLElement>(null);
  const editor = useRef<EditorHandle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const changeMode = (next: Mode) => {
    setMode(next);
    store(MODE_KEY, next);
  };
  const changeFontSize = (step: number) => {
    const next = Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, fontSize + step));
    setFontSize(next);
    store(FONT_SIZE.key, String(next));
  };
  const changeEditorWidth = (next: EditorWidth) => {
    setEditorWidth(next);
    store(EDITOR_WIDTH.key, String(next));
  };
  const changeSplitWidth = (next: EditorWidth) => {
    setSplitWidth(next);
    store(SPLIT_WIDTH.key, String(next));
  };
  // Der Trenner zwischen Text und Vorschau verschiebt das Verhältnis live, wie ein Fensterrahmen.
  const [dividing, setDividing] = useState(false);
  const moveDivider = (clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) {
      return;
    }
    const next = Math.min(SPLIT_RATIO.max, Math.max(SPLIT_RATIO.min, (clientX - box.left) / box.width));
    setRatio(next);
  };

  // Nebeneinander zeigt die Vorschau den Block, in dem der Cursor steht, und hebt ihn leicht hervor.
  useEffect(() => {
    const container = previewScroll.current;
    if (mode !== 'split' || container === null) {
      return;
    }
    const block = blockAt(container, cursorLine);
    if (block === null) {
      return;
    }
    block.classList.add('editor-cursor-block');
    const view = container.getBoundingClientRect();
    const box = block.getBoundingClientRect();
    const margin = view.height * 0.15;
    if (box.top < view.top + margin || box.bottom > view.bottom - margin) {
      // Der Block steht danach im oberen Drittel, ein hoher Block mit seinem Anfang.
      const offset = box.height > view.height * 0.6 ? margin : view.height / 3 - box.height / 2;
      container.scrollTop += box.top - view.top - offset;
    }
    return () => {
      block.classList.remove('editor-cursor-block');
    };
  }, [cursorLine, edited, mode, ratio]);

  // Die letzte Sicherung und seit wann es Text gibt, der noch nicht gesichert ist.
  const lastBackup = useRef<{ text: string; pendingSince: number | null }>({ text: file.text, pendingSince: null });
  const [backedUp, setBackedUp] = useState<BackedUp | null>(null);
  const runBackup = (text: string) => {
    lastBackup.current = { text, pendingSince: null };
    backupEditorText({ data: { path: file.path, text } }).then(
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
        setNotice(`Sicherung gescheitert: ${messageOf(error)}`);
      },
    );
  };
  useEffect(() => {
    if (edited === lastBackup.current.text) {
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
  }, [edited]);

  const save = async () => {
    const text = edited;
    try {
      await saveEditorFile({ data: { path: file.path, text } });
      setSaved(text);
      setNotice(null);
      runBackup(text);
    } catch (error) {
      setNotice(`Speichern gescheitert: ${messageOf(error)}`);
    }
  };
  const formatText = async (text: string): Promise<string> => {
    try {
      setNotice(null);
      return await formatEditorText({ data: { path: file.path, text } });
    } catch (error) {
      setNotice(`Formatieren gescheitert: ${messageOf(error)}`);
      return text;
    }
  };

  // ⌘1 bis ⌘3 wechseln die Anzeige, auch wenn der Text keinen Fokus hat.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const index = ['1', '2', '3'].indexOf(event.key);
      const entry = MODES[index];
      if (event.metaKey && !event.shiftKey && !event.altKey && entry !== undefined) {
        event.preventDefault();
        changeMode(entry.mode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
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

  const showsText = mode !== 'preview';
  return (
    <div className="app">
      <header className="header">
        <div className="header-start">
          <span className="md-where" data-tip={file.path}>
            <span className="md-name">{file.name}</span>
            <span className="md-dir">{file.dir}</span>
          </span>
        </div>
        <div className="header-tools">
          <EditorStatus dirty={dirty} backedUp={backedUp} notice={notice} />
          <div className="md-width" role="group" aria-label="Anzeige">
            {MODES.map((entry) => (
              <button
                key={entry.mode}
                type="button"
                aria-pressed={mode === entry.mode}
                data-tip={entry.tip}
                onClick={() => {
                  changeMode(entry.mode);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {showsText && (
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
          )}
          {mode === 'text' && (
            <WidthControl width={editorWidth} normal={EDITOR_WIDTH.normal} onChange={changeEditorWidth} />
          )}
          {mode === 'split' && <WidthControl width={splitWidth} normal={null} onChange={changeSplitWidth} />}
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
      <div className={`md-body editor-${mode}`} style={{ fontSize: `${String(fontSize)}px` }}>
        <div
          className="editor-frame"
          ref={frame}
          style={mode === 'split' && splitWidth !== 'full' ? { maxWidth: `${String(splitWidth)}px` } : undefined}
        >
          {/* Der Editor bleibt auch in der Vorschau bestehen, damit Cursor und Verlauf erhalten bleiben. */}
          <main
            className="md-scroll editor-text"
            hidden={!showsText}
            style={mode === 'split' ? { flex: `0 0 ${String(ratio * 100)}%` } : undefined}
          >
            <MarkdownEditor
              text={file.text}
              width={mode === 'text' && editorWidth !== 'full' ? editorWidth : null}
              resizable={showsText}
              outer={mode === 'split' ? frame : null}
              minWidth={mode === 'split' ? SPLIT_WIDTH.min : EDITOR_WIDTH.min}
              snapWidth={mode === 'split' ? null : EDITOR_WIDTH.normal}
              onWidth={(next) => {
                (mode === 'split' ? changeSplitWidth : changeEditorWidth)(next ?? 'full');
              }}
              onCursor={setCursorLine}
              handle={editor}
              onFormat={formatText}
              onChange={setEdited}
              onSave={() => {
                void save();
              }}
            />
          </main>
          {mode === 'split' && (
            <div
              className={dividing ? 'editor-divider editor-divider-dragging' : 'editor-divider'}
              data-tip={dividing ? undefined : 'Ziehen ändert das Verhältnis, Doppelklick halbiert'}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDividing(true);
              }}
              onPointerMove={(event) => {
                if (dividing) {
                  moveDivider(event.clientX);
                }
              }}
              onPointerUp={() => {
                setDividing(false);
                store(SPLIT_RATIO.key, String(ratio));
              }}
              onPointerCancel={() => {
                setDividing(false);
              }}
              onDoubleClick={() => {
                setRatio(SPLIT_RATIO.initial);
                store(SPLIT_RATIO.key, String(SPLIT_RATIO.initial));
              }}
            />
          )}
          {mode !== 'text' && (
            <main className="md-scroll editor-preview" ref={previewScroll}>
              <MarkdownView
                text={edited}
                dir={file.dir}
                noting={null}
                onOpen={(path) => {
                  if (!dirty || window.confirm('Ungespeicherte Änderungen verwerfen? Gesichert sind sie trotzdem.')) {
                    void navigate({ to: '/edit', search: { path } });
                  }
                }}
              />
            </main>
          )}
        </div>
      </div>
      <Tooltips />
    </div>
  );
}

/**
 * Der Stand im Editor: ob es ungespeicherte Änderungen gibt, wann und wohin zuletzt gesichert
 * wurde, und eine Meldung, wenn Speichern, Sichern oder Formatieren gescheitert ist.
 */
function EditorStatus({ dirty, backedUp, notice }: { dirty: boolean; backedUp: BackedUp | null; notice: string | null }) {
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
 * Die Knöpfe für die normale und die volle Breite der Textfläche. Jede andere Breite entsteht durch
 * Ziehen am Strich neben den Zeilennummern.
 */
function WidthControl({
  width,
  normal,
  onChange,
}: {
  width: EditorWidth;
  /** Die normale Breite; `null` ohne Knopf dafür. */
  normal: number | null;
  onChange: (width: EditorWidth) => void;
}) {
  return (
    <div className="md-width" role="group" aria-label="Breite des Editors">
      {normal !== null && (
        <button
          type="button"
          aria-pressed={width === normal}
          data-tip={`Normale Breite (${String(normal)} px)`}
          onClick={() => {
            onChange(normal);
          }}
        >
          Normal
        </button>
      )}
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
