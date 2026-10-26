import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { LOCAL } from '../git/repo';
import type { Comparison } from '../git/repo';
import type { ChangeStats, Commit, CommitDetails, DiffFile, RangeCommit, Ref } from '../git/types';
import { commitDetails, commitsBetween } from '../server/repo.functions';
import { ComparedCommit } from './ComparisonBar';
import { BranchIcon } from './Icons';

/** So viele Zeilen der Nachricht zeigt der Bereich, bis sie aufgeklappt wird. */
const BODY_LINES = 4;

/** Die Angaben je Worktree und SHA; ein Commit ändert sich nie, deshalb gelten sie für immer. */
const detailsCache = new Map<string, Promise<CommitDetails>>();

function detailsOf(worktree: string, sha: string): Promise<CommitDetails> {
  const key = `${worktree}\n${sha}`;
  const cached = detailsCache.get(key) ?? commitDetails({ data: { worktree, sha } });
  detailsCache.set(key, cached);
  cached.catch(() => detailsCache.delete(key));
  return cached;
}

/**
 * Was der Server zu `key` liefert. Bis die Antwort zu einem neuen Schlüssel da ist, bleibt die alte
 * stehen, damit der Bereich beim Wechsel des Commits nicht springt.
 */
function useLoaded<T>(key: string, load: () => Promise<T>): { value: T | null; error: string | null } {
  const [state, setState] = useState<{ value: T | null; error: string | null }>({ value: null, error: null });
  useEffect(() => {
    let current = true;
    load().then(
      (value) => {
        if (current) {
          setState({ value, error: null });
        }
      },
      (failure: unknown) => {
        if (current) {
          setState({ value: null, error: failure instanceof Error ? failure.message : String(failure) });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [key]);
  return state;
}

/** Wie viele Dateien und Zeilen die Dateien eines Vergleichs ändern. */
function statsOf(files: DiffFile[]): ChangeStats {
  return {
    files: files.length,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

interface CommitInfoProps {
  worktree: string;
  commits: Commit[];
  /** Alle Branches; der Bereich nennt die, die auf den gewählten Commit zeigen. */
  refs: Ref[];
  /** Der Branch, der im Worktree ausgecheckt ist; er bekommt die lokalen Änderungen. */
  checkedOut: string | null;
  comparison: Comparison;
  /** Die Dateien des Vergleichs; `null`, solange sie für diesen Vergleich nicht geladen sind. */
  files: DiffFile[] | null;
  onChoose: (comparison: Comparison) => void;
}

/**
 * Der Bereich zwischen Commit-Liste und Dateien mit den Angaben zum gewählten Commit. Links stehen
 * Personen, SHA, Vorgänger, Branches und Statistik, rechts die ganze Nachricht. Beim Vergleich
 * zweier Commits stehen die beiden wie in der `ComparisonBar` oben und darunter die Commits
 * dazwischen. Ein Klick auf einen Vorgänger oder einen Commit dazwischen wählt ihn allein.
 */
export function CommitInfo(props: CommitInfoProps) {
  const { comparison } = props;
  const stats = props.files === null ? null : statsOf(props.files);
  return (
    <section className="info" aria-label="Angaben zum Commit">
      {comparison.to === LOCAL ? (
        <dl className="info-facts">
          <dt>Branch</dt>
          <dd>{props.checkedOut ?? 'ohne Branch'}</dd>
          <dt>Änderungen</dt>
          <dd>
            <Stats stats={stats} /> <span className="info-quiet">noch nicht committet</span>
          </dd>
        </dl>
      ) : comparison.from === null ? (
        <SingleInfo {...props} sha={comparison.to} stats={stats} />
      ) : (
        <RangeInfo {...props} from={comparison.from} to={comparison.to} stats={stats} />
      )}
    </section>
  );
}

function SingleInfo({
  worktree,
  commits,
  refs,
  sha,
  stats,
  onChoose,
}: CommitInfoProps & { sha: string; stats: ChangeStats | null }) {
  const { value: details, error } = useLoaded(`${worktree}\n${sha}`, () => detailsOf(worktree, sha));
  if (error !== null) {
    return <p className="info-quiet">{error}</p>;
  }
  // Bis die Angaben zum neuen Commit da sind, steht der alte da, mit allem, was dazugehört.
  const commit = commits.find((candidate) => candidate.sha === details?.sha);
  if (details === null || commit === undefined) {
    return null;
  }
  const { author, committer } = details;
  const sameCommitter =
    author.name === committer.name && author.email === committer.email && author.date === committer.date;
  const pointing = refs.filter((ref) => ref.sha === commit.sha);
  return (
    <div className="info-single">
      <dl className="info-facts">
        <dt>Autor</dt>
        <dd>
          {author.name} <span className="info-quiet">&lt;{author.email}&gt;</span>
          <span className="info-date">{author.date}</span>
        </dd>
        {!sameCommitter && (
          <>
            <dt>Committer</dt>
            <dd>
              {committer.name} <span className="info-quiet">&lt;{committer.email}&gt;</span>
              <span className="info-date">{committer.date}</span>
            </dd>
          </>
        )}
        <dt>SHA</dt>
        <dd>
          <span className="info-sha">{commit.sha}</span>
          <CopyButton text={commit.sha} />
        </dd>
        {commit.parents.length > 0 && (
          <>
            <dt>Vorgänger</dt>
            <dd>
              {commit.parents.map((parent) => (
                <Parent key={parent} sha={parent} commits={commits} onChoose={onChoose} />
              ))}
            </dd>
          </>
        )}
        {pointing.length > 0 && (
          <>
            <dt>Branches</dt>
            <dd>
              {pointing.map((ref) => (
                <span key={ref.name} className={`info-ref info-ref-${ref.kind}`}>
                  <span aria-hidden="true">{ref.kind === 'local' ? <BranchIcon /> : '☁'}</span>
                  {ref.name}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt>Änderungen</dt>
        <dd>
          <Stats stats={stats} />
        </dd>
      </dl>
      <div className="info-message">
        <div className="info-title">
          {commit.step !== null && <b>{commit.step}: </b>}
          {commit.title}
        </div>
        {details.body !== '' && <Body key={commit.sha} text={details.body} />}
        {details.trailers.map((trailer, index) => (
          <div key={index} className="info-trailer">
            <span className="info-quiet">{trailer.key}:</span> {trailer.value}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ein Vorgänger als kurze SHA mit Schritt; steht er in der Liste, wählt ein Klick ihn. */
function Parent({
  sha,
  commits,
  onChoose,
}: {
  sha: string;
  commits: Commit[];
  onChoose: (comparison: Comparison) => void;
}) {
  const parent = commits.find((commit) => commit.sha === sha);
  if (parent === undefined) {
    return <span className="info-parent info-sha">{sha.slice(0, 7)}</span>;
  }
  return (
    <button
      type="button"
      className="info-parent"
      data-tip={`${parent.step === null ? '' : `${parent.step}: `}${parent.title}`}
      onClick={() => {
        onChoose({ from: null, to: sha });
      }}
    >
      <span className="info-sha">{sha.slice(0, 7)}</span>
      {parent.step !== null && <b>{parent.step}</b>}
    </button>
  );
}

function RangeInfo({
  worktree,
  commits,
  from,
  to,
  stats,
  onChoose,
}: CommitInfoProps & { from: string; to: string; stats: ChangeStats | null }) {
  const { value: between, error } = useLoaded(`${worktree}\n${from}\n${to}`, () =>
    commitsBetween({ data: { worktree, comparison: { from, to } } }).then((list) => ({ from, to, list })),
  );
  const older = commits.find((commit) => commit.sha === between?.from);
  const newer = commits.find((commit) => commit.sha === between?.to);
  if (error !== null) {
    return <p className="info-quiet">{error}</p>;
  }
  if (between === null || older === undefined || newer === undefined) {
    return null;
  }
  const count = between.list.length;
  return (
    <div className="info-range">
      <ComparedCommit commit={older} side="old" />
      <ComparedCommit commit={newer} side="new" />
      <div className="info-sum">
        {count} {count === 1 ? 'Commit' : 'Commits'} seit {older.step ?? older.sha.slice(0, 7)} <Stats stats={stats} />
      </div>
      <ol className="info-between">
        {between.list.map((entry) => (
          <BetweenRow key={entry.commit.sha} entry={entry} onChoose={onChoose} />
        ))}
      </ol>
    </div>
  );
}

function BetweenRow({ entry, onChoose }: { entry: RangeCommit; onChoose: (comparison: Comparison) => void }) {
  const { commit, stats } = entry;
  return (
    <li>
      <button
        type="button"
        className="info-between-commit"
        data-tip="Diesen Commit allein zeigen"
        onClick={() => {
          onChoose({ from: null, to: commit.sha });
        }}
      >
        <b className="info-between-step">{commit.step ?? ''}</b>
        <span className="info-between-title">{commit.title}</span>
        <Stats stats={stats} />
        <span className="info-date">{commit.committed}</span>
      </button>
    </li>
  );
}

/** Dateien und Zeilen in den Farben des Diffs; solange sie fehlen, drei Punkte. */
function Stats({ stats }: { stats: ChangeStats | null }) {
  if (stats === null) {
    return <span className="info-stats info-quiet">…</span>;
  }
  return (
    <span className="info-stats">
      {stats.files} {stats.files === 1 ? 'Datei' : 'Dateien'}
      <span className="info-added">+{stats.added}</span>
      <span className="info-removed">−{stats.removed}</span>
    </span>
  );
}

/** Die Nachricht nach dem Titel, wie sie im Commit steht; eine lange lässt sich aufklappen. */
function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = body.current;
    if (element !== null && !open) {
      setClipped(element.scrollHeight > element.clientHeight + 1);
    }
  }, [text, open]);
  return (
    <>
      <div
        ref={body}
        className={open ? 'info-body' : 'info-body info-body-clipped'}
        style={{ '--info-lines': BODY_LINES } as CSSProperties}
      >
        {text}
      </div>
      {(clipped || open) && (
        <button
          type="button"
          className="info-more"
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? 'weniger' : 'mehr …'}
        </button>
      )}
    </>
  );
}

/** Kopiert einen Text in die Zwischenablage und bestätigt es kurz im Tooltip. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="info-copy"
      aria-label="SHA kopieren"
      data-tip={copied ? 'Kopiert' : 'SHA kopieren'}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
    >
      ⧉
    </button>
  );
}
