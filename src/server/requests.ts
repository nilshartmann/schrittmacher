import { shared } from './shared';
import type { ViewSearch } from './store';

/**
 * Eine Ansicht, die ein Kommando angefordert hat: ein Worktree als Tab von `schrittmacher <ordner>`
 * oder eine Markdown-Datei von `schrittmacher <datei.md>`.
 */
export type PageRequest = { kind: 'tab'; view: ViewSearch } | { kind: 'markdown'; path: string };

/** Die zuletzt angeforderte Ansicht, bis die Seite sie abholt; eine neuere ersetzt sie. */
export const requested = shared('requests', () => ({ next: null as PageRequest | null }));
