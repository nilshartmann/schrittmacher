import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import { findCommit, reachable } from '../git/repo';
import { listViews, loadView, resolveView, saveView } from '../server/repo.functions';
import type { ViewSearch } from '../server/store';
import { EmptyHeader } from '../viewer/Header';
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

  // ⌃Tab wechselt vom Mac aus zur vorigen Ansicht.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !event.ctrlKey) {
        return;
      }
      event.preventDefault();
      void listViews().then((views) => {
        const previous = views.find((saved) => saved.worktree !== worktree || saved.branch !== branch);
        if (previous !== undefined) {
          void open(previous);
        }
      });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  return (
    <Viewer
      view={view}
      search={search}
      onSearch={(change, replace) => {
        void navigate({ to: '/', search: { worktree, branch, ...change }, replace });
      }}
      onOpen={open}
      onShow={show}
    />
  );
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
