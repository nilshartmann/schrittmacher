import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { findCommit, reachable } from '../git/repo';
import { loadView, resolveView, saveTabs, saveView, tabOf, takeTabRequest } from '../server/repo.functions';
import type { Tab, ViewSearch } from '../server/store';
import { EmptyHeader } from '../viewer/Header';
import { ProjectMenu } from '../viewer/ProjectMenu';
import { NewTabContext, sameTab, TabBar, withVisible } from '../viewer/Tabs';
import { Tooltips } from '../viewer/Tooltips';
import { Viewer } from '../viewer/Viewer';
import type { LoadedView } from '../viewer/Viewer';

/** Die Zeit in Millisekunden, nach der eine Ansicht gemerkt wird, wenn keine Wahl mehr folgt. */
const SAVE_DELAY = 400;

/** Der Abstand der Fragen nach einem Tab vom Kommando `schrittmacher`, in Millisekunden. */
const REQUEST_INTERVAL = 1500;

/**
 * Ein Parameter der URL als Text. Der Router liest Werte als JSON, eine Nummer wie `40` kommt
 * deshalb als Zahl an; `05` und `06b` sind kein JSON und bleiben Text.
 */
function param(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return String(value);
  }
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
  const router = useRouter();
  const show = (view: ViewSearch) => {
    void navigate({ to: '/', search: view });
  };
  const open = async (target: ViewSearch) => {
    const view = await resolveView({ data: target });
    if (view !== null) {
      show(view);
    }
  };
  // Nach einem Wechsel des Projekts lädt die Seite neu, auch wenn die Ansicht dieselbe bleibt,
  // weil das Projekt seine eigenen Tabs mitbringt.
  const showProject = (view: ViewSearch | null) => {
    void navigate({ to: '/', search: view ?? {} }).then(() => router.invalidate());
  };
  const reload = () => {
    void router.invalidate();
  };
  return { show, open, showProject, reload };
}

function Index() {
  const view = Route.useLoaderData();
  const search = Route.useSearch();
  // Ein anderes Projekt bringt eigene Tabs mit, deshalb beginnt die Ansicht dann von vorn.
  return view === null ? <NoView /> : <OpenedView key={view.project} view={view} search={search} />;
}

function OpenedView({ view, search }: { view: LoadedView; search: ViewSearch }) {
  const navigate = Route.useNavigate();
  const { show, open, showProject, reload } = useOpen();
  const { worktree, branch, to, from, file } = search;
  const { project } = view;
  const { commits, start } = view.repo;
  const title = to === undefined ? undefined : findCommit(commits, to, reachable(commits, start))?.title;

  // Die Ansicht wird gemerkt, sobald die Wahl eine Weile steht.
  useEffect(() => {
    if (worktree === undefined || branch === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      saveView({ data: { project, worktree, branch, to, from, file, title } }).catch((error: unknown) => {
        console.error('Die Ansicht ließ sich nicht merken.', error);
      });
    }, SAVE_DELAY);
    return () => {
      clearTimeout(timer);
    };
  }, [project, worktree, branch, to, from, file, title]);

  const tabs = useTabs(view, open);
  useTabRequests(tabs.openNew);

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
        tabs={
          <TabBar
            tabs={tabs.list}
            current={tabs.current}
            onChoose={tabs.choose}
            onClose={tabs.close}
            project={
              <ProjectMenu
                project={project}
                tabs={tabs.list}
                onProject={showProject}
                onTabs={tabs.replace}
                onRenamed={reload}
              />
            }
          />
        }
      />
    </NewTabContext.Provider>
  );
}

