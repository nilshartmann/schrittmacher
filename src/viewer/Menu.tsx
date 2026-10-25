import { Link } from '@tanstack/react-router';
import { useContext, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { ViewSearch } from '../server/store';
import { TabsContext } from './Tabs';

interface MenuProps {
  /** Der Inhalt des Knopfs. */
  button: ReactNode;
  label: string;
  tip: string;
  className?: string;
  /** Das Menü schließt rechts mit dem Knopf ab, etwa am rechten Rand des Fensters. */
  end?: boolean;
  /** Eine Klasse für das offene Menü, etwa für eine andere Breite. */
  panelClassName?: string;
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
        <div
          className={['menu-panel', props.end === true ? 'menu-panel-end' : '', props.panelClassName ?? ''].join(' ').trim()}
          role="menu"
          aria-label={props.label}
        >
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
  /**
   * Die Ansicht, zu der die Zeile führt. Die Zeile ist dann ein Link, den ⌘-Klick und mittlere
   * Maustaste in einem neuen Tab der Tableiste öffnen; `onChoose` folgt nur einem gewöhnlichen
   * Klick.
   */
  link?: ViewSearch;
  /**
   * Die Ansicht, die ⌘-Klick und mittlere Maustaste in einem neuen Tab öffnen, wenn die Zeile kein
   * Link ist, weil `onChoose` die Ansicht erst beim Server ergänzt.
   */
  newTab?: ViewSearch;
  onChoose: () => void;
}

/** Eine Zeile des Menüs; die aktuelle hat einen Haken. */
export function MenuItem(props: MenuItemProps) {
  const newTab = useContext(TabsContext)?.add ?? null;
  const content = (
    <>
      <span className="menu-check" aria-hidden="true">
        {props.current === true ? '✓' : ''}
      </span>
      <span className="menu-text">
        <span className="menu-main">{props.main}</span>
        {props.sub !== undefined && <span className="menu-sub">{props.sub}</span>}
      </span>
      {props.aside !== undefined && <span className="menu-aside">{props.aside}</span>}
    </>
  );
  const shared = {
    role: 'menuitem',
    className: 'menu-item',
    'aria-current': props.current === true ? ('true' as const) : undefined,
    'data-tip': props.tip,
  };
  if (props.link !== undefined) {
    const link = props.link;
    const onClick = (event: MouseEvent) => {
      if (newTab !== null && event.metaKey && event.button === 0) {
        event.preventDefault();
        newTab(link);
      } else if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
        props.onChoose();
      }
    };
    const onAuxClick = (event: MouseEvent) => {
      if (newTab !== null && event.button === 1) {
        event.preventDefault();
        newTab(link);
      }
    };
    return (
      <Link {...shared} to="/" search={link} onClick={onClick} onAuxClick={onAuxClick}>
        {content}
      </Link>
    );
  }
  const target = props.newTab;
  return (
    <button
      type="button"
      {...shared}
      onClick={(event) => {
        if (newTab !== null && target !== undefined && event.metaKey) {
          newTab(target);
        } else {
          props.onChoose();
        }
      }}
      onAuxClick={(event) => {
        if (newTab !== null && target !== undefined && event.button === 1) {
          event.preventDefault();
          newTab(target);
        }
      }}
    >
      {content}
    </button>
  );
}

/**
 * Der Knopf rechts in einer Zeile, der ihre Ansicht in einem neuen Tab öffnet und ihn aktiv macht.
 * Ist die Ansicht schon in einem Tab offen, zeigt er ein anderes Symbol und holt diesen Tab nach
 * vorn.
 */
export function NewTabButton({ name, open, onClick }: { name: string; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="menu-new-tab"
      aria-label={open ? `Tab von ${name} zeigen` : `${name} in neuem Tab öffnen`}
      data-tip={open ? 'Offenen Tab zeigen' : 'In neuem Tab öffnen'}
      onClick={onClick}
    >
      {open ? <OpenTabIcon /> : <NewTabIcon />}
    </button>
  );
}

/** Ein Rahmen mit einem Pfeil nach außen, wie für einen Link in einem neuen Fenster. */
function NewTabIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M7.5 3.25H4.25c-.6 0-1 .4-1 1v9.5c0 .6.4 1 1 1h9.5c.6 0 1-.4 1-1V10.5M10.5 3.25h4.25V7.5M14.5 3.5 8.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Ein Fenster mit einem gefüllten Tab oben links, für eine Ansicht, die schon in einem Tab offen ist. */
function OpenTabIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="2.25" y="3.25" width="13.5" height="11.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.25 4.75c0-.8.7-1.5 1.5-1.5H8.5v3.5H2.25z" fill="currentColor" />
    </svg>
  );
}

export function MenuSection({ children }: { children: ReactNode }) {
  return <div className="menu-section">{children}</div>;
}

/** Eine dünne Linie zwischen zwei Abschnitten, darin der Name des folgenden in kleiner Schrift. */
export function MenuDivider({ children }: { children: ReactNode }) {
  return (
    <div className="menu-divider" role="separator">
      <span>{children}</span>
    </div>
  );
}

export function MenuNote({ children, error }: { children: ReactNode; error?: boolean }) {
  return <p className={error === true ? 'menu-note menu-error' : 'menu-note'}>{children}</p>;
}
