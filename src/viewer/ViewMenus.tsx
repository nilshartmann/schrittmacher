import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { RepoEntry } from '../git/repos';
import type { Ref, RepoInfo, Worktree } from '../git/types';
import { listRepos, listViews, openRepo } from '../server/repo.functions';
import type { SavedView, ViewSearch } from '../server/store';
import { Menu, MenuItem, MenuNote, MenuSection } from './Menu';

/** Wechselt zu einer Ansicht; fehlende Teile ergänzt der Server. */
export type OpenView = (target: ViewSearch) => Promise<void>;

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Lädt beim Öffnen eines Menüs dessen Daten, mit einer Meldung, falls es scheitert. */
function useLoaded<T>(load: () => Promise<T>): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let current = true;
    load().then(
      (data) => {
        if (current) {
          setState({ data, error: null });
        }
      },
      (failure: unknown) => {
        if (current) {
          setState({ data: null, error: messageOf(failure) });
        }
      },
    );
    return () => {
      current = false;
    };
    // Geladen wird einmal je Öffnen des Menüs.
  }, []);
  return state;
}

/** Ein Pfad mit `~` statt des Home-Verzeichnisses. */
function short(path: string, home: string): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Ruft eine Wahl auf und schließt das Menü, oder zeigt die Meldung, wenn sie scheitert. */
function useChoice(close: () => void): [string | null, (choose: () => Promise<void>) => void] {
  const [error, setError] = useState<string | null>(null);
  return [
    error,
    (choose) => {
      setError(null);
      choose().then(close, (failure: unknown) => {
        setError(messageOf(failure));
      });
    },
  ];
}

/** Das Repo in der Kopfzeile, mit den zuletzt geöffneten, den gefundenen und einem Textfeld. */
export function RepoMenu({
  info,
  initiallyOpen,
  onShow,
}: {
  info: RepoInfo | null;
  initiallyOpen?: boolean;
  /** Zeigt die Ansicht, die der Server für das gewählte Repo liefert. */
  onShow: (view: ViewSearch) => void;
}) {
  return (
    <Menu
      button={<span className="crumb-repo">{info?.repo ?? 'Repo wählen'}</span>}
      label="Repo"
      tip={info === null ? 'Repo wählen' : `Repo: ${info.repoPath}`}
      className="crumb"
      initiallyOpen={initiallyOpen}
    >
      {(close) => <RepoList current={info?.repoPath ?? null} close={close} onShow={onShow} />}
    </Menu>
  );
}

function RepoList({
  current,
  close,
  onShow,
}: {
  current: string | null;
  close: () => void;
  onShow: (view: ViewSearch) => void;
}) {
  const { data, error } = useLoaded(() => listRepos());
  const [filter, setFilter] = useState('');
  const [path, setPath] = useState('');
  const [openError, choose] = useChoice(close);
  const open = (target: string) => {
    choose(async () => {
      const view = await openRepo({ data: { path: target } });
      if (view === null) {
        throw new Error('Für dieses Repo gibt es keine Ansicht.');
      }
      onShow(view);
    });
  };
  const matches = (entry: RepoEntry) => {
    const wanted = filter.trim().toLowerCase();
    return wanted === '' || entry.name.toLowerCase().includes(wanted) || entry.path.toLowerCase().includes(wanted);
  };
  const items = (entries: RepoEntry[], home: string): ReactNode =>
    entries.filter(matches).map((entry) => (
      <MenuItem
        key={entry.path}
        main={entry.name}
        sub={short(entry.path, home)}
        current={entry.path === current}
        onChoose={() => {
          open(entry.path);
        }}
      />
    ));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (path.trim() !== '') {
      open(path);
    }
  };
  return (
    <>
      <input
        className="menu-input"
        type="search"
        placeholder="Filtern"
        aria-label="Repos filtern"
        value={filter}
        autoFocus
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />
      {error !== null && <MenuNote error>{error}</MenuNote>}
      {data === null && error === null && <MenuNote>Sucht Repos …</MenuNote>}
      {data !== null && (
        <div className="menu-scroll">
          {data.recent.length > 0 && <MenuSection>Zuletzt geöffnet</MenuSection>}
          {items(data.recent, data.home)}
          <MenuSection>In {data.roots.map((root) => short(root, data.home)).join(', ')}</MenuSection>
          {items(data.found, data.home)}
          {data.found.length === 0 && <MenuNote>Keine Repos gefunden.</MenuNote>}
        </div>
      )}
      <form className="menu-form" onSubmit={onSubmit}>
        <input
          className="menu-input"
          type="text"
          placeholder="Pfad einfügen, etwa ~/develop/…"
          aria-label="Pfad eines Repos"
          value={path}
          onChange={(event) => {
            setPath(event.target.value);
          }}
        />
        <button type="submit" className="tool" disabled={path.trim() === ''}>
          Öffnen
        </button>
      </form>
      {openError !== null && <MenuNote error>{openError}</MenuNote>}
    </>
  );
}

/** Der Worktree in der Kopfzeile; bei nur einem Worktree ohne Menü. */
export function WorktreeMenu({
  info,
  worktrees,
  onOpen,
}: {
  info: RepoInfo;
  worktrees: Worktree[];
  onOpen: OpenView;
}) {
  if (worktrees.length <= 1) {
    return (
      <span className="crumb crumb-plain" data-tip={`Worktree: ${info.worktreePath}`}>
        ⌂ {info.worktree}
      </span>
    );
  }
  return (
    <Menu button={<>⌂ {info.worktree}</>} label="Worktree" tip={`Worktree: ${info.worktreePath}`} className="crumb">
      {(close) => <WorktreeList info={info} worktrees={worktrees} close={close} onOpen={onOpen} />}
    </Menu>
  );
}

