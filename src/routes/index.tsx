import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { findCommit, reachable } from '../git/repo';
import { loadView, resolveView, saveTabs, saveView, tabOf } from '../server/repo.functions';
import type { Tab, ViewSearch } from '../server/store';
import { EmptyHeader } from '../viewer/Header';
import { NewTabContext, sameTab, TabBar } from '../viewer/Tabs';
import { Tooltips } from '../viewer/Tooltips';
import { Viewer } from '../viewer/Viewer';
import type { LoadedView } from '../viewer/Viewer';

/** Die Zeit in Millisekunden, nach der eine Ansicht gemerkt wird, wenn keine Wahl mehr folgt. */
const SAVE_DELAY = 400;

function param(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): ViewSearch => ({
    worktree: param(search.worktree),
    branch: param(search.branch),
    to: param(search.to),
    from: param(search.from),
    file: param(search.file),
  }),
  loaderDeps: ({ search }) => ({ worktree: search.worktree, branch: search.branch }),
  // Ohne Worktree oder Branch ergänzt der Server die Ansicht, und die URL nennt sie danach ganz.
  loader: async ({ deps }): Promise<LoadedView | null> => {
    const { worktree, branch } = deps;
    if (worktree === undefined || branch === undefined) {
      const full = await resolveView({ data: { worktree, branch } });
      if (full === null) {
        return null;
      }
      throw redirect({ to: '/', search: full, replace: true });
    }
    const view = await loadView({ data: { worktree, branch } });
    const shown = view.repo.info.branch ?? '';
    if (shown !== branch) {
      // Den Branch gibt es nicht mehr; die Liste zeigt dann den ausgecheckten.
      throw redirect({ to: '/', search: { worktree, branch: shown }, replace: true });
    }
    return view;
  },
  component: Index,
  errorComponent: ({ error }) => <NoView message={error instanceof Error ? error.message : String(error)} />,
});

function useOpen() {
  const navigate = Route.useNavigate();
  const show = (view: ViewSearch) => {
    void navigate({ to: '/', search: view });
  };
  const open = async (target: ViewSearch) => {
    const view = await resolveView({ data: target });
    if (view !== null) {
      show(view);
    }
  };
  return { show, open };
}

function Index() {
  const view = Route.useLoaderData();
  const search = Route.useSearch();
  return view === null ? <NoView /> : <OpenedView view={view} search={search} />;
}

function OpenedView({ view, search }: { view: LoadedView; search: ViewSearch }) {
  const navigate = Route.useNavigate();
  const { show, open } = useOpen();
  const { worktree, branch, to, from, file } = search;
  const { commits, start } = view.repo;
  const title = to === undefined ? undefined : findCommit(commits, to, reachable(commits, start))?.title;

  // Die Ansicht wird gemerkt, sobald die Wahl eine Weile steht.
  useEffect(() => {
    if (worktree === undefined || branch === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      saveView({ data: { worktree, branch, to, from, file, title } }).catch((error: unknown) => {
        console.error('Die Ansicht ließ sich nicht merken.', error);
      });
    }, SAVE_DELAY);
    return () => {
      clearTimeout(timer);
    };
  }, [worktree, branch, to, from, file, title]);

  const tabs = useTabs(view, open);

  return (
    <NewTabContext.Provider value={tabs.add}>
      <Viewer
        view={view}
        search={search}
        onSearch={(change, replace) => {
          void navigate({ to: '/', search: { worktree, branch, ...change }, replace });
        }}
        onOpen={open}
        onShow={show}
        tabs={<TabBar tabs={tabs.list} current={tabs.current} onChoose={tabs.choose} onClose={tabs.close} />}
      />
    </NewTabContext.Provider>
  );
}

/**
 * Die Tabs der Tableiste. Wechselt der aktive Tab seine Ansicht, etwa über die Menüs der
 * Kopfzeile, ersetzt die neue Ansicht ihn; ist sie schon in einem anderen Tab offen, wird dieser
 * aktiv. Ein neuer Tab steht rechts neben dem aktiven und öffnet sich im Hintergrund. Der Server
 * merkt sich die Tabs, damit sie nach dem Neuladen wieder da sind.
 */
function useTabs(view: LoadedView, open: (target: ViewSearch) => Promise<void>) {
  const { info } = view.repo;
  const current: Tab = {
    worktree: info.worktreePath,
    branch: info.branch ?? '',
    repo: info.repo,
    worktreeName: info.worktree,
  };
  const [list, setList] = useState<Tab[]>(view.tabs);
  const shown = useRef<Tab | null>(null);
  const saved = useRef(view.tabs);
  useEffect(() => {
    if (list === saved.current) {
      return;
    }
    saved.current = list;
    saveTabs({ data: { tabs: list } }).catch((error: unknown) => {
      console.error('Die Tabs ließen sich nicht merken.', error);
    });
  }, [list]);
  useEffect(() => {
    const before = shown.current;
    shown.current = current;
    setList((tabs) => {
      if (tabs.some((tab) => sameTab(tab, current))) {
        return tabs;
      }
      const at = before === null ? -1 : tabs.findIndex((tab) => sameTab(tab, before));
      return at === -1 ? [...tabs, current] : tabs.with(at, current);
    });
  }, [current.worktree, current.branch]);

  return {
    list,
    current,
    choose: (tab: Tab) => {
      void open({ worktree: tab.worktree, branch: tab.branch });
    },
    close: (closed: Tab) => {
      const at = list.findIndex((tab) => sameTab(tab, closed));
      const rest = list.filter((tab) => !sameTab(tab, closed));
      setList(rest);
      const next = rest[Math.min(at, rest.length - 1)];
      if (sameTab(closed, current) && next !== undefined) {
        void open({ worktree: next.worktree, branch: next.branch });
      }
    },
    add: (target: ViewSearch) => {
      void tabOf({ data: target }).then((added) => {
        if (added === null) {
          return;
        }
        setList((tabs) => {
          if (tabs.some((tab) => sameTab(tab, added))) {
            return tabs;
          }
          const active = shown.current;
          const at = active === null ? -1 : tabs.findIndex((tab) => sameTab(tab, active));
          return at === -1 ? [...tabs, added] : tabs.toSpliced(at + 1, 0, added);
        });
      });
    },
  };
}

/** Ohne Ansicht, beim allerersten Start oder wenn sie sich nicht öffnen lässt. */
function NoView({ message }: { message?: string }) {
  const { show } = useOpen();
  return (
    <div className="app">
      <EmptyHeader onShow={show} />
      <p className="empty">{message ?? 'Noch ist kein Repo geöffnet.'}</p>
      <Tooltips />
    </div>
  );
}
