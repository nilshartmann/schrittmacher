import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import {
  changeProject,
  checkTabs,
  listProjects,
  loadMissing,
  loadView,
  resolveView,
  saveTabs,
  saveView,
  tabOf,
  takeTabRequest,
} from '../server/repo.functions';
import type { Missing, ProjectChange } from '../server/repo.functions';
import type { Project, Projects, Tab, ViewSearch } from '../server/store';
import { EmptyHeader } from '../viewer/Header';
import { MissingView } from '../viewer/MissingView';
import { ProjectBadge } from '../viewer/Projects';
import { sameTab, TabBar, tabKey, TabsContext, withVisible } from '../viewer/Tabs';
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
  // Ein früheres Ergebnis zu Worktree und Branch kennt veraltete Tabs, etwa nach dem Öffnen eines
  // Projekts ohne Tableiste. Deshalb wird nichts davon aufgehoben.
  gcTime: 0,
  // Ohne Worktree oder Branch ergänzt der Server die Ansicht, und die URL nennt sie danach ganz.
  // Fehlt der Ansicht Repo, Worktree oder Branch, bleibt ihr Tab offen und nennt den Grund.
  loader: async ({ deps }): Promise<LoadedView | MissingData | null> => {
    const { worktree, branch } = deps;
    if (worktree === undefined || branch === undefined) {
      const full = await resolveView({ data: { worktree, branch } });
      if (full === null) {
        return null;
      }
      throw redirect({ to: '/', search: full, replace: true });
    }
    let view: LoadedView;
    try {
      view = await loadView({ data: { worktree, branch } });
    } catch (error) {
      const missing = await loadMissing({ data: { worktree, branch } });
      if (missing === null) {
        throw error;
      }
      return missing;
    }
    const shown = view.repo.info.branch ?? '';
    if (shown !== branch) {
      const missing = branch === '' ? null : await loadMissing({ data: { worktree, branch } });
      if (missing !== null) {
        return missing;
      }
      // Ohne Branch zeigt die Liste den ausgecheckten.
      throw redirect({ to: '/', search: { worktree, branch: shown }, replace: true });
    }
    return view;
  },
  component: Index,
  errorComponent: ({ error }) => <NoView message={error instanceof Error ? error.message : String(error)} />,
});

/** Eine Ansicht, die sich nicht öffnen lässt, siehe `loadMissing`. */
interface MissingData {
  missing: Missing;
  tab: Tab;
  tabs: Tab[];
}

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
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  return data === null ? <NoView /> : <Opened data={data} search={search} />;
}

/** Der Tab einer geladenen Ansicht, mit den Namen von Repo und Worktree. */
function tabOfView(view: LoadedView): Tab {
  const { info } = view.repo;
  return { worktree: info.worktreePath, branch: info.branch ?? '', repo: info.repo, worktreeName: info.worktree };
}

/**
 * Die Tableiste mit der Ansicht des aktiven Tabs darunter, oder dem Grund, weshalb sie sich nicht
 * öffnen lässt. Die Tabs leben hier, damit sie einen Wechsel zwischen beidem überstehen.
 */
