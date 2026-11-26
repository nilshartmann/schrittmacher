import { useNavigate, useRouter } from '@tanstack/react-router';
import { useContext, useEffect, useState } from 'react';
import { forgetRecent, loadRecent } from '../editor/editor.functions';
import type { RecentEntry } from '../editor/editor.functions';
import { listProjects, listViews } from '../server/repo.functions';
import type { Project, Projects, SavedView, ViewSearch } from '../server/store';
import { ClockIcon, WindowIcon } from './Icons';
import { Menu, MenuDivider, MenuItem, MenuNote, MenuSection, MenuWhere } from './Menu';
import { openWithoutTabs, projectSummary } from './Projects';
import { TabsContext } from './Tabs';
import { editSearch } from './useRequests';

/** So viele zuletzt gemerkte Ansichten zeigt das Menü. */
const SHOWN_VIEWS = 10;

/** Wie ein Fenster eine Wahl aus dem Menü öffnet; Viewer und Editor machen das verschieden. */
export interface RecentActions {
  openView: (view: ViewSearch) => void;
  openProject: (project: Project) => Promise<void>;
  openEdit: (path: string | null, root: string | null) => void;
  /** Die Datei, die der Editor gerade zeigt; sie hat im Menü einen Haken. */
  currentFile?: string | null;
}

/** Die Meldung eines Fehlers als Text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Das Menü „Zuletzt geöffnet“ in Viewer und Editor, mit demselben Inhalt in beiden: oben die
 * Projekte und gemerkten Ansichten des Viewers, darunter Workspaces und Dateien des Editors. Ein Klick
 * öffnet im selben Fenster und wechselt, wenn nötig, zwischen Viewer und Editor. Ansichten,
 * Workspaces und Dateien lassen sich auch in einem neuen Fenster öffnen.
 */
export function RecentMenu(props: RecentActions) {
  return (
    <Menu button={<ClockIcon />} label="Zuletzt geöffnet" tip="Zuletzt geöffnet" className="bar-tool" panelClassName="recent-menu">
      {(close) => <RecentList {...props} close={close} />}
    </Menu>
  );
}

/**
 * Das Menü „Zuletzt geöffnet“ im Viewer. Eine Ansicht öffnet sich in einem neuen Tab ganz links, ein
 * Projekt ersetzt die Tableiste, wie im Menü der Repos. Ohne Tableiste zeigt die Seite die Ansicht
 * direkt. Workspaces und Dateien wechseln zum Editor.
 */
export function ViewerRecentMenu() {
  const navigate = useNavigate();
  const tabs = useContext(TabsContext);
  const show = (view: ViewSearch) => {
    void navigate({ to: '/', search: view });
  };
  return (
    <RecentMenu
      openView={(view) => {
        if (tabs === null) {
          show(view);
        } else {
          void tabs.showFirst(view);
        }
      }}
      openProject={async (project) => {
        if (tabs === null) {
          await openWithoutTabs(project, show);
        } else {
          tabs.openProject(project);
        }
      }}
      openEdit={(path, root) => {
        void navigate({ to: '/edit', search: editSearch(path, root) });
      }}
    />
  );
}

/** Der Knopf am Ende einer Zeile, der ihren Eintrag in einem neuen Fenster der Web-App öffnet. */
function NewWindowButton({ name, href }: { name: string; href: string }) {
  return (
    <div className="menu-actions">
      <button
        type="button"
        className="menu-action"
        aria-label={`${name} in neuem Fenster öffnen`}
        data-tip="In neuem Fenster öffnen"
        onClick={() => {
          window.open(href);
        }}
      >
        <WindowIcon />
      </button>
    </div>
  );
}

/** Eine gemerkte Ansicht mit ihren Teilen für die URL, samt Vergleich und Datei. */
type ListedView = SavedView & { search: ViewSearch };

interface Loaded {
  projects: Projects;
  views: ListedView[];
  editor: { workspaces: RecentEntry[]; files: RecentEntry[] };
}

