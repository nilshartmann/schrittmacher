import { useContext, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { changeProject, listProjects } from '../server/repo.functions';
import type { ProjectChange } from '../server/repo.functions';
import type { Project, Tab } from '../server/store';
import { SubPanel } from './HoverTools';
import type { SubAnchor } from './HoverTools';
import { CheckMarkIcon, LinkIcon, PencilIcon, PlusIcon, TrashIcon } from './Icons';
import { MenuItem, MenuNote } from './Menu';
import { sameTab, TabsContext } from './Tabs';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** Die Projekte, geladen beim Öffnen des Menüs, und Änderungen daran. */
export function useProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listProjects().then(setProjects, (failure: unknown) => {
      setProjects([]);
      setError(messageOf(failure));
    });
  }, []);
  /** Ändert die Projekte; scheitert das, steht der Grund in `error`, und das Ergebnis ist `false`. */
  const change = async (data: ProjectChange): Promise<boolean> => {
    setError(null);
    try {
      setProjects(await changeProject({ data }));
      return true;
    } catch (failure) {
      setError(messageOf(failure));
      return false;
    }
  };
  return { projects, error, change };
}

/**
 * Das Untermenü „Projekt“ im Kontextmenü eines Tabs. Ein Haken zeigt die Projekte, die den Tab
 * enthalten; ein Klick nimmt ihn auf oder entfernt ihn, und das Menü bleibt offen. „Neues Projekt …“
 * legt ein Projekt mit diesem Tab an, auf Wunsch mit allen offenen Tabs.
 */
export function ProjectToggleMenu({
  anchor,
  tab,
  tabs,
  onDone,
}: {
  anchor: SubAnchor;
  tab: Tab;
  /** Die offenen Tabs, für ein neues Projekt mit allen. */
  tabs: Tab[];
  onDone: () => void;
}) {
  const { projects, error, change } = useProjects();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [all, setAll] = useState(false);
  const create = (event: FormEvent) => {
    event.preventDefault();
    void change({ kind: 'create', name, tabs: all ? tabs : [tab] }).then((done) => {
      if (done) {
        onDone();
      }
    });
  };
  return (
    <SubPanel anchor={anchor} label="Projekt">
      {projects === null && <p className="menu-note">Lädt …</p>}
      {projects?.map((project) => {
        const contains = project.tabs.some((other) => sameTab(other, tab));
        return (
          <div key={project.name} className="menu-row">
            <MenuItem
              main={project.name}
              sub={projectSummary(project)}
              icon={contains ? <CheckMarkIcon /> : undefined}
              tip={contains ? 'Tab aus dem Projekt entfernen' : 'Tab zum Projekt hinzufügen'}
              onChoose={() => {
                void change({ kind: 'toggle', name: project.name, tab });
              }}
            />
          </div>
        );
      })}
      {projects !== null && projects.length > 0 && <div className="menu-rule" />}
      {creating ? (
        <form className="menu-project-form" onSubmit={create}>
          <div className="menu-form">
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
              Anlegen
            </button>
          </div>
          {tabs.length > 1 && (
            <label className="menu-checkbox">
              <input
                type="checkbox"
                checked={all}
                onChange={(event) => {
                  setAll(event.target.checked);
                }}
              />
              Alle offenen Tabs
            </label>
          )}
        </form>
      ) : (
        <div className="menu-row">
          <MenuItem
            main="Neues Projekt …"
            icon={<PlusIcon />}
            onChoose={() => {
              setCreating(true);
            }}
          />
        </div>
      )}
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </SubPanel>
  );
}

/**
 * Das Untermenü „Projekte“ im Menü der Repos. Ein Klick auf ein Projekt öffnet genau seine Tabs
 * und schließt die übrigen; der Knopf in der Zeile öffnet sie zusätzlich. Daneben stehen
 * Umbenennen und Löschen, beide mit einer Rückfrage in der Zeile.
 */
export function ProjectOpenMenu({ anchor, onDone }: { anchor: SubAnchor; onDone: () => void }) {
  const actions = useContext(TabsContext);
  const { projects, error, change } = useProjects();
  const [editing, setEditing] = useState<{ name: string; kind: 'rename' | 'delete'; value: string } | null>(null);
  const open = (project: Project, replace: boolean) => {
    void change({ kind: 'opened', name: project.name });
    actions?.openProject(project, replace);
    onDone();
  };
  const finish = (data: ProjectChange) => {
    void change(data).then((done) => {
      if (done) {
        setEditing(null);
      }
    });
  };
  return (
    <SubPanel anchor={anchor} label="Projekte">
      {projects === null && <p className="menu-note">Lädt …</p>}
      {projects?.length === 0 && (
        <p className="menu-note">Noch kein Projekt. Ein Tab kommt über sein Kontextmenü in ein Projekt.</p>
      )}
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
              disabled={empty}
              tip={empty ? undefined : 'Genau diese Tabs öffnen, die übrigen schließen'}
              onChoose={() => {
                open(project, true);
              }}
            />
            <span className="menu-actions">
              {!empty && (
                <button
                  type="button"
                  className="menu-action"
                  aria-label={`Tabs von ${project.name} zusätzlich öffnen`}
                  data-tip="Tabs zusätzlich öffnen"
                  onClick={() => {
                    open(project, false);
                  }}
                >
                  <LinkIcon />
                </button>
              )}
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
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </SubPanel>
  );
}
