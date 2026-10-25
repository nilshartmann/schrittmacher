import { Fragment, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LOCAL_GROUP, REMOTES_GROUP, hiddenBy, refPath, remoteGroup, remoteOf } from '../git/hidden';
import type { Hidden } from '../git/hidden';
import type { Ref, RepoInfo, Worktree } from '../git/types';
import { listRepos, listViews, openRepo, saveExcluded } from '../server/repo.functions';
import type { ProjectChoice, RepoChoice } from '../server/repo.functions';
import type { SavedView, Tab, ViewSearch } from '../server/store';
import { BranchIcon, RepoIcon } from './Icons';
import { Menu, MenuDivider, MenuItem, MenuNote, MenuSection, NewTabButton } from './Menu';
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
  root,
  onRoot,
  ...hidden
}: {
  info: RepoInfo;
  worktrees: Worktree[];
  refs: Ref[];
  onOpen: OpenView;
  onShow: (view: ViewSearch) => void;
} & RootProps &
  HiddenProps) {
  return (
    <>
      <RepoMenu info={info} onShow={onShow} root={root} onRoot={onRoot} />
      <WhereMenu info={info} worktrees={worktrees} refs={refs} onOpen={onOpen} {...hidden} />
    </>
  );
}

/** Die Wurzel, deren Projekte das Menü der Repos zeigt; `null` für alle. */
interface RootProps {
  root: string | null;
  onRoot: (root: string | null) => void;
}

/**
 * Das Repo, mit den zuletzt geöffneten Ansichten, den gefundenen Repos und einem Textfeld. Solange
 * keins offen ist, steht „Repo wählen" auf dem Knopf. Ohne `onRoot` gilt die Wahl der Wurzel nur,
 * solange das Menü da ist.
 */
export function RepoMenu({
  info,
  initiallyOpen,
  onShow,
  ...chosen
}: {
  info: RepoInfo | null;
  initiallyOpen?: boolean;
  /** Zeigt die Ansicht, die der Server für das gewählte Repo liefert. */
  onShow: (view: ViewSearch) => void;
} & Partial<RootProps>) {
  const [ownRoot, setOwnRoot] = useState<string | null>(null);
  const root = chosen.onRoot === undefined ? ownRoot : (chosen.root ?? null);
  const onRoot = chosen.onRoot ?? setOwnRoot;
  return (
    <Menu
      button={info === null ? <span className="crumb-repo">Repo wählen</span> : <RepoIcon />}
      label="Repo"
      tip={info === null ? 'Repo wählen' : `Repo wechseln: ${info.repo}`}
      className={info === null ? 'crumb' : 'tool'}
      initiallyOpen={initiallyOpen}
    >
      {(close) => <RepoList info={info} close={close} onShow={onShow} root={root} onRoot={onRoot} />}
    </Menu>
  );
}

/** Eine zuletzt geöffnete Ansicht, mit ihren Teilen für die URL. */
type ListedView = SavedView & { search: ViewSearch };

/** Wo eine zuletzt geöffnete Ansicht liegt, vom offenen Repo aus gesehen. */
type ViewPlace = 'repo' | 'sister' | 'other';

const VIEW_SECTIONS: Record<ViewPlace, string> = {
  repo: 'Dieses Repo',
  sister: 'Schwester-Repos',
  other: 'Andere Repos',
};

/** So viele Ansichten anderer Repos zeigt das Menü, damit die Repos darunter zu sehen bleiben. */
const OTHER_VIEWS = 5;

/** Der Ordner, in dem ein Pfad liegt. */
function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

/**
 * Die zuletzt geöffneten Ansichten in Abschnitten wie im Menü „Kopieren nach …“: die des offenen
 * Repos mit der offenen Ansicht zuerst, dann die von Schwester-Repos im selben Ordner, dann
 * höchstens `OTHER_VIEWS` übrige. Innerhalb eines Abschnitts steht die neueste oben. Ohne offenes
 * Repo gibt es nur einen Abschnitt.
 */
