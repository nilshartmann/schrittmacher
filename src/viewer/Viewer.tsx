import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import { graphOf } from '../git/graph';
import { commitKey, findCommit, followComparison, LOCAL, reachable, showsCheckedOut } from '../git/repo';
import type { Comparison, RepoData } from '../git/repo';
import type { Commit, DiffFile, Worktree } from '../git/types';
import { rangesOf, splitRows, unifiedRows } from '../diff/rows';
import type { Extent } from '../diff/rows';
import { isHidden } from '../git/hidden';
import { compareCommits, pushBranch } from '../server/repo.functions';
import type { Tab, ViewSearch } from '../server/store';
import { CommitList } from './CommitList';
import { CommitPanel, EMPTY_DRAFT, PushNote } from './CommitPanel';
import { ComparisonBar } from './ComparisonBar';
import type { Draft, PushState } from './CommitPanel';
import { DiffView } from './DiffView';
import { FileBar, FileList } from './FileList';
import { Header } from './Header';
import { CONTEXT, FONT_SIZES, useSettings } from './settings';
import { Tooltips } from './Tooltips';
import { useHidden } from './useHidden';
import { useRepoChanges } from './useRepoChanges';
import type { Layout } from './Header';
import { WhereMenus } from './ViewMenus';
import type { OpenView } from './ViewMenus';

const NO_GAPS: ReadonlyMap<string, ReadonlySet<number>> = new Map();

/** So lange bleibt die Meldung eines gelungenen Pushs stehen, in Millisekunden. */
const PUSHED_FOR = 3000;
const NO_LINES: ReadonlySet<number> = new Set();

/** Die Dateien eines Vergleichs, mit dem Vergleich, zu dem sie gehören. */
interface Loaded {
  key: string;
  comparison: Comparison;
  files: DiffFile[];
}

/** Was der Server für eine Ansicht liefert. */
export interface LoadedView {
  repo: RepoData;
  worktrees: Worktree[];
  settings: Record<string, unknown>;
  /** Die ausgeblendeten Branches des Repos, siehe `Hidden`. */
  hidden: string[];
  /** Die gemerkten Tabs; sie gelten nur beim Öffnen der Seite. */
  tabs: Tab[];
}

/**
 * Der Vergleich aus den Kennungen der URL; ohne `to` oder mit einer unbekannten gilt `start`. Eine
 * Nummer findet zuerst die Commits des Branches (`line`). Die lokalen Änderungen gelten nur, wenn
 * es welche gibt (`changes`).
 */
function comparisonOf(
  commits: Commit[],
  line: ReadonlySet<string>,
  search: ViewSearch,
  start: string,
  changes: boolean,
): Comparison {
  if (search.to === LOCAL) {
    return { from: null, to: changes ? LOCAL : start };
  }
  const to = search.to === undefined ? undefined : findCommit(commits, search.to, line);
  if (to === undefined) {
    return { from: null, to: start };
  }
  const from = search.from === undefined ? undefined : findCommit(commits, search.from, line);
  return { from: from === undefined || from.sha === to.sha ? null : from.sha, to: to.sha };
}

/** Die Kennungen eines Vergleichs für die URL. */
function keysOf(
  commits: Commit[],
  line: ReadonlySet<string>,
  comparison: Comparison,
): Pick<ViewSearch, 'to' | 'from'> {
  const key = (sha: string | null) => {
    if (sha === LOCAL) {
      return LOCAL;
    }
    const commit = sha === null ? undefined : commits.find((candidate) => candidate.sha === sha);
    return commit === undefined ? undefined : commitKey(commit, commits, line);
  };
  return { to: key(comparison.to), from: key(comparison.from) };
}

interface ViewerProps {
  view: LoadedView;
  /** Die Ansicht aus der URL, mit Worktree und Branch. */
  search: ViewSearch;
  /** Ändert Vergleich oder Datei in der URL; `replace` ersetzt den Eintrag im Verlauf. */
  onSearch: (change: Pick<ViewSearch, 'to' | 'from' | 'file'>, replace?: boolean) => void;
  onOpen: OpenView;
  onShow: (view: ViewSearch) => void;
  /** Die Tableiste über der Kopfzeile; der Tab bestimmt, was darunter steht. */
  tabs: ReactNode;
}

