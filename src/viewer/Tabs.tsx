import { createContext } from 'react';
import type { ReactNode } from 'react';
import type { Tab, ViewSearch } from '../server/store';
import { CopyButton, HoverTools } from './HoverTools';
import { BranchIcon } from './Icons';
import { Menu, MenuItem } from './Menu';
import { RecentMenu } from './ViewMenus';

/** Die offenen Tabs und das Öffnen neuer, für die Einträge der Menüs. */
export interface TabActions {
  tabs: Tab[];
  /** Öffnet eine Ansicht in einem neuen Tab im Hintergrund, etwa nach einem ⌘-Klick. */
  add: (target: ViewSearch) => void;
  /** Öffnet eine Ansicht in einem neuen Tab und macht ihn aktiv; ist sie schon offen, wird ihr Tab aktiv. */
  show: (target: ViewSearch) => Promise<void>;
  /** Schließt den Tab einer Ansicht; war er aktiv, wird sein Nachbar aktiv. */
  close: (target: { worktree: string; branch: string }) => void;
}

export const TabsContext = createContext<TabActions | null>(null);

/** So viele Tabs zeigt die Tableiste; die übrigen stehen im Menü daneben. */
export const SHOWN_TABS = 4;

export function sameTab(a: { worktree: string; branch: string }, b: { worktree: string; branch: string }): boolean {
  return a.worktree === b.worktree && a.branch === b.branch;
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

interface TabBarProps {
  tabs: Tab[];
  current: Tab;
  onChoose: (tab: Tab) => void;
  onClose: (tab: Tab) => void;
}

/**
 * Die Tabs ganz oben wie in Fork, weil die Web-App aus dem Dock keine eigenen hat. Links davor
 * stehen die zuletzt geöffneten Ansichten. Die Tabs stehen über der Kopfzeile, weil der Tab
 * bestimmt, was darunter steht. Jeder Tab ist eine Ansicht; die Tabs teilen sich die Breite und
 * sind gleich breit, ob aktiv oder nicht. Sind es mehr als `SHOWN_TABS`, stehen die übrigen im
 * Menü rechts. Mit nur einem Tab fehlt das Schließen. Über einem Tab erscheint ein Knopf, der den
 * Pfad des Worktrees kopiert. Die Tabs zeigen nur, was offen ist; gewechselt wird über die Knöpfe
 * der Kopfzeile.
 */
export function TabBar({ tabs, current, onChoose, onClose }: TabBarProps) {
  const rest = tabs.slice(SHOWN_TABS);
  return (
    <nav className="tabs" role="tablist" aria-label="Tabs">
      <RecentMenu current={current} className="tabs-recent" />
      {tabs.slice(0, SHOWN_TABS).map((tab) => {
        const active = sameTab(tab, current);
        return (
          <div key={`${tab.worktree}\n${tab.branch}`} className="tab hover-tools-host" aria-selected={active} role="tab">
            <button
              type="button"
              className="tab-label"
              data-tip={tab.worktree}
              onClick={() => {
                if (!active) {
                  onChoose(tab);
                }
              }}
            >
              <span className="tab-repo">{tab.repo}</span>
              <span className="tab-where">· {whereOf(tab)}</span>
            </button>
            <HoverTools>
              <CopyButton text={tab.worktree} tip="Pfad kopieren" />
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
                <div key={`${tab.worktree}\n${tab.branch}`} className="menu-row">
                  <MenuItem
                    main={tab.repo}
                    sub={whereOf(tab)}
                    tip={tab.worktree}
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
                  />
                </div>
              ))}
            </div>
          )}
        </Menu>
      )}
    </nav>
  );
}

export function CloseButton({
  className,
  label = 'Tab schließen',
  onClose,
}: {
  className: string;
  label?: string;
  onClose: () => void;
}) {
  return (
    <button type="button" className={className} aria-label={label} data-tip="Tab schließen" onClick={onClose}>
      ×
    </button>
  );
}
