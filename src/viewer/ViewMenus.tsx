import { Fragment, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LOCAL_GROUP, REMOTES_GROUP, hiddenBy, refPath, remoteGroup, remoteOf } from '../git/hidden';
import type { Hidden } from '../git/hidden';
import type { Ref, RepoInfo, Worktree } from '../git/types';
import { listRepos, listViews, openRepo } from '../server/repo.functions';
import type { RepoChoice } from '../server/repo.functions';
import type { SavedView, Tab, ViewSearch } from '../server/store';
import { BranchIcon, RepoIcon } from './Icons';
import { Menu, MenuItem, MenuNote, MenuSection, NewTabButton } from './Menu';
import { CloseButton, sameTab, TabsContext } from './Tabs';

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
 * Die Knöpfe zum Wechseln des Repos und von Worktree und Branch in der Kopfzeile. Sie zeigen nur
 * ein Symbol, weil die Namen im Tab darüber stehen; den Namen nennt der Tooltip.
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
      <WhereMenu info={info} worktrees={worktrees} refs={refs} onOpen={onOpen} {...hidden} />
    </>
  );
}

/**
 * Das Repo, mit den gefundenen und einem Textfeld. Die zuletzt geöffneten Ansichten stehen hinter
 * der Uhr in der Tableiste. Solange keins offen ist, steht „Repo wählen" auf dem Knopf.
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

/** Die ausgeblendeten Branches und das Umschalten eines Branches oder einer Gruppe. */
interface HiddenProps {
  hidden: Hidden;
  onToggleHidden: (path: string) => void;
}

/**
 * Worktree und Branch in einem Menü, wie in der Seitenleiste von Fork. Zeigt die Liste einen
 * anderen Branch als den ausgecheckten, steht der Knopf in der Farbe der Branch-Badges da.
 */
export function WhereMenu({
  info,
  worktrees,
  refs,
  onOpen,
  ...hidden
}: { info: RepoInfo; worktrees: Worktree[]; refs: Ref[]; onOpen: OpenView } & HiddenProps) {
  const foreign = info.branch !== info.checkedOut;
  const where = `⌂ ${info.worktree} · ${info.branch ?? 'ohne Branch'}`;
  return (
    <Menu
      button={<BranchIcon />}
      label="Worktree und Branch"
      tip={
        foreign
          ? `Worktree und Branch wechseln: ${where}, nicht ausgecheckt; ausgecheckt ist ${info.checkedOut ?? 'kein Branch'}`
          : `Worktree und Branch wechseln: ${where}`
      }
      className={foreign ? 'tool tool-foreign' : 'tool'}
    >
      {(close) => <WhereList info={info} worktrees={worktrees} refs={refs} close={close} onOpen={onOpen} {...hidden} />}
    </Menu>
  );
}

/**
 * Oben die Worktrees, falls es mehr als einen gibt, darunter die lokalen Branches und die Remotes
 * eingeklappt und nach Remote gruppiert. Lokale Branches mit `/` im Namen stehen wie in Fork
 * eingeklappt in einem Ordner. Ein Worktree bringt seinen ausgecheckten Branch mit, ein Branch
 * ändert nur die Commit-Liste im aktuellen Worktree. Jede Zeile öffnet ihre Ansicht auch in einem
 * neuen Tab. Neben jedem Branch und jeder Gruppe blendet ein Auge die Badges in der Commit-Liste
 * aus und wieder ein.
 */
