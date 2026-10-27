import { useContext, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { changeProject, listProjects, saveTabs } from '../server/repo.functions';
import type { ProjectChange } from '../server/repo.functions';
import type { Project, Projects, Tab, ViewSearch } from '../server/store';
import { SubPanel } from './HoverTools';
import type { SubAnchor } from './HoverTools';
import { PencilIcon, PlusIcon, ProjectIcon, TrashIcon } from './Icons';
import { Menu, MenuItem, MenuNote } from './Menu';
import { sameTab, TabsContext } from './Tabs';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ob zwei Tableisten dieselben Tabs in derselben Reihenfolge haben. */
export function sameTabs(a: Tab[], b: Tab[]): boolean {
  return a.length === b.length && a.every((tab, at) => b[at] !== undefined && sameTab(tab, b[at]));
}

/** Die Repos eines Projekts mit ihren Branches, als zweite Zeile im Menü. */
export function projectSummary(project: Project): string {
  if (project.tabs.length === 0) {
    return 'Keine Tabs';
  }
  const repos = new Map<string, string[]>();
  for (const tab of project.tabs) {
    repos.set(tab.repo, [...(repos.get(tab.repo) ?? []), tab.branch || 'ohne Branch']);
  }
  return [...repos].map(([repo, branches]) => `${repo}: ${branches.join(', ')}`).join(' · ');
}

/**
 * Die Projekte und Änderungen daran. Mit Tableiste kommen beide aus ihr, damit die Anzeige des
 * aktiven Projekts jede Änderung sofort sieht; ohne werden sie hier geladen.
 */
export function useProjects() {
  const actions = useContext(TabsContext);
  const [own, setOwn] = useState<Projects | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (actions !== null) {
      return;
    }
    listProjects().then(setOwn, (failure: unknown) => {
      setOwn({ projects: [], active: null });
      setError(messageOf(failure));
    });
  }, [actions === null]);
  const state = actions === null ? own : actions.projects;
  /** Ändert die Projekte; scheitert das, steht der Grund in `error`, und das Ergebnis ist `false`. */
  const change = async (data: ProjectChange): Promise<boolean> => {
    setError(null);
    try {
      if (actions === null) {
        setOwn(await changeProject({ data }));
      } else {
        await actions.changeProject(data);
      }
      return true;
    } catch (failure) {
      setError(messageOf(failure));
      return false;
    }
  };
  return { projects: state?.projects ?? null, active: state?.active ?? null, error, change };
}

/**
 * Eine Zeile „Als neues Projekt speichern …“, die bei einem Klick zu einem Feld für den Namen wird.
 * Das neue Projekt enthält die Tabs der Tableiste und ist danach das aktive.
 */
function NewProjectForm({ tabs, onDone }: { tabs: Tab[]; onDone: () => void }) {
  const { error, change } = useProjects();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = (event: FormEvent) => {
    event.preventDefault();
    void change({ kind: 'create', name, tabs }).then((done) => {
      if (done) {
        onDone();
      }
    });
  };
  return (
    <>
      {open ? (
        <form className="menu-form menu-project-edit" onSubmit={create}>
          <input
            className="menu-input"
            type="text"
            placeholder="Name des Projekts"
            aria-label="Name des Projekts"
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <button type="submit" className="tool tool-primary" disabled={name.trim() === ''}>
            Speichern
          </button>
        </form>
      ) : (
        <div className="menu-row">
          <MenuItem
            main="Als neues Projekt speichern …"
            icon={<PlusIcon />}
            tip="Die offenen Tabs als Projekt speichern"
            onChoose={() => {
              setOpen(true);
            }}
          />
        </div>
      )}
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </>
  );
}

/**
 * Öffnet ein Projekt ohne Tableiste, etwa nachdem alle Tabs geschlossen wurden: Der Server merkt
 * sich seine Tabs als offene, danach zeigt die Seite den ersten.
 */
async function openWithoutTabs(project: Project, onShow: (view: ViewSearch) => void) {
  const [first] = project.tabs;
  if (first === undefined) {
    return;
  }
  await changeProject({ data: { kind: 'open', name: project.name } });
  await saveTabs({ data: { tabs: project.tabs } });
  onShow({ worktree: first.worktree, branch: first.branch });
}

/**
 * Das Untermenü „Projekte“ im Menü der Repos. Ein Klick auf ein Projekt ersetzt die Tableiste durch
 * seine Tabs und macht es zum aktiven; das aktive hat einen Haken. Umbenennen und Löschen fragen in
 * der Zeile nach. Darunter lassen sich die offenen Tabs als neues Projekt speichern.
 */