export function Viewer({ view, search, onSearch, onOpen, onShow, tabs }: ViewerProps) {
  const { repo } = view;
  const router = useRouter();
  const [settings, set, saveNow] = useSettings(view.settings);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Eingabe und Push je Worktree, damit sie einen Wechsel zum Tab mit den Schritten überstehen.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Draft>>(new Map());
  const [pushes, setPushes] = useState<ReadonlyMap<string, PushState>>(new Map());
  // Die aufgeklappten Trenner je Datei, nach ihrer ersten Zeile; sie gelten nur für einen Vergleich
  // und einen Umfang, weil sich sonst die Stellen verschieben.
  const [expanded, setExpanded] = useState<{ key: string; gaps: ReadonlyMap<string, ReadonlySet<number>> }>({
    key: '',
    gaps: new Map(),
  });

  const line = useMemo(() => reachable(repo.commits, repo.start), [repo.commits, repo.start]);
  const graph = useMemo(
    () => (repo.all ? graphOf([...repo.commits].reverse(), repo.start) : null),
    [repo.commits, repo.all, repo.start],
  );
  const comparison = comparisonOf(repo.commits, line, search, repo.start, repo.changes);
  const worktree = repo.info.worktreePath;
  const comparisonKey = `${worktree}\n${comparison.from ?? ''}\n${comparison.to}`;
  // Die lokalen Änderungen werden mit jedem neuen Stand neu geladen, ihr Diff bleibt aber derselbe
  // und behält seine Stelle beim Scrollen.
  const fetchKey = comparison.to === LOCAL ? `${comparisonKey}\n${repo.state}` : comparisonKey;
  const [hidden, toggleHidden] = useHidden(repo.info.repoPath, worktree, view.hidden, () => {
    if (repo.all) {
      void router.invalidate();
    }
  });
  // Der Branch der Liste behält seinen Badge, auch wenn er ausgeblendet ist.
  const shownRefs = useMemo(
    () => repo.refs.filter((ref) => ref.name === repo.info.branch || !isHidden(hidden, ref)),
    [repo.refs, repo.info.branch, hidden],
  );
  const draft = drafts.get(worktree) ?? EMPTY_DRAFT;
  const setDraft = (next: Draft) => {
    setDrafts((current) => new Map(current).set(worktree, next));
  };
  const branch = repo.info.branch ?? '';
  const pushState = pushes.get(worktree);
  const setPush = (target: string, next: PushState | null) => {
    setPushes((current) => {
      const changed = new Map(current);
      if (next === null) {
        changed.delete(target);
      } else {
        changed.set(target, next);
      }
      return changed;
    });
  };
  const push = (force: boolean) => {
    const target = worktree;
    setPush(target, { kind: 'running' });
    pushBranch({ data: { worktree: target, branch, force } }).then(
      () => {
        setPush(target, { kind: 'done' });
        setTimeout(() => {
          setPushes((current) => {
            if (current.get(target)?.kind !== 'done') {
              return current;
            }
            const changed = new Map(current);
            changed.delete(target);
            return changed;
          });
        }, PUSHED_FOR);
        void router.invalidate();
      },
      (failure: unknown) => {
        setPush(target, { kind: 'failed', message: failure instanceof Error ? failure.message : String(failure), force });
      },
    );
  };
  const choose = (next: Comparison) => {
    onSearch({ ...keysOf(repo.commits, line, next), file: search.file });
  };

  useRepoChanges(worktree, repo.state, showsCheckedOut(repo.info));
  // Nach dem Neuladen bleibt der gewählte Vergleich stehen. Eine Nummer findet ihren Commit auch
  // nach einem Rebase; für einen Commit ohne Nummer sucht `followComparison` nach dem Titel.
  const shown = useRef({ commits: repo.commits, line });
  useEffect(() => {
    const before = shown.current;
    shown.current = { commits: repo.commits, line };
    // Ohne lokale Änderungen, etwa nach einem Commit, gilt wieder der neueste Commit.
    if (search.to === LOCAL) {
      if (!repo.changes) {
        onSearch({ ...keysOf(repo.commits, line, { from: null, to: repo.start }), file: search.file }, true);
      }
      return;
    }
    if (
      before.commits === repo.commits ||
      search.to === undefined ||
      findCommit(repo.commits, search.to, line) !== undefined
    ) {
      return;
    }
    const old = comparisonOf(before.commits, before.line, search, repo.start, repo.changes);
    const followed = followComparison(old, before.commits, repo.commits, repo.start);
    onSearch({ ...keysOf(repo.commits, line, followed), file: search.file }, true);
  }, [repo.commits, repo.changes]);

  // Bis die Dateien des neuen Vergleichs da sind, bleiben die alten stehen.
  useEffect(() => {
    let current = true;
    const wanted = comparison;
    compareCommits({ data: { worktree, comparison: wanted } }).then(
      (files) => {
        if (current) {
          setLoaded({ key: comparisonKey, comparison: wanted, files });
          setError(null);
        }
      },
      (failure: unknown) => {
        if (current) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [fetchKey]);

  const files = loaded?.files;
  const { sideBySide, share, showRemoved } = settings;
  const layout: Layout = sideBySide ? { mode: 'split', share } : { mode: 'unified', showRemoved };
  const extent: Extent = settings.whole ? 'whole' : settings.context;
  const expandedKey = `${loaded?.key ?? ''}\n${String(extent)}`;
  const gaps = expanded.key === expandedKey ? expanded.gaps : NO_GAPS;
  const toggleGap = (path: string, start: number) => {
    const next = new Map(gaps);
    const open = new Set(next.get(path));
    if (open.has(start)) {
      open.delete(start);
    } else {
      open.add(start);
    }
    next.set(path, open);
    setExpanded({ key: expandedKey, gaps: next });
  };
  const views = useMemo(
    () =>
      (files ?? []).map((file) => {
        const ranges = rangesOf(file);
        const open = gaps.get(file.path) ?? NO_LINES;
        return {
          file,
          rows:
            layout.mode === 'unified'
              ? unifiedRows(file, ranges, extent, open, layout.showRemoved)
              : splitRows(file, ranges, extent, open),
        };
      }),
    // `layout` entsteht bei jedem Rendern neu, deshalb zählen seine Teile.
    [files, sideBySide, share, extent, showRemoved, gaps],
  );
  const current = views.find((candidate) => candidate.file.path === search.file) ?? views[0];

  return (
    <div className="app" style={{ '--code-size': `${String(settings.fontSize)}px` } as CSSProperties}>
      {tabs}
      <Header
        info={repo.info}
        where={
          <WhereMenus
            info={repo.info}
            worktrees={view.worktrees}
            refs={repo.refs}
            hidden={hidden}
            onToggleHidden={toggleHidden}
            onOpen={onOpen}
            onShow={onShow}
          />
        }
        allBranches={settings.allBranches}
        onAllBranches={() => {
          void saveNow({ allBranches: !settings.allBranches }).then(() => router.invalidate());
        }}
        fontSize={settings.fontSize}
        onFontSize={(change) => {
          set({ fontSize: Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, settings.fontSize + change)) });
        }}
        filesOpen={settings.filesOpen}
        onFilesOpen={() => {
          set({ filesOpen: !settings.filesOpen });
        }}
        timerEnd={settings.timerEnd}
        onTimerEnd={(timerEnd) => {
          set({ timerEnd });
        }}
      />
      <CommitList
        commits={repo.commits}
        changes={repo.changes}
        refs={shownRefs}
        graph={graph}
        line={line}
        branch={repo.info.branch}
        onBranch={(branch) => {
          void onOpen({ worktree, branch });
        }}
        comparison={comparison}
        onChoose={choose}
        height={settings.listHeight}
        onHeight={(listHeight) => {
          set({ listHeight });
        }}
      />
      <ComparisonBar commits={repo.commits} comparison={comparison} />
      <main className="body">
        {settings.filesOpen && (
          <FileList
            files={files ?? []}
            current={current?.file.path ?? ''}
            onChoose={(file) => {
              onSearch({ to: search.to, from: search.from, file });
            }}
            width={settings.filesWidth}
            onWidth={(filesWidth) => {
              set({ filesWidth });
            }}
            selection={
              comparison.to === LOCAL
                ? {
                    unchecked: draft.unchecked,
                    onChange: (unchecked) => {
                      setDraft({ ...draft, unchecked });
                    },
                  }
                : undefined
            }
            footer={
              <>
                {comparison.to === LOCAL && loaded?.comparison.to === LOCAL && (
                  <CommitPanel
                    worktree={worktree}
                    branch={branch}
                    files={loaded.files}
                    draft={draft}
                    onDraft={setDraft}
                    onCommitted={(sha, force) => {
                      // Der neue Commit ist gewählt, auch wenn noch lokale Änderungen übrig sind.
                      void router.invalidate().then(() => {
                        onSearch({ to: sha.slice(0, 7) });
                      });
                      push(force);
                    }}
                  />
                )}
                {pushState !== undefined && (
                  <PushNote
                    push={pushState}
                    onRetry={() => {
                      push(pushState.kind === 'failed' && pushState.force);
                    }}
                  />
                )}
              </>
            }
          />
        )}
        <section className="diff-column">
          {error !== null ? (
            <p className="empty">{error}</p>
          ) : current === undefined ? (
            <p className="empty">
              {loaded === null
                ? 'Lädt …'
                : comparison.to === LOCAL
                  ? 'Es gibt keine lokalen Änderungen.'
                  : 'Zwischen diesen Commits gibt es keinen Unterschied.'}
            </p>
          ) : (
            <>
              <FileBar
                file={current.file}
                share={share}
                onShare={(next) => {
                  set({ share: next, sideBySide: true });
                }}
                sideBySide={sideBySide}
                onSideBySide={(next) => {
                  set({ sideBySide: next });
                }}
                whole={settings.whole}
                onWhole={(whole) => {
                  set({ whole });
                }}
                context={settings.context}
                onContext={(change) => {
                  set({
                    context: Math.min(CONTEXT.max, Math.max(CONTEXT.min, settings.context + change * CONTEXT.step)),
                  });
                }}
                contextLimits={CONTEXT}
                wrap={settings.wrap}
                onWrap={(wrap) => {
                  set({ wrap });
                }}
                showRemoved={showRemoved}
                onShowRemoved={(next) => {
                  set({ showRemoved: next });
                }}
              />
              {current.file.binary ? (
                <p className="empty">Eine Binärdatei hat keine Zeilen zum Anzeigen.</p>
              ) : (
                <DiffView
                  key={`${loaded?.key ?? ''}\n${current.file.path}`}
                  rows={current.rows}
                  layout={layout}
                  onShare={(next) => {
                    set({ share: next });
                  }}
                  wrap={settings.wrap}
                  onToggleGap={(start) => {
                    toggleGap(current.file.path, start);
                  }}
                />
              )}
            </>
          )}
        </section>
      </main>
      <Tooltips />
    </div>
  );
}
