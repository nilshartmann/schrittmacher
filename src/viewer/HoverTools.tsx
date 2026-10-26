import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Die Breite des Menüs von `CopyToMenu` und sein Abstand zum Rand des Fensters, in Pixeln. */
const PANEL = { width: 360, margin: 12 };

/**
 * Eine schwebende Leiste mit Knöpfen am rechten Rand ihres Elements. Sie erscheint nur, solange
 * der Zeiger über dem Element steht, und überdeckt dann den Text darunter. Das Element braucht
 * dafür die Klasse `hover-tools-host`.
 */
export function HoverTools({ children }: { children: ReactNode }) {
  return <span className="hover-tools">{children}</span>;
}

/**
 * Ein Knopf, der ein Menü darunter öffnet; `onOpen` bekommt die Stelle für das Menü. Ein zweiter
 * Klick schließt es wieder. Solange es offen ist, bleibt die Leiste sichtbar.
 */
export function MenuToolButton({
  tip,
  expanded,
  onOpen,
}: {
  tip: string;
  expanded: boolean;
  onOpen: (at: { x: number; y: number }) => void;
}) {
  // Ein Klick daneben schließt das Menü schon beim Drücken. War es da offen, schließt der Klick
  // auf den Knopf es also und öffnet es nicht gleich wieder.
  const wasOpen = useRef(false);
  return (
    <button
      type="button"
      className="hover-tool"
      aria-label={tip}
      aria-haspopup="menu"
      aria-expanded={expanded}
      data-tip={expanded ? undefined : tip}
      onPointerDown={() => {
        wasOpen.current = expanded;
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (wasOpen.current) {
          wasOpen.current = false;
          return;
        }
        const box = event.currentTarget.getBoundingClientRect();
        onOpen({ x: box.left, y: box.bottom + 4 });
      }}
    >
      <MoreIcon />
    </button>
  );
}

/** Ein Ziel für `CopyToMenu`, mit Schlüssel und Beschriftung im Menü. */
export interface CopyTarget {
  key: string;
  /** Die Überschrift des Abschnitts, in dem das Ziel steht. */
  section: string;
  main: ReactNode;
  sub: ReactNode;
  tip: string;
}

/**
 * Das Untermenü mit den Zielen zum Kopieren, seitlich neben dem Eintrag `anchor`. Es steht rechts
 * davon und weicht nach links aus, wenn rechts der Platz fehlt. Die Ziele lädt `load` beim Öffnen,
 * in Abschnitten nach `section`; die Wahl eines Ziels ruft `onCopy`, danach `onDone`. Ein Fehler
 * steht im Menü.
 */
export function CopyToMenu({
  anchor,
  label,
  load,
  onCopy,
  onDone,
}: {
  anchor: { left: number; right: number; top: number };
  label: string;
  load: () => Promise<CopyTarget[]>;
  onCopy: (key: string) => Promise<void>;
  onDone: () => void;
}) {
  const [targets, setTargets] = useState<CopyTarget[] | null>(null);
  const [state, setState] = useState<{ kind: 'running' } | { kind: 'failed'; message: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ top: anchor.top, left: anchor.right });
  // Geladen wird einmal beim Öffnen, auch wenn `load` bei jedem Rendern neu entsteht.
  const loadOnce = useRef(load);
  useEffect(() => {
    loadOnce.current().then(setTargets, (error: unknown) => {
      setTargets([]);
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    });
  }, []);
  useLayoutEffect(() => {
    const box = panel.current?.getBoundingClientRect();
    if (box === undefined) {
      return;
    }
    const fitsRight = anchor.right + box.width + PANEL.margin <= window.innerWidth;
    setPlace({
      left: fitsRight ? anchor.right : Math.max(PANEL.margin, anchor.left - box.width),
      top: Math.max(PANEL.margin, Math.min(anchor.top, window.innerHeight - box.height - PANEL.margin)),
    });
  }, [anchor, targets]);
  const copy = (key: string) => {
    setState({ kind: 'running' });
    onCopy(key).then(onDone, (error: unknown) => {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    });
  };
  return (
    <div
      ref={panel}
      className="menu-panel copy-to-panel"
      role="menu"
      aria-label={label}
      style={{ top: place.top, left: place.left, width: PANEL.width }}
    >
      {targets === null && <p className="menu-note">Lädt …</p>}
      {targets?.length === 0 && state?.kind !== 'failed' && (
        <p className="menu-note">Es ist kein anderer Tab mit ausgechecktem Branch offen.</p>
      )}
      {targets?.map((target, index) => (
        <Fragment key={target.key}>
          {target.section !== targets[index - 1]?.section && <div className="menu-section">{target.section}</div>}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            data-tip={target.tip}
            disabled={state?.kind === 'running'}
            onClick={() => {
              copy(target.key);
            }}
          >
            <span className="menu-check" aria-hidden="true" />
            <span className="menu-text">
              <span className="menu-main">{target.main}</span>
              <span className="menu-sub">{target.sub}</span>
            </span>
          </button>
        </Fragment>
      ))}
      {state?.kind === 'failed' && <p className="menu-note menu-error">{state.message}</p>}
    </div>
  );
}

/** Zwei Blätter übereinander, wie das Symbol zum Kopieren in macOS. */
export function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.5 2.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** Ein Blatt mit einem Pfeil nach rechts: eine Datei an einen anderen Ort kopieren. */
export function CopyToIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M8 1.5H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1.5v3h3M11 4.5V6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7 10h5.5M10.5 8l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Drei Punkte wie auf dem Knopf für weitere Aktionen in macOS. */
function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="3" cy="7" r="1.25" fill="currentColor" />
      <circle cx="7" cy="7" r="1.25" fill="currentColor" />
      <circle cx="11" cy="7" r="1.25" fill="currentColor" />
    </svg>
  );
}
