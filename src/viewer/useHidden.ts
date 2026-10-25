import { useState } from 'react';
import { toggleHidden } from '../git/hidden';
import type { Hidden } from '../git/hidden';
import { saveHidden } from '../server/repo.functions';

/**
 * Die ausgeblendeten Branches eines Repos und eine Funktion, die einen Branch oder eine Gruppe
 * umschaltet. Eine Änderung gilt sofort und wird gleich im Server gespeichert. Nach einem Wechsel
 * des Repos gilt wieder, was der Server geliefert hat.
 */
export function useHidden(repoPath: string, worktree: string, saved: Hidden): [Hidden, (path: string) => void] {
  const [changed, setChanged] = useState<{ repoPath: string; hidden: Hidden } | null>(null);
  const hidden = changed?.repoPath === repoPath ? changed.hidden : saved;
  const toggle = (path: string) => {
    const next = toggleHidden(hidden, path);
    setChanged({ repoPath, hidden: next });
    saveHidden({ data: { worktree, hidden: next } }).catch((error: unknown) => {
      console.error('Die ausgeblendeten Branches ließen sich nicht speichern.', error);
    });
  };
  return [hidden, toggle];
}
