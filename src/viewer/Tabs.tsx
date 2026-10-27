import { createContext, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { Tracking } from '../git/types';
import type { Missing } from '../server/repo.functions';
import type { Project, Tab, ViewSearch } from '../server/store';
import { HoverTools, MenuToolButton } from './HoverTools';
import { BranchIcon, CloseIcon, WarningIcon } from './Icons';
import { Menu, MenuItem, MenuWhere, TrackingBadge } from './Menu';
import { OpenInMenu } from './OpenInMenu';

/** Die offenen Tabs und das Öffnen neuer, für die Einträge der Menüs. */
export interface TabActions {
  tabs: Tab[];
  /** Öffnet eine Ansicht in einem neuen Tab im Hintergrund, etwa nach einem ⌘-Klick. */
  add: (target: ViewSearch) => void;
  /** Öffnet eine Ansicht in einem neuen Tab und macht ihn aktiv; ist sie schon offen, wird ihr Tab aktiv. */
  show: (target: ViewSearch) => Promise<void>;
  /** Wie `show`, aber der neue Tab steht ganz links, etwa nach einer Wahl im Menü der Repos. */
  showFirst: (target: ViewSearch) => Promise<void>;
  /** Schließt den Tab einer Ansicht; war er aktiv, wird sein Nachbar aktiv. */
  close: (target: { worktree: string; branch: string }) => void;
  /**
   * Öffnet die Tabs eines Projekts und macht seinen ersten aktiv. Mit `replace` schließen sich die
   * übrigen Tabs, sonst kommen die fehlenden rechts neben dem aktiven dazu.
   */
  openProject: (project: Project, replace: boolean) => void;
}

export const TabsContext = createContext<TabActions | null>(null);

/** So viele Tabs zeigt die Tableiste; die übrigen stehen im Menü daneben. */
export const SHOWN_TABS = 4;

export function sameTab(a: { worktree: string; branch: string }, b: { worktree: string; branch: string }): boolean {
  return a.worktree === b.worktree && a.branch === b.branch;
}

/** Ein Schlüssel für Worktree und Branch eines Tabs. */
export function tabKey(tab: { worktree: string; branch: string }): string {
  return `${tab.worktree}\n${tab.branch}`;
}

/**
 * Die Tabs mit dem aktiven unter den sichtbaren. Steht er im Menü, nimmt er den Platz des letzten
 * sichtbaren ein, und dieser rückt ins Menü. Eine unveränderte Liste bleibt dasselbe Objekt.
 */
export function withVisible(tabs: Tab[], current: { worktree: string; branch: string }): Tab[] {
  const at = tabs.findIndex((tab) => sameTab(tab, current));
  const active = tabs[at];
  if (at < SHOWN_TABS || active === undefined) {
    return tabs;
  }
  return tabs.toSpliced(at, 1).toSpliced(SHOWN_TABS - 1, 0, active);
}

/** Worktree und Branch eines Tabs; der Worktree fehlt, wenn er wie Branch oder Repo heißt. */
export function whereOf(tab: Tab): ReactNode {
  const worktree = tab.worktreeName === tab.branch || tab.worktreeName === tab.repo ? '' : `⌂ ${tab.worktreeName} · `;
  return (
    <>
      {worktree}
      <BranchIcon /> {tab.branch || 'ohne Branch'}
    </>
  );
}

/** Worktree und Branch eines Tabs als zweite Zeile im Menü, mit derselben Regel wie `whereOf`. */
export function whereInMenu(tab: Tab): ReactNode {
  const folder = tab.worktreeName === tab.branch || tab.worktreeName === tab.repo ? null : tab.worktreeName;
  return <MenuWhere folder={folder} branch={tab.branch || null} />;
}

interface TabBarProps {
  tabs: Tab[];
  current: Tab;
  /** Der Abstand des Branches im aktiven Tab zum Remote, falls es ein lokaler mit Gegenstück ist. */
  tracking?: Tracking;
  /** Was den Ansichten fehlt, je `tabKey`; ein Tab ohne Eintrag lässt sich öffnen. */
  missing: ReadonlyMap<string, Missing>;
  onChoose: (tab: Tab) => void;
  onClose: (tab: Tab) => void;
}

/**
 * Die Tabs ganz oben wie in Fork, weil die Web-App aus dem Dock keine eigenen hat. Die Tabs stehen
 * über der Kopfzeile, weil der Tab bestimmt, was darunter steht. Jeder Tab ist eine Ansicht; die Tabs teilen sich die Breite und
 * sind gleich breit, ob aktiv oder nicht. Sind es mehr als `SHOWN_TABS`, stehen die übrigen im
 * Menü rechts. Mit nur einem Tab fehlt das Schließen. Über einem Tab erscheint ein Knopf mit einem
 * Menü, das den Worktree in einem anderen Programm öffnet oder seinen Pfad kopiert; ein
 * Rechtsklick auf den Tab öffnet dasselbe Menü. Der aktive Tab nennt den Abstand seines Branches
 * zum Remote. Die Tabs zeigen nur, was offen ist; gewechselt wird über die Knöpfe der Kopfzeile.
 * Ein Tab, dessen Ansicht es nicht mehr gibt, zeigt ein Warnzeichen, und der Tooltip nennt den Grund.
 */
export function TabBar({ tabs, current, tracking, missing, onChoose, onClose }: TabBarProps) {
  const rest = tabs.slice(SHOWN_TABS);
  const [context, setContext] = useState<{ tab: Tab; at: { x: number; y: number } } | null>(null);
  const closeContext = useCallback(() => {
    setContext(null);
  }, []);
  return (
    <nav className="tabs" role="tablist" aria-label="Tabs">
      {tabs.slice(0, SHOWN_TABS).map((tab) => {
        const active = sameTab(tab, current);
        const lost = missing.get(tabKey(tab));
        return (
          <div
            key={tabKey(tab)}
            className={lost === undefined ? 'tab hover-tools-host' : 'tab tab-missing hover-tools-host'}
            aria-selected={active}
            role="tab"
            onContextMenu={(event) => {
              event.preventDefault();
              setContext({ tab, at: { x: event.clientX, y: event.clientY } });
            }}
          >
            <button
              type="button"
              className="tab-label"
              data-tip={lost?.message ?? tab.worktree}
              onClick={() => {
                if (!active) {
                  onChoose(tab);
                }
              }}
            >
              {lost !== undefined && <WarningIcon />}
              <span className="tab-repo">{tab.repo}</span>
              <span className="tab-where">· {whereOf(tab)}</span>
              {active && <TrackingBadge tracking={tracking} />}
            </button>
            <HoverTools>
              <MenuToolButton
                tip="Aktionen"
                expanded={context !== null && sameTab(context.tab, tab)}
                onOpen={(at) => {
                  setContext({ tab, at });
                }}
              />
            </HoverTools>
            {tabs.length > 1 && (
              <CloseButton
                className="tab-close"
                onClose={() => {
                  onClose(tab);
                }}
              />
            )}
          </div>
        );
      })}
      {rest.length > 0 && (
        <Menu
          button={<>+{rest.length} ▾</>}
          label="Weitere Tabs"
          tip="Weitere Tabs"
          className="tabs-more"
          end
        >
          {(close) => (
            <div className="menu-scroll">
              {rest.map((tab) => (
                <div key={tabKey(tab)} className="menu-row">
                  <MenuItem
                    main={tab.repo}
                    sub={whereInMenu(tab)}
                    icon={missing.has(tabKey(tab)) ? <WarningIcon /> : undefined}
                    tip={missing.get(tabKey(tab))?.message ?? tab.worktree}
                    onChoose={() => {
                      close();
                      onChoose(tab);
                    }}
                  />
                  <CloseButton
                    className="menu-close"
                    onClose={() => {
                      onClose(tab);
                    }}
                  >
                    <CloseIcon />
                  </CloseButton>
                </div>
              ))}
            </div>
          )}
        </Menu>
      )}
      {context !== null && (
        <OpenInMenu
          worktree={context.tab.worktree}
          at={context.at}
          copies={[{ label: 'Pfad kopieren', text: context.tab.worktree }]}
          project={{ tab: context.tab, tabs }}
          onClose={closeContext}
        />
      )}
    </nav>
  );
}

export function CloseButton({
  className,
  label = 'Tab schließen',
  onClose,
  children = '×',
}: {
  className: string;
  label?: string;
  onClose: () => void;
  /** Das Zeichen auf dem Knopf; in den Menüs ein Symbol statt des ×. */
  children?: ReactNode;
}) {
  return (
    <button type="button" className={className} aria-label={label} data-tip="Tab schließen" onClick={onClose}>
      {children}
    </button>
  );
}
