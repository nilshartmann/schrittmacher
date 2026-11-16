import { shared } from './shared';
import type { ViewSearch } from './store';

/**
 * Eine Ansicht, die ein Kommando angefordert hat: ein Worktree als Tab von `schrittmacher <ordner>`,
 * eine Markdown-Datei von `schrittmacher <datei.md>` oder eine Datei für den Editor von
 * `schrittmacher edit <datei.md>`.
 */
export type PageRequest =
  | { kind: 'tab'; view: ViewSearch }
  | { kind: 'markdown'; path: string }
  | { kind: 'edit'; path: string };

/** Die zuletzt angeforderte Ansicht, bis die Seite sie abholt; eine neuere ersetzt sie. */
export const requested = shared('requests', () => ({ next: null as PageRequest | null }));
