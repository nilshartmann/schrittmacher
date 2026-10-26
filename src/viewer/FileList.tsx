import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { DiffFile } from '../git/types';
import { HoverTools, MenuToolButton } from './HoverTools';
import { NoteIcon } from './Icons';
import type { CopyTarget } from './HoverTools';
import { OpenInMenu } from './OpenInMenu';
import type { MenuCopyTo } from './OpenInMenu';

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** Die Zeichen der Arten wie in Fork: M für geändert, + für neu, − für gelöscht, → für umbenannt. */
const KIND_SIGN = { changed: 'M', added: '+', deleted: '−', renamed: '→' } as const;

/** Der Pfad als Tooltip, bei einer Umbenennung mit dem alten davor. */
function pathTip(file: DiffFile): string {
  return file.kind === 'renamed' ? `${file.oldPath} → ${file.path}` : file.path;
}

/** Ein Pfad mit grauem Ordner und hervorgehobenem Dateinamen. */
function PathText({ path }: { path: string }) {
  return (
    <span className="path">
      {/* Die Marken halten die Schrägstriche trotz `direction: rtl` an ihrem Platz. */}
      <span className="path-folder">{`\u200e${folderOf(path)}\u200e`}</span>
      <span className="path-name">{nameOf(path)}</span>
    </span>
  );
}

/** Das Kopieren nach `copyTo` für eine Datei, wie es das Menü braucht. */
function copyToFor(copyTo: CopyTo, path: string): MenuCopyTo {
  return { load: copyTo.load, onCopy: (target) => copyTo.onCopy(path, target) };
}

/** Die Grenzen der Breite der Dateiliste in Pixeln; der Rest bleibt mindestens für den Diff. */
export const FILES_WIDTH = { min: 140, start: 300, restMin: 400 };

/** Die Haken der Dateien für einen Commit; gemerkt werden die Dateien ohne Haken. */
export interface Selection {
  unchecked: ReadonlySet<string>;
  onChange: (unchecked: ReadonlySet<string>) => void;
}

/** Die Ziele, in die sich eine Datei kopieren lässt, und das Kopieren selbst. */
export interface CopyTo {
  load: () => Promise<CopyTarget[]>;
  onCopy: (path: string, target: string) => Promise<void>;
}

/**
 * Die Dateien des Vergleichs als Spalte links vom Diff, mit einer Trennlinie für die Breite. Jede
 * Datei steht mit ihrem ganzen Pfad da; wird es eng, kürzt er vorn, damit der Dateiname bleibt.
 * Hat die Liste den Fokus, wählen ↑ und ↓ die Datei darüber oder darunter. Mit `selection` hat
 * jede Datei einen Haken, darüber stehen Knöpfe für alle und keine, und die Leertaste schaltet den
 * Haken der gewählten Datei um. Über jeder Datei erscheint ein Knopf mit einem Menü, das ihren
 * Ordner in `worktree` in einem anderen Programm öffnet oder ihren Pfad kopiert; ein Rechtsklick
 * öffnet dasselbe Menü. Mit `copyTo` kopiert es eine Datei, die es nachher gibt, in einen anderen
 * Tab. Unter der Liste steht `footer`.
 */
