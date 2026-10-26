import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { Commit, SyncAction, SyncPlan } from '../git/types';
import { syncBranch, syncPlan } from '../server/repo.functions';
import { ChevronIcon } from './Icons';
import { MenuItem, MenuNote, MenuSection } from './Menu';

/** Die Breite des Menüs in Pixeln, wie in `.sync-menu`. */
const MENU_WIDTH = 330;

/** So viele Commits je Seite zeigt der Dialog, bevor die Liste aufgeklappt wird. */
const COLLAPSED = 8;

/** Der Abstand des Menüs zum Badge und zum Rand des Fensters, in Pixeln. */
const GAP = 6;

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function commits(count: number): string {
  return count === 1 ? '1 Commit' : `${String(count)} Commits`;
}

/**
 * Merge und harter Reset eines lokalen Branches mit seinem Branch auf dem Remote, geöffnet vom
 * Abstand in seinem Badge. Erst steht ein Menü unter dem Badge, nach der Wahl ein Dialog zur
 * Bestätigung. Beide fragen den Server nach dem Stand, damit sie zeigen, was wirklich geschieht.
 */
export function SyncMenu({
  worktree,
  branch,
  at,
  onClose,
}: {
  worktree: string;
  branch: string;
  at: DOMRect;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<SyncAction | null>(null);
  useEffect(() => {
    let current = true;
    syncPlan({ data: { worktree, branch } }).then(
      (loaded) => {
        if (current) {
          setPlan(loaded);
        }
      },
      (failure: unknown) => {
        if (current) {
          setError(messageOf(failure));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [worktree, branch]);

  if (action !== null && plan !== null) {
    return <SyncDialog worktree={worktree} plan={plan} action={action} onClose={onClose} />;
  }
  return <SyncChoice branch={branch} plan={plan} error={error} at={at} onAction={setAction} onClose={onClose} />;
}

/**
 * Das Menü unter dem Badge. Es steht fest im Fenster, weil die Commit-Liste es sonst abschneiden
 * würde. Ein Klick daneben, Escape und Scrollen schließen es.
 */
function SyncChoice({
  branch,
  plan,
  error,
  at,
  onAction,
  onClose,
}: {
  branch: string;
  plan: SyncPlan | null;
  error: string | null;
  at: DOMRect;
  onAction: (action: SyncAction) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const remote = plan?.remote ?? `origin/${branch}`;
  const left = Math.max(GAP, Math.min(at.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - GAP));
  let mergeSub: string | undefined;
  let mergeDisabled = plan === null;
  if (plan !== null) {
    if (plan.tracking.behind === 0) {
      mergeSub = `${remote} hat keine Commits, die ${branch} fehlen`;
      mergeDisabled = true;
    } else if (plan.worktree !== null) {
      mergeSub = `Im Worktree ${plan.worktree.name}`;
    } else if (plan.tracking.ahead > 0) {
      mergeSub = `Nicht möglich: ${branch} ist nirgends ausgecheckt und hat eigene Commits`;
      mergeDisabled = true;
    } else {
      mergeSub = 'Fast-Forward, ohne Worktree';
    }
  }
  const resetSub =
    plan === null ? undefined : plan.worktree !== null ? `Im Worktree ${plan.worktree.name}` : 'Nur den Branch verschieben, ohne Worktree';
  return (
    <div
      ref={root}
      className="menu-panel sync-menu"
      role="menu"
      aria-label={`Merge oder Reset von ${branch}`}
      style={{ top: at.bottom + GAP, left }}
    >
      <MenuSection>
        {branch} und {remote}
      </MenuSection>
      <div className="menu-row">
        <MenuItem
          main={`Merge ${remote} in ${branch}`}
          sub={mergeSub}
          disabled={mergeDisabled}
          onChoose={() => {
            onAction('merge');
          }}
        />
      </div>
      <div className="menu-row">
        <MenuItem
          main={`Reset (hart) ${branch} auf ${remote}`}
          sub={resetSub}
          disabled={plan === null}
          onChoose={() => {
            onAction('reset');
          }}
        />
      </div>
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </div>
  );
}

/**
 * Die Bestätigung: wo die Aktion läuft, welcher Commit auf welchen gesetzt wird und welche Commits
 * dazukommen oder wegfallen. Lokale Änderungen, die ein Reset verwirft, stehen als Warnung da.
 */
function SyncDialog({
  worktree,
  plan,
  action,
  onClose,
}: {
  worktree: string;
  plan: SyncPlan;
  action: SyncAction;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // Der Fokus steht auf „Abbrechen“, damit Return nichts auslöst, was sich nicht rückgängig machen lässt.
  useEffect(() => {
    dialog.current?.showModal();
    cancel.current?.focus();
  }, []);

  const { branch, remote, tracking } = plan;
  const merge = action === 'merge';
  const fastForward = tracking.ahead === 0;
  // Nur ein Merge mit eigenen Commits auf beiden Seiten führt zwei Commits zusammen.
  const joins = merge && !fastForward;
  const where =
    plan.worktree === null ? (
      <p>
        <b>{branch}</b> ist in keinem Worktree ausgecheckt. Verschoben wird nur der Branch, an den Dateien
        ändert sich nichts.
      </p>
    ) : (
      <p>
        Im Worktree <b>{plan.worktree.name}</b>, in dem {branch} ausgecheckt ist:
        <span className="sync-path">{plan.worktree.path}</span>
      </p>
    );
  const result = merge
    ? fastForward
      ? `Fast-Forward: ${branch} rückt auf den Commit von ${remote} vor.`
      : `Ein neuer Merge-Commit auf ${branch} vereint beide Seiten. Bei Konflikten wird der Merge abgebrochen, und ${branch} bleibt unverändert.`
    : `${branch} wird hart auf den Commit von ${remote} gesetzt.`;
  const run = () => {
    setRunning(true);
    setError(null);
    syncBranch({ data: { worktree, branch, action, local: plan.local.sha, upstream: plan.upstream.sha } })
      .then(() => router.invalidate())
      .then(onClose, (failure: unknown) => {
        setError(messageOf(failure));
        setRunning(false);
      });
  };
  return (
    <dialog
      ref={dialog}
      className="sync-dialog"
      aria-labelledby="sync-title"
      onCancel={(event) => {
        if (running) {
          event.preventDefault();
        } else {
          onClose();
        }
      }}
    >
      <h2 id="sync-title">{merge ? `Merge ${remote} in ${branch}` : `Reset (hart) ${branch} auf ${remote}`}</h2>
      {where}
      <div className="sync-commits">
        <CommitCard label={`${branch} jetzt`} commit={plan.local} />
        <span className="sync-arrow" aria-hidden="true">
          {joins ? '+' : '→'}
        </span>
        <CommitCard label={joins ? remote : `${remote}, danach auch ${branch}`} commit={plan.upstream} />
      </div>
      <p>{result}</p>
      {tracking.assumed && (
        <p className="sync-quiet">Für {branch} ist kein Upstream eingerichtet; es gilt {remote}.</p>
      )}
      <CommitList title={`Kommen von ${remote} dazu: ${commits(tracking.behind)}`} commits={plan.behind} count={tracking.behind} />
      {!merge && (
        <CommitList
          title={`Fallen auf ${branch} weg: ${commits(tracking.ahead)}`}
          commits={plan.ahead}
          count={tracking.ahead}
          lost
        />
      )}
      {plan.worktree !== null && plan.changes && (
        <p className="sync-warning">
          {merge
            ? 'Der Worktree hat lokale Änderungen. Berührt der Merge dieselben Dateien, bricht Git ab, ohne etwas zu ändern.'
            : 'Der Worktree hat lokale Änderungen an Dateien, die Git kennt. Der Reset verwirft sie unwiderruflich.'}
        </p>
      )}
      {!merge && plan.worktree !== null && plan.untracked && (
        <p className="sync-quiet">Neue Dateien, die Git noch nicht kennt, bleiben erhalten.</p>
      )}
      {error !== null && <p className="sync-error">{error}</p>}
      <div className="sync-buttons">
        <button ref={cancel} type="button" className="tool" disabled={running} onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className={merge ? 'tool tool-primary' : 'tool tool-primary tool-danger'}
          disabled={running}
          onClick={run}
        >
          {running ? 'Läuft …' : merge ? 'Mergen' : 'Hart zurücksetzen'}
        </button>
      </div>
    </dialog>
  );
}

/** Ein Commit mit SHA, Titel, Autor und Datum. */
function CommitCard({ label, commit }: { label: string; commit: Commit }) {
  return (
    <div className="sync-card">
      <div className="sync-label">{label}</div>
      <div className="sync-title">
        <span className="commit-sha">{commit.sha.slice(0, 7)}</span> {commit.step === null ? '' : `${commit.step}: `}
        {commit.title}
      </div>
      <div className="sync-quiet">
        {commit.author}, {commit.date}
      </div>
    </div>
  );
}

/**
 * Die neuesten Commits einer Seite; `count` zählt alle. Zuerst stehen nur die neuesten da, ein Klick
 * auf die Zeile darunter klappt die übrigen auf. Was der Server nicht mitgeschickt hat, steht als
 * Zahl darunter.
 */
function CommitList({ title, commits: listed, count, lost }: { title: string; commits: Commit[]; count: number; lost?: boolean }) {
  const [open, setOpen] = useState(false);
  if (count === 0) {
    return null;
  }
  const foldable = listed.length > COLLAPSED + 1;
  const shown = foldable && !open ? listed.slice(0, COLLAPSED) : listed;
  return (
    <div className={lost === true ? 'sync-list sync-lost' : 'sync-list'}>
      <div className="sync-label">{title}</div>
      <ul>
        {shown.map((commit) => (
          <li key={commit.sha}>
            <span className="commit-sha">{commit.sha.slice(0, 7)}</span>{' '}
            {commit.step === null ? '' : `${commit.step}: `}
            {commit.title}
            <span className="sync-quiet"> · {commit.date}</span>
          </li>
        ))}
        {foldable && (
          <li>
            <button
              type="button"
              className="sync-more"
              aria-expanded={open}
              onClick={() => {
                setOpen(!open);
              }}
            >
              <ChevronIcon open={open} size={8} />
              {open ? 'Weniger zeigen' : `und ${commits(listed.length - COLLAPSED)} mehr`}
            </button>
          </li>
        )}
        {(open || !foldable) && count > listed.length && (
          <li className="sync-quiet">und {commits(count - listed.length)} mehr, nicht geladen</li>
        )}
      </ul>
    </div>
  );
}
