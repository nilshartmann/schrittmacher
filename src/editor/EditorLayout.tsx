import { useNavigate } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { ChevronIcon, ClockIcon, CloseIcon, PlusIcon } from '../viewer/Icons';
import { Menu, MenuDivider, MenuItem, MenuNote, MenuSection } from '../viewer/Menu';
import { Tooltips } from '../viewer/Tooltips';
import { editSearch, useRequests } from '../viewer/useRequests';
import { closeEditorFile, forgetRecent, loadRecent, loadWorkspace, newDraft, newWorkspaceFile, touchWorkspace } from './editor.functions';
import type { Draft, EditorFile, RecentEntry, WorkspaceListing } from './editor.functions';
import { TreeFileIcon, TreeFolderIcon } from './TreeIcons';

/** Der Abstand der Fragen nach dem Inhalt des Workspace, in Millisekunden. */
const TREE_INTERVAL = 3000;

/** Die Breite des Baums in Pixeln. */
const TREE_WIDTH = 260;

/** Der Abstand der Zeilen ganz links vom Rand des Baums, in Pixeln. */
const TREE_START = 4;

/** Die Einrückung je Ebene des Baums, in Pixeln. */
const TREE_INDENT = 16;

/** Die Breite des Platzes für den Pfeil eines Ordners, in Pixeln. */
const TREE_TWISTIE = 16;

/** Unter diesem Schlüssel und der Wurzel merkt sich der Browser die aufgeklappten Ordner. */
const EXPANDED_KEY = 'schrittmacher.editor.expanded:';

/** Die Meldung eines Fehlers als Text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Ob die Seite ungespeicherte Änderungen hat. Die Editor-Seite setzt den Wert, Baum und Menü fragen
 * ihn vor dem Wechsel zu einer anderen Datei ab.
 */
export const DirtyContext = createContext<RefObject<boolean> | null>(null);

/** Die offene Datei und ihr Workspace, damit ein Klick auf dieselbe Datei nichts verwirft. */
const ShownContext = createContext<{ path: string | null; root: string | null }>({ path: null, root: null });

/**
 * Wechselt im Editor zu einer Datei, einem Workspace oder beidem. Bei ungespeicherten Änderungen
 * fragt es vorher; gesichert werden sie beim Verlassen trotzdem.
 */
export function useOpen() {
  const navigate = useNavigate();
  const dirty = useContext(DirtyContext);
  const shown = useContext(ShownContext);
  return (path: string | null, root: string | null) => {
    // Die Datei ist schon offen: nichts zu tun, und ungespeicherte Änderungen bleiben stehen.
    if (path !== null && path === shown.path && root === shown.root) {
      return;
    }
    if (dirty?.current === true && !window.confirm('Ungespeicherte Änderungen verwerfen? Gesichert sind sie trotzdem.')) {
      return;
    }
    void navigate({ to: '/edit', search: editSearch(path, root) });
  };
}

/**
 * Das × zum Schließen der offenen Datei. Sie verschwindet aus „Zuletzt geöffnet“, ein leerer Entwurf
 * wird gelöscht, und es öffnet sich die nächste Datei der Liste. Ungespeicherte Änderungen fragt es
 * vorher ab wie beim Wechsel. Ist die Liste leer, bleibt der Workspace offen.
 */
export function CloseButton({ path, root }: { path: string; root: string | null }) {
  const navigate = useNavigate();
  const dirty = useContext(DirtyContext);
  const close = () => {
    if (dirty?.current === true && !window.confirm('Ungespeicherte Änderungen verwerfen? Gesichert sind sie trotzdem.')) {
      return;
    }
    closeEditorFile({ data: { path } }).then(
      (next) => {
        if (dirty !== null) {
          dirty.current = false;
        }
        void navigate({ to: '/edit', search: next === null ? editSearch(null, root) : editSearch(next.path, next.root) });
      },
      (failure: unknown) => {
        window.alert(messageOf(failure));
      },
    );
  };
  return (
    <button type="button" className="bar-tool" aria-label="Schließen" data-tip="Datei schließen" onClick={close}>
      <CloseIcon />
    </button>
  );
}

/**
 * Der Rahmen der Seite `/edit`: links der Baum, wenn ein Workspace offen ist, rechts die Datei.
 * Er holt auch die Anforderungen des Kommandos `schrittmacher` ab.
 */
