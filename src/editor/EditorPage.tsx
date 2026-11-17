import { useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CopyIcon, HoverTools } from '../viewer/HoverTools';
import { CheckMarkIcon, FetchIcon, FolderIcon, GitClientIcon, PencilIcon } from '../viewer/Icons';
import { MarkdownView } from '../viewer/Markdown';
import {
  backupEditorText,
  editorFileChanged,
  formatEditorText,
  loadEditorFile,
  openEditorFileIn,
  saveEditorFile,
  saveEditorHighlights,
} from './editor.functions';
import type { EditorApp, EditorFile } from './editor.functions';
import { CloseButton, DirtyContext, RecentMenu, useOpen } from './EditorLayout';
import { FigureDialog } from './FigureDialog';
import { anchorsOf as highlightAnchorsOf, resolveAnchors } from './highlights';
import type { Highlight, HighlightAnchor } from './highlights';
import { isMarkdownPath } from './languages';
import { MarkdownEditor } from './MarkdownEditor';
import { anchorsOf, lineForTop, topForLine } from './scrollSync';
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

/** Der Abstand der Fragen, ob sich die Datei außerhalb des Editors geändert hat, in Millisekunden. */
const CHANGE_INTERVAL = 1500;

/** So lange zeigt ein Knopf nach dem Kopieren ein Häkchen, in Millisekunden. */
const COPIED_DURATION = 1200;

/** So lange wartet das Speichern der Markierungen nach der letzten Änderung, in Millisekunden. */
const HIGHLIGHT_SAVE_DELAY = 800;

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

/**
 * Wie die Vorschau neben dem Text folgt: gar nicht, der Zeile des Cursors oder dem Scrollen, dann
 * in beide Richtungen.
 */
type Follow = 'off' | 'cursor' | 'scroll';

/** Die Arten des Folgens im Umschalter, in seiner Reihenfolge. */
const FOLLOWS: { follow: Follow; label: string; tip: string }[] = [
  { follow: 'off', label: 'Aus', tip: 'Die Vorschau bleibt, wo sie ist' },
  { follow: 'cursor', label: 'Cursor', tip: 'Die Vorschau zeigt die Zeile des Cursors' },
  { follow: 'scroll', label: 'Scrollen', tip: 'Text und Vorschau scrollen gemeinsam, in beide Richtungen' },
];

/** Unter diesem Schlüssel merkt sich der Browser, wie die Vorschau folgt. */
const FOLLOW_KEY = 'schrittmacher.editor.follow';

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

