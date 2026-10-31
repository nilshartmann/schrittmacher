import { useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  createParticipantRepo,
  loadPublishStatus,
  loadPushPlan,
  publishToParticipants,
  startLiveCoding,
  switchParticipantVisibility,
} from '../server/repo.functions';
import type { BranchState, PublishStatus, PublishedBranch, PushPlan } from '../server/publish';
import { TabsContext } from './Tabs';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Eine Bestätigung, die den Stand im Dialog ersetzt, bis sie entschieden ist. */
type Confirm =
  | { kind: 'push'; branch: PublishedBranch; plan: PushPlan }
  | { kind: 'visibility'; to: 'public' | 'private' };

/** Der Stand eines Branches in Worten. */
function branchText(state: BranchState): string {
  if (state.local === null) {
    return 'gibt es im Werkstatt-Repo noch nicht';
  }
  if (state.remote === null) {
    return 'noch nicht veröffentlicht';
  }
  return state.local === state.remote ? 'veröffentlicht, gleicher Stand' : 'veröffentlicht, weicht vom Werkstatt-Repo ab';
}

/** Eine Zeile der Übersicht: Schritt, Stand und Knopf. */
function Step({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="publish-step">
      <div className="publish-step-text">
        <div className="publish-step-title">{title}</div>
        {children}
      </div>
      {action !== undefined && <div className="publish-step-action">{action}</div>}
    </div>
  );
}

/**
 * Der Dialog „Veröffentlichen …“, siehe `docs/veroeffentlichen.md`. Er zeigt für jeden Schritt den
 * Stand und einen Knopf für das, was als Nächstes geht: Teilnehmer-Repo anlegen und sichtbar
 * schalten, `main` und `schritte` pushen, `live_coding` anlegen. Jeder Push und jedes Umschalten
 * wird vorher bestätigt; ein Force-Push nennt die Commits, die verschwinden.
 */