function WorktreeList({
  info,
  worktrees,
  close,
  onOpen,
}: {
  info: RepoInfo;
  worktrees: Worktree[];
  close: () => void;
  onOpen: OpenView;
}) {
  const [error, choose] = useChoice(close);
  return (
    <div className="menu-scroll">
      {worktrees.map((worktree) => (
        <MenuItem
          key={worktree.path}
          main={worktree.name}
          sub={worktree.branch === null ? 'ohne Branch' : `⑂ ${worktree.branch}`}
          tip={worktree.path}
          current={worktree.path === info.worktreePath}
          onChoose={() => {
            choose(() => onOpen({ worktree: worktree.path }));
          }}
        />
      ))}
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </div>
  );
}

/**
 * Der Branch in der Kopfzeile. Zeigt die Liste einen anderen als den ausgecheckten, steht er in
 * der Farbe der Branch-Badges da.
 */
export function BranchMenu({ info, refs, onOpen }: { info: RepoInfo; refs: Ref[]; onOpen: OpenView }) {
  const foreign = info.branch !== info.checkedOut;
  return (
    <Menu
      button={<>⑂ {info.branch ?? 'ohne Branch'}</>}
      label="Branch"
      tip={foreign ? `Nicht ausgecheckt; ausgecheckt ist ${info.checkedOut ?? 'kein Branch'}` : 'Branch'}
      className={foreign ? 'crumb crumb-foreign' : 'crumb'}
    >
      {(close) => <BranchList info={info} refs={refs} close={close} onOpen={onOpen} />}
    </Menu>
  );
}

function BranchList({
  info,
  refs,
  close,
  onOpen,
}: {
  info: RepoInfo;
  refs: Ref[];
  close: () => void;
  onOpen: OpenView;
}) {
  const remotes = refs.filter((ref) => ref.kind === 'remote');
  const [remotesOpen, setRemotesOpen] = useState(remotes.some((ref) => ref.name === info.branch));
  const [error, choose] = useChoice(close);
  const item = (name: string, sub?: string) => (
    <MenuItem
      key={name}
      main={name === '' ? 'HEAD ohne Branch' : name}
      sub={sub}
      current={name === (info.branch ?? '')}
      onChoose={() => {
        choose(() => onOpen({ worktree: info.worktreePath, branch: name }));
      }}
    />
  );
  return (
    <div className="menu-scroll">
      <MenuSection>Lokal</MenuSection>
      {info.checkedOut === null && item('', 'ausgecheckt')}
      {refs
        .filter((ref) => ref.kind === 'local')
        .map((ref) => item(ref.name, ref.name === info.checkedOut ? 'ausgecheckt' : undefined))}
      {remotes.length > 0 && (
        <button
          type="button"
          className="menu-item menu-toggle"
          aria-expanded={remotesOpen}
          onClick={() => {
            setRemotesOpen(!remotesOpen);
          }}
        >
          <span className="menu-check" aria-hidden="true">
            {remotesOpen ? '▾' : '▸'}
          </span>
          <span className="menu-text">
            <span className="menu-main">Remotes</span>
          </span>
          <span className="menu-aside">{remotes.length}</span>
        </button>
      )}
      {remotesOpen && remotes.map((ref) => item(ref.name))}
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </div>
  );
}

/** Die zuletzt geöffneten Ansichten hinter dem Knopf mit der Uhr. */
export function RecentMenu({ info, onOpen }: { info: RepoInfo | null; onOpen: OpenView }) {
  return (
    <Menu button={<ClockIcon />} label="Zuletzt geöffnet" tip="Zuletzt geöffnete Ansichten (⌃Tab: vorige)" className="tool">
      {(close) => <RecentList info={info} close={close} onOpen={onOpen} />}
    </Menu>
  );
}

function RecentList({ info, close, onOpen }: { info: RepoInfo | null; close: () => void; onOpen: OpenView }) {
  const { data, error } = useLoaded(() => listViews());
  const [openError, choose] = useChoice(close);
  const isCurrent = (view: SavedView) =>
    info !== null && view.worktree === info.worktreePath && view.branch === (info.branch ?? '');
  return (
    <div className="menu-scroll">
      {error !== null && <MenuNote error>{error}</MenuNote>}
      {data?.length === 0 && <MenuNote>Noch keine Ansicht geöffnet.</MenuNote>}
      {data?.map((view) => (
        <MenuItem
          key={`${view.worktree}\n${view.branch}`}
          main={
            <>
              {view.repo}
              <span className="menu-where">
                {view.worktreeName === view.branch ? '' : ` · ⌂ ${view.worktreeName}`} · ⑂ {view.branch || 'ohne Branch'}
              </span>
            </>
          }
          sub={view.title}
          aside={view.to ?? 'neuester'}
          tip={view.worktree}
          current={isCurrent(view)}
          onChoose={() => {
            choose(() => onOpen(view));
          }}
        />
      ))}
      {openError !== null && <MenuNote error>{openError}</MenuNote>}
    </div>
  );
}

/** Eine Uhr als Symbol für die zuletzt geöffneten Ansichten. */
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 4.5V9l3 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
