import { Link } from '@tanstack/react-router';
import { useContext, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { ViewSearch } from '../server/store';
import { BranchIcon, CheckMarkIcon, HouseIcon, LinkIcon, WindowIcon } from './Icons';
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
        {props.current === true && <CheckMarkIcon />}
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
 * Ist die Ansicht schon in einem Tab offen, zeigt er ein Fenster und holt diesen Tab nach vorn. Er
 * erscheint wie die übrigen Knöpfe einer Zeile erst beim Überfahren.
 */
export function NewTabButton({ name, open, onClick }: { name: string; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="menu-action"
      aria-label={open ? `Tab von ${name} zeigen` : `${name} in neuem Tab öffnen`}
      data-tip={open ? 'Offenen Tab zeigen' : 'In neuem Tab öffnen'}
      onClick={onClick}
    >
      {open ? <WindowIcon /> : <LinkIcon />}
    </button>
  );
}

/**
 * Die zweite Zeile eines Repos: der Ordner des Worktrees mit einem Haus und der Branch als Chip.
 * Ohne `folder` steht nur der Branch da.
 */
export function MenuWhere({ folder, branch }: { folder: string | null; branch: string | null }) {
  return (
    <span className="menu-where">
      {folder !== null && (
        <span className="menu-folder">
          <HouseIcon />
          <span>{folder}</span>
        </span>
      )}
      <span className="menu-chip">
        <BranchIcon />
        {branch ?? 'ohne Branch'}
      </span>
    </span>
  );
}

export function MenuSection({ children }: { children: ReactNode }) {
  return <div className="menu-section">{children}</div>;
}

/** Die Überschrift eines Abschnitts, etwa „Dieses Repo“ im Menü der Repos. */
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
