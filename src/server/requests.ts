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

/** Die zuletzt angeforderte Ansicht, bis die Seite sie abholt; eine neuere ersetzt sie. */
export const requested = shared('requests', () => ({ next: null as PageRequest | null }));