function RecentList({ close, openView, openProject, openEdit, currentFile }: RecentActions & { close: () => void }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    Promise.all([listProjects(), listViews(), loadRecent()]).then(
      ([projects, views, editor]) => {
        setLoaded({ projects, views: views.slice(0, SHOWN_VIEWS), editor });
      },
      (failure: unknown) => {
        setError(messageOf(failure));
      },
    );
  };
  useEffect(load, []);
  if (error !== null) {
    return <MenuNote error>{error}</MenuNote>;
  }
  if (loaded === null) {
    return <MenuNote>Lädt …</MenuNote>;
  }
  const viewHref = (view: ListedView) => router.buildLocation({ to: '/', search: view.search }).href;
  const editHref = (path: string | null, root: string | null) => router.buildLocation({ to: '/edit', search: editSearch(path, root) }).href;
  const chooseEntry = (entry: RecentEntry, kind: 'workspace' | 'file') => {
    if (!entry.exists) {
      forgetRecent({ data: { path: entry.path } }).then(load, (failure: unknown) => {
        setError(messageOf(failure));
      });
      return;
    }
    close();
    if (kind === 'workspace') {
      openEdit(null, entry.path);
    } else {
      openEdit(entry.path, entry.root);
    }
  };
  const entryRow = (entry: RecentEntry, kind: 'workspace' | 'file') => (
    <div key={entry.path} className="menu-row">
      <MenuItem
        main={<span className={entry.exists ? undefined : 'recent-missing'}>{entry.name}</span>}
        sub={entry.exists ? entry.dir : `${entry.dir}, fehlt`}
        tip={entry.exists ? entry.path : 'Gibt es nicht mehr. Ein Klick nimmt den Eintrag heraus.'}
        current={kind === 'file' && entry.path === currentFile}
        onChoose={() => {
          chooseEntry(entry, kind);
        }}
      />
      {entry.exists && (
        <NewWindowButton
          name={entry.name}
          href={kind === 'workspace' ? editHref(null, entry.path) : editHref(entry.path, entry.root)}
        />
      )}
    </div>
  );
  const { projects, active } = loaded.projects;
  return (
    <div className="menu-scroll">
      <div className="recent-group">Schrittmacher</div>
      <MenuDivider>Projekte</MenuDivider>
      <MenuSection>
        {projects.length === 0 ? (
          <MenuNote>Noch keine.</MenuNote>
        ) : (
          projects.map((project) => (
            <div key={project.name} className="menu-row">
              <MenuItem
                main={project.name}
                sub={projectSummary(project)}
                current={project.name === active}
                disabled={project.tabs.length === 0}
                onChoose={() => {
                  close();
                  openProject(project).catch((failure: unknown) => {
                    window.alert(messageOf(failure));
                  });
                }}
              />
            </div>
          ))
        )}
      </MenuSection>
      <MenuDivider>Ansichten</MenuDivider>
      <MenuSection>
        {loaded.views.length === 0 ? (
          <MenuNote>Noch keine.</MenuNote>
        ) : (
          loaded.views.map((view) => (
            <div key={`${view.worktree}\n${view.branch}`} className="menu-row">
              <MenuItem
                main={view.repo}
                sub={<MenuWhere folder={view.worktreeName === view.branch ? null : view.worktreeName} branch={view.branch || null} />}
                tip={view.worktree}
                onChoose={() => {
                  close();
                  openView(view.search);
                }}
              />
              <NewWindowButton name={view.repo} href={viewHref(view)} />
            </div>
          ))
        )}
      </MenuSection>
      <div className="recent-group">Editor</div>
      <MenuDivider>Workspaces</MenuDivider>
      <MenuSection>{loaded.editor.workspaces.map((entry) => entryRow(entry, 'workspace'))}</MenuSection>
      <MenuDivider>Dateien</MenuDivider>
      <MenuSection>
        {loaded.editor.files.length === 0 ? (
          <MenuNote>Noch keine.</MenuNote>
        ) : (
          loaded.editor.files.map((entry) => entryRow(entry, 'file'))
        )}
      </MenuSection>
    </div>
  );
}