export function PublishDialog({ worktree, onClose }: { worktree: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tabs = useContext(TabsContext);
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    loadPublishStatus({ data: { worktree } }).then(
      (loaded) => {
        setStatus(loaded);
        setName((current) => (current === '' ? loaded.suggestion : current));
      },
      (failure: unknown) => {
        setError(messageOf(failure));
      },
    );
  useEffect(() => {
    dialog.current?.showModal();
    void reload();
    // Geladen wird einmal beim Öffnen, danach nach jeder Aktion.
  }, []);

  const run = (note: string, work: () => Promise<unknown>, then?: (result: unknown) => void) => {
    setRunning(note);
    setError(null);
    work()
      .then(async (result) => {
        setConfirm(null);
        await reload();
        then?.(result);
      })
      .catch((failure: unknown) => {
        setError(messageOf(failure));
      })
      .finally(() => {
        setRunning(null);
      });
  };
  const askPush = (branch: PublishedBranch) => {
    setRunning('Prüft, was der Push bewirkt …');
    setError(null);
    loadPushPlan({ data: { worktree, branch } }).then(
      (plan) => {
        setRunning(null);
        setConfirm({ kind: 'push', branch, plan });
      },
      (failure: unknown) => {
        setRunning(null);
        setError(messageOf(failure));
      },
    );
  };

  const busy = running !== null;
  const remote = status?.remote ?? null;
  let body: ReactNode;
  if (status === null) {
    body = error === null ? <p className="sync-quiet">Holt den Stand des Teilnehmer-Repos …</p> : null;
  } else if (confirm?.kind === 'push') {
    const { branch, plan } = confirm;
    const force = plan.lost.length > 0;
    body = (
      <>
        <p>
          <b>{branch}</b> geht an <b>{status.repo ?? remote}</b>. Danach sehen den Stand alle, die das Teilnehmer-Repo sehen.
        </p>
        <div className="sync-list">
          <div className="sync-label">Kommt dazu</div>
          {plan.added.length === 0 ? (
            <p className="sync-quiet">Keine neuen Commits.</p>
          ) : (
            <ul>
              {plan.added.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
        {force && (
          <>
            <div className="sync-list sync-lost">
              <div className="sync-label">Verschwindet im Teilnehmer-Repo</div>
              <ul>
                {plan.lost.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <p className="sync-warning">
              Das geht nur mit Force-Push. Wer das Teilnehmer-Repo schon geklont hat, dessen Klon passt danach nicht mehr.
            </p>
          </>
        )}
      </>
    );
  } else if (confirm?.kind === 'visibility') {
    body =
      confirm.to === 'public' ? (
        <>
          <p>
            <b>{status.repo}</b> wird öffentlich.
          </p>
          <p className="sync-warning">
            Jeder sieht dann die ganze Historie aller gepushten Branches. Was einmal öffentlich war, kann schon geklont sein.
          </p>
        </>
      ) : (
        <>
          <p>
            <b>{status.repo}</b> wird privat.
          </p>
          <p className="sync-warning">Sterne und Watcher gehen verloren, öffentliche Forks lösen sich vom Repo.</p>
        </>
      );
  } else {
    const { main, schritte, live_coding: live } = status.branches;
    const mainBlocked = status.placeholder.length > 0;
    body = (
      <>
        {status.problems.map((problem) => (
          <p key={problem} className="sync-error">
            {problem}
          </p>
        ))}
        <Step
          title="Teilnehmer-Repo"
          action={
            remote === null ? (
              <button
                type="button"
                className="tool tool-small tool-primary"
                disabled={busy || name.trim() === ''}
                onClick={() => {
                  run('Legt das Teilnehmer-Repo an …', () => createParticipantRepo({ data: { worktree, name: name.trim() } }));
                }}
              >
                Anlegen
              </button>
            ) : status.visibility === null ? undefined : (
              <button
                type="button"
                className="tool tool-small"
                disabled={busy}
                onClick={() => {
                  setConfirm({ kind: 'visibility', to: status.visibility === 'public' ? 'private' : 'public' });
                }}
              >
                {status.visibility === 'public' ? 'Privat schalten' : 'Öffentlich schalten'}
              </button>
            )
          }
        >
          {remote === null ? (
            <>
              <p className="sync-quiet">Gibt es noch nicht. Es entsteht privat.</p>
              <input
                className="menu-input"
                type="text"
                aria-label="Name des Teilnehmer-Repos"
                placeholder="org/name"
                value={name}
                disabled={busy}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </>
          ) : (
            <p className="sync-quiet">
              <span className="publish-repo">{status.repo ?? remote}</span>
              {status.visibility !== null && ` · ${status.visibility === 'public' ? 'öffentlich' : 'privat'}`}
              {remote !== 'teilnehmer' && ` · Remote „${remote}“`}
            </p>
          )}
        </Step>
        <Step
          title="Startpunkt (main)"
          action={
            <button
              type="button"
              className="tool tool-small"
              disabled={busy || remote === null || main.local === null || mainBlocked || main.local === main.remote}
              onClick={() => {
                askPush('main');
              }}
            >
              main veröffentlichen
            </button>
          }
        >
          {mainBlocked ? (
            <p className="shortlink-warning">
              Auf main steht noch der Platzhalter ORG/TEILNEHMER-REPO, in {status.placeholder.join(', ')}. Claude ersetzt ihn im
              Startpunkt.
            </p>
          ) : (
            <p className="sync-quiet">{branchText(main)}</p>
          )}
        </Step>
        <Step
          title="Live-Coding (live_coding)"
          action={
            status.liveWorktree === null ? (
              <button
                type="button"
                className="tool tool-small"
                disabled={busy || remote === null || main.remote === null}
                data-tip={main.remote === null ? 'Erst main veröffentlichen' : undefined}
                onClick={() => {
                  run(
                    'Legt live_coding an und veröffentlicht den Branch …',
                    () => startLiveCoding({ data: { worktree } }),
                    (path) => {
                      // Danach beginnt das Live-Coding: Der Tab kommt nach vorn, der Dialog geht zu.
                      if (typeof path === 'string' && tabs !== null) {
                        void tabs.show({ worktree: path, branch: 'live_coding' });
                        onClose();
                      }
                    },
                  );
                }}
              >
                live_coding anlegen
              </button>
            ) : (
              <button
                type="button"
                className="tool tool-small"
                disabled={busy || tabs === null}
                onClick={() => {
                  const path = status.liveWorktree;
                  if (path !== null) {
                    void tabs?.show({ worktree: path, branch: 'live_coding' });
                    onClose();
                  }
                }}
              >
                Als Tab öffnen
              </button>
            )
          }
        >
          <p className="sync-quiet">
            {status.liveWorktree === null
              ? live.local === null
                ? 'Wird vor Beginn aus main angelegt. Danach geht jeder Push aus dem Tab „Live“ an die Teilnehmer.'
                : `${branchText(live)}, aber ohne Worktree`
              : `${branchText(live)}, ausgecheckt in ${status.liveWorktree}`}
          </p>
        </Step>
        <Step
          title="Musterlösungen (schritte)"
          action={
            <button
              type="button"
              className="tool tool-small"
              disabled={busy || remote === null || schritte.local === null || schritte.local === schritte.remote}
              onClick={() => {
                askPush('schritte');
              }}
            >
              schritte veröffentlichen
            </button>
          }
        >
          <p className="sync-quiet">{branchText(schritte)}. Geht erst nach der Veranstaltung an die Teilnehmer.</p>
        </Step>
      </>
    );
  }

  let buttons: ReactNode;
  if (confirm?.kind === 'push') {
    const { branch, plan } = confirm;
    const force = plan.lost.length > 0;
    buttons = (
      <button
        type="button"
        className={force ? 'tool tool-primary tool-danger' : 'tool tool-primary'}
        autoFocus={!force}
        disabled={busy}
        onClick={() => {
          run(`Veröffentlicht ${branch} …`, () =>
            publishToParticipants({ data: { worktree, branch, force, expected: plan.expected } }),
          );
        }}
      >
        {force ? 'Mit Force veröffentlichen' : 'Veröffentlichen'}
      </button>
    );
  } else if (confirm?.kind === 'visibility') {
    const { to } = confirm;
    buttons = (
      <button
        type="button"
        className="tool tool-primary tool-danger"
        disabled={busy}
        onClick={() => {
          run('Schaltet die Sichtbarkeit um …', () => switchParticipantVisibility({ data: { worktree, visibility: to } }));
        }}
      >
        {to === 'public' ? 'Öffentlich schalten' : 'Privat schalten'}
      </button>
    );
  }

  return (
    <dialog
      ref={dialog}
      className="sync-dialog publish-dialog"
      aria-labelledby="publish-title"
      onCancel={(event) => {
        event.preventDefault();
        if (busy) {
          return;
        }
        if (confirm === null) {
          onClose();
        } else {
          setConfirm(null);
        }
      }}
    >
      <h2 id="publish-title">Veröffentlichen</h2>
      {body}
      {running !== null && <p className="sync-quiet">{running}</p>}
      {error !== null && <p className="sync-error">{error}</p>}
      <div className="sync-buttons">
        {confirm === null ? (
          <button type="button" className="tool tool-primary" autoFocus disabled={busy} onClick={onClose}>
            Schließen
          </button>
        ) : (
          <>
            <button
              type="button"
              className="tool"
              autoFocus={confirm.kind === 'push' && confirm.plan.lost.length > 0}
              disabled={busy}
              onClick={() => {
                setConfirm(null);
              }}
            >
              Abbrechen
            </button>
            {buttons}
          </>
        )}
      </div>
    </dialog>
  );
}