function Opened({ data, search }: { data: LoadedView | MissingData; search: ViewSearch }) {
  const navigate = Route.useNavigate();
  const { show, open } = useOpen();
  const missing = 'missing' in data ? data : null;
  const view = 'missing' in data ? null : data;
  const projects = useProjectState();
  const tabs = useTabs(data.tabs, missing?.tab ?? tabOfView(data as LoadedView), open, show, () => {
    // Ohne Tableiste gibt es kein aktives Projekt mehr.
    if (projects.state?.active != null) {
      void projects.change({ kind: 'leave' }).catch((error: unknown) => {
        console.error('Das Projekt ließ sich nicht verlassen.', error);
      });
    }
  });
  useTabRequests(tabs.openNew);
  useSaveView(view === null ? null : search);

  const tabBar = (
    <TabBar
      tabs={tabs.list}
      current={tabs.current}
      tracking={view?.repo.refs.find((ref) => ref.kind === 'local' && ref.name === view.repo.info.branch)?.tracking}
      missing={tabs.missing}
      onChoose={tabs.choose}
      onClose={tabs.close}
      onCloseOthers={tabs.closeOthers}
      onCloseAll={tabs.closeAll}
      onMove={tabs.move}
      end={<ProjectBadge />}
    />
  );
  const { worktree, branch } = search;
  return (
    <TabsContext.Provider
      value={{
        tabs: tabs.list,
        add: tabs.add,
        show: tabs.openNew,
        showFirst: tabs.openFirst,
        close: tabs.close,
        closeOthers: tabs.closeOthers,
        closeAll: tabs.closeAll,
        openProject: (project: Project) => {
          tabs.openProject(project);
          void projects.change({ kind: 'open', name: project.name }).catch((error: unknown) => {
            console.error('Das Projekt ließ sich nicht als geöffnet merken.', error);
          });
        },
        projects: projects.state,
        changeProject: projects.change,
      }}
    >
      {view === null ? (
        <MissingView
          missing={missing?.missing ?? { reason: 'other', message: '' }}
          tab={tabs.current}
          tabs={tabBar}
          onShow={show}
          onClose={() => {
            tabs.close(tabs.current);
          }}
        />
      ) : (
        <Viewer
          view={view}
          search={search}
          onSearch={(change, replace) => {
            void navigate({ to: '/', search: { worktree, branch, ...change }, replace });
          }}
          onOpen={open}
          onShow={show}
          tabs={tabBar}
        />
      )}
    </TabsContext.Provider>
  );
}

/** Die Projekte mit dem aktiven, geladen beim Öffnen der Seite, und Änderungen daran. */
function useProjectState() {
  const [state, setState] = useState<Projects | null>(null);
  useEffect(() => {
    listProjects().then(setState, (error: unknown) => {
      console.error('Die Projekte ließen sich nicht laden.', error);
    });
  }, []);
  const change = async (data: ProjectChange) => {
    setState(await changeProject({ data }));
  };
  return { state, change };
}

/** Merkt sich die Ansicht, sobald die Wahl eine Weile steht; ohne Ansicht nichts. */
function useSaveView(search: ViewSearch | null) {
  const { worktree, branch, to, from, file } = search ?? {};
  useEffect(() => {
    if (worktree === undefined || branch === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      saveView({ data: { worktree, branch, to, from, file } }).catch((error: unknown) => {
        console.error('Die Ansicht ließ sich nicht merken.', error);
      });
    }, SAVE_DELAY);
    return () => {
      clearTimeout(timer);
    };
  }, [worktree, branch, to, from, file]);
}

/**
 * Die Tabs der Tableiste. Wechselt der aktive Tab seine Ansicht, etwa über die Menüs der
 * Kopfzeile, ersetzt die neue Ansicht ihn; ist sie schon in einem anderen Tab offen, wird dieser
 * aktiv. Ein neuer Tab steht rechts neben dem aktiven und öffnet sich im Hintergrund. Der aktive
 * Tab steht immer unter den sichtbaren, siehe `withVisible`. Der Server merkt sich die Tabs, damit
 * sie nach dem Neuladen wieder da sind.
 */
