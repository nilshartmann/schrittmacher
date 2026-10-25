import { Fragment, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LOCAL_GROUP, REMOTES_GROUP, hiddenBy, refPath, remoteGroup, remoteOf } from '../git/hidden';
import type { Hidden } from '../git/hidden';
import type { Ref, RepoInfo, Worktree } from '../git/types';
import { listRepos, listViews, openRepo } from '../server/repo.functions';
import type { RepoChoice } from '../server/repo.functions';
import type { SavedView, ViewSearch } from '../server/store';
import { BranchIcon, RepoIcon } from './Icons';
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

/**
 * Die Knöpfe zum Wechseln von Repo, Worktree und Branch in der Kopfzeile. Sie zeigen nur ein
 * Symbol, weil die Namen im Tab darüber stehen; den Namen nennt der Tooltip. Mit nur einem
 * Worktree fehlt dessen Knopf, weil es nichts zu wählen gibt.
 */
export function WhereMenus({
  info,
  worktrees,
  refs,
  onOpen,
  onShow,
  ...hidden
}: {
  info: RepoInfo;
  worktrees: Worktree[];
  refs: Ref[];
  onOpen: OpenView;
  onShow: (view: ViewSearch) => void;
} & HiddenProps) {
  return (
    <>
      <RepoMenu info={info} onShow={onShow} />
      {worktrees.length > 1 && <WorktreeMenu info={info} worktrees={worktrees} onOpen={onOpen} />}
      <BranchMenu info={info} refs={refs} onOpen={onOpen} {...hidden} />
    </>
  );
}

