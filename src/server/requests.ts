import { shared } from './shared';
import type { ViewSearch } from './store';

/**
 * Eine Ansicht, die ein Kommando angefordert hat: ein Worktree als Tab von `schrittmacher <ordner>`,
 * eine Markdown-Datei von `schrittmacher <datei.md>` oder der Editor von `schrittmacher edit`, mit
 * einer Datei, einem Workspace oder beidem.
 */
export type PageRequest =
  | { kind: 'tab'; view: ViewSearch }
  | { kind: 'markdown'; path: string }
  | { kind: 'edit'; path: string | null; root: string | null };

/** Die Art eines Fensters der Web-App: Viewer mit Tabs und Markdown-Ansicht oder Editor. */
export type WindowKind = 'viewer' | 'editor';

/**
 * So lange nach seiner letzten Frage gilt ein Fenster als offen, in Millisekunden. Ein offenes
 * Fenster fragt alle 1,5 Sekunden.
 */
const WINDOW_TIMEOUT = 5000;

/** Die zuletzt angeforderte Ansicht, bis ein Fenster sie abholt; eine neuere ersetzt sie. */
export const requested = shared('requests', () => ({ next: null as PageRequest | null }));

/** Der Zeitpunkt der letzten Frage je Art von Fenster. */
const seen = shared('windows', (): Record<WindowKind, number> => ({ viewer: 0, editor: 0 }));

/** Die Art von Fenster, an die eine Anforderung geht. */
function windowFor(request: PageRequest): WindowKind {
  return request.kind === 'edit' ? 'editor' : 'viewer';
}

/**
 * Liefert dem fragenden Fenster die angeforderte Ansicht einmal und vergisst sie dann. Sie geht an
 * ein Fenster ihrer Art. Hat sich keins davon in letzter Zeit gemeldet, nimmt sie auch ein Fenster
 * der anderen Art und wechselt dorthin. Ohne passende Anforderung `null`.
 */
export function takeFor(kind: WindowKind): PageRequest | null {
  const now = Date.now();
  seen[kind] = now;
  const next = requested.next;
  if (next === null) {
    return null;
  }
  const target = windowFor(next);
  if (target !== kind && now - seen[target] < WINDOW_TIMEOUT) {
    return null;
  }
  requested.next = null;
  return next;
}
