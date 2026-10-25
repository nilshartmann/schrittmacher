import { createContext } from 'react';
import type { Tab, ViewSearch } from '../server/store';

/** Öffnet eine Ansicht in einem neuen Tab, etwa nach einem ⌘-Klick auf einen Eintrag der Menüs. */
export const NewTabContext = createContext<((target: ViewSearch) => void) | null>(null);

export function sameTab(a: { worktree: string; branch: string }, b: { worktree: string; branch: string }): boolean {
  return a.worktree === b.worktree && a.branch === b.branch;
}

interface TabBarProps {
  tabs: Tab[];
  current: Tab;
  onChoose: (tab: Tab) => void;
  onClose: (tab: Tab) => void;
}

/**
 * Die Tabs unter der Kopfzeile wie in Fork, weil die Web-App aus dem Dock keine eigenen hat. Jeder
 * Tab ist eine Ansicht; die Tabs teilen sich die Breite. Mit nur einem Tab fehlt das Schließen.
 */
export function TabBar({ tabs, current, onChoose, onClose }: TabBarProps) {
  return (
    <nav className="tabs" role="tablist" aria-label="Tabs">
      {tabs.map((tab) => {
        const active = sameTab(tab, current);
        return (
          <div key={`${tab.worktree}\n${tab.branch}`} className="tab" aria-selected={active} role="tab">
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
              <span className="tab-where">
                {tab.worktreeName === tab.branch ? '' : `· ⌂ ${tab.worktreeName} `}· ⑂ {tab.branch || 'ohne Branch'}
              </span>
            </button>
            {tabs.length > 1 && (
              <button
                type="button"
                className="tab-close"
                aria-label="Tab schließen"
                data-tip="Tab schließen"
                onClick={() => {
                  onClose(tab);
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