/**
 * Die Tabs der Tableiste. Wechselt der aktive Tab seine Ansicht, etwa über die Menüs der
 * Kopfzeile, ersetzt die neue Ansicht ihn; ist sie schon in einem anderen Tab offen, wird dieser
 * aktiv. Ein neuer Tab steht rechts neben dem aktiven und öffnet sich im Hintergrund. Der aktive
 * Tab steht immer unter den sichtbaren, siehe `withVisible`. Der Server
 * merkt sich die Tabs im Projekt, damit sie nach dem Neuladen wieder da sind. Setzt die Auswahl
 * der Ansichten neue Tabs, öffnet sich der erste, wenn der aktive nicht mehr dabei ist.
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
    saveTabs({ data: { project: view.project, tabs: list } }).catch((error: unknown) => {
      console.error('Die Tabs ließen sich nicht merken.', error);
    });
  }, [list]);
  useEffect(() => {
    const before = shown.current;
    shown.current = current;
    setList((tabs) => {
      if (tabs.some((tab) => sameTab(tab, current))) {
        return withVisible(tabs, current);
      }
      const at = before === null ? -1 : tabs.findIndex((tab) => sameTab(tab, before));
      return withVisible(at === -1 ? [...tabs, current] : tabs.with(at, current), current);
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
    replace: (tabs: Tab[]) => {
      // Der Server kennt die neuen Tabs schon.
      const shown = withVisible(tabs, current);
      saved.current = shown;
      setList(shown);
      const first = tabs[0];
      if (!tabs.some((tab) => sameTab(tab, current)) && first !== undefined) {
        void open({ worktree: first.worktree, branch: first.branch });
      }
    },
    add: (target: ViewSearch) => {
      void tabOf({ data: target }).then((added) => {
        if (added !== null) {
          insert(added);
        }
      });
    },
    /** Öffnet eine Ansicht in einem neuen Tab und macht ihn aktiv, etwa vom Kommando `schrittmacher`. */
    openNew: async (target: ViewSearch) => {
      const added = await tabOf({ data: target });
      if (added !== null) {
        insert(added);
        await open(target);
      }
    },
  };

  /** Setzt einen Tab rechts neben den aktiven, wenn er noch fehlt. */
  function insert(added: Tab) {
    setList((tabs) => {
      if (tabs.some((tab) => sameTab(tab, added))) {
        return tabs;
      }
      const active = shown.current;
      const at = active === null ? -1 : tabs.findIndex((tab) => sameTab(tab, active));
      return at === -1 ? [...tabs, added] : tabs.toSpliced(at + 1, 0, added);
    });
  }
}

/**
 * Holt die Tabs ab, die das Kommando `schrittmacher <pfad>` beim Server anfordert. Gefragt wird
 * beim Start, regelmäßig, solange das Fenster sichtbar ist, und sofort, wenn es sichtbar wird, weil
 * das Kommando die Web-App danach nach vorn holt.
 */
function useTabRequests(openNew: (target: ViewSearch) => Promise<void>) {
  const latest = useRef(openNew);
  latest.current = openNew;
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') {
        return;
      }
      busy = true;
      try {
        const requested = await takeTabRequest();
        if (requested !== null) {
          await latest.current(requested);
        }
      } catch {
        // Der Server ist kurz nicht erreichbar; die nächste Frage versucht es wieder.
      } finally {
        busy = false;
      }
    };
    const onCheck = () => {
      void check();
    };
    onCheck();
    const timer = setInterval(onCheck, REQUEST_INTERVAL);
    document.addEventListener('visibilitychange', onCheck);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onCheck);
    };
  }, []);
}

/** Ohne Ansicht, beim allerersten Start oder wenn sie sich nicht öffnen lässt. */
function NoView({ message }: { message?: string }) {
  const { show, showProject, reload } = useOpen();
  return (
    <div className="app">
      <nav className="tabs" aria-label="Tabs">
        <ProjectMenu project={null} tabs={[]} onProject={showProject} onTabs={reload} onRenamed={reload} />
      </nav>
      <EmptyHeader onShow={show} />
      <p className="empty">{message ?? 'Noch ist kein Repo geöffnet.'}</p>
      <Tooltips />
    </div>
  );
}