export function EditorLayout({ root, current, children }: { root: string | null; current: string | null; children: ReactNode }) {
  const navigate = useNavigate();
  useRequests(async (view) => {
    await navigate({ to: '/', search: view });
  });
  const dirty = useRef(false);
  const shown = useMemo(() => ({ path: current, root }), [current, root]);
  return (
    <DirtyContext.Provider value={dirty}>
      <ShownContext.Provider value={shown}>
        <div className="editor-layout">
          {root !== null && <WorkspaceTree key={root} root={root} current={current} />}
          {children}
        </div>
        <RecentSwitcher current={current} />
        <Tooltips />
      </ShownContext.Provider>
    </DirtyContext.Provider>
  );
}

/** Ein Ordner des Baums mit seinen Ordnern und Dateien, beide nach Namen sortiert. */
interface Folder {
  name: string;
  /** Der Pfad relativ zur Wurzel, mit `/` getrennt; leer für die Wurzel. */
  path: string;
  folders: Folder[];
  files: string[];
}

/** Sortiert Namen wie der Finder, also `2` vor `10`. */
const byName = new Intl.Collator('de', { numeric: true, sensitivity: 'base' }).compare;

/** Baut aus den Pfaden der Dateien den Baum der Ordner. */
function treeOf(files: string[]): Folder {
  const top: Folder = { name: '', path: '', folders: [], files: [] };
  for (const file of files) {
    const parts = file.split('/');
    let folder = top;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path === '' ? part : `${folder.path}/${part}`;
      let next = folder.folders.find((candidate) => candidate.name === part);
      if (next === undefined) {
        next = { name: part, path, folders: [], files: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  const sort = (folder: Folder) => {
    folder.folders.sort((a, b) => byName(a.name, b.name));
    folder.files.sort((a, b) => byName(a, b));
    folder.folders.forEach(sort);
  };
  sort(top);
  return top;
}

function storedExpanded(root: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPANDED_KEY + root) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []);
  } catch {
    return new Set();
  }
}

function storeExpanded(root: string, expanded: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_KEY + root, JSON.stringify([...expanded]));
  } catch {
    // Ohne Speicher im Browser gilt die Auswahl bis zum Schließen.
  }
}

/** Die Ordner über einer Datei relativ zur Wurzel, etwa `a` und `a/b` für `a/b/c.md`. */
function foldersAbove(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, at) => parts.slice(0, at + 1).join('/'));
}

