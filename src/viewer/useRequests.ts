import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { takeRequest } from '../server/repo.functions';
import type { ViewSearch } from '../server/store';

/** Der Abstand der Fragen nach einer Ansicht vom Kommando `schrittmacher`, in Millisekunden. */
const REQUEST_INTERVAL = 1500;

/**
 * Holt die Ansichten ab, die das Kommando `schrittmacher <pfad>` beim Server anfordert. Ein Tab
 * geht an `openTab`, eine Markdown-Datei öffnet die Ansicht unter `/markdown`. Gefragt wird beim
 * Start, regelmäßig, solange das Fenster sichtbar ist, und sofort, wenn es sichtbar wird, weil das
 * Kommando die Web-App danach nach vorn holt.
 */
export function useRequests(openTab: (target: ViewSearch) => Promise<void>) {
  const navigate = useNavigate();
  const latest = useRef({ openTab, navigate });
  latest.current = { openTab, navigate };
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') {
        return;
      }
      busy = true;
      try {
        const requested = await takeRequest();
        if (requested?.kind === 'tab') {
          await latest.current.openTab(requested.view);
        } else if (requested?.kind === 'markdown') {
          await latest.current.navigate({ to: '/markdown', search: { path: requested.path } });
        }
      } catch {
        // Der Server ist kurz nicht erreichbar; die nächste Frage versucht es wieder.
      } finally {
        busy = false;
      }
    };
    const onCheck = () => {
      void check();
    };
    onCheck();
    const timer = setInterval(onCheck, REQUEST_INTERVAL);
    document.addEventListener('visibilitychange', onCheck);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onCheck);
    };
  }, []);
}