function WhereList({
  info,
  worktrees,
  refs,
  close,
  onOpen,
  hidden,
  onToggleHidden,
}: {
  info: RepoInfo;
  worktrees: Worktree[];
  refs: Ref[];
  close: () => void;
  onOpen: OpenView;
} & HiddenProps) {
  const remotes = refs.filter((ref) => ref.kind === 'remote');
  const remoteNames = [...new Set(remotes.map(remoteOf))];
  const [remotesOpen, setRemotesOpen] = useState(remotes.some((ref) => ref.name === info.branch));
  const locals = refs.filter((ref) => ref.kind === 'local');
  const folders = [...new Set(locals.flatMap((ref) => (ref.name.includes('/') ? [folderOf(ref.name)] : [])))].sort();
  // Ein Ordner ist anfangs nur offen, wenn der gezeigte Branch darin liegt.
  const [openFolders, setOpenFolders] = useState(() =>
    folders.filter((folder) => info.branch?.startsWith(`${folder}/`) === true),
  );
  const tabs = useContext(TabsContext);
  const [error, choose] = useChoice(close);
  // Ist die Ansicht in einem Tab offen, holt der Knopf diesen Tab nach vorn, und daneben steht sein
  // Schließen-Kreuz; sonst steht dort ein Platzhalter, damit die Knöpfe untereinander stehen. Der
  // letzte Tab lässt sich nicht schließen.
  const tabButton = (target: { worktree: string; branch: string }, name: string, open: Tab | undefined) => {
    if (tabs === null) {
      return null;
    }
    return (
      <>
        <NewTabButton
          name={name}
          open={open !== undefined}
          onClick={() => {
            choose(() => tabs.show(open ?? target));
          }}
        />
        {open !== undefined && tabs.tabs.length > 1 ? (
          <CloseButton
            className="menu-close"
            label={`Tab von ${name} schließen`}
            onClose={() => {
              tabs.close(open);
            }}
          />
        ) : (
          <span className="menu-spacer" />
        )}
      </>
    );
  };
  const eye = (path: string, name: string) => (
    <EyeButton path={path} name={name} hidden={hidden} onToggle={onToggleHidden} />
  );
  const branch = (ref: Ref | null, main: string, sub?: string) => {
    const name = ref?.name ?? '';
    const path = ref === null ? null : refPath(ref);
    const target = { worktree: info.worktreePath, branch: name };
    // Ein neuer Tab zeigt den Branch in dem Worktree, in dem er ausgecheckt ist, mit seinen lokalen
    // Änderungen. Offen ist der Branch, wenn ein Tab ihn in einem Worktree des Repos zeigt.
    const checkedOutIn = worktrees.find((worktree) => worktree.branch === name);
    const inTab = { worktree: checkedOutIn?.path ?? info.worktreePath, branch: name };
    const inRepo = (tab: Tab) => worktrees.some((worktree) => worktree.path === tab.worktree);
    const open =
      tabs?.tabs.find((tab) => sameTab(tab, inTab)) ??
      tabs?.tabs.find((tab) => name !== '' && tab.branch === name && inRepo(tab));
    return (
      <div
        key={name}
        className={`menu-row${ref !== null && (ref.kind === 'remote' || ref.name.includes('/')) ? ' menu-row-nested' : ''}${
          path !== null && hiddenBy(hidden, path) !== null ? ' menu-row-hidden' : ''
        }`}
      >
        <MenuItem
          main={main}
          sub={sub}
          current={name === (info.branch ?? '')}
          newTab={target}
          onChoose={() => {
            choose(() => onOpen(target));
          }}
        />
        {tabButton(inTab, main, open)}
        {path !== null ? eye(path, name) : <span className="menu-spacer" />}
      </div>
    );
  };
  return (
    <div className="menu-scroll">
      {worktrees.length > 1 && (
        <>
          <MenuSection>Worktrees</MenuSection>
          {worktrees.map((worktree) => {
            const target = { worktree: worktree.path, branch: worktree.branch ?? '' };
            return (
              <div key={worktree.path} className="menu-row">
                <MenuItem
                  main={<>⌂ {worktree.name}</>}
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
                  newTab={target}
                  onChoose={() => {
                    choose(() => onOpen(target));
                  }}
                />
                {tabButton(target, worktree.name, tabs?.tabs.find((tab) => sameTab(tab, target)))}
                <span className="menu-spacer" />
              </div>
            );
          })}
        </>
      )}
      <div className="menu-row">
        <MenuSection>Lokal</MenuSection>
        {eye(LOCAL_GROUP, 'alle lokalen Branches')}
      </div>
      {info.checkedOut === null && branch(null, 'HEAD ohne Branch', 'ausgecheckt')}
      {folders.map((folder) => {
        const inFolder = locals.filter((ref) => ref.name.includes('/') && folderOf(ref.name) === folder);
        const open = openFolders.includes(folder);
        const group = `${LOCAL_GROUP}${folder}/`;
        return (
          <Fragment key={`${folder}/`}>
            <div className={`menu-row${hiddenBy(hidden, group) !== null ? ' menu-row-hidden' : ''}`}>
              <Toggle
                name={folder}
                count={inFolder.length}
                open={open}
                onToggle={() => {
                  setOpenFolders(open ? openFolders.filter((other) => other !== folder) : [...openFolders, folder]);
                }}
              />
              {eye(group, `alle Branches in ${folder}`)}
            </div>
            {open &&
              inFolder.map((ref) =>
                branch(ref, ref.name.slice(folder.length + 1), ref.name === info.checkedOut ? 'ausgecheckt' : undefined),
              )}
          </Fragment>
        );
      })}
      {locals
        .filter((ref) => !ref.name.includes('/'))
        .map((ref) => branch(ref, ref.name, ref.name === info.checkedOut ? 'ausgecheckt' : undefined))}
      {remotes.length > 0 && (
        <div className={`menu-row${hiddenBy(hidden, REMOTES_GROUP) !== null ? ' menu-row-hidden' : ''}`}>
          <Toggle
            name="Remotes"
            count={remotes.length}
            open={remotesOpen}
            onToggle={() => {
              setRemotesOpen(!remotesOpen);
            }}
          />
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
              .map((ref) => branch(ref, ref.name.slice(remote.length + 1)))}
          </Fragment>
        ))}
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </div>
  );
}

/** Der Ordner eines lokalen Branches, `backup` für `backup/2026-10-11_interaktion`. */
function folderOf(name: string): string {
  return name.slice(0, name.indexOf('/'));
}

/** Eine Zeile, die eine Gruppe von Branches auf- und zuklappt, mit der Zahl der Branches darin. */
function Toggle({ name, count, open, onToggle }: { name: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="menu-item menu-toggle" aria-expanded={open} onClick={onToggle}>
      <span className="menu-check" aria-hidden="true">
        {open ? '▾' : '▸'}
      </span>
      <span className="menu-text">
        <span className="menu-main">{name}</span>
      </span>
      <span className="menu-aside">{count}</span>
    </button>
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
  if (group.startsWith(LOCAL_GROUP)) {
    return `allen Branches in ${group.slice(LOCAL_GROUP.length, -1)}`;
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