/** Der Pfad einer Datei relativ zur Wurzel; `null`, wenn sie nicht darin liegt. */
function relativeTo(root: string, path: string | null): string | null {
  return path !== null && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

/** Ein Zeitpunkt wie `16.11., 14:32`. */
function dateOf(millis: number): string {
  return new Date(millis).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Der Baum eines Workspace links neben der Datei. Er zeigt alle Dateien außer denen, die Git
 * ignoriert, im Workspace „Entwürfe“ stattdessen die Entwürfe mit ihrer ersten Zeile. Das Plus legt
 * eine neue Datei an, bei den Entwürfen einen neuen Entwurf.
 */
function WorkspaceTree({ root, current }: { root: string; current: string | null }) {
  const open = useOpen();
  const [listing, setListing] = useState<WorkspaceListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(() => storedExpanded(root));
  const [creating, setCreating] = useState<string | null>(null);
  const currentRelative = relativeTo(root, current);

  const refresh = () => {
    loadWorkspace({ data: { root } }).then(
      (next) => {
        setListing(next);
        setError(null);
      },
      (failure: unknown) => {
        setError(messageOf(failure));
      },
    );
  };
  useEffect(() => {
    touchWorkspace({ data: { root } }).catch(() => undefined);
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    }, TREE_INTERVAL);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [root]);
  // Nach dem Wechsel der Datei neu laden, etwa weil ein leerer Entwurf beim Schließen verschwunden ist.
  useEffect(refresh, [current]);
  // Die Ordner über der offenen Datei klappen auf, damit sie im Baum zu sehen ist.
  useEffect(() => {
    if (currentRelative === null) {
      return;
    }
    const missing = foldersAbove(currentRelative).filter((folder) => !expanded.has(folder));
    if (missing.length > 0) {
      const next = new Set([...expanded, ...missing]);
      setExpanded(next);
      storeExpanded(root, next);
    }
  }, [currentRelative]);
  const toggle = (folder: string) => {
    const next = new Set(expanded);
    if (!next.delete(folder)) {
      next.add(folder);
    }
    setExpanded(next);
    storeExpanded(root, next);
  };
  const tree = useMemo(() => (listing === null ? null : treeOf(listing.files)), [listing]);
  const drafts = listing?.drafts ?? null;

  const create = () => {
    if (drafts !== null) {
      newDraft().then(
        (draft) => {
          refresh();
          open(draft.path, draft.root);
        },
        (failure: unknown) => {
          setError(messageOf(failure));
        },
      );
      return;
    }
    const folder = currentRelative === null ? '' : currentRelative.slice(0, currentRelative.lastIndexOf('/') + 1);
    setCreating(folder);
  };

  return (
    <nav className="editor-tree" style={{ width: `${String(TREE_WIDTH)}px` }} aria-label="Workspace">
      <div className="editor-tree-head">
        <span className="editor-tree-name" data-tip={root}>
          {listing?.name ?? root.slice(root.lastIndexOf('/') + 1)}
        </span>
        <button
          type="button"
          className="bar-tool"
          aria-label={drafts !== null ? 'Neuer Entwurf' : 'Neue Datei'}
          data-tip={drafts !== null ? 'Neuer Entwurf' : 'Neue Datei, auch mit Ordnern wie kapitel/neu.md'}
          onClick={create}
        >
          <PlusIcon />
        </button>
      </div>
      {creating !== null && (
        <NewFileField
          initial={creating}
          onCancel={() => {
            setCreating(null);
          }}
          onCreate={async (path) => {
            const created = await newWorkspaceFile({ data: { root, path } });
            setCreating(null);
            refresh();
            open(created, root);
          }}
        />
      )}
      <div className="editor-tree-scroll">
        {error !== null && <p className="editor-tree-error">{error}</p>}
        {drafts !== null && <DraftList drafts={drafts} root={root} current={currentRelative} />}
        {tree !== null && drafts === null && (
          <FolderRows folder={tree} depth={0} root={root} current={currentRelative} expanded={expanded} onToggle={toggle} />
        )}
        {listing?.truncated === true && <p className="editor-tree-note">Zu viele Dateien, der Baum ist unvollständig.</p>}
        {drafts !== null && drafts.length === 0 && <p className="editor-tree-note">Noch keine Entwürfe.</p>}
      </div>
    </nav>
  );
}

/** Die Zeilen eines Ordners im Baum: erst die Ordner, aufklappbar, dann die Dateien. */
function FolderRows({
  folder,
  depth,
  root,
  current,
  expanded,
  onToggle,
}: {
  folder: Folder;
  depth: number;
  root: string;
  current: string | null;
  expanded: Set<string>;
  onToggle: (folder: string) => void;
}) {
  const open = useOpen();
  const indent = { paddingLeft: `${String(TREE_START + depth * TREE_INDENT)}px` };
  return (
    <>
      {folder.folders.map((child) => {
        const isOpen = expanded.has(child.path);
        return (
          <div key={child.path}>
            <button
              type="button"
              className="editor-tree-row editor-tree-folder"
              style={indent}
              aria-expanded={isOpen}
              data-tip={child.path}
              onClick={() => {
                onToggle(child.path);
              }}
            >
              <span className="editor-tree-twistie">
                <ChevronIcon open={isOpen} size={12} />
              </span>
              <TreeFolderIcon />
              <span className="editor-tree-label">{child.name}</span>
            </button>
            {isOpen && (
              // Die Linie am Rand der Kinder steht unter dem Pfeil des Ordners.
              <div
                className="editor-tree-children"
                style={{ ['--guide' as string]: `${String(TREE_START + depth * TREE_INDENT + TREE_TWISTIE / 2)}px` }}
              >
                <FolderRows
                  folder={child}
                  depth={depth + 1}
                  root={root}
                  current={current}
                  expanded={expanded}
                  onToggle={onToggle}
                />
              </div>
            )}
          </div>
        );
      })}
      {folder.files.map((file) => {
        const name = file.slice(file.lastIndexOf('/') + 1);
        return (
          <button
            key={file}
            type="button"
            className="editor-tree-row editor-tree-file"
            style={indent}
            aria-current={file === current ? 'true' : undefined}
            data-tip={file}
            onClick={() => {
              open(`${root}/${file}`, root);
            }}
          >
            <span className="editor-tree-twistie" />
            <TreeFileIcon name={name} />
            <span className="editor-tree-label">{name}</span>
          </button>
        );
      })}
    </>
  );
}

/** Die Entwürfe als Liste, der zuletzt geänderte oben, mit erster Zeile und Datum. */
function DraftList({ drafts, root, current }: { drafts: Draft[]; root: string; current: string | null }) {
  const open = useOpen();
  return (
    <>
      {drafts.map((draft) => (
        <button
          key={draft.path}
          type="button"
          className="editor-tree-row editor-tree-draft"
          aria-current={draft.path === current ? 'true' : undefined}
          data-tip={draft.path}
          onClick={() => {
            open(`${root}/${draft.path}`, root);
          }}
        >
          <span className={draft.title === '' ? 'editor-tree-label editor-tree-empty' : 'editor-tree-label'}>
            {draft.title === '' ? 'Leer' : draft.title}
          </span>
          <span className="editor-tree-sub">{dateOf(draft.changed)}</span>
        </button>
      ))}
    </>
  );
}

/** Das Feld für den Pfad einer neuen Datei relativ zur Wurzel. Enter legt sie an, Escape bricht ab. */
function NewFileField({
  initial,
  onCreate,
  onCancel,
}: {
  initial: string;
  onCreate: (path: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="editor-tree-new"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(value).catch((failure: unknown) => {
          setError(messageOf(failure));
        });
      }}
    >
      <input
        // Das Feld bekommt beim Erscheinen den Fokus, damit sich gleich der Name tippen lässt.
        autoFocus
        className="editor-tree-input"
        value={value}
        placeholder="kapitel/neu.md"
        aria-label="Pfad der neuen Datei"
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onCancel();
          }
        }}
        onBlur={() => {
          if (value === initial) {
            onCancel();
          }
        }}
      />
      {error !== null && <p className="editor-tree-error">{error}</p>}
    </form>
  );
}