function viewSections(views: ListedView[], info: RepoInfo | null): { title: string; views: ListedView[] }[] {
  if (info === null) {
    return [{ title: 'Zuletzt geöffnet', views: views.slice(0, OTHER_VIEWS) }];
  }
  const placeOf = (view: ListedView): ViewPlace =>
    view.repoPath === info.repoPath
      ? 'repo'
      : parentOf(view.repoPath) === parentOf(info.repoPath)
        ? 'sister'
        : 'other';
  const isCurrent = (view: ListedView) => isCurrentView(view, info);
  const inRepo = views.filter((view) => placeOf(view) === 'repo');
  return [
    { title: VIEW_SECTIONS.repo, views: [...inRepo.filter(isCurrent), ...inRepo.filter((view) => !isCurrent(view))] },
    { title: VIEW_SECTIONS.sister, views: views.filter((view) => placeOf(view) === 'sister') },
    { title: VIEW_SECTIONS.other, views: views.filter((view) => placeOf(view) === 'other').slice(0, OTHER_VIEWS) },
  ];
}

function isCurrentView(view: SavedView, info: RepoInfo | null): boolean {
  return info !== null && view.worktree === info.worktreePath && view.branch === (info.branch ?? '');
}

/** So viele zuletzt geänderte Projekte stehen über den übrigen. */
const RECENT_PROJECTS = 10;

/** Die `count` zuletzt geänderten Projekte und die übrigen, beide nach Name sortiert. */
function splitByChange(projects: ProjectChoice[], count: number): { recent: ProjectChoice[]; rest: ProjectChoice[] } {
  const recent = new Set(projects.toSorted((a, b) => b.changed - a.changed).slice(0, count));
  return {
    recent: projects.filter((project) => recent.has(project)),
    rest: projects.filter((project) => !recent.has(project)),
  };
}