/**
 * Das Repo, mit denen im Ordner des Projekts, den gefundenen und einem Textfeld. Die zuletzt
 * geöffneten Ansichten stehen hinter der Uhr in der Tableiste. Solange keins offen ist, steht „Repo wählen" auf dem Knopf.
 */
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
      button={info === null ? <span className="crumb-repo">Repo wählen</span> : <RepoIcon />}
      label="Repo"
      tip={info === null ? 'Repo wählen' : `Repo wechseln: ${info.repo}`}
      className={info === null ? 'crumb' : 'tool'}
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
  const matches = (entry: RepoChoice) => {
    const wanted = filter.trim().toLowerCase();
    return wanted === '' || entry.name.toLowerCase().includes(wanted) || entry.path.toLowerCase().includes(wanted);
  };
  const items = (entries: RepoChoice[], home: string): ReactNode =>
    entries.filter(matches).map((entry) => (
      <MenuItem
        key={entry.path}
        main={entry.name}
        sub={short(entry.path, home)}
        current={entry.path === current}
        link={entry.view}
        onChoose={close}
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
          {data.folder !== null && data.inFolder.length > 0 && (
            <MenuSection>In {short(data.folder, data.home)}</MenuSection>
          )}
          {items(data.inFolder, data.home)}
          <MenuSection>In {data.roots.map((root) => short(root, data.home)).join(', ')}</MenuSection>
          {items(data.found, data.home)}
          {data.found.length === 0 && <MenuNote>Keine weiteren Repos gefunden.</MenuNote>}
          {data.opened.length > 0 && <MenuSection>Über den Pfad geöffnet</MenuSection>}
          {items(data.opened, data.home)}
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

/** Der Worktree. */
export function WorktreeMenu({
  info,
  worktrees,
  onOpen,
}: {
  info: RepoInfo;
  worktrees: Worktree[];
  onOpen: OpenView;
}) {
  return (
    <Menu
      button={<span className="tool-glyph">⌂</span>}
      label="Worktree"
      tip={`Worktree wechseln: ${info.worktree}`}
      className="tool"
    >
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
          sub={
            worktree.branch === null ? (
              'ohne Branch'
            ) : (
              <>
                <BranchIcon /> {worktree.branch}
              </>
            )
          }
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

/** Die ausgeblendeten Branches und das Umschalten eines Branches oder einer Gruppe. */
interface HiddenProps {
  hidden: Hidden;
  onToggleHidden: (path: string) => void;
}

/**
 * Der Branch. Zeigt die Liste einen anderen als den ausgecheckten, steht der Knopf in der Farbe der
 * Branch-Badges da.
 */
export function BranchMenu({
  info,
  refs,
  onOpen,
  ...hidden
}: { info: RepoInfo; refs: Ref[]; onOpen: OpenView } & HiddenProps) {
  const foreign = info.branch !== info.checkedOut;
  return (
    <Menu
      button={<BranchIcon />}
      label="Branch"
      tip={
        foreign
          ? `Branch wechseln: ${info.branch ?? 'ohne Branch'}, nicht ausgecheckt; ausgecheckt ist ${info.checkedOut ?? 'kein Branch'}`
          : `Branch wechseln: ${info.branch ?? 'ohne Branch'}`
      }
      className={foreign ? 'tool tool-foreign' : 'tool'}
    >
      {(close) => <BranchList info={info} refs={refs} close={close} onOpen={onOpen} {...hidden} />}
    </Menu>
  );
}

/**
 * Die Branches wie in der Seitenleiste von Fork: die lokalen, darunter die Remotes eingeklappt und
 * nach Remote gruppiert. Neben jedem Branch und jeder Gruppe blendet ein Auge die Badges in der
 * Commit-Liste aus und wieder ein.
 */
function BranchList({
  info,
  refs,
  close,
  onOpen,
  hidden,
  onToggleHidden,
}: {
  info: RepoInfo;
  refs: Ref[];
  close: () => void;
  onOpen: OpenView;
} & HiddenProps) {
  const remotes = refs.filter((ref) => ref.kind === 'remote');
  const remoteNames = [...new Set(remotes.map(remoteOf))];
  const [remotesOpen, setRemotesOpen] = useState(remotes.some((ref) => ref.name === info.branch));
  const [error, choose] = useChoice(close);
  const eye = (path: string, name: string) => (
    <EyeButton path={path} name={name} hidden={hidden} onToggle={onToggleHidden} />
  );
  const item = (ref: Ref | null, main: string, sub?: string) => {
    const name = ref?.name ?? '';
    const path = ref === null ? null : refPath(ref);
    return (
      <div
        key={name}
        className={`menu-row${ref?.kind === 'remote' ? ' menu-row-nested' : ''}${
          path !== null && hiddenBy(hidden, path) !== null ? ' menu-row-hidden' : ''
        }`}
      >
        <MenuItem
          main={main}
          sub={sub}
          current={name === (info.branch ?? '')}
          onChoose={() => {
            choose(() => onOpen({ worktree: info.worktreePath, branch: name }));
          }}
        />
        {path !== null && eye(path, name)}
      </div>
    );
  };
  return (
    <div className="menu-scroll">
      <div className="menu-row">
        <MenuSection>Lokal</MenuSection>
        {eye(LOCAL_GROUP, 'alle lokalen Branches')}
      </div>
      {info.checkedOut === null && item(null, 'HEAD ohne Branch', 'ausgecheckt')}
      {refs
        .filter((ref) => ref.kind === 'local')
        .map((ref) => item(ref, ref.name, ref.name === info.checkedOut ? 'ausgecheckt' : undefined))}
      {remotes.length > 0 && (
        <div className={`menu-row${hiddenBy(hidden, REMOTES_GROUP) !== null ? ' menu-row-hidden' : ''}`}>
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
          {eye(REMOTES_GROUP, 'alle Remotes')}
        </div>
      )}
      {remotesOpen &&
        remoteNames.map((remote) => (
          <Fragment key={remote}>
            <div className={`menu-row${hiddenBy(hidden, remoteGroup(remote)) !== null ? ' menu-row-hidden' : ''}`}>
              <MenuSection>☁ {remote}</MenuSection>
              {eye(remoteGroup(remote), `alle Branches von ${remote}`)}
            </div>
            {remotes
              .filter((ref) => remoteOf(ref) === remote)
              .map((ref) => item(ref, ref.name.slice(remote.length + 1)))}
          </Fragment>
        ))}
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </div>
  );
}

/**
 * Das Auge neben einem Branch oder einer Gruppe. Ausgeblendet ist es durchgestrichen. Ist der
 * Branch über eine Gruppe ausgeblendet, lässt er sich erst mit der Gruppe wieder einblenden.
 */
function EyeButton({
  path,
  name,
  hidden,
  onToggle,
}: {
  path: string;
  name: string;
  hidden: Hidden;
  onToggle: (path: string) => void;
}) {
  const by = hiddenBy(hidden, path);
  const inherited = by !== null && by !== path;
  return (
    <button
      type="button"
      className="menu-eye"
      aria-label={by === null ? `${name} ausblenden` : `${name} einblenden`}
      aria-pressed={by !== null}
      // Ohne `disabled`, weil ein gesperrter Knopf in Safari keinen Tooltip bekommt.
      aria-disabled={inherited}
      data-tip={
        inherited
          ? `Ausgeblendet mit ${groupName(by)}`
          : by === null
            ? 'Badges in der Commit-Liste ausblenden'
            : 'Badges in der Commit-Liste einblenden'
      }
      onClick={() => {
        if (!inherited) {
          onToggle(path);
        }
      }}
    >
      <EyeIcon crossed={by !== null} />
    </button>
  );
}

/** Der Name einer Gruppe für einen Tooltip. */
function groupName(group: string): string {
  if (group === LOCAL_GROUP) {
    return 'allen lokalen Branches';
  }
  if (group === REMOTES_GROUP) {
    return 'allen Remotes';
  }
  return `allen Branches von ${group.slice(REMOTES_GROUP.length, -1)}`;
}

/**
 * Die zuletzt geöffneten Ansichten hinter dem Knopf mit der Uhr; `current` ist die offene Ansicht
 * und hat einen Haken.
 */
export function RecentMenu({
  current,
  className = 'tool',
}: {
  current: { worktree: string; branch: string } | null;
  className?: string;
}) {
  return (
    <Menu button={<ClockIcon />} label="Zuletzt geöffnete Ansichten" tip="Zuletzt geöffnete Ansichten" className={className}>
      {(close) => <RecentList current={current} close={close} />}
    </Menu>
  );
}

function RecentList({ current, close }: { current: { worktree: string; branch: string } | null; close: () => void }) {
  const { data, error } = useLoaded(() => listViews());
  const isCurrent = (view: SavedView) =>
    current !== null && view.worktree === current.worktree && view.branch === current.branch;
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
                {view.worktreeName === view.branch ? '' : ` · ⌂ ${view.worktreeName}`} · <BranchIcon />{' '}
                {view.branch || 'ohne Branch'}
              </span>
            </>
          }
          sub={view.title}
          aside={view.to ?? 'neuester'}
          tip={view.worktree}
          current={isCurrent(view)}
          link={view.search}
          onChoose={close}
        />
      ))}
    </div>
  );
}

/** Eine Uhr als Symbol für die zuletzt geöffneten Ansichten. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M1.75 9C3.4 5.9 6 4.25 9 4.25S14.6 5.9 16.25 9C14.6 12.1 12 13.75 9 13.75S3.4 12.1 1.75 9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="2.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {crossed && <path d="M3 15 15 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 4.5V9l3 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