export function FileList({
  worktree,
  files,
  current,
  onChoose,
  width,
  onWidth,
  selection,
  copyTo,
  footer,
}: {
  worktree: string;
  files: DiffFile[];
  current: string;
  onChoose: (path: string) => void;
  width: number;
  onWidth: (width: number) => void;
  selection?: Selection;
  copyTo?: CopyTo;
  footer?: ReactNode;
}) {
  const list = useRef<HTMLElement>(null);
  const [context, setContext] = useState<{ file: DiffFile; at: { x: number; y: number } } | null>(null);
  const closeContext = useCallback(() => {
    setContext(null);
  }, []);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  const toggle = (path: string) => {
    if (selection === undefined) {
      return;
    }
    const next = new Set(selection.unchecked);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    selection.onChange(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Die Leertaste auf einem Haken schaltet ihn schon selbst um.
    if (event.key === ' ' && selection !== undefined && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      toggle(current);
      return;
    }
    if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.metaKey || event.altKey || event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const at = files.findIndex((file) => file.path === current);
    const next = files[Math.max(0, at) + (event.key === 'ArrowUp' ? -1 : 1)];
    if (next !== undefined) {
      onChoose(next.path);
    }
  };
  return (
    <>
    <div className="files-column" style={{ width }}>
    {selection !== undefined && (
      <div className="files-tools">
        <button
          type="button"
          className="icon-button"
          aria-label="Alle auswählen"
          data-tip="Alle auswählen"
          onClick={() => {
            selection.onChange(new Set());
          }}
        >
          <CheckAllIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Auswahl aufheben"
          data-tip="Auswahl aufheben"
          onClick={() => {
            selection.onChange(new Set(files.map((file) => file.path)));
          }}
        >
          <CheckNoneIcon />
        </button>
      </div>
    )}
    <nav ref={list} className="file-list" aria-label="Dateien" tabIndex={0} onKeyDown={onKeyDown}>
      <ol>
        {files.map((file) => (
          <li
            key={file.path}
            className="hover-tools-host"
            onContextMenu={(event) => {
              event.preventDefault();
              setContext({ file, at: { x: event.clientX, y: event.clientY } });
            }}
          >
            {selection !== undefined && (
              <input
                type="checkbox"
                className="file-check"
                aria-label={`${file.path} committen`}
                checked={!selection.unchecked.has(file.path)}
                onChange={() => {
                  toggle(file.path);
                }}
              />
            )}
            <button
              type="button"
              className="file"
              aria-current={file.path === current ? 'true' : undefined}
              data-tip={pathTip(file)}
              onClick={() => {
                onChoose(file.path);
              }}
            >
              <span className={`file-kind file-kind-${file.kind}`}>{KIND_SIGN[file.kind]}</span>
              <PathText path={file.path} />
            </button>
            <HoverTools>
              <MenuToolButton
                tip="Aktionen"
                expanded={context?.file.path === file.path}
                onOpen={(at) => {
                  setContext({ file, at });
                }}
              />
            </HoverTools>
          </li>
        ))}
      </ol>
    </nav>
    {context !== null && (
      <OpenInMenu
        worktree={worktree}
        path={context.file.path}
        at={context.at}
        copies={[{ label: 'Vollen Pfad kopieren', text: `${worktree}/${context.file.path}` }]}
        copyTo={copyTo === undefined || context.file.kind === 'deleted' ? undefined : copyToFor(copyTo, context.file.path)}
        onClose={closeContext}
      />
    )}
    {footer}
    </div>
    <WidthSplitter width={width} onWidth={onWidth} limits={FILES_WIDTH} label="Breite der Dateiliste" />
    </>
  );
}

/** Ein Kästchen mit Haken: alle Dateien anhaken. */
function CheckAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 8.2l2.4 2.4 4.6-5.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Ein leeres Kästchen: alle Haken entfernen. */
function CheckNoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * Die Trennlinie neben einer Spalte am Rand, etwa rechts der Dateiliste. Ziehen ändert die Breite,
 * ein Doppelklick stellt sie zurück. Mit `end` steht die Spalte am rechten Rand und wird breiter,
 * wenn die Linie nach links wandert. Dem Diff bleiben mindestens `limits.restMin` Pixel.
 */
export function WidthSplitter({
  width,
  onWidth,
  limits,
  label,
  end = false,
}: {
  width: number;
  onWidth: (width: number) => void;
  limits: { min: number; start: number; restMin: number };
  label: string;
  end?: boolean;
}) {
  const drag = useRef<{ x: number; width: number; max: number } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const diff = event.currentTarget.parentElement?.querySelector('.diff-column')?.clientWidth ?? 0;
    drag.current = { x: event.clientX, width, max: width + diff - limits.restMin };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) {
      return;
    }
    const moved = (event.clientX - drag.current.x) * (end ? -1 : 1);
    const next = Math.min(drag.current.max, drag.current.width + moved);
    onWidth(Math.round(Math.max(limits.min, next)));
  };
  const onPointerEnd = () => {
    drag.current = null;
  };
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      data-tip="Ziehen ändert die Breite, Doppelklick stellt sie zurück"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => {
        onWidth(limits.start);
      }}
    />
  );
}

const PRESETS = [
  { label: '50/50', share: 0.5 },
  { label: '30/70', share: 0.3 },
] as const;

interface FileBarProps {
  file: DiffFile;
  share: number;
  /** Eine Aufteilung schaltet Side-by-Side ein. */
  onShare: (share: number) => void;
  sideBySide: boolean;
  onSideBySide: (sideBySide: boolean) => void;
  whole: boolean;
  onWhole: (whole: boolean) => void;
  context: number;
  onContext: (change: -1 | 1) => void;
  contextLimits: { min: number; max: number };
  wrap: boolean;
  onWrap: (wrap: boolean) => void;
  showRemoved: boolean;
  onShowRemoved: (showRemoved: boolean) => void;
  /** Legt einen Hinweis zur ganzen Datei an; ohne, etwa bei den lokalen Änderungen, fehlt der Knopf. */
  onNote?: () => void;
}

/**
 * Die Leiste über dem Diff: der Pfad der Datei, rechts die Aufteilungen 50/50 und 30/70, der
 * Zeilenumbruch, die entfernten Zeilen und wie in Fork weniger und mehr Zeilen um die Änderungen,
 * die ganze Datei und Side-by-Side. Die Zahl der Zeilen lässt sich
 * nur ohne „ganze Datei“ ändern. Ohne Side-by-Side stehen alle Zeilen untereinander; die
 * entfernten Zeilen lassen sich dann ausblenden.
 */
