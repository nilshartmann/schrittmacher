import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { followComparison } from '../git/repo';
import type { Comparison, RepoData } from '../git/repo';
import type { DiffFile } from '../git/types';
import { rangesOf, splitRows, unifiedRows } from '../diff/rows';
import type { Extent } from '../diff/rows';
import { compareCommits } from '../server/repo.functions';
import { CommitList, LIST_HEIGHT } from './CommitList';
import { DiffView } from './DiffView';
import { FILES_WIDTH, FileBar, FileList } from './FileList';
import { Header } from './Header';
import { Tooltips } from './Tooltips';
import { useRepoChanges } from './useRepoChanges';
import type { Layout } from './Header';

const FONT_SIZES = { min: 9, max: 24, start: 12 };

/** Die Zahl der Zeilen um jede Änderung, ohne „ganze Datei“. */
const CONTEXT = { min: 0, max: 30, start: 3, step: 3 };

const NO_GAPS: ReadonlyMap<string, ReadonlySet<number>> = new Map();
const NO_LINES: ReadonlySet<number> = new Set();

/** Die Dateien eines Vergleichs, mit dem Vergleich, zu dem sie gehören. */
interface Loaded {
  comparison: Comparison;
  files: DiffFile[];
}

export function Viewer({ repo }: { repo: RepoData }) {
  const [comparison, setComparison] = useState<Comparison>({ from: null, to: repo.start });
  const [shownRepo, setShownRepo] = useState(repo);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listHeight, setListHeight] = useState(LIST_HEIGHT.start);
  const [filesOpen, setFilesOpen] = useState(true);
  const [filesWidth, setFilesWidth] = useState(FILES_WIDTH.start);
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const [share, setShare] = useState(0.5);
  const [whole, setWhole] = useState(false);
  const [context, setContext] = useState(CONTEXT.start);
  const [fontSize, setFontSize] = useState(FONT_SIZES.start);
  const [wrap, setWrap] = useState(false);
  const [showRemoved, setShowRemoved] = useState(true);
  // Die aufgeklappten Trenner je Datei, nach ihrer ersten Zeile; sie gelten nur für einen Vergleich
  // und einen Umfang, weil sich sonst die Stellen verschieben.
  const [expanded, setExpanded] = useState<{ key: string; gaps: ReadonlyMap<string, ReadonlySet<number>> }>({
    key: '',
    gaps: new Map(),
  });

  useRepoChanges(repo.state);
  // Nach dem Neuladen bleibt der gewählte Vergleich stehen, auch wenn ein Rebase die Commits
  // umgeschrieben hat.
  if (shownRepo !== repo) {
    setShownRepo(repo);
    setComparison(followComparison(comparison, shownRepo.commits, repo.commits, repo.start));
  }

  // Bis die Dateien des neuen Vergleichs da sind, bleiben die alten stehen.
  useEffect(() => {
    let current = true;
    compareCommits({ data: comparison }).then(
      (files) => {
        if (current) {
          setLoaded({ comparison, files });
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
  }, [comparison]);

  const files = loaded?.files;
  const layout: Layout = sideBySide ? { mode: 'split', share } : { mode: 'unified', showRemoved };
  const extent: Extent = whole ? 'whole' : context;
  const expandedKey = `${loaded?.comparison.from ?? ''}-${loaded?.comparison.to ?? ''}-${String(extent)}`;
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
  const current = views.find((view) => view.file.path === chosenPath) ?? views[0];
  const shown = loaded?.comparison;

  return (
    <div className="app" style={{ '--code-size': `${String(fontSize)}px` } as CSSProperties}
    >
      <Header
        info={repo.info}
        commits={repo.commits}
        comparison={comparison}
        fontSize={fontSize}
        onFontSize={(change) => {
          setFontSize((size) => Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, size + change)));
        }}
        filesOpen={filesOpen}
        onFilesOpen={() => {
          setFilesOpen(!filesOpen);
        }}
      />
      <CommitList
        commits={repo.commits}
        refs={repo.refs}
        branch={repo.info.branch}
        comparison={comparison}
        onChoose={setComparison}
        height={listHeight}
        onHeight={setListHeight}
      />
      <main className="body">
        {filesOpen && (
          <FileList
            files={files ?? []}
            current={current?.file.path ?? ''}
            onChoose={setChosenPath}
            width={filesWidth}
            onWidth={setFilesWidth}
          />
        )}
        <section className="diff-column">
          {error !== null ? (
            <p className="empty">{error}</p>
          ) : current === undefined ? (
            <p className="empty">
              {loaded === null ? 'Lädt …' : 'Zwischen diesen Commits gibt es keinen Unterschied.'}
            </p>
          ) : (
            <>
              <FileBar
                file={current.file}
                share={share}
                onShare={(next) => {
                  setShare(next);
                  setSideBySide(true);
                }}
                sideBySide={sideBySide}
                onSideBySide={setSideBySide}
                whole={whole}
                onWhole={setWhole}
                context={context}
                onContext={(change) => {
                  setContext((lines) =>
                    Math.min(CONTEXT.max, Math.max(CONTEXT.min, lines + change * CONTEXT.step)),
                  );
                }}
                contextLimits={CONTEXT}
                wrap={wrap}
                onWrap={setWrap}
                showRemoved={showRemoved}
                onShowRemoved={setShowRemoved}
              />
              {current.file.binary ? (
                <p className="empty">Eine Binärdatei hat keine Zeilen zum Anzeigen.</p>
              ) : (
                <DiffView
                  key={`${shown?.from ?? ''}-${shown?.to ?? ''}-${current.file.path}`}
                  rows={current.rows}
                  layout={layout}
                  onShare={setShare}
                  wrap={wrap}
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
