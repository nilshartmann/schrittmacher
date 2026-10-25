import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** So lange zeigt ein Knopf zum Kopieren den Haken, in Millisekunden. */
const COPIED_FOR = 1200;

/** Die Breite des Menüs von `CopyToButton` und sein Abstand zum Rand des Fensters, in Pixeln. */
const PANEL = { width: 360, margin: 12 };

/**
 * Eine schwebende Leiste mit Knöpfen am rechten Rand ihres Elements. Sie erscheint nur, solange
 * der Zeiger über dem Element steht, und überdeckt dann den Text darunter. Das Element braucht
 * dafür die Klasse `hover-tools-host`.
 */
export function HoverTools({ children }: { children: ReactNode }) {
  return <span className="hover-tools">{children}</span>;
}

/** Ein Knopf, der `text` in die Zwischenablage legt und danach kurz einen Haken zeigt. */
export function CopyButton({ text, tip }: { text: string; tip: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_FOR);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  return (
    <button
      type="button"
      className="hover-tool"
      aria-label={tip}
      data-tip={copied ? 'Kopiert' : tip}
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
          },
          (error: unknown) => {
            console.error('Der Text ließ sich nicht kopieren.', error);
          },
        );
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

/** Ein Ziel für `CopyToButton`, mit Schlüssel und Beschriftung im Menü. */
export interface CopyTarget {
  key: string;
  /** Die Überschrift des Abschnitts, in dem das Ziel steht. */
  section: string;
  main: ReactNode;
  sub: ReactNode;
  tip: string;
}

/**
 * Ein Knopf, der ein Menü mit Zielen öffnet; die Wahl eines Ziels ruft `onCopy`. Die Ziele lädt
 * `load` bei jedem Öffnen, in Abschnitten nach `section`. Das Menü steht
 * fest im Fenster und hängt an `body`, damit weder eine Liste mit eigenem Scrollen es abschneidet
 * noch das `transform` der Leiste es verschiebt. Solange es offen ist
 * oder kopiert wird, bleibt die Leiste sichtbar. Danach zeigt der Knopf kurz einen Haken, ein
 * Fehler steht im Menü.
 */
export function CopyToButton({
  load,
  tip,
  onCopy,
}: {
  load: () => Promise<CopyTarget[]>;
  tip: string;
  onCopy: (key: string) => Promise<void>;
}) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [targets, setTargets] = useState<CopyTarget[] | null>(null);
  const [state, setState] = useState<{ kind: 'running' | 'done' } | { kind: 'failed'; message: string } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = at !== null;
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      const inside = [button.current, panel.current].some((part) => part?.contains(event.target as Node) === true);
      if (!inside) {
        setAt(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAt(null);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (state?.kind !== 'done') {
      return;
    }
    const timer = setTimeout(() => {
      setState(null);
    }, COPIED_FOR);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);
  const copy = (key: string) => {
    setState({ kind: 'running' });
    onCopy(key).then(
      () => {
        setAt(null);
        setState({ kind: 'done' });
      },
      (error: unknown) => {
        setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
      },
    );
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="hover-tool"
        aria-label={tip}
        aria-expanded={open || state?.kind === 'running'}
        data-tip={open ? undefined : state?.kind === 'done' ? 'Kopiert' : tip}
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            setAt(null);
            return;
          }
          const box = event.currentTarget.getBoundingClientRect();
          setAt({
            top: box.bottom + 4,
            left: Math.max(PANEL.margin, Math.min(box.left, window.innerWidth - PANEL.width - PANEL.margin)),
          });
          setState(null);
          setTargets(null);
          load().then(setTargets, (error: unknown) => {
            setTargets([]);
            setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
          });
        }}
      >
        {state?.kind === 'done' ? <CheckIcon /> : <CopyToIcon />}
      </button>
      {at !== null &&
        createPortal(
          <div
            ref={panel}
            className="menu-panel copy-to-panel"
            role="menu"
            aria-label={tip}
            style={{ top: at.top, left: at.left, width: PANEL.width }}
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
          </div>,
          document.body,
        )}
    </>
  );
}

/** Zwei Blätter übereinander, wie das Symbol zum Kopieren in macOS. */
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.5 2.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** Ein Blatt mit einem Pfeil nach rechts: eine Datei an einen anderen Ort kopieren. */
function CopyToIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M8 1.5H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1.5v3h3M11 4.5V6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7 10h5.5M10.5 8l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
