import { useState } from 'react';
import type { ReactNode } from 'react';
import type { OpenApp } from '../server/apps';
import { openWorktreeIn } from '../server/repo.functions';
import type { Tab } from '../server/store';
import { CopyIcon, CopyToIcon, CopyToMenu, subAnchorOf } from './HoverTools';
import type { CopyTarget, SubAnchor } from './HoverTools';
import { CloseIcon, FolderIcon, GitClientIcon, ProjectIcon, TerminalIcon } from './Icons';
import { ContextMenu, MenuItem, MenuNote } from './Menu';
import { ProjectToggleMenu } from './Projects';

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
 * Programmen stehen die Einträge aus `copies`, die einen Text in die Zwischenablage legen, mit
 * `copyTo` ein Untermenü, das die Datei in einen anderen Tab kopiert, mit `project` eins, das den
 * Tab in Projekte aufnimmt, und mit `closing` das Schließen anderer und aller Tabs.
 */
export function OpenInMenu({
  worktree,
  path,
  at,
  copies = [],
  copyTo,
  project,
  closing,
  onClose,
}: {
  worktree: string;
  path?: string;
  at: { x: number; y: number };
  copies?: { label: string; text: string }[];
  copyTo?: MenuCopyTo;
  /** Der Tab des Menüs und die offenen Tabs, für das Untermenü „Projekt“. */
  project?: { tab: Tab; tabs: Tab[] };
  /** Das Schließen anderer und aller Tabs, im Menü eines Tabs; ohne `others` fehlt dieser Eintrag. */
  closing?: { others?: () => void; all: () => void };
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<{ kind: 'copy' | 'project'; anchor: SubAnchor } | null>(null);
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
  const openSub = (kind: 'copy' | 'project', row: HTMLElement) => {
    setSub({ kind, anchor: subAnchorOf(row) });
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
          className={sub?.kind === 'copy' ? 'menu-row menu-row-open' : 'menu-row'}
          onMouseEnter={(event) => {
            openSub('copy', event.currentTarget);
          }}
          onClick={(event) => {
            openSub('copy', event.currentTarget);
          }}
        >
          {/* Die Zeile öffnet das Untermenü beim Überfahren und beim Klick; der Eintrag selbst tut nichts. */}
          <MenuItem main="Kopieren nach …" icon={<CopyToIcon />} aside="›" onChoose={() => {}} />
        </div>
      )}
      {copyTo !== undefined && sub?.kind === 'copy' && (
        <CopyToMenu
          anchor={sub.anchor}
          label="Kopieren nach"
          load={copyTo.load}
          onCopy={copyTo.onCopy}
          onDone={onClose}
        />
      )}
      {project !== undefined && (
        <>
          <div className="menu-rule" onMouseEnter={closeSub} />
          <div
            className={sub?.kind === 'project' ? 'menu-row menu-row-open' : 'menu-row'}
            onMouseEnter={(event) => {
              openSub('project', event.currentTarget);
            }}
            onClick={(event) => {
              openSub('project', event.currentTarget);
            }}
          >
            <MenuItem main="Projekt" icon={<ProjectIcon />} aside="›" onChoose={() => {}} />
          </div>
        </>
      )}
      {project !== undefined && sub?.kind === 'project' && (
        <ProjectToggleMenu anchor={sub.anchor} tab={project.tab} tabs={project.tabs} onDone={onClose} />
      )}
      {closing !== undefined && (
        <>
          <div className="menu-rule" onMouseEnter={closeSub} />
          {[
            { label: 'Andere Tabs schließen', act: closing.others },
            { label: 'Alle Tabs schließen', act: closing.all },
          ].map(
            ({ label, act }) =>
              act !== undefined && (
                <div key={label} className="menu-row" onMouseEnter={closeSub}>
                  <MenuItem
                    main={label}
                    icon={<CloseIcon />}
                    onChoose={() => {
                      onClose();
                      act();
                    }}
                  />
                </div>
              ),
          )}
        </>
      )}
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </ContextMenu>
  );
}
