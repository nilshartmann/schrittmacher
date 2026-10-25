import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  activateProject,
  chooseTabs,
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  scanFolder,
} from '../server/repo.functions';
import type { RepoViews, ViewChoice } from '../server/repo.functions';
import type { Tab, ViewSearch } from '../server/store';
import { BranchIcon } from './Icons';
import { Menu, MenuItem, MenuNote, MenuSection } from './Menu';
import { sameTab } from './Tabs';

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Ein Pfad mit `~` statt des Home-Verzeichnisses. */
function short(path: string, home: string): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

interface ProjectMenuProps {
  /** Das aktive Projekt; ohne offene Ansicht unbekannt. */
  project: string | null;
  /** Die Tabs des aktiven Projekts, damit die Auswahl sie angehakt zeigt. */
  tabs: Tab[];
  /**
   * Zeigt nach einem Wechsel des Projekts dessen Ansicht; `null`, wenn es noch keine hat. Die Seite
   * lädt dabei neu, weil das Projekt seine eigenen Tabs mitbringt.
   */
  onProject: (view: ViewSearch | null) => void;
  /** Übernimmt die Tabs, die die Auswahl für das aktive Projekt gesetzt hat. */
  onTabs: (tabs: Tab[]) => void;
  /** Lädt die Seite nach dem Umbenennen neu, damit sie den neuen Namen kennt. */
  onRenamed: () => void;
}

/** Was der Dialog zur Auswahl der Ansichten gerade tut: ein Projekt anlegen oder eins ändern. */
type Dialog = { mode: 'create' } | { mode: 'edit'; name: string; folder: string | null };

/**
 * Das Projekt links in der Tableiste. Das Menü wechselt das Projekt, benennt es um und löscht es; das
 * Anlegen und die Auswahl der Ansichten laufen im Dialog.
 */
export function ProjectMenu(props: ProjectMenuProps) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  return (
    <>
      <Menu
        button={
          <>
            <StackIcon />
            <span className="tabs-project-name">{props.project ?? 'Projekt'}</span>
          </>
        }
        label="Projekt"
        tip={props.project === null ? 'Projekt' : `Projekt: ${props.project}`}
        className="tabs-project"
      >
        {(close) => (
          <ProjectList
            {...props}
            close={close}
            onDialog={(next) => {
              close();
              setDialog(next);
            }}
          />
        )}
      </Menu>
      {dialog !== null && (
        <ViewsDialog
          dialog={dialog}
          tabs={dialog.mode === 'edit' ? props.tabs : []}
          onCancel={() => {
            setDialog(null);
          }}
          onCreated={(view) => {
            setDialog(null);
            props.onProject(view);
          }}
          onChosen={(tabs) => {
            setDialog(null);
            props.onTabs(tabs);
          }}
        />
      )}
    </>
  );
}

