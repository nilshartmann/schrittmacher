import type { ReactNode } from 'react';
import type { Missing, MissingReason } from '../server/repo.functions';
import type { Tab, ViewSearch } from '../server/store';
import { WarningIcon } from './Icons';
import { useProjects } from './Projects';
import { sameTab } from './Tabs';
import { Tooltips } from './Tooltips';
import { RepoMenu } from './ViewMenus';

const TITLES: Record<MissingReason, string> = {
  repo: 'Das Repo fehlt',
  worktree: 'Der Worktree fehlt',
  branch: 'Der Branch fehlt',
  other: 'Die Ansicht lässt sich nicht öffnen',
};

/**
 * Der Inhalt eines Tabs, dessen Ansicht sich nicht öffnen lässt: der Grund und Knöpfe, die den Tab
 * aus seinen Projekten entfernen oder ihn schließen. Der letzte Tab lässt sich nicht schließen. Über
 * das Menü der Repos lässt sich eine andere Ansicht wählen.
 */
export function MissingView({
  missing,
  tab,
  last,
  tabs,
  onShow,
  onClose,
}: {
  missing: Missing;
  tab: Tab;
  /** Ob es der letzte Tab ist. */
  last: boolean;
  tabs: ReactNode;
  onShow: (view: ViewSearch) => void;
  onClose: () => void;
}) {
  const { projects, error, change } = useProjects();
  const containing = (projects ?? []).filter((project) => project.tabs.some((other) => sameTab(other, tab)));
  return (
    <div className="app">
      {tabs}
      <header className="header">
        <div className="header-where">
          <RepoMenu info={null} onShow={onShow} />
        </div>
      </header>
      <div className="missing">
        <h2 className="missing-title">
          <WarningIcon size={18} />
          {TITLES[missing.reason]}
        </h2>
        <p className="missing-message">{missing.message}</p>
        <div className="missing-actions">
          {containing.map((project) => (
            <button
              key={project.name}
              type="button"
              className="tool"
              onClick={() => {
                void change({ kind: 'toggle', name: project.name, tab });
              }}
            >
              Aus „{project.name}“ entfernen
            </button>
          ))}
          {!last && (
            <button type="button" className="tool" onClick={onClose}>
              Tab schließen
            </button>
          )}
        </div>
        {error !== null && <p className="missing-error">{error}</p>}
      </div>
      <Tooltips />
    </div>
  );
}
