import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface MenuProps {
  /** Der Inhalt des Knopfs. */
  button: ReactNode;
  label: string;
  tip: string;
  className?: string;
  /** Beim ersten Rendern schon offen, etwa beim allerersten Start. */
  initiallyOpen?: boolean;
  /** Der Inhalt des offenen Menüs; `close` schließt es nach einer Wahl. */
  children: (close: () => void) => ReactNode;
}

/**
 * Ein Knopf in der Kopfzeile, der direkt darunter ein Menü öffnet. Ein Klick daneben und Escape
 * schließen es. Der Inhalt wird erst beim Öffnen gerendert, damit er dann seine Daten lädt.
 */
export function Menu(props: MenuProps) {
  const [open, setOpen] = useState(props.initiallyOpen ?? false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className={`menu-button ${props.className ?? ''}`}
        aria-label={props.label}
        aria-expanded={open}
        data-tip={open ? undefined : props.tip}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {props.button}
      </button>
      {open && (
        <div className="menu-panel" role="menu" aria-label={props.label}>
          {props.children(() => {
            setOpen(false);
          })}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  main: ReactNode;
  sub?: ReactNode;
  /** Rechts in der Zeile, etwa die Nummer eines Schritts. */
  aside?: ReactNode;
  current?: boolean;
  tip?: string;
  onChoose: () => void;
}

/** Eine Zeile des Menüs, hoch genug für den Pencil; die aktuelle hat einen Haken. */
export function MenuItem(props: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      aria-current={props.current === true ? 'true' : undefined}
      data-tip={props.tip}
      onClick={props.onChoose}
    >
      <span className="menu-check" aria-hidden="true">
        {props.current === true ? '✓' : ''}
      </span>
      <span className="menu-text">
        <span className="menu-main">{props.main}</span>
        {props.sub !== undefined && <span className="menu-sub">{props.sub}</span>}
      </span>
      {props.aside !== undefined && <span className="menu-aside">{props.aside}</span>}
    </button>
  );
}

export function MenuSection({ children }: { children: ReactNode }) {
  return <div className="menu-section">{children}</div>;
}

export function MenuNote({ children, error }: { children: ReactNode; error?: boolean }) {
  return <p className={error === true ? 'menu-note menu-error' : 'menu-note'}>{children}</p>;
}