function ProjectList({
  project,
  close,
  onProject,
  onRenamed,
  onDialog,
}: ProjectMenuProps & { close: () => void; onDialog: (dialog: Dialog) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof listProjects>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(project ?? '');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    listProjects().then(setData, (failure: unknown) => {
      setError(messageOf(failure));
    });
  }, []);
  const run = (action: () => Promise<void>) => {
    setError(null);
    action().then(close, (failure: unknown) => {
      setError(messageOf(failure));
    });
  };
  const active = data?.projects.find((candidate) => candidate.name === data.active);
  const onRename = (event: FormEvent) => {
    event.preventDefault();
    if (active !== undefined && name.trim() !== '' && name.trim() !== active.name) {
      run(async () => {
        await renameProject({ data: { from: active.name, to: name } });
        onRenamed();
      });
    }
  };
  return (
    <>
      {error !== null && <MenuNote error>{error}</MenuNote>}
      {data === null && error === null && <MenuNote>Lädt …</MenuNote>}
      {data !== null && (
        <div className="menu-scroll">
          {data.projects.map((candidate) => (
            <MenuItem
              key={candidate.name}
              main={candidate.name}
              sub={candidate.folder === null ? 'ohne Ordner' : short(candidate.folder, data.home)}
              current={candidate.name === data.active}
              onChoose={() => {
                if (candidate.name === data.active) {
                  close();
                  return;
                }
                run(async () => {
                  onProject(await activateProject({ data: { name: candidate.name } }));
                });
              }}
            />
          ))}
          <hr className="menu-divider" />
          <MenuItem
            main="Ansichten auswählen …"
            sub={(active?.folder ?? null) === null ? 'Repos aus einem Ordner als Tabs' : undefined}
            onChoose={() => {
              onDialog({ mode: 'edit', name: data.active, folder: active?.folder ?? null });
            }}
          />
          {data.projects.length > 1 && (
            <MenuItem
              main={deleting ? `${data.active} wirklich löschen?` : 'Projekt löschen …'}
              sub={deleting ? 'Tabs und zuletzt geöffnete Ansichten gehen verloren' : undefined}
              onChoose={() => {
                if (!deleting) {
                  setDeleting(true);
                  return;
                }
                run(async () => {
                  onProject(await deleteProject({ data: { name: data.active } }));
                });
              }}
            />
          )}
          <MenuItem
            main="Neues Projekt …"
            onChoose={() => {
              onDialog({ mode: 'create' });
            }}
          />
        </div>
      )}
      {active !== undefined && (
        <form className="menu-form" onSubmit={onRename}>
          <input
            className="menu-input"
            type="text"
            aria-label="Name des Projekts"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <button
            type="submit"
            className="tool"
            disabled={name.trim() === '' || name.trim() === active.name}
          >
            Umbenennen
          </button>
        </form>
      )}
    </>
  );
}

/** Der Schlüssel einer Ansicht für die Häkchen. */
function keyOf(view: { worktree: string; branch: string }): string {
  return `${view.worktree}\n${view.branch}`;
}

/**
 * Die Auswahl der Ansichten in einem Dialog. Für den Ordner werden die Repos darin mit ihren
 * Ansichten gesucht; jede angehakte wird ein Tab. Beim Anlegen sind die ausgecheckten Branches
 * angehakt, beim Ändern die Tabs des Projekts. Tabs außerhalb des Ordners stehen am Ende.
 */
