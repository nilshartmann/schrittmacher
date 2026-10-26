import { useState } from 'react';
import type { ReactNode } from 'react';
import type { OpenApp } from '../server/apps';
import { openWorktreeIn } from '../server/repo.functions';
import { CopyIcon, CopyToIcon, CopyToMenu } from './HoverTools';
import type { CopyTarget } from './HoverTools';
import { FolderIcon, GitClientIcon, TerminalIcon } from './Icons';
import { ContextMenu, MenuItem, MenuNote } from './Menu';

/** Die Programme im Kontextmenü, in der Reihenfolge, in der sie dort stehen. */
const OPEN_ENTRIES: { app: OpenApp; label: string; icon: ReactNode }[] = [
  { app: 'terminal', label: 'Im Terminal öffnen', icon: <TerminalIcon /> },
  { app: 'forklift', label: 'In ForkLift öffnen', icon: <FolderIcon /> },
  { app: 'fork', label: 'In Fork öffnen', icon: <GitClientIcon /> },
];

/** Die Ziele, in die sich die Datei kopieren lässt, und das Kopieren selbst. */
export interface MenuCopyTo {
  load: () => Promise<CopyTarget[]>;
  onCopy: (target: string) => Promise<void>;
}

/**
 * Das Kontextmenü, das einen Worktree in einem Programm auf dem Mac öffnet. Mit `path` öffnen
 * Terminal und ForkLift den Ordner dieser Datei, Fork bleibt beim Worktree. Das Menü schließt,
 * sobald das Programm gestartet ist; scheitert das, bleibt es mit der Meldung offen. Unter den
 * Programmen stehen die Einträge aus `copies`, die einen Text in die Zwischenablage legen, und mit
 * `copyTo` ein Untermenü, das die Datei in einen anderen Tab kopiert.
 */
export function OpenInMenu({
  worktree,
  path,
  at,
  copies = [],
  copyTo,
  onClose,
}: {
  worktree: string;
  path?: string;
  at: { x: number; y: number };
  copies?: { label: string; text: string }[];
  copyTo?: MenuCopyTo;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<{ left: number; right: number; top: number } | null>(null);
  const closeSub = () => {
    setSub(null);
  };
  const open = (app: OpenApp) => {
    setError(null);
    openWorktreeIn({ data: { worktree, app, path } }).then(onClose, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure));
    });
  };
  const copy = (text: string) => {
    setError(null);
    navigator.clipboard.writeText(text).then(onClose, (failure: unknown) => {
      setError(`Der Text ließ sich nicht kopieren: ${failure instanceof Error ? failure.message : String(failure)}`);
    });
  };
  const openSub = (row: HTMLElement) => {
    const box = row.getBoundingClientRect();
    // Das Untermenü steht mit seinem ersten Eintrag auf der Höhe des Eintrags, der es öffnet.
    setSub({ left: box.left, right: box.right + 6, top: box.top - 6 });
  };
  return (
    <ContextMenu at={at} label={path === undefined ? 'Worktree öffnen' : 'Datei'} onClose={onClose}>
      {OPEN_ENTRIES.map(({ app, label, icon }) => (
        <div key={app} className="menu-row" onMouseEnter={closeSub}>
          <MenuItem
            main={label}
            icon={icon}
            onChoose={() => {
              open(app);
            }}
          />
        </div>
      ))}
      {(copies.length > 0 || copyTo !== undefined) && <div className="menu-rule" />}
      {copies.map(({ label, text }) => (
        <div key={label} className="menu-row" onMouseEnter={closeSub}>
          <MenuItem
            main={label}
            icon={<CopyIcon />}
            tip={text}
            onChoose={() => {
              copy(text);
            }}
          />
        </div>
      ))}
      {copyTo !== undefined && (
        <div
          className={sub === null ? 'menu-row' : 'menu-row menu-row-open'}
          onMouseEnter={(event) => {
            openSub(event.currentTarget);
          }}
          onClick={(event) => {
            openSub(event.currentTarget);
          }}
        >
          {/* Die Zeile öffnet das Untermenü beim Überfahren und beim Klick; der Eintrag selbst tut nichts. */}
          <MenuItem main="Kopieren nach …" icon={<CopyToIcon />} aside="›" onChoose={() => {}} />
        </div>
      )}
      {copyTo !== undefined && sub !== null && (
        <CopyToMenu anchor={sub} label="Kopieren nach" load={copyTo.load} onCopy={copyTo.onCopy} onDone={onClose} />
      )}
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </ContextMenu>
  );
}
