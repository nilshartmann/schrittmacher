import { useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { OpenApp } from '../server/apps';
import {
  addWerkstattWorktree,
  loadProbePlan,
  openWorktreeIn,
  removeProbe,
  startProbe,
} from '../server/repo.functions';
import type { ProbePlan, WerkstattRow, WerkstattStatus } from '../server/werkstatt';
import { ClaudeIcon, CloudIcon, QrIcon, TerminalIcon, TrashIcon, WorkshopIcon } from './Icons';
import { ContextMenu, Menu, MenuItem, MenuNote } from './Menu';
import { PublishDialog } from './PublishDialog';
import { ShortlinkDialog } from './ShortlinkDialog';
import { TabsContext } from './Tabs';

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Der Stand eines Branches als zweite Zeile im Menü. */
function stateOf(row: WerkstattRow, status: WerkstattStatus): string {
  if (row.branch === 'probe') {
    const start = status.probeStart;
    if (row.local) {
      const where = row.place === null || row.place === '' ? '' : `⌂ ${row.place} · `;
      return start === null ? `${where}ohne Startpunkt` : `${where}ab ${start.subject}`;
    }
    return 'Probe anlegen über den Knopf „Probe“ an einem Commit';
  }
  if (row.place !== null) {
    return row.place === '' ? 'im Haupt-Checkout' : `⌂ ${row.place}`;
  }
  if (row.branch === 'live_coding') {
    return 'fehlt noch, wird beim Veröffentlichen angelegt';
  }
  if (row.local || row.remote) {
    return row.local ? 'ohne Worktree, Klick legt ihn an' : 'nur auf origin, Klick legt Worktree an';
  }
  return 'fehlt noch';
}

/**
 * Der Knopf „Werkstatt“ in der Kopfzeile, siehe `docs/werkstatt.md`. Das Menü zeigt je Branch der
 * Werkstatt seinen Stand. Ein Klick auf einen Branch mit Worktree öffnet ihn als Tab, einer ohne
 * Worktree legt ihn an. Beim Überfahren öffnen Knöpfe den Worktree im Terminal, den von `werkstatt`
 * auch in Claude Code, und verwerfen die Probe. Darunter stehen Veröffentlichen und Kurzlink.
 */
export function WerkstattMenu({
  worktree,
  status,
  onChanged,
}: {
  worktree: string;
  status: WerkstattStatus;
  /** Lädt den Stand neu, nachdem sich ein Branch oder Worktree geändert hat. */
  onChanged: () => void;
}) {
  const tabs = useContext(TabsContext);
  const [publish, setPublish] = useState(false);
  const [shortlink, setShortlink] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showTab = (path: string, branch: string) => {
    void tabs?.show({ worktree: path, branch });
  };
  return (
    <>
      <Menu
        button={<WorkshopIcon />}
        label="Werkstatt"
        tip="Werkstatt"
        className="bar-tool"
        panelClassName="menu-panel-werkstatt"
      >
        {(close) => {
          const run = (work: () => Promise<void>) => {
            setError(null);
            work().then(close, (failure: unknown) => {
              setError(messageOf(failure));
            });
          };
          const openIn = (path: string, app: OpenApp) => {
            run(() => openWorktreeIn({ data: { worktree: path, app } }));
          };
          return (
            <>
              {status.rows.map((row) => {
                const path = row.worktree;
                const addable = path === null && (row.branch === 'main' || row.branch === 'schritte') && (row.local || row.remote);
                const choose =
                  path !== null
                    ? () => {
                        close();
                        showTab(path, row.branch);
                      }
                    : addable
                      ? () => {
                          run(async () => {
                            const added = await addWerkstattWorktree({
                              data: { worktree, branch: row.branch as 'main' | 'schritte' },
                            });
                            onChanged();
                            showTab(added, row.branch);
                          });
                        }
                      : undefined;
                return (
                  <div key={row.branch} className="menu-row">
                    <MenuItem
                      main={row.branch}
                      sub={stateOf(row, status)}
                      disabled={choose === undefined}
                      tip={path === null ? undefined : `Als Tab öffnen: ${path}`}
                      onChoose={choose ?? (() => {})}
                    />
                    {path !== null && (
                      <span className="menu-actions">
                        <ActionButton
                          label="Im Terminal öffnen"
                          onClick={() => {
                            openIn(path, 'terminal');
                          }}
                        >
                          <TerminalIcon />
                        </ActionButton>
                        {row.branch === 'werkstatt' && (
                          <ActionButton
                            label="In Claude Code öffnen"
                            onClick={() => {
                              openIn(path, 'claude');
                            }}
                          >
                            <ClaudeIcon />
                          </ActionButton>
                        )}
                        {row.branch === 'probe' && (
                          <ActionButton
                            label="Probe verwerfen …"
                            onClick={() => {
                              close();
                              setDiscard(true);
                            }}
                          >
                            <TrashIcon />
                          </ActionButton>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="menu-rule" />
              <MenuItem
                main="Veröffentlichen …"
                icon={<CloudIcon />}
                onChoose={() => {
                  close();
                  setPublish(true);
                }}
              />
              <MenuItem
                main="Kurzlink anlegen …"
                icon={<QrIcon />}
                onChoose={() => {
                  close();
                  setShortlink(true);
                }}
              />
              {error !== null && <MenuNote error>{error}</MenuNote>}
            </>
          );
        }}
      </Menu>
      {publish && (
        <PublishDialog
          worktree={worktree}
          onClose={() => {
            setPublish(false);
            onChanged();
          }}
        />
      )}
      {shortlink && (
        <ShortlinkDialog
          worktree={worktree}
          initial={null}
          onClose={() => {
            setShortlink(false);
          }}
        />
      )}
      {discard && (
        <ProbeDialog
          worktree={worktree}
          target={null}
          onDone={onChanged}
          onClose={() => {
            setDiscard(false);
          }}
        />
      )}
    </>
  );
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="menu-action" aria-label={label} data-tip={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** Ein Commit, an dem die Probe beginnen soll. */
export interface ProbeTarget {
  sha: string;
  /** Nummer und Titel des Commits für das Menü und die Bestätigung. */
  label: string;
}

/**
 * Das Menü am Knopf „Probe“ eines Commits. Gibt es noch keine Probe, legt es sie dort an und öffnet
 * ihren Tab. Sonst führt es zur Bestätigung, die nennt, was beim Neuaufsetzen verloren geht.
 */
export function ProbeMenu({
  worktree,
  status,
  target,
  at,
  onDone,
  onClose,
}: {
  worktree: string;
  status: WerkstattStatus;
  target: ProbeTarget;
  at: { x: number; y: number };
  onDone: () => void;
  onClose: () => void;
}) {
  const tabs = useContext(TabsContext);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exists = status.rows.some((row) => row.branch === 'probe' && row.local);
  if (confirm) {
    return <ProbeDialog worktree={worktree} target={target} onDone={onDone} onClose={onClose} />;
  }
  return (
    <ContextMenu at={at} label="Probe" onClose={onClose}>
      <MenuItem
        main={exists ? 'Probe hierher neu aufsetzen …' : 'Probe ab hier'}
        sub={target.label}
        icon={<WorkshopIcon />}
        onChoose={() => {
          if (exists) {
            setConfirm(true);
            return;
          }
          setError(null);
          startProbe({ data: { worktree, target: target.sha, expected: null } }).then(
            (path) => {
              onDone();
              onClose();
              void tabs?.show({ worktree: path, branch: 'probe' });
            },
            (failure: unknown) => {
              setError(messageOf(failure));
            },
          );
        }}
      />
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </ContextMenu>
  );
}

/**
 * Die Bestätigung, bevor die Probe auf `target` neu aufgesetzt oder ohne `target` verworfen wird. Sie
 * nennt die Commits und lokalen Änderungen, die dabei verloren gehen.
 */
function ProbeDialog({
  worktree,
  target,
  onDone,
  onClose,
}: {
  worktree: string;
  target: ProbeTarget | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const tabs = useContext(TabsContext);
  const [plan, setPlan] = useState<ProbePlan | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Der Fokus steht auf „Abbrechen“, damit Return nichts verwirft.
  useEffect(() => {
    dialog.current?.showModal();
    cancel.current?.focus();
    loadProbePlan({ data: { worktree, target: target?.sha } }).then(setPlan, (failure: unknown) => {
      setError(messageOf(failure));
    });
  }, []);
  const run = () => {
    if (plan?.current == null) {
      return;
    }
    const current = plan.current;
    setRunning(true);
    setError(null);
    const work =
      target === null
        ? removeProbe({ data: { worktree, expected: current } })
        : startProbe({ data: { worktree, target: target.sha, expected: current } });
    work
      .then(async () => {
        onDone();
        if (target === null) {
          const open = tabs?.tabs.find((tab) => tab.branch === 'probe');
          if (open !== undefined) {
            tabs?.close(open);
          }
        } else {
          await router.invalidate();
        }
        onClose();
      })
      .catch((failure: unknown) => {
        setError(messageOf(failure));
        setRunning(false);
      });
  };
  return (
    <dialog
      ref={dialog}
      className="sync-dialog"
      aria-labelledby="probe-title"
      onCancel={(event) => {
        if (running) {
          event.preventDefault();
        } else {
          onClose();
        }
      }}
    >
      <h2 id="probe-title">{target === null ? 'Probe verwerfen' : 'Probe neu aufsetzen'}</h2>
      {target === null ? (
        <p>Worktree und Branch probe werden entfernt.</p>
      ) : (
        <p>
          Die Probe beginnt danach neu bei <b>{target.label}</b>.
        </p>
      )}
      {plan === null && error === null && <p className="sync-quiet">Prüft die Probe …</p>}
      {plan !== null && (
        <>
          <div className="sync-list sync-lost">
            <div className="sync-label">Commits, die verloren gehen</div>
            {plan.lost.length === 0 ? (
              <p className="sync-quiet">Keine.</p>
            ) : (
              <ul>
                {plan.lost.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
          {plan.changes.length > 0 && (
            <div className="sync-list sync-lost">
              <div className="sync-label">Lokale Änderungen, auch neue Dateien, die verloren gehen</div>
              <ul>
                {plan.changes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {error !== null && <p className="sync-error">{error}</p>}
      <div className="sync-buttons">
        <button ref={cancel} type="button" className="tool" disabled={running} onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className="tool tool-primary tool-danger"
          disabled={running || plan?.current == null}
          onClick={run}
        >
          {running ? 'Läuft …' : target === null ? 'Verwerfen' : 'Neu aufsetzen'}
        </button>
      </div>
    </dialog>
  );
}
