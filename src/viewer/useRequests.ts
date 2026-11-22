import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { takeRequest } from '../server/repo.functions';
import type { WindowKind } from '../server/requests';
import type { ViewSearch } from '../server/store';

/** Die Suche der Seite `/edit` mit einer Datei, einem Workspace oder beidem. */
export function editSearch(path: string | null, root: string | null): { path?: string; root?: string } {
  return { ...(path === null ? {} : { path }), ...(root === null ? {} : { root }) };
}

/** Der Abstand der Fragen nach einer Ansicht vom Kommando `schrittmacher`, in Millisekunden. */
const REQUEST_INTERVAL = 1500;

/**
 * Holt die Ansichten ab, die das Kommando `schrittmacher <pfad>` beim Server anfordert. Ein Tab
 * geht an `openTab`, eine Markdown-Datei öffnet die Ansicht unter `/markdown`, eine Datei oder ein
 * Workspace für den Editor die Seite unter `/edit`. Mit `kind` sagt das Fenster, ob es Viewer
 * oder Editor ist. Der Server gibt ihm nur, was zu seiner Art gehört, solange auch ein Fenster der
 * anderen Art fragt (`takeFor`). Gefragt wird beim Start, regelmäßig, auch im Hintergrund, und
 * sofort, wenn das Fenster sichtbar wird, weil das Kommando die Web-App danach nach vorn holt.
 */
export function useRequests(kind: WindowKind, openTab: (target: ViewSearch) => Promise<void>) {
  const navigate = useNavigate();
  const latest = useRef({ openTab, navigate });
  latest.current = { openTab, navigate };
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        const requested = await takeRequest({ data: { window: kind } });
        if (requested?.kind === 'tab') {
          await latest.current.openTab(requested.view);
        } else if (requested?.kind === 'markdown') {
          await latest.current.navigate({ to: '/markdown', search: { path: requested.path } });
        } else if (requested?.kind === 'edit') {
          await latest.current.navigate({ to: '/edit', search: editSearch(requested.path, requested.root) });
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
  }, [kind]);
}