/** Der Umschalter zwischen den Wurzeln, mit ihrem Ordnernamen; „Beide" oder „Alle" zeigt jede. */
function RootSwitch({ roots, root, onRoot }: { roots: string[] } & RootProps) {
  const choices: { label: string; root: string | null }[] = [
    ...roots.map((path) => ({ label: path.slice(path.lastIndexOf('/') + 1), root: path })),
    { label: roots.length === 2 ? 'Beide' : 'Alle', root: null },
  ];
  return (
    <div className="segmented menu-roots" role="group" aria-label="Wurzel">
      {choices.map((choice) => (
        <button
          key={choice.label}
          type="button"
          aria-pressed={choice.root === root}
          data-tip={choice.root ?? undefined}
          onClick={() => {
            onRoot(choice.root);
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function RepoList({
  info,
  close,
  onShow,
  root: chosenRoot,
  onRoot,
}: {
  info: RepoInfo | null;
  close: () => void;
  onShow: (view: ViewSearch) => void;
} & RootProps) {
  const current = info?.repoPath ?? null;
  const { data, error } = useLoaded(() => listRepos());
  const views = useLoaded(() => listViews());
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
  const matching = (...texts: string[]) => {
    const wanted = filter.trim().toLowerCase();
    return wanted === '' || texts.some((text) => text.toLowerCase().includes(wanted));
  };
  const matches = (entry: RepoChoice) => matching(entry.name, entry.path);
  // Gemerkt wird die Liste, sobald sie sich hier ändert; bis dahin gilt die des Servers.
  const [changedExcluded, setChangedExcluded] = useState<string[] | null>(null);
  const excluded = changedExcluded ?? data?.excluded ?? [];
  const setExcluded = (next: string[]) => {
    setChangedExcluded(next);
    saveExcluded({ data: { excluded: next } }).catch((failure: unknown) => {
      console.error('Die ausgeschlossenen Repos ließen sich nicht speichern.', failure);
    });
  };
  const isExcluded = (path: string) => excluded.some((entry) => path === entry || path.startsWith(`${entry}/`));
  // Passt das Projekt, bleiben alle seine Repos; sonst nur die passenden darunter.
  const filtered = (project: ProjectChoice): ProjectChoice | null => {
    if (isExcluded(project.path)) {
      return null;
    }
    const kept = { ...project, children: project.children.filter((child) => !isExcluded(child.path)) };
    if (kept.repo === null && kept.children.length === 0) {
      return null;
    }
    if (matching(kept.name, kept.path)) {
      return kept;
    }
    const children = kept.children.filter(matches);
    return children.length === 0 ? null : { ...kept, children };
  };
  const sections =
    views.data === null
      ? []
      : viewSections(
          views.data.filter(
            (view) =>
              matching(view.repo, view.worktree, view.branch) &&
              (!isExcluded(view.repoPath) || isCurrentView(view, info)),
          ),
          info,
        ).filter((section) => section.views.length > 0);
  const excludeButton = (path: string, name: string): ReactNode => (
    <button
      type="button"
      className="menu-close menu-exclude"
      aria-label={`${name} ausschließen`}
      data-tip="Aus dem Menü ausschließen"
      onClick={() => {
        setExcluded([...excluded, path]);
      }}
    >
      ×
    </button>
  );
  const item = (entry: RepoChoice, main: string, home: string, row: RowOptions = {}): ReactNode => (
    <div key={entry.path} className={`menu-row menu-excludable ${row.className ?? ''}`}>
      <MenuItem
        main={main}
        sub={short(entry.path, home)}
        current={entry.path === current}
        link={entry.view}
        onChoose={close}
      />
      {row.fold}
      {excludeButton(row.exclude ?? entry.path, main)}
    </div>
  );
  const items = (entries: RepoChoice[], home: string): ReactNode =>
    entries.filter((entry) => matches(entry) && !isExcluded(entry.path)).map((entry) => item(entry, entry.name, home));
  const projects = (list: ProjectChoice[], home: string, initiallyOpen: boolean): ReactNode =>
    list.map((project) => {
      const shown = filtered(project);
      return (
        shown !== null && (
          <ProjectItems
            key={project.path}
            project={shown}
            initiallyOpen={initiallyOpen}
            item={(entry, main, row) => item(entry, main, home, row)}
            exclude={excludeButton(project.path, project.name)}
          />
        )
      );
    });
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
      {views.error !== null && <MenuNote error>{views.error}</MenuNote>}
      {error !== null && <MenuNote error>{error}</MenuNote>}
      {data === null && error === null && <MenuNote>Sucht Repos …</MenuNote>}
      {data !== null && (
        <div className="menu-scroll">
          {sections.map((section) => (
            <Fragment key={section.title}>
              <MenuDivider>{section.title}</MenuDivider>
              {section.views.map((view) => (
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
                  tip={view.worktree}
                  current={isCurrentView(view, info)}
                  link={view.search}
                  onChoose={close}
                />
              ))}
            </Fragment>
          ))}
          {(() => {
            // Eine Wurzel, die nicht mehr in der Konfiguration steht, gilt wie keine Wahl.
            const root = chosenRoot !== null && data.roots.includes(chosenRoot) ? chosenRoot : null;
            const { recent, rest } = splitByChange(
              data.projects.filter((project) => (root === null || project.root === root) && filtered(project) !== null),
              RECENT_PROJECTS,
            );
            const where = (root === null ? data.roots : [root]).map((path) => short(path, data.home)).join(', ');
            return (
              <>
                <div className="menu-row">
                  <MenuDivider>Zuletzt geändert</MenuDivider>
                  {data.roots.length > 1 && <RootSwitch roots={data.roots} root={root} onRoot={onRoot} />}
                </div>
                {projects(recent, data.home, true)}
                {rest.length > 0 && <MenuDivider>Weitere in {where}</MenuDivider>}
                {projects(rest, data.home, false)}
                {recent.length === 0 && <MenuNote>Keine Repos in {where} gefunden.</MenuNote>}
              </>
            );
          })()}
          {data.opened.some((entry) => !isExcluded(entry.path)) && <MenuDivider>Über den Pfad geöffnet</MenuDivider>}
          {items(data.opened, data.home)}
          {excluded.length > 0 && (
            <ExcludedList
              excluded={excluded.filter((entry) => matching(entry))}
              home={data.home}
              onOpen={open}
              onRestore={(path) => {
                setExcluded(excluded.filter((entry) => entry !== path));
              }}
            />
          )}
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

/** Wie eine Repo-Zeile im Menü der Repos aussieht und was ihr X ausschließt. */
interface RowOptions {
  className?: string;
  /** Das Dreieck eines Projekts, das selbst ein Repo ist. */
  fold?: ReactNode;
  /** Der Pfad, den das X ausschließt; ohne ihn der des Repos. */
  exclude?: string;
}

/**
 * Ein Projekt mit seinen Repos. Hat es nur eins, steht es als einzelne Zeile da. Sonst klappt das
 * Dreieck links die Repos darunter auf und zu. Ist der Ordner des Projekts selbst ein Repo, öffnet
 * ein Klick auf seinen Namen dieses Repo. Das X in der Zeile des Projekts schließt das ganze
 * Projekt aus.
 */
function ProjectItems({
  project,
  initiallyOpen,
  item,
  exclude,
}: {
  project: ProjectChoice;
  initiallyOpen: boolean;
  item: (entry: RepoChoice, main: string, row?: RowOptions) => ReactNode;
  /** Das X, das das ganze Projekt ausschließt. */
  exclude: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const toggle = () => {
    setOpen((before) => !before);
  };
  const [only, ...more] = project.repo === null ? project.children : [project.repo, ...project.children];
  if (only !== undefined && more.length === 0) {
    return item(only, only === project.repo ? project.name : `${project.name}/${only.name}`, {
      exclude: project.path,
    });
  }
  return (
    <>
      {project.repo === null ? (
        <div className="menu-row menu-excludable">
          <Toggle name={project.name} count={project.children.length} open={open} onToggle={toggle} />
          {exclude}
        </div>
      ) : (
        item(project.repo, project.name, {
          className: 'menu-project',
          fold: (
            <button
              type="button"
              className="menu-fold"
              aria-expanded={open}
              aria-label={open ? 'Repos darunter einklappen' : 'Repos darunter aufklappen'}
              data-tip={open ? 'Repos darunter einklappen' : 'Repos darunter aufklappen'}
              onClick={toggle}
            >
              {open ? '▾' : '▸'}
            </button>
          ),
        })
      )}
      {open && project.children.map((child) => item(child, child.name, { className: 'menu-row-nested' }))}
    </>
  );
}

/**
 * Die ausgeschlossenen Repos, eingeklappt am Ende des Menüs. Ein Klick auf eine Zeile öffnet das
 * Repo trotzdem, der Pfeil daneben nimmt den Ausschluss zurück.
 */
function ExcludedList({
  excluded,
  home,
  onOpen,
  onRestore,
}: {
  excluded: string[];
  home: string;
  onOpen: (path: string) => void;
  onRestore: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="menu-rule" />
      <Toggle
        name="Ausgeschlossene Repos"
        count={excluded.length}
        open={open}
        onToggle={() => {
          setOpen((before) => !before);
        }}
      />
      {open &&
        excluded.toSorted((a, b) => a.localeCompare(b)).map((path) => (
          <div key={path} className="menu-row menu-row-nested">
            <MenuItem
              main={path.slice(path.lastIndexOf('/') + 1)}
              sub={short(path, home)}
              onChoose={() => {
                onOpen(path);
              }}
            />
            <button
              type="button"
              className="menu-close"
              aria-label={`Ausschluss von ${short(path, home)} zurücknehmen`}
              data-tip="Wieder im Menü zeigen"
              onClick={() => {
                onRestore(path);
              }}
            >
              ↩
            </button>
          </div>
        ))}
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

/** Ein Auge wie in Fork, durchgestrichen für einen ausgeblendeten Branch. */
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