/**
 * Das Menü „Zuletzt geöffnet“ in der Kopfzeile: oben „Entwürfe“ und die Workspaces, darunter die
 * Dateien. Ein Eintrag, den es nicht mehr gibt, steht ausgegraut darin; ein Klick nimmt ihn heraus.
 */
export function RecentMenu() {
  return (
    <Menu button={<ClockIcon />} label="Zuletzt geöffnet" tip="Zuletzt geöffnet" className="bar-tool" panelClassName="editor-recent">
      {(close) => <RecentList close={close} />}
    </Menu>
  );
}

function RecentList({ close }: { close: () => void }) {
  const open = useOpen();
  const [recent, setRecent] = useState<{ workspaces: RecentEntry[]; files: RecentEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    loadRecent().then(setRecent, (failure: unknown) => {
      setError(messageOf(failure));
    });
  };
  useEffect(load, []);
  const choose = (entry: RecentEntry, kind: 'workspace' | 'file') => {
    if (!entry.exists) {
      forgetRecent({ data: { path: entry.path } }).then(load, (failure: unknown) => {
        setError(messageOf(failure));
      });
      return;
    }
    close();
    if (kind === 'workspace') {
      open(null, entry.path);
    } else {
      open(entry.path, entry.root);
    }
  };
  if (error !== null) {
    return <MenuNote error>{error}</MenuNote>;
  }
  if (recent === null) {
    return <MenuNote>Lädt …</MenuNote>;
  }
  const row = (entry: RecentEntry, kind: 'workspace' | 'file') => (
    <MenuItem
      key={entry.path}
      main={<span className={entry.exists ? undefined : 'editor-recent-missing'}>{entry.name}</span>}
      sub={entry.exists ? entry.dir : `${entry.dir}, fehlt`}
      tip={entry.exists ? entry.path : 'Gibt es nicht mehr. Ein Klick nimmt den Eintrag heraus.'}
      onChoose={() => {
        choose(entry, kind);
      }}
    />
  );
  return (
    <div className="menu-scroll">
      <MenuDivider>Workspaces</MenuDivider>
      <MenuSection>{recent.workspaces.map((entry) => row(entry, 'workspace'))}</MenuSection>
      <MenuDivider>Dateien</MenuDivider>
      <MenuSection>
        {recent.files.length === 0 ? <MenuNote>Noch keine.</MenuNote> : recent.files.map((entry) => row(entry, 'file'))}
      </MenuSection>
    </div>
  );
}

