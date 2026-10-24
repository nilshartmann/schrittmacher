import { useRef } from 'react';
import type { PointerEvent } from 'react';
import type { DiffFile } from '../git/types';

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** Die Zeichen der Arten wie in Fork: M für geändert, + für neu, − für gelöscht. */
const KIND_SIGN = { changed: 'M', added: '+', deleted: '−' } as const;

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

/** Die Grenzen der Breite der Dateiliste in Pixeln; der Rest bleibt mindestens für den Diff. */
export const FILES_WIDTH = { min: 140, start: 300, restMin: 400 };

/**
 * Die Dateien des Vergleichs als Spalte links vom Diff, mit einer Trennlinie für die Breite. Jede
 * Datei steht mit ihrem ganzen Pfad da; wird es eng, kürzt er vorn, damit der Dateiname bleibt.
 */
export function FileList({
  files,
  current,
  onChoose,
  width,
  onWidth,
}: {
  files: DiffFile[];
  current: string;
  onChoose: (path: string) => void;
  width: number;
  onWidth: (width: number) => void;
}) {
  return (
    <>
    <nav className="file-list" aria-label="Dateien" style={{ width }}>
      <ol>
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className="file"
              aria-current={file.path === current ? 'true' : undefined}
              data-tip={file.path}
              onClick={() => {
                onChoose(file.path);
              }}
            >
              <span className={`file-kind file-kind-${file.kind}`}>{KIND_SIGN[file.kind]}</span>
              <PathText path={file.path} />
            </button>
          </li>
        ))}
      </ol>
    </nav>
    <WidthSplitter width={width} onWidth={onWidth} />
    </>
  );
}

/** Die Trennlinie rechts der Dateiliste. Ziehen ändert die Breite, ein Doppelklick stellt sie zurück. */
function WidthSplitter({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) {
      return;
    }
    const body = event.currentTarget.parentElement?.clientWidth ?? 0;
    const next = drag.current.width + event.clientX - drag.current.x;
    onWidth(Math.round(Math.max(FILES_WIDTH.min, Math.min(body - FILES_WIDTH.restMin, next))));
  };
  const onPointerEnd = () => {
    drag.current = null;
  };
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite der Dateiliste"
      data-tip="Ziehen ändert die Breite, Doppelklick stellt sie zurück"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => {
        onWidth(FILES_WIDTH.start);
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
      <code className="file-path" data-tip={file.path}>
        <PathText path={file.path} />
      </code>
      <div className="file-tools">
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