function storedFollow(): Follow {
  const value = stored(FOLLOW_KEY);
  return value === 'off' || value === 'scroll' ? value : 'cursor';
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
 * Der Editor für eine Textdatei unter `/edit`, mit Speichern, automatischer Sicherung und
 * Formatieren (`docs/editor.md`). Eine Markdown-Datei zeigt Text, Vorschau oder beides
 * nebeneinander, jede andere nur den Text. Die Seite hängt nicht an den Tabs von Schrittmacher und
 * kennt keine Hinweise. `root` ist der Workspace, in dem die Datei offen ist.
 */
export function EditorPage({ file, root }: { file: EditorFile; root: string | null }) {
  const open = useOpen();
  const dirtyRef = useContext(DirtyContext);
  const markdown = isMarkdownPath(file.path);
  const [edited, setEdited] = useState(file.text);
  const [saved, setSaved] = useState(file.text);
  const [exists, setExists] = useState(file.exists);
  const dirty = edited !== saved;
  useEffect(() => {
    if (dirtyRef !== null) {
      dirtyRef.current = dirty;
    }
  }, [dirty]);
  const [chosenMode, setMode] = useState(storedMode);
  // Nur Markdown hat eine Vorschau; jede andere Datei zeigt den Text.
  const mode: Mode = markdown ? chosenMode : 'text';
  const [fontSize, setFontSize] = useState(storedFontSize);
  const [editorWidth, setEditorWidth] = useState(() =>
    storedWidth(EDITOR_WIDTH.key, EDITOR_WIDTH.min, EDITOR_WIDTH.normal),
  );
  const [splitWidth, setSplitWidth] = useState(() => storedWidth(SPLIT_WIDTH.key, SPLIT_WIDTH.min, 'full'));
  const [ratio, setRatio] = useState(storedRatio);
  const [cursorLine, setCursorLine] = useState(1);
  // Die Markierungen beim Öffnen, im Text der Datei wiedergefunden; was fehlt, bleibt gespeichert.
  const [initialHighlights] = useState(() => resolveAnchors(file.text, file.highlights));
  const [highlights, setHighlights] = useState<Highlight[]>(initialHighlights.found);
  const [lostHighlights, setLostHighlights] = useState<HighlightAnchor[]>(initialHighlights.lost);
  const frame = useRef<HTMLDivElement>(null);
  const previewScroll = useRef<HTMLElement>(null);
  const textScroll = useRef<HTMLElement>(null);
  const [follow, setFollow] = useState(storedFollow);
  const changeFollow = (next: Follow) => {
    setFollow(next);
    store(FOLLOW_KEY, next);
  };
  // Die Höhe, die das Mitscrollen zuletzt auf einer Seite gesetzt hat. Das Scrollen, das daraus
  // folgt, löst kein Mitscrollen der anderen Seite aus, sonst schaukeln sich beide auf.
  const expected = useRef<{ text: number | null; preview: number | null }>({ text: null, preview: null });
  const ownScroll = (side: 'text' | 'preview', top: number) => {
    const value = expected.current[side];
    expected.current[side] = null;
    return value !== null && Math.abs(value - top) < 2;
  };
  const syncPreview = () => {
    const text = textScroll.current;
    const preview = previewScroll.current;
    if (text === null || preview === null || editor.current === null) {
      return;
    }
    const top = topForLine(anchorsOf(preview), editor.current.topLine(text));
    if (Math.abs(preview.scrollTop - top) >= 1) {
      preview.scrollTop = top;
      expected.current.preview = preview.scrollTop;
    }
  };
  const syncText = () => {
    const text = textScroll.current;
    const preview = previewScroll.current;
    if (text === null || preview === null || editor.current === null) {
      return;
    }
    const before = text.scrollTop;
    const after = editor.current.scrollToLine(text, lineForTop(anchorsOf(preview), preview.scrollTop));
    if (Math.abs(after - before) >= 1) {
      expected.current.text = after;
    }
  };
  const editor = useRef<EditorHandle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Ein Bild aus der Zwischenablage, für das der Dialog nach dem Namen der neuen Datei fragt.
  const [pastedImage, setPastedImage] = useState<File | null>(null);
  const changeMode = (next: Mode) => {
    if (!markdown) {
      return;
    }
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

  // Nebeneinander hebt die Vorschau den Block, in dem der Cursor steht, leicht hervor. Beim Folgen
  // des Cursors scrollt sie ihn außerdem in den sichtbaren Bereich.
  useEffect(() => {
    const container = previewScroll.current;
    if (mode !== 'split' || follow === 'off' || container === null) {
      return;
    }
    const block = blockAt(container, cursorLine);
    if (block === null) {
      return;
    }
    block.classList.add('editor-cursor-block');
    if (follow !== 'cursor') {
      return () => {
        block.classList.remove('editor-cursor-block');
      };
    }
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
  }, [cursorLine, edited, mode, ratio, follow]);
  // Beim gemeinsamen Scrollen folgt die Vorschau auch einer Änderung am Text und dem Umschalten.
  useEffect(() => {
    if (mode === 'split' && follow === 'scroll') {
      syncPreview();
    }
  }, [edited, mode, ratio, follow]);

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
  // Beim Verlassen der Datei wird gesichert, was noch nicht gesichert ist. Danach gilt die Seite
  // nicht mehr als ungespeichert.
  const latestText = useRef(edited);
  latestText.current = edited;
  useEffect(
    () => () => {
      if (latestText.current !== lastBackup.current.text) {
        runBackup(latestText.current);
      }
      if (dirtyRef !== null) {
        dirtyRef.current = false;
      }
    },
    [],
  );

  // Der Stand der Datei, den der Editor zuletzt gelesen oder geschrieben hat. Weicht ihre letzte
  // Änderung davon ab, hat sie sich außerhalb des Editors geändert.
  const known = useRef(file.changed);
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      editorFileChanged({ data: { path: file.path } }).then(
        (changed) => {
          setOutdated(changed !== null && changed !== known.current);
        },
        () => {
          // Der Server ist kurz nicht erreichbar; die nächste Frage versucht es wieder.
        },
      );
    }, CHANGE_INTERVAL);
    return () => {
      clearInterval(timer);
    };
  }, [file.path]);
  const reload = async () => {
    if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen und den Stand der Datei laden? Gesichert werden sie vorher.')) {
      return;
    }
    try {
      if (dirty) {
        runBackup(edited);
      }
      const current = await loadEditorFile({ data: { path: file.path } });
      // Vor dem Ersetzen gilt der neue Text als gesichert, damit er keine Sicherung auslöst.
      lastBackup.current = { text: current.text, pendingSince: null };
      editor.current?.replace(current.text);
      setEdited(current.text);
      setSaved(current.text);
      known.current = current.changed;
      setOutdated(false);
      setNotice(null);
    } catch (error) {
      setNotice(`Laden gescheitert: ${messageOf(error)}`);
    }
  };

  const save = async () => {
    const text = edited;
    try {
      known.current = await saveEditorFile({ data: { path: file.path, text } });
      setOutdated(false);
      setSaved(text);
      setExists(true);
      setNotice(null);
      runBackup(text);
    } catch (error) {
      setNotice(`Speichern gescheitert: ${messageOf(error)}`);
    }
  };
  const formatText = async (text: string): Promise<string> => {
    if (!file.formattable) {
      setNotice('Formatieren nicht möglich: Für diese Art von Datei kennt Prettier keine Formatierung.');
      return text;
    }
    try {
      setNotice(null);
      return await formatEditorText({ data: { path: file.path, text } });
    } catch (error) {
      setNotice(`Formatieren gescheitert: ${messageOf(error)}`);
      return text;
    }
  };

  // Die Markierungen werden kurz nach jeder Änderung an ihnen oder am Text gespeichert, mit dem Text
  // im Editor. Ungespeicherter Text lässt sich deshalb beim nächsten Öffnen vielleicht nicht finden.
  const savedHighlights = useRef(
    JSON.stringify([...highlightAnchorsOf(file.text, initialHighlights.found), ...initialHighlights.lost]),
  );
  useEffect(() => {
    const anchors = [...highlightAnchorsOf(edited, highlights), ...lostHighlights];
    const json = JSON.stringify(anchors);
    if (json === savedHighlights.current) {
      return;
    }
    const timer = setTimeout(() => {
      saveEditorHighlights({ data: { path: file.path, highlights: anchors } }).then(
        () => {
          savedHighlights.current = json;
        },
        (error: unknown) => {
          setNotice(`Markierungen nicht gespeichert: ${messageOf(error)}`);
        },
      );
    }, HIGHLIGHT_SAVE_DELAY);
    return () => {
      clearTimeout(timer);
    };
  }, [edited, highlights, lostHighlights, file.path]);

  // ⌘1 bis ⌘3 wechseln die Anzeige, auch wenn der Text keinen Fokus hat.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!markdown) {
        return;
      }
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
          <RecentMenu />
          <FileTitle
            file={file}
            onError={(message) => {
              setNotice(message);
            }}
          />
        </div>
        <div className="header-tools">
          <EditorStatus dirty={dirty} exists={exists} backedUp={backedUp} notice={notice} />
          <button
            type="button"
            className={outdated ? 'editor-reload editor-reload-outdated' : 'editor-reload'}
            aria-label="Neu laden"
            data-tip={
              outdated
                ? 'Die Datei hat sich außerhalb des Editors geändert: ihren Stand laden'
                : 'Den Stand der Datei neu laden'
            }
            onClick={() => {
              void reload();
            }}
          >
            <FetchIcon />
            {outdated && <span>Datei geändert</span>}
          </button>
          {markdown && (
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
          )}
          {showsText && (
            <HighlightControl
              count={highlights.length}
              lost={lostHighlights}
              onToggle={() => {
                editor.current?.toggleHighlight();
              }}
              onNext={() => {
                editor.current?.nextHighlight();
              }}
              onDiscardLost={() => {
                setLostHighlights([]);
              }}
            />
          )}
          {showsText && file.formattable && (
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
          {mode === 'split' && (
            <div className="md-width" role="group" aria-label="Folgen">
              <span className="md-width-label">Folgen</span>
              {FOLLOWS.map((entry) => (
                <button
                  key={entry.follow}
                  type="button"
                  aria-pressed={follow === entry.follow}
                  data-tip={entry.tip}
                  onClick={() => {
                    changeFollow(entry.follow);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
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
          <CloseButton path={file.path} root={root} />
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
            ref={textScroll}
            onScroll={(event) => {
              if (!ownScroll('text', event.currentTarget.scrollTop) && mode === 'split' && follow === 'scroll') {
                syncPreview();
              }
            }}
            hidden={!showsText}
            style={mode === 'split' ? { flex: `0 0 ${String(ratio * 100)}%` } : undefined}
          >
            <MarkdownEditor
              path={file.path}
              text={file.text}
              highlights={initialHighlights.found}
              onHighlights={setHighlights}
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
              onPasteImage={markdown ? setPastedImage : undefined}
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
            <main
              className="md-scroll editor-preview"
              ref={previewScroll}
              onScroll={(event) => {
                if (!ownScroll('preview', event.currentTarget.scrollTop) && mode === 'split' && follow === 'scroll') {
                  syncText();
                }
              }}
            >
              <MarkdownView
                text={edited}
                dir={file.dir}
                noting={null}
                highlights={highlights}
                onOpen={(path) => {
                  open(path, root !== null && path.startsWith(`${root}/`) ? root : null);
                }}
              />
            </main>
          )}
        </div>
      </div>
      {pastedImage !== null && (
        <FigureDialog
          image={pastedImage}
          path={file.path}
          dir={
            root !== null && (file.dir === root || file.dir.startsWith(`${root}/`))
              ? root.slice(root.lastIndexOf('/') + 1) + file.dir.slice(root.length)
              : file.dir
          }
          root={root}
          onInsert={(text) => {
            editor.current?.insert(text);
          }}
          onClose={() => {
            setPastedImage(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Der Knopf zum Markieren der Auswahl, daneben die Zahl der Markierungen, die zur nächsten springt.
 * Markierungen, die sich beim Öffnen nicht mehr fanden, stehen dahinter und lassen sich verwerfen.
 */
function HighlightControl({
  count,
  lost,
  onToggle,
  onNext,
  onDiscardLost,
}: {
  count: number;
  lost: HighlightAnchor[];
  onToggle: () => void;
  onNext: () => void;
  onDiscardLost: () => void;
}) {
  return (
    <div className="md-width" role="group" aria-label="Markierungen">
      <button
        type="button"
        data-tip="Auswahl markieren oder Markierung aufheben (⌘⇧M)"
        // Der Knopf nimmt dem Editor nicht den Fokus, damit die Auswahl bleibt.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={onToggle}
      >
        Markieren
      </button>
      {count > 0 && (
        <button
          type="button"
          className="editor-highlight-count"
          data-tip="Zur nächsten Markierung"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onNext}
        >
          {count}
        </button>
      )}
      {lost.length > 0 && (
        <button
          type="button"
          className="editor-highlight-lost"
          data-tip={`Nicht wiedergefunden: ${lost.map((anchor) => `„${anchor.text}“`).join(', ')}. Klick verwirft sie.`}
          onClick={() => {
            if (window.confirm('Die nicht wiedergefundenen Markierungen verwerfen?')) {
              onDiscardLost();
            }
          }}
        >
          {`${String(lost.length)} nicht gefunden`}
        </button>
      )}
    </div>
  );
}

/**
 * Der Name der Datei, groß, mit ihrem Ordner daneben. Beim Überfahren erscheinen Knöpfe zum Kopieren
 * des Pfads und zum Öffnen in ForkLift, Fork und BBEdit.
 */
function FileTitle({ file, onError }: { file: EditorFile; onError: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_DURATION);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  const open = (app: EditorApp) => {
    openEditorFileIn({ data: { path: file.path, app } }).catch((error: unknown) => {
      onError(`Öffnen gescheitert: ${messageOf(error)}`);
    });
  };
  const apps: { app: EditorApp; tip: string; icon: ReactNode }[] = [
    { app: 'forklift', tip: 'Ordner in ForkLift öffnen', icon: <FolderIcon /> },
    { app: 'fork', tip: 'Repo in Fork öffnen', icon: <GitClientIcon /> },
    { app: 'bbedit', tip: 'Datei in BBEdit öffnen', icon: <PencilIcon /> },
  ];
  return (
    <span className="editor-title hover-tools-host">
      <span className="editor-name" data-tip={file.path}>
        {file.name}
      </span>
      <span className="md-dir">{file.dir}</span>
      <HoverTools>
        <button
          type="button"
          className="hover-tool"
          aria-label="Pfad kopieren"
          data-tip={copied ? 'Kopiert' : 'Pfad kopieren'}
          onClick={() => {
            navigator.clipboard.writeText(file.path).then(
              () => {
                setCopied(true);
              },
              (error: unknown) => {
                onError(`Kopieren gescheitert: ${messageOf(error)}`);
              },
            );
          }}
        >
          {copied ? <CheckMarkIcon /> : <CopyIcon />}
        </button>
        {apps.map((entry) => (
          <button
            key={entry.app}
            type="button"
            className="hover-tool"
            aria-label={entry.tip}
            data-tip={entry.tip}
            onClick={() => {
              open(entry.app);
            }}
          >
            {entry.icon}
          </button>
        ))}
      </HoverTools>
    </span>
  );
}

/**
 * Der Stand im Editor: ob es ungespeicherte Änderungen gibt, wann und wohin zuletzt gesichert
 * wurde, und eine Meldung, wenn Speichern, Sichern oder Formatieren gescheitert ist.
 */
function EditorStatus({
  dirty,
  exists,
  backedUp,
  notice,
}: {
  dirty: boolean;
  /** Ob es die Datei gibt; eine neue entsteht erst beim Speichern. */
  exists: boolean;
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
  if (!exists) {
    return (
      <span className="md-save-state" data-tip="Die Datei gibt es noch nicht; ⌘S legt sie an">
        Neue Datei, ⌘S
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