export function ProjectOpenMenu({
  anchor,
  onShow,
  onDone,
}: {
  anchor: SubAnchor;
  /** Zeigt eine Ansicht, solange es keine Tableiste gibt. */
  onShow: (view: ViewSearch) => void;
  onDone: () => void;
}) {
  const actions = useContext(TabsContext);
  const { projects, active, error, change } = useProjects();
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ name: string; kind: 'rename' | 'delete'; value: string } | null>(null);
  const open = (project: Project) => {
    if (actions !== null) {
      actions.openProject(project);
      onDone();
      return;
    }
    openWithoutTabs(project, onShow).then(onDone, (reason: unknown) => {
      setFailure(messageOf(reason));
    });
  };
  const finish = (data: ProjectChange) => {
    void change(data).then((done) => {
      if (done) {
        setEditing(null);
      }
    });
  };
  const openTabs = actions?.tabs ?? [];
  return (
    <SubPanel anchor={anchor} label="Projekte">
      {projects === null && <p className="menu-note">Lädt …</p>}
      {projects?.length === 0 && <p className="menu-note">Noch kein Projekt.</p>}
      {projects?.map((project) => {
        const empty = project.tabs.length === 0;
        if (editing?.name === project.name && editing.kind === 'rename') {
          return (
            <form
              key={project.name}
              className="menu-form menu-project-edit"
              onSubmit={(event) => {
                event.preventDefault();
                finish({ kind: 'rename', name: project.name, to: editing.value });
              }}
            >
              <input
                className="menu-input"
                type="text"
                aria-label={`Neuer Name für ${project.name}`}
                value={editing.value}
                autoFocus
                onChange={(event) => {
                  setEditing({ ...editing, value: event.target.value });
                }}
              />
              <button
                type="button"
                className="tool"
                onClick={() => {
                  setEditing(null);
                }}
              >
                Abbrechen
              </button>
              <button type="submit" className="tool tool-primary" disabled={editing.value.trim() === ''}>
                Umbenennen
              </button>
            </form>
          );
        }
        if (editing?.name === project.name && editing.kind === 'delete') {
          return (
            <div key={project.name} className="menu-form menu-project-edit">
              <span className="menu-confirm-text">„{project.name}“ löschen?</span>
              <button
                type="button"
                className="tool"
                onClick={() => {
                  setEditing(null);
                }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="tool tool-danger"
                autoFocus
                onClick={() => {
                  finish({ kind: 'delete', name: project.name });
                }}
              >
                Löschen
              </button>
            </div>
          );
        }
        return (
          <div key={project.name} className="menu-row">
            <MenuItem
              main={project.name}
              sub={projectSummary(project)}
              current={project.name === active}
              disabled={empty}
              tip={empty ? undefined : 'Die Tabs des Projekts öffnen, die übrigen schließen'}
              onChoose={() => {
                open(project);
              }}
            />
            <span className="menu-actions">
              <button
                type="button"
                className="menu-action"
                aria-label={`${project.name} umbenennen`}
                data-tip="Umbenennen"
                onClick={() => {
                  setEditing({ name: project.name, kind: 'rename', value: project.name });
                }}
              >
                <PencilIcon />
              </button>
              <button
                type="button"
                className="menu-action"
                aria-label={`${project.name} löschen`}
                data-tip="Löschen"
                onClick={() => {
                  setEditing({ name: project.name, kind: 'delete', value: '' });
                }}
              >
                <TrashIcon />
              </button>
            </span>
          </div>
        );
      })}
      {openTabs.length > 0 && (
        <>
          <div className="menu-rule" />
          <NewProjectForm tabs={openTabs} onDone={onDone} />
        </>
      )}
      {error !== null && <MenuNote error>{error}</MenuNote>}
      {failure !== null && <MenuNote error>{failure}</MenuNote>}
    </SubPanel>
  );
}

/**
 * Das aktive Projekt rechts in der Tableiste, mit einem Punkt, solange die Tableiste vom
 * gespeicherten Stand abweicht. Als Abweichung zählen nur Tabs und Reihenfolge. Das Menü speichert
 * die Tableiste in das Projekt, stellt seinen Stand wieder her oder legt ein neues an.
 */
export function ProjectBadge() {
  const actions = useContext(TabsContext);
  const { error, change } = useProjects();
  const project = actions?.projects?.projects.find((candidate) => candidate.name === actions.projects?.active);
  if (actions === null || project === undefined) {
    return null;
  }
  const changed = !sameTabs(project.tabs, actions.tabs);
  return (
    <Menu
      button={
        <>
          <ProjectIcon />
          <span className="tabs-project-name">{project.name}</span>
          {changed && <span className="tabs-project-changed" aria-label="geändert" />}
        </>
      }
      label="Projekt"
      tip={changed ? `Projekt ${project.name}, mit Änderungen` : `Projekt ${project.name}`}
      className="tabs-project"
      end
    >
      {(close) => (
        <>
          <div className="menu-row">
            <MenuItem
              main={`„${project.name}“ speichern`}
              sub="Die offenen Tabs in ihrer Reihenfolge"
              disabled={!changed}
              onChoose={() => {
                void change({ kind: 'save', name: project.name, tabs: actions.tabs }).then((done) => {
                  if (done) {
                    close();
                  }
                });
              }}
            />
          </div>
          <div className="menu-row">
            <MenuItem
              main="Zurücksetzen"
              sub="Die gespeicherten Tabs wieder öffnen"
              disabled={!changed}
              onChoose={() => {
                close();
                actions.openProject(project);
              }}
            />
          </div>
          <div className="menu-rule" />
          <NewProjectForm tabs={actions.tabs} onDone={close} />
          {error !== null && <MenuNote error>{error}</MenuNote>}
        </>
      )}
    </Menu>
  );
}