/** Die Kopfzeile einer Seite ohne Editor: das Menü „Zuletzt geöffnet“ und ein Titel. */
function PaneHeader({ title, sub, close }: { title: string; sub?: string; close?: { path: string; root: string | null } }) {
  return (
    <header className="header">
      <div className="header-start">
        <RecentMenu />
        <span className="editor-title">
          <span className="editor-name">{title}</span>
          {sub !== undefined && <span className="md-dir">{sub}</span>}
        </span>
      </div>
      {close !== undefined && (
        <div className="header-tools">
          <CloseButton path={close.path} root={close.root} />
        </div>
      )}
    </header>
  );
}

/** Die rechte Seite, solange im Workspace keine Datei offen ist, oder mit einer Meldung. */
export function EmptyPane({ message }: { message: string }) {
  return (
    <div className="app">
      <PaneHeader title="Editor" />
      <p className="empty">{message}</p>
    </div>
  );
}

/** Eine Datei, die sich nicht als Text bearbeiten lässt: ein Bild als Ansicht, sonst eine Meldung. */
export function FilePane({ file, root }: { file: EditorFile; root: string | null }) {
  return (
    <div className="app">
      <PaneHeader title={file.name} sub={file.dir} close={{ path: file.path, root }} />
      {file.kind === 'image' ? (
        <div className="editor-image">
          <img src={`/api/image?${new URLSearchParams({ path: file.path }).toString()}`} alt={file.name} />
        </div>
      ) : (
        <p className="empty">
          {file.kind === 'large' ? 'Die Datei ist zu groß für den Editor.' : 'Die Datei ist kein Text und lässt sich nicht öffnen.'}
        </p>
      )}
    </div>
  );
}

/**
 * Der Wechsel zu zuletzt geöffneten Dateien mit ⌘E, wie ⌘Tab zwischen Programmen: Jedes E bei
 * gedrückter ⌘-Taste geht eine Datei weiter zurück, ⇧E wieder vor. Beim Loslassen von ⌘ öffnet sich
 * die gewählte Datei, Escape bricht ab. Solange ⌘ gedrückt ist, zeigt eine Liste die Wahl.
 */
function RecentSwitcher({ current }: { current: string | null }) {
  const open = useOpen();
  // Die Liste wird bei jedem Wechsel der Datei vorab geladen, damit ⌘E sofort wirkt.
  const files = useRef<RecentEntry[]>([]);
  useEffect(() => {
    loadRecent().then(
      (recent) => {
        files.current = recent.files.filter((entry) => entry.exists && entry.path !== current);
      },
      () => {
        // Ohne Liste bleibt ⌘E ohne Wirkung, bis die nächste Datei sie lädt.
      },
    );
  }, [current]);
  const [choice, setChoice] = useState<{ list: RecentEntry[]; at: number } | null>(null);
  const latest = useRef(choice);
  latest.current = choice;
  const finish = useRef(open);
  finish.current = open;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e' || !event.metaKey || event.altKey || event.ctrlKey) {
        if (event.key === 'Escape' && latest.current !== null) {
          event.preventDefault();
          setChoice(null);
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? -1 : 1;
      const now = latest.current;
      if (now === null) {
        const list = files.current;
        if (list.length > 0) {
          setChoice({ list, at: event.shiftKey ? list.length - 1 : 0 });
        }
        return;
      }
      setChoice({ list: now.list, at: (now.at + step + now.list.length) % now.list.length });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const now = latest.current;
      if (event.key !== 'Meta' || now === null) {
        return;
      }
      setChoice(null);
      const entry = now.list[now.at];
      if (entry !== undefined) {
        finish.current(entry.path, entry.root);
      }
    };
    const onBlur = () => {
      setChoice(null);
    };
    // In der Phase davor, damit der Editor ⌘E nicht vorher bekommt.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  if (choice === null) {
    return null;
  }
  return (
    <div className="editor-switcher" role="listbox" aria-label="Zuletzt geöffnete Dateien">
      <p className="editor-switcher-head">Zuletzt geöffnet, ⌘ loslassen öffnet</p>
      {choice.list.map((entry, at) => (
        <button
          key={entry.path}
          type="button"
          role="option"
          className="editor-switcher-row"
          aria-selected={at === choice.at}
          onMouseDown={(event) => {
            event.preventDefault();
            setChoice(null);
            open(entry.path, entry.root);
          }}
        >
          <span className="editor-switcher-name">{entry.name}</span>
          <span className="editor-switcher-dir">{entry.dir}</span>
        </button>
      ))}
    </div>
  );
}
