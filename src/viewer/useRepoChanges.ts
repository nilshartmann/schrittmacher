import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { repoState } from '../server/repo.functions';

/** Der Abstand der Abfragen in Millisekunden. */
const INTERVAL = 1500;

/**
 * Lädt das Repo neu, sobald der Stand des Worktrees nicht mehr zu `state` passt, etwa nach einem
 * Commit aus Fork oder der IDE, mit `local` auch nach jeder lokalen Änderung. Abgefragt wird nur,
 * solange das Fenster sichtbar ist, und sofort, wenn es wieder sichtbar wird.
 */
export function useRepoChanges(worktree: string, state: string, local: boolean): void {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') {
        return;
      }
      busy = true;
      try {
        const next = await repoState({ data: { worktree, local } });
        if (active && next !== state) {
          await router.invalidate();
        }
      } catch {
        // Der Server ist kurz nicht erreichbar, etwa bei einem Neustart. Die nächste Abfrage
        // versucht es wieder, bis dahin bleibt der alte Stand stehen.
      } finally {
        busy = false;
      }
    };
    const onCheck = () => {
      void check();
    };
    const timer = setInterval(onCheck, INTERVAL);
    document.addEventListener('visibilitychange', onCheck);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onCheck);
    };
  }, [worktree, state, local, router]);
}