export function FileBar(props: FileBarProps) {
  const { file, whole, context, contextLimits } = props;
  return (
    <div className="file-bar">
      <code className="file-path" data-tip={pathTip(file)}>
        <PathText path={file.path} />
      </code>
      <div className="file-tools">
        {props.onNote !== undefined && (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label="Hinweis zur Datei"
              data-tip="Hinweis zur ganzen Datei; für einzelne Zeilen diese im Diff markieren"
              onClick={props.onNote}
            >
              <NoteIcon size={16} />
            </button>
            <span className="file-tools-separator" />
          </>
        )}
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="icon-button preset"
            aria-pressed={props.sideBySide && Math.abs(props.share - preset.share) < 0.01}
            data-tip={`Side-by-Side ${preset.label}`}
            onClick={() => {
              props.onShare(preset.share);
            }}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className="icon-button"
          aria-pressed={props.wrap}
          aria-label="Zeilenumbruch"
          data-tip="Zeilenumbruch"
          onClick={() => {
            props.onWrap(!props.wrap);
          }}
        >
          <WrapIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-pressed={props.showRemoved && !props.sideBySide}
          aria-label="Entfernte Zeilen zeigen"
          data-tip={
            props.showRemoved
              ? 'Entfernte Zeilen ausblenden, nur die Fassung nachher'
              : 'Entfernte Zeilen zeigen'
          }
          disabled={props.sideBySide}
          onClick={() => {
            props.onShowRemoved(!props.showRemoved);
          }}
        >
          <RemovedIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Weniger Zeilen um die Änderungen"
          data-tip={`Weniger Zeilen um die Änderungen (jetzt ${String(context)})`}
          disabled={whole || context <= contextLimits.min}
          onClick={() => {
            props.onContext(-1);
          }}
        >
          <LinesIcon sign="minus" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Mehr Zeilen um die Änderungen"
          data-tip={`Mehr Zeilen um die Änderungen (jetzt ${String(context)})`}
          disabled={whole || context >= contextLimits.max}
          onClick={() => {
            props.onContext(1);
          }}
        >
          <LinesIcon sign="plus" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Ganze Datei zeigen"
          data-tip="Ganze Datei zeigen"
          aria-pressed={whole}
          onClick={() => {
            props.onWhole(!whole);
          }}
        >
          <WholeIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Side-by-Side"
          data-tip="Side-by-Side"
          aria-pressed={props.sideBySide}
          onClick={() => {
            props.onSideBySide(!props.sideBySide);
          }}
        >
          <SideBySideIcon />
        </button>
      </div>
    </div>
  );
}

/** Drei Zeilen mit − oder + davor, wie in Fork. */
function LinesIcon({ sign }: { sign: 'minus' | 'plus' }) {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="8" x2="6" y2="8" />
      {sign === 'plus' && <line x1="3.5" y1="5.5" x2="3.5" y2="10.5" />}
      <line x1="9" y1="3" x2="19" y2="3" />
      <line x1="11" y1="8" x2="19" y2="8" />
      <line x1="9" y1="13" x2="19" y2="13" />
    </svg>
  );
}

/** Ein Pfeil nach oben und unten neben Zeilen: die ganze Datei. */
function WholeIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" fill="none">
      <line x1="4" y1="1.5" x2="4" y2="14.5" />
      <polyline points="1.5,4 4,1.5 6.5,4" />
      <polyline points="1.5,12 4,14.5 6.5,12" />
      <line x1="10" y1="3" x2="19" y2="3" />
      <line x1="10" y1="8" x2="19" y2="8" />
      <line x1="10" y1="13" x2="19" y2="13" />
    </svg>
  );
}

/** Ein Rahmen mit zwei Spalten: Side-by-Side. */
function SideBySideIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" fill="none">
      <rect x="1" y="1.5" width="18" height="13" rx="2" />
      <line x1="10" y1="1.5" x2="10" y2="14.5" />
    </svg>
  );
}

/** Eine Zeile, die am Ende umbricht und darunter weitergeht. */
function WrapIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" fill="none">
      <line x1="1" y1="3" x2="19" y2="3" />
      <path d="M1 8 H15 a3 3 0 0 1 0 6 H10" />
      <polyline points="12,11.5 9.5,14 12,16.5" />
      <line x1="1" y1="13" x2="6" y2="13" />
    </svg>
  );
}

/** Drei Zeilen, die mittlere durchgestrichen: eine entfernte Zeile. */
function RemovedIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" fill="none">
      <line x1="1" y1="2.5" x2="19" y2="2.5" />
      <rect x="1" y="5.5" width="18" height="5" rx="1" />
      <line x1="4" y1="8" x2="16" y2="8" />
      <line x1="1" y1="13.5" x2="19" y2="13.5" />
    </svg>
  );
}