function ViewsDialog({
  dialog,
  tabs,
  onCancel,
  onCreated,
  onChosen,
}: {
  dialog: Dialog;
  tabs: Tab[];
  onCancel: () => void;
  onCreated: (view: ViewSearch | null) => void;
  onChosen: (tabs: Tab[]) => void;
}) {
  const [name, setName] = useState(dialog.mode === 'edit' ? dialog.name : '');
  const [folder, setFolder] = useState(dialog.mode === 'edit' ? (dialog.folder ?? '') : '');
  const [scanned, setScanned] = useState<{ folder: string; repos: RepoViews[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(tabs.map(keyOf)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scan = (path: string) => {
    setError(null);
    setScanning(true);
    scanFolder({ data: { folder: path } }).then(
      (result) => {
        setScanning(false);
        setScanned(result);
        if (dialog.mode === 'create') {
          const views = result.repos.flatMap((repo) => repo.views);
          setChecked(new Set(views.filter((view) => view.checkedOut).map(keyOf)));
        }
      },
      (failure: unknown) => {
        setScanning(false);
        setError(messageOf(failure));
      },
    );
  };
  useEffect(() => {
    if (folder !== '') {
      scan(folder);
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const offered = scanned?.repos.flatMap((repo) => repo.views) ?? [];
  // Tabs, die die Suche im Ordner nicht findet, bleiben wählbar, damit sie sich abwählen lassen.
  const outside = tabs.filter((tab) => !offered.some((view) => sameTab(view, tab)));
  const chosen = [
    ...tabs.filter((tab) => checked.has(keyOf(tab))),
    ...offered.filter((view) => checked.has(keyOf(view)) && !tabs.some((tab) => sameTab(tab, view))),
  ];
  const toggle = (key: string) => {
    const next = new Set(checked);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setChecked(next);
  };
  const ready = scanned !== null && chosen.length > 0 && name.trim() !== '' && !saving;
  const onScan = (event: FormEvent) => {
    event.preventDefault();
    if (folder.trim() !== '') {
      scan(folder);
    }
  };
  const save = () => {
    if (!ready) {
      return;
    }
    setError(null);
    setSaving(true);
    const data = {
      name,
      folder: scanned.folder,
      views: chosen.map(({ worktree, branch }) => ({ worktree, branch })),
    };
    const done = dialog.mode === 'create' ? createProject({ data }).then(onCreated) : chooseTabs({ data }).then(onChosen);
    done.catch((failure: unknown) => {
      setSaving(false);
      setError(messageOf(failure));
    });
  };

  const row = (view: ViewChoice | Tab, sub: string) => {
    const key = keyOf(view);
    return (
      <label key={key} className="choice">
        <input
          type="checkbox"
          checked={checked.has(key)}
          onChange={() => {
            toggle(key);
          }}
        />
        <span className="menu-text">
          <span className="menu-main">
            ⌂ {view.worktreeName} · <BranchIcon /> {view.branch || 'ohne Branch'}
          </span>
          <span className="menu-sub">{sub}</span>
        </span>
      </label>
    );
  };

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-label={dialog.mode === 'create' ? 'Neues Projekt' : 'Ansichten auswählen'}>
        <h2 className="dialog-title">{dialog.mode === 'create' ? 'Neues Projekt' : `Ansichten von ${dialog.name}`}</h2>
        {dialog.mode === 'create' && (
          <input
            className="menu-input"
            type="text"
            placeholder="Name, etwa W-JAX 2026"
            aria-label="Name des Projekts"
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
        <form className="dialog-folder" onSubmit={onScan}>
          <input
            className="menu-input"
            type="text"
            placeholder="Ordner einfügen, etwa ~/develop/…"
            aria-label="Ordner des Projekts"
            value={folder}
            autoFocus={dialog.mode === 'edit' && folder === ''}
            onChange={(event) => {
              setFolder(event.target.value);
            }}
          />
          <button type="submit" className="tool" disabled={folder.trim() === '' || scanning}>
            Suchen
          </button>
        </form>
        <div className="dialog-list">
          {scanning && <MenuNote>Sucht Repos …</MenuNote>}
          {!scanning && scanned === null && <MenuNote>Im Ordner und darunter werden Repos gesucht.</MenuNote>}
          {!scanning && scanned?.repos.length === 0 && <MenuNote>Im Ordner gibt es kein Repo.</MenuNote>}
          {!scanning &&
            scanned?.repos.map((repo) => (
              <section key={repo.path}>
                <MenuSection>
                  {repo.name}
                  {repo.path.startsWith(`${scanned.folder}/`) &&
                    repo.path.slice(scanned.folder.length + 1) !== repo.name && (
                      <span className="dialog-path">{repo.path.slice(scanned.folder.length + 1)}</span>
                    )}
                </MenuSection>
                {repo.views.map((view) => row(view, view.checkedOut ? 'ausgecheckt' : 'nicht ausgecheckt'))}
              </section>
            ))}
          {!scanning && outside.length > 0 && (
            <section>
              <MenuSection>Tabs außerhalb des Ordners</MenuSection>
              {outside.map((tab) => row(tab, tab.repo))}
            </section>
          )}
        </div>
        {error !== null && <MenuNote error>{error}</MenuNote>}
        <div className="dialog-actions">
          <span className="dialog-count">
            {chosen.length === 1 ? 'Ein Tab' : `${String(chosen.length)} Tabs`}
          </span>
          <button type="button" className="tool" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="button" className="tool tool-primary" disabled={!ready} onClick={save}>
            {dialog.mode === 'create' ? 'Anlegen' : 'Übernehmen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Drei gestapelte Ebenen als Symbol für ein Projekt. */
function StackIcon() {
  return (
    <svg className="tabs-project-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 1.5 12.5 4 7 6.5 1.5 4Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M1.5 7 7 9.5 12.5 7M1.5 10 7 12.5 12.5 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