function useTabs(
  initial: Tab[],
  current: Tab,
  open: (target: ViewSearch) => Promise<void>,
  show: (view: ViewSearch) => void,
  onAllClosed: () => void,
) {
  const [list, setList] = useState<Tab[]>(initial);
  const shown = useRef<Tab | null>(null);
  const saved = useRef(initial);
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
        return withVisible(tabs, current);
      }
      const at = before === null ? -1 : tabs.findIndex((tab) => sameTab(tab, before));
      return withVisible(at === -1 ? [...tabs, current] : tabs.with(at, current), current);
    });
  }, [current.worktree, current.branch]);

  // Geprüft wird, sobald sich die Tabs oder der aktive ändern; so fällt ein Repo auf, das wieder da ist.
  const [missing, setMissing] = useState<ReadonlyMap<string, Missing>>(new Map());
  const keys = list.map(tabKey).join('\0');
  useEffect(() => {
    let live = true;
    checkTabs({ data: { tabs: list } }).then(
      (found) => {
        if (live) {
          setMissing(new Map(list.flatMap((tab, at) => (found[at] == null ? [] : [[tabKey(tab), found[at]]]))));
        }
      },
      (error: unknown) => {
        console.error('Die Tabs ließen sich nicht prüfen.', error);
      },
    );
    return () => {
      live = false;
    };
  }, [keys, current.worktree, current.branch]);

  /**
   * Zeigt die Ansicht eines Tabs mit ihrem gemerkten Vergleich. Lässt sie sich nicht vervollständigen,
   * etwa weil ihr Worktree fehlt, gilt sie, wie sie ist, und der Tab nennt den Grund.
   */
  const openTab = async (tab: Tab) => {
    const target = { worktree: tab.worktree, branch: tab.branch };
    const view = await resolveView({ data: target }).catch(() => null);
    await open(view ?? target);
  };

  return {
    list,
    current,
    missing,
    choose: (tab: Tab) => {
      void openTab(tab);
    },
    close: (closed: { worktree: string; branch: string }) => {
      const at = list.findIndex((tab) => sameTab(tab, closed));
      const rest = list.filter((tab) => !sameTab(tab, closed));
      if (rest.length === 0) {
        void closeAll();
        return;
      }
      setList(rest);
      const next = rest[Math.min(at, rest.length - 1)];
      if (sameTab(closed, current) && next !== undefined) {
        void openTab(next);
      }
    },
    /** Verschiebt einen Tab vor oder mit `after` hinter einen anderen. */
    move: (moved: Tab, target: Tab, after: boolean) => {
      setList((tabs) => {
        const rest = tabs.filter((tab) => !sameTab(tab, moved));
        const at = rest.findIndex((tab) => sameTab(tab, target));
        return at === -1 ? tabs : withVisible(rest.toSpliced(after ? at + 1 : at, 0, moved), current);
      });
    },
    /** Schließt alle Tabs außer dem einen und macht ihn aktiv. */
    closeOthers: (kept: Tab) => {
      setList([kept]);
      if (!sameTab(kept, current)) {
        void openTab(kept);
      }
    },
    closeAll: () => {
      void closeAll();
    },
    /** Ersetzt die Tableiste durch die Tabs eines Projekts und macht den ersten aktiv. */
    openProject: (project: Project) => {
      const [first] = project.tabs;
      if (first === undefined) {
        return;
      }
      setList(withVisible(project.tabs, first));
      void openTab(first);
    },
    add: (target: ViewSearch) => {
      void tabOf({ data: target }).then((added) => {
        if (added !== null) {
          insert(added);
        }
      });
    },
    /**
     * Öffnet eine Ansicht in einem neuen Tab und macht ihn aktiv, etwa vom Kommando `schrittmacher`
     * oder aus dem Menü. Ist sie schon offen, wird ihr Tab aktiv.
     */
    openNew: async (target: ViewSearch) => {
      const added = await tabOf({ data: target });
      if (added !== null) {
        insert(added);
        await open(target);
      }
    },
    /** Wie `openNew`, aber ein neuer Tab steht ganz links. */
    openFirst: async (target: ViewSearch) => {
      const added = await tabOf({ data: target });
      if (added !== null) {
        insert(added, true);
        await open(target);
      }
    },
  };

  /**
   * Schließt alle Tabs. Erst wenn der Server die leere Tableiste kennt, wechselt die Seite zur
   * Ansicht ohne Tab, weil er sonst den ersten Tab wieder öffnen würde.
   */
  async function closeAll() {
    onAllClosed();
    setList([]);
    saved.current = [];
    await saveTabs({ data: { tabs: [] } }).catch((error: unknown) => {
      console.error('Die Tabs ließen sich nicht merken.', error);
    });
    show({});
  }

  /** Setzt einen Tab rechts neben den aktiven oder mit `first` ganz links, wenn er noch fehlt. */
  function insert(added: Tab, first = false) {
    setList((tabs) => {
      if (tabs.some((tab) => sameTab(tab, added))) {
        return tabs;
      }
      if (first) {
        return [added, ...tabs];
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

/** Ohne Ansicht: beim allerersten Start, ohne offenen Tab oder wenn sie sich nicht öffnen lässt. */
function NoView({ message }: { message?: string }) {
  const { show } = useOpen();
  // Auch ohne Tab öffnet das Kommando `schrittmacher <pfad>` einen.
  useTabRequests(async (target) => {
    show(target);
  });
  return (
    <div className="app">
      <nav className="tabs" aria-label="Tabs" />
      <EmptyHeader onShow={show} />
      <p className="empty">{message ?? 'Es ist kein Tab offen.'}</p>
      <Tooltips />
    </div>
  );
}
